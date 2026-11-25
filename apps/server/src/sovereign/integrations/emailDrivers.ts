// @effect-diagnostics-next-line nodeBuiltinImport:off -- Deterministic sandbox message IDs via SHA-256.
import * as NodeCrypto from "node:crypto";
import type { CommunicationSenderType, ConsentRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { SovereignIntegrationError, SovereignPermissionError } from "../SovereignErrors.ts";
import type {
  SovereignIntegrationDriver,
  SovereignIntegrationDriverContext,
} from "../SovereignIntegrationService.ts";
import {
  checkDisabledOrSandbox,
  createFetchHttpTransport,
  decodeJsonRecord,
  encodeJsonString,
  extractSecretField,
  type HttpTransport,
  mapHttpStatusToTestResult,
  readBooleanSetting,
  readNumberSetting,
  readStringSetting,
} from "./httpTransport.ts";

const DEFAULT_RESEND_API_BASE = "https://api.resend.com";
const AI_DISCLOSURE_FOOTER =
  "Transparency notice: This message was drafted and sent by an AI assistant operating on behalf of the sender. Reply STOP or UNSUBSCRIBE at any time to opt out.";
const OPT_OUT_FOOTER = "To stop receiving emails from us, reply UNSUBSCRIBE at any time.";

export interface SendEmailInput {
  readonly context: SovereignIntegrationDriverContext;
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly senderType: CommunicationSenderType;
  readonly aiDisclosed: boolean;
  readonly consentVerified?: boolean;
  readonly optedOut?: boolean;
  readonly consents?: ReadonlyArray<ConsentRecord>;
}

export interface SendEmailResult {
  readonly providerKind: "resend" | "smtp";
  readonly messageId: string;
  readonly accepted: boolean;
  readonly sandbox: boolean;
  readonly aiDisclosed: boolean;
  readonly headersApplied: Readonly<Record<string, string>>;
  readonly renderedText: string;
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const enforceEmailCompliance = (
  input: SendEmailInput,
): Effect.Effect<
  {
    readonly headersApplied: Readonly<Record<string, string>>;
    readonly renderedText: string;
    readonly renderedHtml: string | undefined;
  },
  SovereignPermissionError | SovereignIntegrationError
> => {
  if (input.from.trim().length === 0 || input.to.length === 0) {
    return Effect.fail(
      new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "send_email",
        reason: "Email sender and at least one recipient are required.",
      }),
    );
  }

  if (input.senderType === "ai_agent" && !input.aiDisclosed) {
    return Effect.fail(
      new SovereignPermissionError({
        code: "permission_denied",
        reason: "AI-authored emails must explicitly disclose AI identity before sending.",
        ...(input.context.integration.ventureId === null
          ? {}
          : { ventureId: input.context.integration.ventureId }),
      }),
    );
  }

  const consents = input.consents ?? [];
  const hasOptOutRecord =
    input.optedOut === true ||
    consents.some(
      (record) =>
        (record.channel === "email" || record.optedOut) &&
        (record.optedOut || record.status === "withdrawn"),
    );

  if (hasOptOutRecord) {
    return Effect.fail(
      new SovereignPermissionError({
        code: "consent_required",
        reason: "Recipient has opted out or withdrawn email consent.",
        ...(input.context.integration.ventureId === null
          ? {}
          : { ventureId: input.context.integration.ventureId }),
      }),
    );
  }

  const hasGrantedConsent =
    input.consentVerified === true ||
    consents.some(
      (record) =>
        record.channel === "email" &&
        !record.optedOut &&
        record.status === "granted" &&
        record.lawfulBasis !== "not_established",
    );

  if (!hasGrantedConsent) {
    return Effect.fail(
      new SovereignPermissionError({
        code: "consent_required",
        reason: "Verified recipient consent or lawful basis is required before sending email.",
        ...(input.context.integration.ventureId === null
          ? {}
          : { ventureId: input.context.integration.ventureId }),
      }),
    );
  }

  const trimmedText = input.text.trim();
  const hasDisclosureInText =
    trimmedText.toLowerCase().includes("ai assistant") ||
    trimmedText.toLowerCase().includes("artificial intelligence") ||
    trimmedText.toLowerCase().includes("transparency notice");
  const hasOptOutInText = trimmedText.toLowerCase().includes("unsubscribe");

  let renderedText = trimmedText;
  if (input.senderType === "ai_agent" && !hasDisclosureInText) {
    renderedText = `${renderedText}\n\n---\n${AI_DISCLOSURE_FOOTER}`;
  } else if (!hasOptOutInText) {
    renderedText = `${renderedText}\n\n---\n${OPT_OUT_FOOTER}`;
  }

  let renderedHtml = input.html;
  if (renderedHtml !== undefined) {
    const footer = input.senderType === "ai_agent" ? AI_DISCLOSURE_FOOTER : OPT_OUT_FOOTER;
    if (!renderedHtml.toLowerCase().includes("unsubscribe")) {
      renderedHtml = `${renderedHtml}<hr /><p>${footer}</p>`;
    }
  }

  const headersApplied: Record<string, string> = {
    "x-sovereign-sender-type": input.senderType,
    "x-sovereign-ai-disclosed": input.aiDisclosed ? "true" : "false",
    "list-unsubscribe": "<mailto:unsubscribe@sovereign.local?subject=unsubscribe>",
  };

  return Effect.succeed({ headersApplied, renderedText, renderedHtml });
};

export const sendResendEmail = Effect.fn("SovereignEmailDrivers.sendResendEmail")(function* (
  input: SendEmailInput,
  transport?: HttpTransport,
) {
  const prepared = yield* enforceEmailCompliance(input);

  if (input.context.integration.sandboxMode) {
    const hash = NodeCrypto.createHash("sha256")
      .update(`${input.from}:${input.to.join(",")}:${input.subject}`)
      .digest("hex")
      .slice(0, 12);
    return {
      providerKind: "resend",
      messageId: `resend_sandbox_${hash}`,
      accepted: true,
      sandbox: true,
      aiDisclosed: input.aiDisclosed,
      headersApplied: prepared.headersApplied,
      renderedText: prepared.renderedText,
    } satisfies SendEmailResult;
  }

  const apiKey = extractSecretField(input.context.secret, ["apiKey", "token", "key"]);
  if (apiKey === null) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "send_email",
      reason: "Resend API key is not configured in secure credential storage.",
    });
  }

  const activeTransport = transport ?? createFetchHttpTransport();
  const baseUrl = stripTrailingSlash(
    input.context.integration.endpointUrl ?? DEFAULT_RESEND_API_BASE,
  );
  const response = yield* activeTransport
    .request({
      url: `${baseUrl}/emails`,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: encodeJsonString({
        from: input.from,
        to: [...input.to],
        subject: input.subject,
        text: prepared.renderedText,
        ...(prepared.renderedHtml === undefined ? {} : { html: prepared.renderedHtml }),
        headers: prepared.headersApplied,
      }),
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "send_email",
            reason: "Failed to contact Resend API when sending email.",
            cause,
          }),
      ),
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "send_email",
      reason: `Resend API rejected email delivery (HTTP ${response.status}).`,
    });
  }

  const parsed = decodeJsonRecord(response.bodyText);
  const messageId =
    typeof parsed?.id === "string" && parsed.id.trim().length > 0
      ? parsed.id.trim()
      : "resend_accepted";

  return {
    providerKind: "resend",
    messageId,
    accepted: true,
    sandbox: false,
    aiDisclosed: input.aiDisclosed,
    headersApplied: prepared.headersApplied,
    renderedText: prepared.renderedText,
  } satisfies SendEmailResult;
});

const validateSmtpConfiguration = (
  context: SovereignIntegrationDriverContext,
):
  | {
      readonly ok: true;
      readonly host: string;
      readonly port: number;
      readonly username: string | null;
      readonly relayUrl: string | null;
      readonly secret: string | null;
    }
  | { readonly ok: false; readonly reason: string } => {
  const relayUrl = context.integration.endpointUrl;
  const host = readStringSetting(context.integration.settings, "host");
  const port = readNumberSetting(context.integration.settings, "port") ?? 587;
  const requireAuth = readBooleanSetting(context.integration.settings, "requireAuth") ?? true;
  const username =
    readStringSetting(context.integration.settings, "username") ?? context.integration.accountLabel;
  const secret = extractSecretField(context.secret, ["password", "apiKey", "token", "secret"]);

  if (relayUrl === null && host === null) {
    return {
      ok: false,
      reason: "SMTP requires settings.host or an HTTP relay endpointUrl before connecting.",
    };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      reason: "SMTP settings.port must be a valid TCP port between 1 and 65535.",
    };
  }
  if (requireAuth && secret === null) {
    return {
      ok: false,
      reason: "SMTP authentication requires a password or relay token in secure storage.",
    };
  }
  return {
    ok: true,
    host: host ?? "http-relay",
    port,
    username,
    relayUrl,
    secret,
  };
};

export const sendSmtpRelayEmail = Effect.fn("SovereignEmailDrivers.sendSmtpRelayEmail")(function* (
  input: SendEmailInput,
  transport?: HttpTransport,
) {
  const prepared = yield* enforceEmailCompliance(input);

  if (input.context.integration.sandboxMode) {
    const hash = NodeCrypto.createHash("sha256")
      .update(`smtp:${input.from}:${input.to.join(",")}:${input.subject}`)
      .digest("hex")
      .slice(0, 12);
    return {
      providerKind: "smtp",
      messageId: `smtp_sandbox_${hash}`,
      accepted: true,
      sandbox: true,
      aiDisclosed: input.aiDisclosed,
      headersApplied: prepared.headersApplied,
      renderedText: prepared.renderedText,
    } satisfies SendEmailResult;
  }

  const config = validateSmtpConfiguration(input.context);
  if (!config.ok) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "send_email",
      reason: config.reason,
    });
  }

  if (config.relayUrl === null) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "send_email",
      reason:
        "Direct raw SMTP socket delivery is not configured; provide an HTTP relay endpointUrl or enable sandboxMode.",
    });
  }

  const activeTransport = transport ?? createFetchHttpTransport();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.secret !== null) {
    headers.authorization =
      config.username !== null
        ? `Basic ${Buffer.from(`${config.username}:${config.secret}`, "utf8").toString("base64")}`
        : `Bearer ${config.secret}`;
  }

  const response = yield* activeTransport
    .request({
      url: config.relayUrl,
      method: "POST",
      headers,
      body: encodeJsonString({
        from: input.from,
        to: [...input.to],
        subject: input.subject,
        text: prepared.renderedText,
        ...(prepared.renderedHtml === undefined ? {} : { html: prepared.renderedHtml }),
        headers: prepared.headersApplied,
      }),
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "send_email",
            reason: "Failed to contact SMTP HTTP relay endpoint.",
            cause,
          }),
      ),
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "send_email",
      reason: `SMTP HTTP relay rejected email delivery (HTTP ${response.status}).`,
    });
  }

  const parsed = decodeJsonRecord(response.bodyText);
  const messageId =
    typeof parsed?.messageId === "string" && parsed.messageId.trim().length > 0
      ? parsed.messageId.trim()
      : "smtp_relay_accepted";

  return {
    providerKind: "smtp",
    messageId,
    accepted: true,
    sandbox: false,
    aiDisclosed: input.aiDisclosed,
    headersApplied: prepared.headersApplied,
    renderedText: prepared.renderedText,
  } satisfies SendEmailResult;
});

export function createResendDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "resend",
    testConnection: Effect.fn("SovereignEmailDrivers.resend.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Resend");
      if (early !== null) return early;

      const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "Resend requires an API key in secure credential storage.",
        };
      }

      const baseUrl = stripTrailingSlash(
        context.integration.endpointUrl ?? DEFAULT_RESEND_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/domains`,
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Resend API domains endpoint.",
        };
      }

      return mapHttpStatusToTestResult("Resend", response.value);
    }),
  };
}

export function createSmtpDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "smtp",
    testConnection: Effect.fn("SovereignEmailDrivers.smtp.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "SMTP");
      if (early !== null) return early;

      const validated = validateSmtpConfiguration(context);
      if (!validated.ok) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: validated.reason,
        };
      }

      if (validated.relayUrl !== null) {
        const headers: Record<string, string> = {};
        if (validated.secret !== null) {
          headers.authorization =
            validated.username !== null
              ? `Basic ${Buffer.from(`${validated.username}:${validated.secret}`, "utf8").toString("base64")}`
              : `Bearer ${validated.secret}`;
        }
        const response = yield* transport
          .request({
            url: validated.relayUrl,
            method: "HEAD",
            headers,
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach configured SMTP HTTP relay endpoint.",
          };
        }
        return mapHttpStatusToTestResult("SMTP relay", response.value);
      }

      return {
        ok: true,
        status: "configured",
        latencyMs: 0,
        message: `SMTP configuration validated for ${validated.host}:${validated.port} with credentials stored securely.`,
      };
    }),
  };
}
