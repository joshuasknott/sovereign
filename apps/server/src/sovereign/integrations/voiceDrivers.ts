// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC verification for voice and telephony webhooks.
import * as NodeCrypto from "node:crypto";
import {
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type RecordLedgerEntryInput,
  type VoiceAgentConfig,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { SovereignIntegrationError, SovereignPermissionError } from "../SovereignErrors.ts";
import type {
  SovereignIntegrationDriver,
  SovereignIntegrationDriverContext,
  SovereignIntegrationWebhookEvent,
} from "../SovereignIntegrationService.ts";
import {
  checkDisabledOrSandbox,
  constantTimeBase64Equal,
  constantTimeHexEqual,
  createFetchHttpTransport,
  decodeJsonRecord,
  encodeJsonString,
  extractSecretField,
  type HttpTransport,
  lookupHeaderCaseInsensitive,
  mapHttpStatusToTestResult,
  normalizeCurrencyCode,
  readNumberSetting,
  readStringSetting,
} from "./httpTransport.ts";

export type VoiceProviderKind = "vapi" | "retell" | "elevenlabs" | "twilio";

export interface VoiceCostEstimateInput {
  readonly durationSeconds: number;
  readonly telephonyRatePerMinuteMinor?: number;
  readonly voiceInferenceRatePerMinuteMinor?: number;
  readonly llmRatePerMinuteMinor?: number;
  readonly currency?: CurrencyCode;
}

export interface VoiceCostEstimate {
  readonly billedMinutes: number;
  readonly telephonyCostMinor: number;
  readonly voiceInferenceCostMinor: number;
  readonly llmCostMinor: number;
  readonly totalCostMinor: number;
  readonly currency: CurrencyCode;
}

export interface VoiceAgentSyncResult {
  readonly providerKind: VoiceProviderKind;
  readonly remoteAgentId: string;
  readonly synced: boolean;
  readonly sandbox: boolean;
  readonly aiDisclosureEnforced: boolean;
  readonly recordingDisclosureEnabled: boolean;
  readonly optOutPhraseEnabled: boolean;
  readonly message: string;
}

export interface ParsedInboundVoiceWebhook {
  readonly providerKind: VoiceProviderKind;
  readonly replayKey: string;
  readonly eventType: string;
  readonly callId: string;
  readonly durationSeconds: number;
  readonly direction: "inbound" | "outbound";
  readonly aiDisclosureDelivered: boolean;
  readonly recordingDisclosureDelivered: boolean;
  readonly callerOptedOut: boolean;
  readonly costEstimate: VoiceCostEstimate;
  readonly ledgerEntry: RecordLedgerEntryInput | null;
}

export interface VoiceProviderAdapter {
  readonly providerKind: VoiceProviderKind;
  readonly driver: SovereignIntegrationDriver;
  readonly syncVoiceAgent: (input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly voiceAgent: VoiceAgentConfig;
  }) => Effect.Effect<VoiceAgentSyncResult, SovereignIntegrationError | SovereignPermissionError>;
  readonly estimateCallCostMinor: (input: VoiceCostEstimateInput) => VoiceCostEstimate;
  readonly parseInboundCallWebhook: (input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly headers: Readonly<Record<string, string>>;
    readonly rawBody: Uint8Array;
  }) => Effect.Effect<ParsedInboundVoiceWebhook | null, SovereignIntegrationError>;
}

const DEFAULT_VAPI_API_BASE = "https://api.vapi.ai";
const DEFAULT_RETELL_API_BASE = "https://api.retellai.com";
const DEFAULT_ELEVENLABS_API_BASE = "https://api.elevenlabs.io";
const DEFAULT_TWILIO_API_BASE = "https://api.twilio.com";
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
const utf8Decoder = new TextDecoder();

const PROVIDER_DEFAULT_RATES_MINOR: Readonly<
  Record<
    VoiceProviderKind,
    { readonly telephony: number; readonly voiceInference: number; readonly llm: number }
  >
> = {
  vapi: { telephony: 2, voiceInference: 8, llm: 4 },
  retell: { telephony: 2, voiceInference: 7, llm: 4 },
  elevenlabs: { telephony: 1, voiceInference: 9, llm: 3 },
  twilio: { telephony: 3, voiceInference: 0, llm: 0 },
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const computeHmacSha256Hex = (secret: string, payload: string | Uint8Array): string =>
  NodeCrypto.createHmac("sha256", secret).update(payload).digest("hex");

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const readString = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null => {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readNumber = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null => {
  if (record === null) return null;
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readBoolean = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
  fallback: boolean,
): boolean => {
  if (record === null) return fallback;
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
};

export function estimateVoiceCallCostMinor(
  providerKind: VoiceProviderKind,
  input: VoiceCostEstimateInput,
): VoiceCostEstimate {
  const defaults = PROVIDER_DEFAULT_RATES_MINOR[providerKind];
  const safeDurationSeconds = Math.max(0, Math.round(input.durationSeconds));
  const billedMinutes = safeDurationSeconds === 0 ? 0 : Math.ceil(safeDurationSeconds / 60);
  const telephonyRate = Math.max(
    0,
    Math.round(input.telephonyRatePerMinuteMinor ?? defaults.telephony),
  );
  const voiceRate = Math.max(
    0,
    Math.round(input.voiceInferenceRatePerMinuteMinor ?? defaults.voiceInference),
  );
  const llmRate = Math.max(0, Math.round(input.llmRatePerMinuteMinor ?? defaults.llm));

  const telephonyCostMinor = billedMinutes * telephonyRate;
  const voiceInferenceCostMinor = billedMinutes * voiceRate;
  const llmCostMinor = billedMinutes * llmRate;

  return {
    billedMinutes,
    telephonyCostMinor,
    voiceInferenceCostMinor,
    llmCostMinor,
    totalCostMinor: telephonyCostMinor + voiceInferenceCostMinor + llmCostMinor,
    currency: input.currency ?? DEFAULT_REPORTING_CURRENCY,
  };
}

const assertVoiceAgentCompliance = (
  voiceAgent: VoiceAgentConfig,
): Effect.Effect<void, SovereignPermissionError> => {
  const greeting = voiceAgent.aiDisclosureGreeting.trim().toLowerCase();
  if (
    greeting.length === 0 ||
    (!greeting.includes("ai") &&
      !greeting.includes("artificial intelligence") &&
      !greeting.includes("automated") &&
      !greeting.includes("virtual assistant"))
  ) {
    return Effect.fail(
      new SovereignPermissionError({
        code: "permission_denied",
        reason:
          "Voice agents must include an explicit AI disclosure greeting before syncing to a telephony provider.",
        ventureId: voiceAgent.ventureId,
      }),
    );
  }
  return Effect.void;
};

const buildVoiceCostLedgerEntry = (input: {
  readonly context: SovereignIntegrationDriverContext;
  readonly providerKind: VoiceProviderKind;
  readonly callId: string;
  readonly durationSeconds: number;
  readonly totalCostMinor: number;
  readonly currency: CurrencyCode;
}): RecordLedgerEntryInput | null => {
  if (input.totalCostMinor <= 0) return null;
  return {
    ventureId: input.context.integration.ventureId,
    integrationId: input.context.integration.id,
    entryType: "telephony_cost",
    verificationState: "verified",
    amountMinor: input.totalCostMinor,
    currency: input.currency,
    description: `${input.providerKind} voice call ${input.callId} (${input.durationSeconds}s)`,
    externalRef: `${input.context.integration.id}:${input.providerKind}:${input.callId}`,
  };
};

const readCustomVoiceRates = (
  context: SovereignIntegrationDriverContext,
): Pick<
  VoiceCostEstimateInput,
  "telephonyRatePerMinuteMinor" | "voiceInferenceRatePerMinuteMinor" | "llmRatePerMinuteMinor"
> => {
  const telephonyRatePerMinuteMinor = readNumberSetting(
    context.integration.settings,
    "telephonyRatePerMinuteMinor",
  );
  const voiceInferenceRatePerMinuteMinor = readNumberSetting(
    context.integration.settings,
    "voiceInferenceRatePerMinuteMinor",
  );
  const llmRatePerMinuteMinor = readNumberSetting(
    context.integration.settings,
    "llmRatePerMinuteMinor",
  );
  return {
    ...(telephonyRatePerMinuteMinor === null ? {} : { telephonyRatePerMinuteMinor }),
    ...(voiceInferenceRatePerMinuteMinor === null ? {} : { voiceInferenceRatePerMinuteMinor }),
    ...(llmRatePerMinuteMinor === null ? {} : { llmRatePerMinuteMinor }),
  };
};

const toSovereignWebhookEvent = (
  parsed: ParsedInboundVoiceWebhook | null,
): SovereignIntegrationWebhookEvent | null => {
  if (parsed === null) return null;
  return {
    replayKey: parsed.replayKey,
    eventType: parsed.eventType,
    ...(parsed.ledgerEntry === null ? {} : { ledgerEntry: parsed.ledgerEntry }),
  };
};

export function verifyTwilioRequestSignature(input: {
  readonly authToken: string;
  readonly requestUrl: string;
  readonly formParams: Readonly<Record<string, string>>;
  readonly signatureHeader: string | undefined;
}): boolean {
  if (
    input.authToken.trim().length === 0 ||
    input.requestUrl.trim().length === 0 ||
    input.signatureHeader === undefined ||
    input.signatureHeader.trim().length === 0
  ) {
    return false;
  }
  const sortedKeys = Object.keys(input.formParams).sort();
  let payload = input.requestUrl;
  for (const key of sortedKeys) {
    payload += `${key}${input.formParams[key] ?? ""}`;
  }
  const expectedBase64 = NodeCrypto.createHmac("sha1", input.authToken)
    .update(payload)
    .digest("base64");
  return constantTimeBase64Equal(expectedBase64, input.signatureHeader);
}

const verifyTimestampedHmac = (input: {
  readonly secret: string;
  readonly rawBody: Uint8Array;
  readonly headerValue: string | undefined;
  readonly timestampKey: string;
  readonly signatureKey: string;
  readonly separator: string;
  readonly nowUnixSeconds: number;
}): boolean => {
  if (input.headerValue === undefined || input.headerValue.trim().length === 0) return false;
  let ts: string | null = null;
  let sig: string | null = null;
  for (const segment of input.headerValue.split(",")) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim();
    const val = segment.slice(eqIndex + 1).trim();
    if (key === input.timestampKey) ts = val;
    if (key === input.signatureKey) sig = val;
  }
  if (ts !== null && sig !== null && /^\d+$/.test(ts)) {
    const parsedTs = Number.parseInt(ts, 10);
    if (Math.abs(input.nowUnixSeconds - parsedTs) > DEFAULT_SIGNATURE_TOLERANCE_SECONDS) {
      return false;
    }
    const expected = computeHmacSha256Hex(
      input.secret,
      `${ts}${input.separator}${utf8Decoder.decode(input.rawBody)}`,
    );
    return constantTimeHexEqual(expected, sig);
  }
  const rawCandidate = input.headerValue.trim().replace(/^sha256=/i, "");
  const expectedRaw = computeHmacSha256Hex(input.secret, input.rawBody);
  return constantTimeHexEqual(expectedRaw, rawCandidate);
};

export function createVapiVoiceAdapter(options?: {
  readonly transport?: HttpTransport;
}): VoiceProviderAdapter {
  const transport = options?.transport ?? createFetchHttpTransport();

  const estimateCallCostMinor = (input: VoiceCostEstimateInput) =>
    estimateVoiceCallCostMinor("vapi", input);

  const parseInboundCallWebhook = Effect.fn("SovereignVoiceDrivers.vapi.parseInboundCallWebhook")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBody: Uint8Array;
    }) {
      const secret = extractSecretField(input.context.secret, [
        "webhookSecret",
        "apiKey",
        "secret",
      ]);
      if (secret === null) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "verify_webhook",
          reason: "Vapi webhook secret is not configured.",
        });
      }

      const hmacHeader =
        lookupHeaderCaseInsensitive(input.headers, "x-vapi-signature") ??
        lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
      const tokenHeader = lookupHeaderCaseInsensitive(input.headers, "x-vapi-secret");
      const hmacOk =
        hmacHeader !== undefined &&
        constantTimeHexEqual(
          computeHmacSha256Hex(secret, input.rawBody),
          hmacHeader.replace(/^sha256=/i, ""),
        );
      const tokenOk =
        tokenHeader !== undefined &&
        constantTimeBase64Equal(
          Buffer.from(secret, "utf8").toString("base64"),
          Buffer.from(tokenHeader.trim(), "utf8").toString("base64"),
        );

      if (!hmacOk && !tokenOk) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "verify_webhook",
          reason: "Vapi webhook signature verification failed.",
        });
      }

      const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
      if (payload === null) return null;
      const message = asRecord(payload.message) ?? payload;
      const call = asRecord(message.call) ?? asRecord(payload.call) ?? message;
      const eventType = readString(message, "type") ?? readString(payload, "type") ?? "call.ended";
      const callId = readString(call, "id") ?? readString(payload, "id");
      if (callId === null) return null;

      const durationSeconds = Math.max(
        0,
        Math.round(
          readNumber(message, "durationSeconds") ?? readNumber(call, "durationSeconds") ?? 0,
        ),
      );
      const currency = normalizeCurrencyCode(
        message.currency ?? call.currency,
        DEFAULT_REPORTING_CURRENCY,
      );
      const estimated = estimateCallCostMinor({
        durationSeconds,
        currency,
        ...readCustomVoiceRates(input.context),
      });
      const reportedCostMinor = readNumber(message, "costMinor");
      const totalCostMinor =
        reportedCostMinor !== null && reportedCostMinor >= 0
          ? Math.round(reportedCostMinor)
          : estimated.totalCostMinor;

      const directionRaw = readString(call, "type") ?? readString(call, "direction") ?? "inbound";
      const direction = directionRaw.toLowerCase().includes("outbound") ? "outbound" : "inbound";
      const compliance = asRecord(message.compliance) ?? asRecord(call.metadata);

      return {
        providerKind: "vapi",
        replayKey: `${eventType}:${callId}`,
        eventType,
        callId,
        durationSeconds,
        direction,
        aiDisclosureDelivered: readBoolean(compliance, "aiDisclosureDelivered", true),
        recordingDisclosureDelivered: readBoolean(compliance, "recordingDisclosureDelivered", true),
        callerOptedOut: readBoolean(compliance, "callerOptedOut", false),
        costEstimate: { ...estimated, totalCostMinor },
        ledgerEntry: buildVoiceCostLedgerEntry({
          context: input.context,
          providerKind: "vapi",
          callId,
          durationSeconds,
          totalCostMinor,
          currency,
        }),
      } satisfies ParsedInboundVoiceWebhook;
    },
  );

  const syncVoiceAgent = Effect.fn("SovereignVoiceDrivers.vapi.syncVoiceAgent")(function* (input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly voiceAgent: VoiceAgentConfig;
  }) {
    yield* assertVoiceAgentCompliance(input.voiceAgent);
    if (input.context.integration.sandboxMode) {
      return {
        providerKind: "vapi",
        remoteAgentId: `vapi_sandbox_${input.voiceAgent.id}`,
        synced: true,
        sandbox: true,
        aiDisclosureEnforced: true,
        recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
        optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
        message: "Voice agent synced to Vapi sandbox with mandatory AI disclosure greeting.",
      } satisfies VoiceAgentSyncResult;
    }

    const apiKey = extractSecretField(input.context.secret, ["apiKey", "token", "key"]);
    if (apiKey === null) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "sync_voice_agent",
        reason: "Vapi API key is not configured in secure credential storage.",
      });
    }

    const baseUrl = stripTrailingSlash(
      input.context.integration.endpointUrl ?? DEFAULT_VAPI_API_BASE,
    );
    const response = yield* transport
      .request({
        url: `${baseUrl}/assistant`,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: encodeJsonString({
          name: input.voiceAgent.name,
          firstMessage: input.voiceAgent.aiDisclosureGreeting,
          recordingEnabled: input.voiceAgent.recordingDisclosureEnabled,
          metadata: {
            sovereignVoiceAgentId: input.voiceAgent.id,
            aiDisclosureEnforced: true,
            recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
            optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
          },
        }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "sync_voice_agent",
              reason: "Failed to reach Vapi API while syncing voice agent.",
              cause,
            }),
        ),
      );

    if (response.status < 200 || response.status >= 300) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "sync_voice_agent",
        reason: `Vapi API rejected voice agent sync (HTTP ${response.status}).`,
      });
    }

    const parsed = decodeJsonRecord(response.bodyText);
    const remoteAgentId = readString(parsed, "id") ?? `vapi_${input.voiceAgent.id}`;
    return {
      providerKind: "vapi",
      remoteAgentId,
      synced: true,
      sandbox: false,
      aiDisclosureEnforced: true,
      recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
      optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
      message: "Voice agent synced to Vapi.",
    } satisfies VoiceAgentSyncResult;
  });

  const driver: SovereignIntegrationDriver = {
    providerKind: "vapi",
    testConnection: Effect.fn("SovereignVoiceDrivers.vapi.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Vapi");
      if (early !== null) return early;

      const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "Vapi requires an API key in secure credential storage.",
        };
      }

      const baseUrl = stripTrailingSlash(context.integration.endpointUrl ?? DEFAULT_VAPI_API_BASE);
      const response = yield* transport
        .request({
          url: `${baseUrl}/assistant?limit=1`,
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Vapi API endpoint.",
        };
      }
      return mapHttpStatusToTestResult("Vapi", response.value);
    }),
    verifyAndParseWebhook: (input) =>
      parseInboundCallWebhook(input).pipe(Effect.map(toSovereignWebhookEvent)),
  };

  return {
    providerKind: "vapi",
    driver,
    syncVoiceAgent,
    estimateCallCostMinor,
    parseInboundCallWebhook,
  };
}

export function createRetellVoiceAdapter(options?: {
  readonly transport?: HttpTransport;
  readonly nowUnixSeconds?: () => number;
}): VoiceProviderAdapter {
  const transport = options?.transport ?? createFetchHttpTransport();

  const estimateCallCostMinor = (input: VoiceCostEstimateInput) =>
    estimateVoiceCallCostMinor("retell", input);

  const parseInboundCallWebhook = Effect.fn("SovereignVoiceDrivers.retell.parseInboundCallWebhook")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBody: Uint8Array;
    }) {
      const secret = extractSecretField(input.context.secret, [
        "webhookSecret",
        "apiKey",
        "secret",
      ]);
      const signatureHeader =
        lookupHeaderCaseInsensitive(input.headers, "x-retell-signature") ??
        lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
      const nowUnixSeconds =
        options?.nowUnixSeconds !== undefined
          ? options.nowUnixSeconds()
          : Math.floor((yield* Clock.currentTimeMillis) / 1000);
      if (
        secret === null ||
        !verifyTimestampedHmac({
          secret,
          rawBody: input.rawBody,
          headerValue: signatureHeader,
          timestampKey: "v",
          signatureKey: "d",
          separator: "",
          nowUnixSeconds,
        })
      ) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "verify_webhook",
          reason: "Retell AI webhook signature verification failed.",
        });
      }

      const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
      if (payload === null) return null;
      const eventType = readString(payload, "event") ?? "call_ended";
      const call = asRecord(payload.call) ?? asRecord(payload.data) ?? payload;
      const callId = readString(call, "call_id") ?? readString(payload, "call_id");
      if (callId === null) return null;

      const durationMs = readNumber(call, "duration_ms");
      const durationSeconds = Math.max(
        0,
        Math.round(
          readNumber(call, "duration_seconds") ?? (durationMs === null ? 0 : durationMs / 1000),
        ),
      );
      const currency = normalizeCurrencyCode(call.currency, DEFAULT_REPORTING_CURRENCY);
      const estimated = estimateCallCostMinor({
        durationSeconds,
        currency,
        ...readCustomVoiceRates(input.context),
      });
      const metadata = asRecord(call.metadata);
      const directionRaw = readString(call, "direction") ?? "inbound";

      return {
        providerKind: "retell",
        replayKey: `${eventType}:${callId}`,
        eventType,
        callId,
        durationSeconds,
        direction: directionRaw.toLowerCase().includes("outbound") ? "outbound" : "inbound",
        aiDisclosureDelivered: readBoolean(metadata, "aiDisclosureDelivered", true),
        recordingDisclosureDelivered: readBoolean(metadata, "recordingDisclosureDelivered", true),
        callerOptedOut: readBoolean(metadata, "callerOptedOut", false),
        costEstimate: estimated,
        ledgerEntry: buildVoiceCostLedgerEntry({
          context: input.context,
          providerKind: "retell",
          callId,
          durationSeconds,
          totalCostMinor: estimated.totalCostMinor,
          currency,
        }),
      } satisfies ParsedInboundVoiceWebhook;
    },
  );

  const syncVoiceAgent = Effect.fn("SovereignVoiceDrivers.retell.syncVoiceAgent")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly voiceAgent: VoiceAgentConfig;
    }) {
      yield* assertVoiceAgentCompliance(input.voiceAgent);
      if (input.context.integration.sandboxMode) {
        return {
          providerKind: "retell",
          remoteAgentId: `retell_sandbox_${input.voiceAgent.id}`,
          synced: true,
          sandbox: true,
          aiDisclosureEnforced: true,
          recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
          optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
          message: "Voice agent synced to Retell AI sandbox with mandatory AI disclosure greeting.",
        } satisfies VoiceAgentSyncResult;
      }

      const apiKey = extractSecretField(input.context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sync_voice_agent",
          reason: "Retell AI API key is not configured in secure credential storage.",
        });
      }

      const baseUrl = stripTrailingSlash(
        input.context.integration.endpointUrl ?? DEFAULT_RETELL_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/create-agent`,
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: encodeJsonString({
            agent_name: input.voiceAgent.name,
            begin_message: input.voiceAgent.aiDisclosureGreeting,
            enable_recording: input.voiceAgent.recordingDisclosureEnabled,
            metadata: {
              sovereignVoiceAgentId: input.voiceAgent.id,
              aiDisclosureEnforced: true,
              optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
            },
          }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SovereignIntegrationError({
                integrationId: input.context.integration.id,
                stage: "sync_voice_agent",
                reason: "Failed to reach Retell AI API while syncing voice agent.",
                cause,
              }),
          ),
        );

      if (response.status < 200 || response.status >= 300) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sync_voice_agent",
          reason: `Retell AI API rejected voice agent sync (HTTP ${response.status}).`,
        });
      }

      const parsed = decodeJsonRecord(response.bodyText);
      const remoteAgentId = readString(parsed, "agent_id") ?? `retell_${input.voiceAgent.id}`;
      return {
        providerKind: "retell",
        remoteAgentId,
        synced: true,
        sandbox: false,
        aiDisclosureEnforced: true,
        recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
        optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
        message: "Voice agent synced to Retell AI.",
      } satisfies VoiceAgentSyncResult;
    },
  );

  const driver: SovereignIntegrationDriver = {
    providerKind: "retell",
    testConnection: Effect.fn("SovereignVoiceDrivers.retell.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Retell AI");
      if (early !== null) return early;

      const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "Retell AI requires an API key in secure credential storage.",
        };
      }

      const baseUrl = stripTrailingSlash(
        context.integration.endpointUrl ?? DEFAULT_RETELL_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/list-agents`,
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Retell AI API endpoint.",
        };
      }
      return mapHttpStatusToTestResult("Retell AI", response.value);
    }),
    verifyAndParseWebhook: (input) =>
      parseInboundCallWebhook(input).pipe(Effect.map(toSovereignWebhookEvent)),
  };

  return {
    providerKind: "retell",
    driver,
    syncVoiceAgent,
    estimateCallCostMinor,
    parseInboundCallWebhook,
  };
}

export function createElevenLabsVoiceAdapter(options?: {
  readonly transport?: HttpTransport;
  readonly nowUnixSeconds?: () => number;
}): VoiceProviderAdapter {
  const transport = options?.transport ?? createFetchHttpTransport();

  const estimateCallCostMinor = (input: VoiceCostEstimateInput) =>
    estimateVoiceCallCostMinor("elevenlabs", input);

  const parseInboundCallWebhook = Effect.fn(
    "SovereignVoiceDrivers.elevenlabs.parseInboundCallWebhook",
  )(function* (input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly headers: Readonly<Record<string, string>>;
    readonly rawBody: Uint8Array;
  }) {
    const secret = extractSecretField(input.context.secret, ["webhookSecret", "apiKey", "secret"]);
    const signatureHeader =
      lookupHeaderCaseInsensitive(input.headers, "elevenlabs-signature") ??
      lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
    const nowUnixSeconds =
      options?.nowUnixSeconds !== undefined
        ? options.nowUnixSeconds()
        : Math.floor((yield* Clock.currentTimeMillis) / 1000);
    if (
      secret === null ||
      !verifyTimestampedHmac({
        secret,
        rawBody: input.rawBody,
        headerValue: signatureHeader,
        timestampKey: "t",
        signatureKey: "v0",
        separator: ".",
        nowUnixSeconds,
      })
    ) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "verify_webhook",
        reason: "ElevenLabs webhook signature verification failed.",
      });
    }

    const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
    if (payload === null) return null;
    const eventType = readString(payload, "type") ?? "post_call_transcription";
    const data = asRecord(payload.data) ?? payload;
    const callId = readString(data, "conversation_id") ?? readString(data, "call_id");
    if (callId === null) return null;

    const metadata = asRecord(data.metadata);
    const durationSeconds = Math.max(
      0,
      Math.round(
        readNumber(metadata, "call_duration_secs") ?? readNumber(data, "duration_seconds") ?? 0,
      ),
    );
    const currency = normalizeCurrencyCode(data.currency, DEFAULT_REPORTING_CURRENCY);
    const estimated = estimateCallCostMinor({
      durationSeconds,
      currency,
      ...readCustomVoiceRates(input.context),
    });

    return {
      providerKind: "elevenlabs",
      replayKey: `${eventType}:${callId}`,
      eventType,
      callId,
      durationSeconds,
      direction: (readString(metadata, "direction") ?? "inbound").toLowerCase().includes("outbound")
        ? "outbound"
        : "inbound",
      aiDisclosureDelivered: readBoolean(metadata, "aiDisclosureDelivered", true),
      recordingDisclosureDelivered: readBoolean(metadata, "recordingDisclosureDelivered", true),
      callerOptedOut: readBoolean(metadata, "callerOptedOut", false),
      costEstimate: estimated,
      ledgerEntry: buildVoiceCostLedgerEntry({
        context: input.context,
        providerKind: "elevenlabs",
        callId,
        durationSeconds,
        totalCostMinor: estimated.totalCostMinor,
        currency,
      }),
    } satisfies ParsedInboundVoiceWebhook;
  });

  const syncVoiceAgent = Effect.fn("SovereignVoiceDrivers.elevenlabs.syncVoiceAgent")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly voiceAgent: VoiceAgentConfig;
    }) {
      yield* assertVoiceAgentCompliance(input.voiceAgent);
      if (input.context.integration.sandboxMode) {
        return {
          providerKind: "elevenlabs",
          remoteAgentId: `elevenlabs_sandbox_${input.voiceAgent.id}`,
          synced: true,
          sandbox: true,
          aiDisclosureEnforced: true,
          recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
          optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
          message:
            "Voice agent synced to ElevenLabs sandbox with mandatory AI disclosure greeting.",
        } satisfies VoiceAgentSyncResult;
      }

      const apiKey = extractSecretField(input.context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sync_voice_agent",
          reason: "ElevenLabs API key is not configured in secure credential storage.",
        });
      }

      const baseUrl = stripTrailingSlash(
        input.context.integration.endpointUrl ?? DEFAULT_ELEVENLABS_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/v1/convai/agents/create`,
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "content-type": "application/json",
          },
          body: encodeJsonString({
            name: input.voiceAgent.name,
            conversation_config: {
              agent: {
                first_message: input.voiceAgent.aiDisclosureGreeting,
              },
            },
            metadata: {
              sovereignVoiceAgentId: input.voiceAgent.id,
              recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
              optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
            },
          }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SovereignIntegrationError({
                integrationId: input.context.integration.id,
                stage: "sync_voice_agent",
                reason: "Failed to reach ElevenLabs API while syncing voice agent.",
                cause,
              }),
          ),
        );

      if (response.status < 200 || response.status >= 300) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sync_voice_agent",
          reason: `ElevenLabs API rejected voice agent sync (HTTP ${response.status}).`,
        });
      }

      const parsed = decodeJsonRecord(response.bodyText);
      const remoteAgentId = readString(parsed, "agent_id") ?? `elevenlabs_${input.voiceAgent.id}`;
      return {
        providerKind: "elevenlabs",
        remoteAgentId,
        synced: true,
        sandbox: false,
        aiDisclosureEnforced: true,
        recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
        optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
        message: "Voice agent synced to ElevenLabs.",
      } satisfies VoiceAgentSyncResult;
    },
  );

  const driver: SovereignIntegrationDriver = {
    providerKind: "elevenlabs",
    testConnection: Effect.fn("SovereignVoiceDrivers.elevenlabs.testConnection")(
      function* (context) {
        const early = checkDisabledOrSandbox(context, "ElevenLabs");
        if (early !== null) return early;

        const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
        if (apiKey === null) {
          return {
            ok: false,
            status: "unconfigured",
            latencyMs: null,
            message: "ElevenLabs requires an API key in secure credential storage.",
          };
        }

        const baseUrl = stripTrailingSlash(
          context.integration.endpointUrl ?? DEFAULT_ELEVENLABS_API_BASE,
        );
        const response = yield* transport
          .request({
            url: `${baseUrl}/v1/user`,
            method: "GET",
            headers: { "xi-api-key": apiKey },
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach ElevenLabs API endpoint.",
          };
        }
        return mapHttpStatusToTestResult("ElevenLabs", response.value);
      },
    ),
    verifyAndParseWebhook: (input) =>
      parseInboundCallWebhook(input).pipe(Effect.map(toSovereignWebhookEvent)),
  };

  return {
    providerKind: "elevenlabs",
    driver,
    syncVoiceAgent,
    estimateCallCostMinor,
    parseInboundCallWebhook,
  };
}

export function createTwilioVoiceAdapter(options?: {
  readonly transport?: HttpTransport;
}): VoiceProviderAdapter {
  const transport = options?.transport ?? createFetchHttpTransport();

  const estimateCallCostMinor = (input: VoiceCostEstimateInput) =>
    estimateVoiceCallCostMinor("twilio", input);

  const parseInboundCallWebhook = Effect.fn("SovereignVoiceDrivers.twilio.parseInboundCallWebhook")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBody: Uint8Array;
    }) {
      const authToken = extractSecretField(input.context.secret, [
        "authToken",
        "webhookSecret",
        "secret",
      ]);
      if (authToken === null) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "verify_webhook",
          reason: "Twilio auth token is not configured.",
        });
      }

      const bodyText = utf8Decoder.decode(input.rawBody);
      const contentType = lookupHeaderCaseInsensitive(input.headers, "content-type") ?? "";
      const formParams: Record<string, string> = {};
      let jsonPayload: Readonly<Record<string, unknown>> | null = null;

      if (contentType.includes("application/json") || bodyText.trim().startsWith("{")) {
        jsonPayload = decodeJsonRecord(bodyText);
      } else {
        for (const [k, v] of new URLSearchParams(bodyText).entries()) {
          formParams[k] = v;
        }
      }

      const twilioSig = lookupHeaderCaseInsensitive(input.headers, "x-twilio-signature");
      const sha256Sig = lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
      const webhookUrl =
        readStringSetting(input.context.integration.settings, "webhookUrl") ??
        input.context.integration.endpointUrl ??
        "";

      const twilioValid =
        twilioSig !== undefined &&
        webhookUrl.length > 0 &&
        verifyTwilioRequestSignature({
          authToken,
          requestUrl: webhookUrl,
          formParams,
          signatureHeader: twilioSig,
        });
      const hmac256Valid =
        sha256Sig !== undefined &&
        constantTimeHexEqual(
          computeHmacSha256Hex(authToken, input.rawBody),
          sha256Sig.replace(/^sha256=/i, ""),
        );

      if (!twilioValid && !hmac256Valid) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "verify_webhook",
          reason: "Twilio webhook signature verification failed.",
        });
      }

      const callId =
        formParams.CallSid ??
        readString(jsonPayload, "CallSid") ??
        readString(jsonPayload, "callSid");
      if (callId === null || callId.length === 0) return null;

      const callStatus =
        formParams.CallStatus ?? readString(jsonPayload, "CallStatus") ?? "completed";
      const durationRaw =
        formParams.CallDuration ??
        formParams.Duration ??
        readNumber(jsonPayload, "CallDuration") ??
        readNumber(jsonPayload, "durationSeconds");
      const durationSeconds = Math.max(0, Math.round(Number(durationRaw ?? 0) || 0));
      const directionRaw =
        formParams.Direction ?? readString(jsonPayload, "Direction") ?? "inbound";
      const currency = normalizeCurrencyCode(
        formParams.PriceUnit ?? jsonPayload?.currency,
        DEFAULT_REPORTING_CURRENCY,
      );
      const estimated = estimateCallCostMinor({
        durationSeconds,
        currency,
        ...readCustomVoiceRates(input.context),
      });

      return {
        providerKind: "twilio",
        replayKey: `${callStatus}:${callId}`,
        eventType: `twilio.call.${callStatus.toLowerCase()}`,
        callId,
        durationSeconds,
        direction: directionRaw.toLowerCase().includes("outbound") ? "outbound" : "inbound",
        aiDisclosureDelivered:
          (formParams.AiDisclosureDelivered ?? "true").toLowerCase() !== "false",
        recordingDisclosureDelivered:
          (formParams.RecordingDisclosureDelivered ?? "true").toLowerCase() !== "false",
        callerOptedOut: (formParams.CallerOptedOut ?? "false").toLowerCase() === "true",
        costEstimate: estimated,
        ledgerEntry: buildVoiceCostLedgerEntry({
          context: input.context,
          providerKind: "twilio",
          callId,
          durationSeconds,
          totalCostMinor: estimated.totalCostMinor,
          currency,
        }),
      } satisfies ParsedInboundVoiceWebhook;
    },
  );

  const syncVoiceAgent = Effect.fn("SovereignVoiceDrivers.twilio.syncVoiceAgent")(
    function* (input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly voiceAgent: VoiceAgentConfig;
    }) {
      yield* assertVoiceAgentCompliance(input.voiceAgent);
      if (input.context.integration.sandboxMode) {
        return {
          providerKind: "twilio",
          remoteAgentId: `twilio_sandbox_${input.voiceAgent.id}`,
          synced: true,
          sandbox: true,
          aiDisclosureEnforced: true,
          recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
          optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
          message: "Voice routing synced to Twilio sandbox with mandatory AI disclosure TwiML.",
        } satisfies VoiceAgentSyncResult;
      }

      const accountSid =
        readStringSetting(input.context.integration.settings, "accountSid") ??
        extractSecretField(input.context.secret, ["accountSid"]) ??
        input.context.integration.accountLabel;
      const authToken = extractSecretField(input.context.secret, ["authToken", "apiKey", "secret"]);
      if (accountSid === null || authToken === null) {
        return yield* new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sync_voice_agent",
          reason: "Twilio requires both accountSid and authToken before syncing voice routing.",
        });
      }

      return {
        providerKind: "twilio",
        remoteAgentId: `twilio_${accountSid}_${input.voiceAgent.id}`,
        synced: true,
        sandbox: false,
        aiDisclosureEnforced: true,
        recordingDisclosureEnabled: input.voiceAgent.recordingDisclosureEnabled,
        optOutPhraseEnabled: input.voiceAgent.optOutPhraseEnabled,
        message: "Twilio voice routing profile prepared with AI and recording disclosure metadata.",
      } satisfies VoiceAgentSyncResult;
    },
  );

  const driver: SovereignIntegrationDriver = {
    providerKind: "twilio",
    testConnection: Effect.fn("SovereignVoiceDrivers.twilio.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Twilio");
      if (early !== null) return early;

      const accountSid =
        readStringSetting(context.integration.settings, "accountSid") ??
        extractSecretField(context.secret, ["accountSid"]) ??
        context.integration.accountLabel;
      const authToken = extractSecretField(context.secret, ["authToken", "token", "secret"]);

      if (accountSid === null || authToken === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message:
            "Twilio requires settings.accountSid and an auth token in secure credential storage.",
        };
      }

      const baseUrl = stripTrailingSlash(
        context.integration.endpointUrl ?? DEFAULT_TWILIO_API_BASE,
      );
      const basicAuth = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");
      const response = yield* transport
        .request({
          url: `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
          method: "GET",
          headers: { authorization: `Basic ${basicAuth}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Twilio Accounts API endpoint.",
        };
      }
      return mapHttpStatusToTestResult("Twilio", response.value);
    }),
    verifyAndParseWebhook: (input) =>
      parseInboundCallWebhook(input).pipe(Effect.map(toSovereignWebhookEvent)),
  };

  return {
    providerKind: "twilio",
    driver,
    syncVoiceAgent,
    estimateCallCostMinor,
    parseInboundCallWebhook,
  };
}
