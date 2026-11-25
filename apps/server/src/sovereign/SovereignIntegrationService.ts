// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC-SHA256 verification for inbound webhook signatures.
import * as NodeCrypto from "node:crypto";
import {
  DEFAULT_REPORTING_CURRENCY,
  type IntegrationConfig,
  IntegrationId,
  type IntegrationProviderKind,
  type IntegrationStatus,
  type IntegrationSummary,
  type IntegrationTestResult,
  InvoiceId,
  isSecretReference,
  type LedgerEntryId,
  type LedgerEntryType,
  OrderId,
  type RecordLedgerEntryInput,
  type UpsertIntegrationInput,
  VentureId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  type SovereignDomainError,
  SovereignIntegrationError,
  SovereignNotFoundError,
  type SovereignPersistenceError,
} from "./SovereignErrors.ts";
import * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import * as SovereignLedgerService from "./SovereignLedgerService.ts";
import * as SovereignStore from "./SovereignStore.ts";

export interface SovereignIntegrationDriverContext {
  readonly integration: IntegrationConfig;
  readonly secret: string | null;
}

export interface SovereignIntegrationDriverTestOutput {
  readonly ok: boolean;
  readonly status: IntegrationStatus;
  readonly latencyMs: number | null;
  readonly message: string;
}

export interface SovereignIntegrationWebhookEvent {
  readonly replayKey: string;
  readonly eventType: string;
  readonly ledgerEntry?: RecordLedgerEntryInput;
}

export interface SovereignIntegrationDriver {
  readonly providerKind: IntegrationProviderKind;
  readonly testConnection: (
    context: SovereignIntegrationDriverContext,
  ) => Effect.Effect<SovereignIntegrationDriverTestOutput, SovereignIntegrationError>;
  readonly verifyAndParseWebhook?: (input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly headers: Readonly<Record<string, string>>;
    readonly rawBody: Uint8Array;
  }) => Effect.Effect<SovereignIntegrationWebhookEvent | null, SovereignIntegrationError>;
}

export type InboundWebhookOutcome =
  | {
      readonly outcome: "accepted";
      readonly replayKey: string;
      readonly eventType: string;
      readonly ledgerEntryId: LedgerEntryId | null;
    }
  | {
      readonly outcome: "duplicate";
      readonly replayKey: string;
    }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "disabled" }
  | { readonly outcome: "unconfigured" }
  | { readonly outcome: "invalid_signature" }
  | { readonly outcome: "invalid_payload"; readonly reason: string };

const GenericWebhookPayload = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  eventId: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  eventType: Schema.optionalKey(Schema.String),
  amountMinor: Schema.optionalKey(Schema.Int),
  currency: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  ventureId: Schema.optionalKey(Schema.String),
  invoiceId: Schema.optionalKey(Schema.String),
  orderId: Schema.optionalKey(Schema.String),
  entryType: Schema.optionalKey(
    Schema.Literals([
      "collected_revenue",
      "confirmed_expense",
      "payment_fee",
      "inference_cost",
      "hosting_cost",
      "deployment_cost",
      "telephony_cost",
      "subscription_allocation",
      "refund",
      "adjustment",
    ]),
  ),
});

const decodeGenericWebhookPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(GenericWebhookPayload),
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const integrationSecretKey = (integrationId: IntegrationId): string =>
  `sovereign-integration-${integrationId}`;

const constantTimeHexEqual = (expectedHex: string, candidateHex: string): boolean => {
  const normalizedExpected = expectedHex.trim().toLowerCase();
  const normalizedCandidate = candidateHex.trim().toLowerCase();
  if (
    normalizedExpected.length === 0 ||
    normalizedExpected.length !== normalizedCandidate.length ||
    !/^[0-9a-f]+$/.test(normalizedExpected) ||
    !/^[0-9a-f]+$/.test(normalizedCandidate)
  ) {
    return false;
  }
  const expectedBuf = Buffer.from(normalizedExpected, "hex");
  const candidateBuf = Buffer.from(normalizedCandidate, "hex");
  if (expectedBuf.length !== candidateBuf.length) return false;
  return NodeCrypto.timingSafeEqual(expectedBuf, candidateBuf);
};

export function computeHmacSha256Hex(secret: string, payload: Uint8Array | string): string {
  return NodeCrypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function verifyHmacSha256Signature(
  secret: string,
  rawBody: Uint8Array,
  signatureHeader: string | undefined,
): boolean {
  if (signatureHeader === undefined || signatureHeader.trim().length === 0) return false;
  const trimmed = signatureHeader.trim();

  if (trimmed.includes("v1=") && trimmed.includes("t=")) {
    const parts = Object.fromEntries(
      trimmed.split(",").map((segment) => {
        const [k, v] = segment.trim().split("=", 2);
        return [k ?? "", v ?? ""];
      }),
    );
    const timestamp = parts.t;
    const v1 = parts.v1;
    if (timestamp && v1) {
      const signedPayload = `${timestamp}.${textDecoder.decode(rawBody)}`;
      const expectedTimestamped = computeHmacSha256Hex(secret, signedPayload);
      if (constantTimeHexEqual(expectedTimestamped, v1)) return true;
      const expectedRaw = computeHmacSha256Hex(secret, rawBody);
      return constantTimeHexEqual(expectedRaw, v1);
    }
  }

  const candidate = trimmed.toLowerCase().startsWith("sha256=") ? trimmed.slice(7) : trimmed;
  const expected = computeHmacSha256Hex(secret, rawBody);
  return constantTimeHexEqual(expected, candidate);
}

const inferLedgerEntryType = (
  eventType: string,
  explicitType?: LedgerEntryType,
): LedgerEntryType | null => {
  if (explicitType !== undefined) return explicitType;
  const lower = eventType.toLowerCase();
  if (
    lower.includes("payment.succeeded") ||
    lower.includes("payment_intent.succeeded") ||
    lower.includes("checkout.completed") ||
    lower.includes("invoice.paid") ||
    lower.includes("charge.succeeded")
  ) {
    return "collected_revenue";
  }
  if (lower.includes("refund")) return "refund";
  if (lower.includes("fee")) return "payment_fee";
  return null;
};

function summarizeIntegrations(integrations: ReadonlyArray<IntegrationConfig>): IntegrationSummary {
  let connectedCount = 0;
  let configuredCount = 0;
  let errorCount = 0;
  let unconfiguredCount = 0;
  for (const integration of integrations) {
    switch (integration.status) {
      case "connected":
        connectedCount += 1;
        break;
      case "configured":
        configuredCount += 1;
        break;
      case "error":
        errorCount += 1;
        break;
      case "unconfigured":
      case "disabled":
        unconfiguredCount += 1;
        break;
    }
  }
  return {
    totalCount: integrations.length,
    connectedCount,
    configuredCount,
    errorCount,
    unconfiguredCount,
    integrations,
  };
}

export class SovereignIntegrationService extends Context.Service<
  SovereignIntegrationService,
  {
    readonly registerDriver: (driver: SovereignIntegrationDriver) => Effect.Effect<void>;
    readonly listRegisteredDriverKinds: Effect.Effect<ReadonlyArray<IntegrationProviderKind>>;
    readonly listIntegrations: (filter?: {
      readonly ventureId?: VentureId | null;
    }) => Effect.Effect<IntegrationSummary, SovereignPersistenceError>;
    readonly upsertIntegration: (
      input: UpsertIntegrationInput,
    ) => Effect.Effect<IntegrationConfig, SovereignDomainError>;
    readonly deleteIntegration: (
      integrationId: IntegrationId,
    ) => Effect.Effect<{ readonly deleted: boolean }, SovereignDomainError>;
    readonly testIntegration: (
      integrationId: IntegrationId,
    ) => Effect.Effect<IntegrationTestResult, SovereignDomainError>;
    readonly handleInboundWebhook: (input: {
      readonly integrationId: IntegrationId;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBody: Uint8Array;
    }) => Effect.Effect<InboundWebhookOutcome, SovereignDomainError>;
  }
>()("t3/sovereign/SovereignIntegrationService") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const governance = yield* SovereignGovernanceService.SovereignGovernanceService;
  const ledger = yield* SovereignLedgerService.SovereignLedgerService;
  const random = yield* SecureRandom.SecureRandom;
  const httpClientOption = yield* Effect.serviceOption(HttpClient.HttpClient);

  const probeEndpoint = Effect.fn("SovereignIntegrationService.probeEndpoint")(function* (
    context: SovereignIntegrationDriverContext,
  ): Effect.fn.Return<SovereignIntegrationDriverTestOutput, SovereignIntegrationError> {
    if (!context.integration.enabled) {
      return {
        ok: false,
        status: "disabled",
        latencyMs: null,
        message: "Integration is disabled.",
      };
    }

    if (context.integration.sandboxMode) {
      return {
        ok: true,
        status: "connected",
        latencyMs: 0,
        message: `Sandbox verification passed for ${context.integration.displayName}.`,
      };
    }

    if (context.integration.endpointUrl === null) {
      if (context.integration.hasSecret) {
        return {
          ok: true,
          status: "configured",
          latencyMs: null,
          message:
            "Credentials are stored securely; configure an endpoint or provider driver for live probes.",
        };
      }
      return {
        ok: false,
        status: "unconfigured",
        latencyMs: null,
        message: "No endpoint URL or secret is configured for this integration.",
      };
    }

    if (Option.isNone(httpClientOption)) {
      return {
        ok: false,
        status: "error",
        latencyMs: null,
        message: "HTTP client is unavailable for live connection probe.",
      };
    }

    const startedAt = yield* Clock.currentTimeMillis;
    const responseOpt = yield* httpClientOption.value
      .head(context.integration.endpointUrl)
      .pipe(Effect.timeoutOption(Duration.seconds(5)), Effect.orElseSucceed(Option.none));
    const endedAt = yield* Clock.currentTimeMillis;
    const latencyMs = Math.max(0, endedAt - startedAt);

    if (Option.isNone(responseOpt)) {
      return {
        ok: false,
        status: "error",
        latencyMs,
        message: "Connection probe timed out or could not reach the configured endpoint.",
      };
    }

    const status = responseOpt.value.status;
    if (status >= 200 && status < 500) {
      return {
        ok: true,
        status: "connected",
        latencyMs,
        message: `Endpoint reachable (HTTP ${status}).`,
      };
    }

    return {
      ok: false,
      status: "error",
      latencyMs,
      message: `Endpoint returned server error (HTTP ${status}).`,
    };
  });

  const builtinWebhookDriver: SovereignIntegrationDriver = {
    providerKind: "webhook",
    testConnection: (context) => probeEndpoint(context),
  };

  const driversRef = yield* Ref.make<
    ReadonlyMap<IntegrationProviderKind, SovereignIntegrationDriver>
  >(new Map([["webhook", builtinWebhookDriver]]));

  const registerDriver = Effect.fn("SovereignIntegrationService.registerDriver")(function* (
    driver: SovereignIntegrationDriver,
  ) {
    yield* Ref.update(driversRef, (current) => {
      const next = new Map(current);
      next.set(driver.providerKind, driver);
      return next;
    });
  });

  const readSecretString = Effect.fnUntraced(function* (integrationId: IntegrationId) {
    const rawOpt = yield* secretStore.get(integrationSecretKey(integrationId)).pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId,
            stage: "read_secret",
            reason: "Failed to read stored integration secret.",
            cause,
          }),
      ),
    );
    return Option.isSome(rawOpt) ? textDecoder.decode(rawOpt.value) : null;
  });

  const listIntegrations = Effect.fn("SovereignIntegrationService.listIntegrations")(
    function* (filter?: { readonly ventureId?: VentureId | null }) {
      const integrations = yield* store.listIntegrations(filter);
      return summarizeIntegrations(integrations);
    },
  );

  const upsertIntegration = Effect.fn("SovereignIntegrationService.upsertIntegration")(function* (
    input: UpsertIntegrationInput,
  ) {
    if (input.ventureId !== undefined && input.ventureId !== null) {
      const ventureOpt = yield* store.getVenture(input.ventureId);
      if (Option.isNone(ventureOpt)) {
        return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
      }
    }

    const existing = input.id === undefined ? Option.none() : yield* store.getIntegration(input.id);
    const id =
      input.id ??
      (yield* random.uuidV4().pipe(
        Effect.orDie,
        Effect.map((uuid) => IntegrationId.make(`int_${uuid.replace(/-/g, "")}`)),
      ));
    const now = yield* store.nowIso;

    let hasSecret = Option.isSome(existing) ? existing.value.hasSecret : false;
    let secretReference = Option.isSome(existing) ? (existing.value.secretReference ?? null) : null;

    if (input.secretValue !== undefined) {
      const key = integrationSecretKey(id);
      if (input.secretValue === null || input.secretValue === "") {
        yield* secretStore.remove(key).pipe(
          Effect.mapError(
            (cause) =>
              new SovereignIntegrationError({
                integrationId: id,
                stage: "remove_secret",
                reason: "Failed to remove stored integration secret.",
                cause,
              }),
          ),
        );
        hasSecret = false;
        secretReference = null;
      } else if (isSecretReference(input.secretValue)) {
        yield* secretStore.remove(key).pipe(Effect.ignore);
        hasSecret = true;
        secretReference = input.secretValue;
      } else {
        yield* secretStore.set(key, textEncoder.encode(input.secretValue)).pipe(
          Effect.mapError(
            (cause) =>
              new SovereignIntegrationError({
                integrationId: id,
                stage: "persist_secret",
                reason: "Failed to persist integration secret securely.",
                cause,
              }),
          ),
        );
        hasSecret = true;
        secretReference = null;
      }
    }

    const enabled = input.enabled ?? (Option.isSome(existing) ? existing.value.enabled : true);
    const sandboxMode =
      input.sandboxMode ?? (Option.isSome(existing) ? existing.value.sandboxMode : false);
    const endpointUrl =
      input.endpointUrl !== undefined
        ? input.endpointUrl
        : Option.isSome(existing)
          ? existing.value.endpointUrl
          : null;
    const status: IntegrationStatus = !enabled
      ? "disabled"
      : hasSecret || endpointUrl !== null || sandboxMode
        ? Option.isSome(existing) && existing.value.status === "connected"
          ? "connected"
          : "configured"
        : "unconfigured";

    const config: IntegrationConfig = {
      id,
      ventureId: input.ventureId ?? (Option.isSome(existing) ? existing.value.ventureId : null),
      category: input.category,
      providerKind: input.providerKind,
      displayName: input.displayName,
      status,
      enabled,
      sandboxMode,
      endpointUrl,
      accountLabel:
        input.accountLabel !== undefined
          ? input.accountLabel
          : Option.isSome(existing)
            ? existing.value.accountLabel
            : null,
      hasSecret,
      secretReference,
      settings: input.settings ?? (Option.isSome(existing) ? existing.value.settings : {}),
      lastTestedAt: Option.isSome(existing) ? existing.value.lastTestedAt : null,
      lastError: Option.isSome(existing) ? existing.value.lastError : null,
      createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
      updatedAt: now,
    };

    yield* store.upsertIntegration(config);
    yield* store.publishEvent({ type: "integrationUpdated", payload: config });
    return config;
  });

  const deleteIntegration = Effect.fn("SovereignIntegrationService.deleteIntegration")(function* (
    integrationId: IntegrationId,
  ) {
    yield* secretStore.remove(integrationSecretKey(integrationId)).pipe(Effect.ignore);
    const deleted = yield* store.deleteIntegration(integrationId);
    return { deleted };
  });

  const testIntegration = Effect.fn("SovereignIntegrationService.testIntegration")(function* (
    integrationId: IntegrationId,
  ) {
    const existingOpt = yield* store.getIntegration(integrationId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "integration", id: integrationId });
    }
    const integration = existingOpt.value;
    const secret = yield* readSecretString(integration.id);
    const drivers = yield* Ref.get(driversRef);
    const driver = drivers.get(integration.providerKind);
    const context: SovereignIntegrationDriverContext = { integration, secret };

    const outcome =
      driver !== undefined ? yield* driver.testConnection(context) : yield* probeEndpoint(context);
    const now = yield* store.nowIso;

    const updated: IntegrationConfig = {
      ...integration,
      status: outcome.status,
      lastTestedAt: now,
      lastError: outcome.ok ? null : outcome.message,
      updatedAt: now,
    };
    yield* store.upsertIntegration(updated);
    yield* governance.recordAuditEvent({
      kind: "integration_tested",
      severity: outcome.ok ? "info" : "warning",
      ventureId: integration.ventureId,
      actor: "owner",
      summary: `Integration test for ${integration.displayName}: ${outcome.status}`,
      integrationId: integration.id,
      metadata: {
        providerKind: integration.providerKind,
        ok: outcome.ok,
        latencyMs: outcome.latencyMs,
      },
    });
    yield* store.publishEvent({ type: "integrationUpdated", payload: updated });

    return {
      integrationId: integration.id,
      ok: outcome.ok,
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      message: outcome.message,
      checkedAt: now,
    } satisfies IntegrationTestResult;
  });

  const handleInboundWebhook = Effect.fn("SovereignIntegrationService.handleInboundWebhook")(
    function* (input: {
      readonly integrationId: IntegrationId;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBody: Uint8Array;
    }) {
      const existingOpt = yield* store.getIntegration(input.integrationId);
      if (Option.isNone(existingOpt)) {
        return { outcome: "not_found" } satisfies InboundWebhookOutcome;
      }
      const integration = existingOpt.value;
      if (!integration.enabled) {
        return { outcome: "disabled" } satisfies InboundWebhookOutcome;
      }

      const secret = yield* readSecretString(integration.id);
      if (secret === null || secret.length === 0) {
        return { outcome: "unconfigured" } satisfies InboundWebhookOutcome;
      }

      const drivers = yield* Ref.get(driversRef);
      const driver = drivers.get(integration.providerKind);
      let parsedEvent: SovereignIntegrationWebhookEvent | null = null;

      if (driver?.verifyAndParseWebhook !== undefined) {
        const driverEvent = yield* driver
          .verifyAndParseWebhook({
            context: { integration, secret },
            headers: input.headers,
            rawBody: input.rawBody,
          })
          .pipe(Effect.option);
        if (Option.isNone(driverEvent)) {
          return { outcome: "invalid_signature" } satisfies InboundWebhookOutcome;
        }
        parsedEvent = driverEvent.value;
      } else {
        const signatureHeader =
          input.headers["x-sovereign-signature"] ??
          input.headers["stripe-signature"] ??
          input.headers["x-hub-signature-256"] ??
          input.headers["x-webhook-signature"];

        if (!verifyHmacSha256Signature(secret, input.rawBody, signatureHeader)) {
          yield* governance.recordAuditEvent({
            kind: "permission_denied",
            severity: "warning",
            ventureId: integration.ventureId,
            actor: `webhook:${integration.providerKind}`,
            summary: `Rejected inbound webhook for ${integration.displayName} due to invalid HMAC signature.`,
            integrationId: integration.id,
          });
          return { outcome: "invalid_signature" } satisfies InboundWebhookOutcome;
        }

        const decoded = decodeGenericWebhookPayload(textDecoder.decode(input.rawBody));
        if (Option.isNone(decoded)) {
          return {
            outcome: "invalid_payload",
            reason: "Webhook payload is not valid JSON matching expected webhook fields.",
          } satisfies InboundWebhookOutcome;
        }
        const payload = decoded.value;
        const deliveryHeader =
          input.headers["x-sovereign-delivery-id"] ??
          input.headers["x-webhook-id"] ??
          input.headers["x-request-id"];
        const replayKey =
          deliveryHeader?.trim() ||
          payload.eventId?.trim() ||
          payload.id?.trim() ||
          NodeCrypto.createHash("sha256").update(input.rawBody).digest("hex");
        const eventType = payload.eventType ?? payload.type ?? "webhook.event";
        const inferredType = inferLedgerEntryType(eventType, payload.entryType);
        const ledgerEntry: RecordLedgerEntryInput | undefined =
          inferredType !== null && payload.amountMinor !== undefined
            ? {
                ventureId:
                  payload.ventureId !== undefined
                    ? VentureId.make(payload.ventureId)
                    : integration.ventureId,
                ...(payload.invoiceId === undefined
                  ? {}
                  : { invoiceId: InvoiceId.make(payload.invoiceId) }),
                ...(payload.orderId === undefined
                  ? {}
                  : { orderId: OrderId.make(payload.orderId) }),
                integrationId: integration.id,
                entryType: inferredType,
                verificationState: "verified",
                amountMinor: payload.amountMinor,
                currency: payload.currency ?? DEFAULT_REPORTING_CURRENCY,
                description:
                  payload.description ?? `${integration.displayName} ${eventType} (${replayKey})`,
                externalRef: `${integration.id}:${replayKey}`,
              }
            : undefined;
        parsedEvent = {
          replayKey,
          eventType,
          ...(ledgerEntry === undefined ? {} : { ledgerEntry }),
        };
      }

      if (parsedEvent === null) {
        return {
          outcome: "invalid_payload",
          reason: "Webhook driver returned no event.",
        } satisfies InboundWebhookOutcome;
      }

      const now = yield* store.nowIso;
      const claimed = yield* store.claimWebhookReplayKey({
        integrationId: integration.id,
        replayKey: parsedEvent.replayKey,
        eventType: parsedEvent.eventType,
        receivedAt: now,
      });
      if (!claimed) {
        return {
          outcome: "duplicate",
          replayKey: parsedEvent.replayKey,
        } satisfies InboundWebhookOutcome;
      }

      let ledgerEntryId: LedgerEntryId | null = null;
      if (parsedEvent.ledgerEntry !== undefined) {
        const entry = yield* ledger.recordEntry(
          {
            ...parsedEvent.ledgerEntry,
            integrationId: integration.id,
            verificationState: "verified",
            externalRef:
              parsedEvent.ledgerEntry.externalRef ?? `${integration.id}:${parsedEvent.replayKey}`,
          },
          { recordedBy: `webhook:${integration.providerKind}` },
        );
        ledgerEntryId = entry.id;
      }

      return {
        outcome: "accepted",
        replayKey: parsedEvent.replayKey,
        eventType: parsedEvent.eventType,
        ledgerEntryId,
      } satisfies InboundWebhookOutcome;
    },
  );

  const listRegisteredDriverKinds: Effect.Effect<ReadonlyArray<IntegrationProviderKind>> = Ref.get(
    driversRef,
  ).pipe(Effect.map((drivers) => Array.from(drivers.keys())));

  return SovereignIntegrationService.of({
    registerDriver,
    listRegisteredDriverKinds,
    listIntegrations,
    upsertIntegration,
    deleteIntegration,
    testIntegration,
    handleInboundWebhook,
  });
});

export const layer = Layer.effect(SovereignIntegrationService, make);
