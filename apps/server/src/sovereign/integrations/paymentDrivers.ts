// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC-SHA256 verification for payment provider webhooks.
import * as NodeCrypto from "node:crypto";
import {
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  InvoiceId,
  OrderId,
  type PaymentLink,
  type RecordLedgerEntryInput,
  VentureId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { SovereignIntegrationError } from "../SovereignErrors.ts";
import type {
  SovereignIntegrationDriver,
  SovereignIntegrationDriverContext,
  SovereignIntegrationWebhookEvent,
} from "../SovereignIntegrationService.ts";
import {
  checkDisabledOrSandbox,
  constantTimeHexEqual,
  createFetchHttpTransport,
  decodeJsonRecord,
  extractSecretField,
  type HttpTransport,
  lookupHeaderCaseInsensitive,
  mapHttpStatusToTestResult,
  normalizeCurrencyCode,
} from "./httpTransport.ts";

const DEFAULT_STRIPE_API_BASE = "https://api.stripe.com";
const DEFAULT_PADDLE_LIVE_API_BASE = "https://api.paddle.com";
const DEFAULT_PADDLE_SANDBOX_API_BASE = "https://sandbox-api.paddle.com";
const DEFAULT_LEMON_SQUEEZY_API_BASE = "https://api.lemonsqueezy.com";
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
const utf8Decoder = new TextDecoder();

export interface NormalizedPaymentWebhookReconciliation {
  readonly providerKind: "stripe" | "paddle" | "lemonsqueezy";
  readonly replayKey: string;
  readonly eventType: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
  readonly feeMinor: number | null;
  readonly ledgerEntryType: "collected_revenue" | "refund" | "payment_fee";
  readonly ledgerEntry: RecordLedgerEntryInput;
  readonly feeLedgerEntry: RecordLedgerEntryInput | null;
  readonly externalRef: string;
}

export interface CreateStripePaymentLinkInput {
  readonly context: SovereignIntegrationDriverContext;
  readonly ventureId: VentureId;
  readonly invoiceId?: InvoiceId | null;
  readonly label: string;
  readonly amountMinor: number;
  readonly currency?: CurrencyCode;
}

const computeHmacSha256 = (secret: string, payload: string | Uint8Array): string =>
  NodeCrypto.createHmac("sha256", secret).update(payload).digest("hex");

const parseIntegerMinor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const extractOptionalString = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null => {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const buildPaymentLedgerEntry = (input: {
  readonly context: SovereignIntegrationDriverContext;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly entryType: "collected_revenue" | "refund" | "payment_fee";
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly description: string;
  readonly externalRef: string;
}): RecordLedgerEntryInput => {
  const metaVentureId = extractOptionalString(input.metadata, "ventureId");
  const metaInvoiceId = extractOptionalString(input.metadata, "invoiceId");
  const metaOrderId = extractOptionalString(input.metadata, "orderId");
  const ventureId =
    metaVentureId !== null ? VentureId.make(metaVentureId) : input.context.integration.ventureId;

  return {
    ventureId,
    ...(metaInvoiceId === null ? {} : { invoiceId: InvoiceId.make(metaInvoiceId) }),
    ...(metaOrderId === null ? {} : { orderId: OrderId.make(metaOrderId) }),
    integrationId: input.context.integration.id,
    entryType: input.entryType,
    verificationState: "verified",
    amountMinor: Math.abs(input.amountMinor),
    currency: input.currency,
    description: input.description,
    externalRef: input.externalRef,
  };
};

export function verifyStripeWebhookSignature(input: {
  readonly webhookSecret: string;
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string | undefined;
  readonly nowUnixSeconds?: number;
  readonly toleranceSeconds?: number;
}): boolean {
  if (
    input.webhookSecret.trim().length === 0 ||
    input.signatureHeader === undefined ||
    input.signatureHeader.trim().length === 0
  ) {
    return false;
  }

  let timestampRaw: string | null = null;
  const v1Signatures: Array<string> = [];

  for (const segment of input.signatureHeader.split(",")) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim();
    const value = segment.slice(eqIndex + 1).trim();
    if (key === "t" && value.length > 0) {
      timestampRaw = value;
    } else if (key === "v1" && value.length > 0) {
      v1Signatures.push(value);
    }
  }

  if (timestampRaw === null || !/^\d+$/.test(timestampRaw) || v1Signatures.length === 0) {
    return false;
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  const nowSeconds =
    input.nowUnixSeconds ?? Math.floor(DateTime.toEpochMillis(DateTime.nowUnsafe()) / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) {
    return false;
  }

  const signedPayload = `${timestampRaw}.${utf8Decoder.decode(input.rawBody)}`;
  const expected = computeHmacSha256(input.webhookSecret, signedPayload);
  return v1Signatures.some((candidate) => constantTimeHexEqual(expected, candidate));
}

export function parseStripeWebhookPayload(
  context: SovereignIntegrationDriverContext,
  rawBody: Uint8Array,
): NormalizedPaymentWebhookReconciliation | null {
  const payload = decodeJsonRecord(utf8Decoder.decode(rawBody));
  if (payload === null) return null;

  const eventType = extractOptionalString(payload, "type");
  const eventId = extractOptionalString(payload, "id");
  const dataObject = asRecord(asRecord(payload.data)?.object);
  if (eventType === null || eventId === null || dataObject === null) return null;

  const metadata = asRecord(dataObject.metadata);
  const currency = normalizeCurrencyCode(dataObject.currency, DEFAULT_REPORTING_CURRENCY);
  const externalRef = `${context.integration.id}:stripe:${eventId}`;

  if (eventType === "checkout.session.completed") {
    const amountMinor = parseIntegerMinor(dataObject.amount_total);
    if (amountMinor === null || amountMinor < 0) return null;
    const feeMinor =
      parseIntegerMinor(dataObject.application_fee_amount) ??
      parseIntegerMinor(dataObject.fee_minor);
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata,
      entryType: "collected_revenue",
      amountMinor,
      currency,
      description: `Stripe checkout completed (${eventId})`,
      externalRef,
    });
    const feeLedgerEntry =
      feeMinor !== null && feeMinor > 0
        ? buildPaymentLedgerEntry({
            context,
            metadata,
            entryType: "payment_fee",
            amountMinor: feeMinor,
            currency,
            description: `Stripe payment fee (${eventId})`,
            externalRef: `${externalRef}:fee`,
          })
        : null;
    return {
      providerKind: "stripe",
      replayKey: eventId,
      eventType,
      currency,
      amountMinor,
      feeMinor,
      ledgerEntryType: "collected_revenue",
      ledgerEntry,
      feeLedgerEntry,
      externalRef,
    };
  }

  if (eventType === "invoice.paid") {
    const amountMinor = parseIntegerMinor(dataObject.amount_paid);
    if (amountMinor === null || amountMinor < 0) return null;
    const feeMinor =
      parseIntegerMinor(dataObject.application_fee_amount) ??
      parseIntegerMinor(dataObject.fee_minor);
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata,
      entryType: "collected_revenue",
      amountMinor,
      currency,
      description: `Stripe invoice paid (${eventId})`,
      externalRef,
    });
    const feeLedgerEntry =
      feeMinor !== null && feeMinor > 0
        ? buildPaymentLedgerEntry({
            context,
            metadata,
            entryType: "payment_fee",
            amountMinor: feeMinor,
            currency,
            description: `Stripe invoice fee (${eventId})`,
            externalRef: `${externalRef}:fee`,
          })
        : null;
    return {
      providerKind: "stripe",
      replayKey: eventId,
      eventType,
      currency,
      amountMinor,
      feeMinor,
      ledgerEntryType: "collected_revenue",
      ledgerEntry,
      feeLedgerEntry,
      externalRef,
    };
  }

  if (eventType === "charge.refunded") {
    const amountMinor = parseIntegerMinor(dataObject.amount_refunded);
    if (amountMinor === null || amountMinor < 0) return null;
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata,
      entryType: "refund",
      amountMinor,
      currency,
      description: `Stripe charge refunded (${eventId})`,
      externalRef,
    });
    return {
      providerKind: "stripe",
      replayKey: eventId,
      eventType,
      currency,
      amountMinor,
      feeMinor: null,
      ledgerEntryType: "refund",
      ledgerEntry,
      feeLedgerEntry: null,
      externalRef,
    };
  }

  return null;
}

export const createStripePaymentLink = Effect.fn("SovereignPaymentDrivers.createStripePaymentLink")(
  function* (input: CreateStripePaymentLinkInput, transport?: HttpTransport) {
    const label = input.label.trim();
    if (label.length === 0) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "create_payment_link",
        reason: "Payment link label must not be empty.",
      });
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "create_payment_link",
        reason: "Payment link amountMinor must be a positive integer.",
      });
    }

    const currency = input.currency ?? DEFAULT_REPORTING_CURRENCY;
    const nowIso = DateTime.formatIso(yield* DateTime.now);

    if (input.context.integration.sandboxMode) {
      const slug = NodeCrypto.createHash("sha256")
        .update(`${input.ventureId}:${label}:${input.amountMinor}:${currency}`)
        .digest("hex")
        .slice(0, 12);
      return {
        id: `plink_sandbox_${slug}`,
        ventureId: input.ventureId,
        invoiceId: input.invoiceId ?? null,
        integrationId: input.context.integration.id,
        label,
        url: `https://buy.stripe.com/test_sandbox_${slug}`,
        amountMinor: input.amountMinor,
        currency,
        active: true,
        createdAt: nowIso,
      } satisfies PaymentLink;
    }

    const apiKey = extractSecretField(input.context.secret, ["apiKey", "secretKey", "key"]);
    if (apiKey === null) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "create_payment_link",
        reason: "Stripe API key is not configured in secure credential storage.",
      });
    }

    const activeTransport = transport ?? createFetchHttpTransport();
    const baseUrl = stripTrailingSlash(
      input.context.integration.endpointUrl ?? DEFAULT_STRIPE_API_BASE,
    );
    const params = new URLSearchParams();
    params.set("line_items[0][price_data][currency]", currency.toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
    params.set("line_items[0][price_data][product_data][name]", label);
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[ventureId]", input.ventureId);
    if (input.invoiceId !== undefined && input.invoiceId !== null) {
      params.set("metadata[invoiceId]", input.invoiceId);
    }

    const response = yield* activeTransport
      .request({
        url: `${baseUrl}/v1/payment_links`,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "create_payment_link",
              reason: "Failed to reach Stripe API when creating payment link.",
              cause,
            }),
        ),
      );

    if (response.status < 200 || response.status >= 300) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "create_payment_link",
        reason: `Stripe API rejected payment link creation (HTTP ${response.status}).`,
      });
    }

    const parsed = decodeJsonRecord(response.bodyText);
    const linkId = extractOptionalString(parsed, "id");
    const linkUrl = extractOptionalString(parsed, "url");
    if (linkId === null || linkUrl === null) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "create_payment_link",
        reason: "Stripe API response did not include payment link id and url.",
      });
    }

    return {
      id: linkId,
      ventureId: input.ventureId,
      invoiceId: input.invoiceId ?? null,
      integrationId: input.context.integration.id,
      label,
      url: linkUrl,
      amountMinor: input.amountMinor,
      currency,
      active: true,
      createdAt: nowIso,
    } satisfies PaymentLink;
  },
);

export function verifyPaddleWebhookSignature(input: {
  readonly webhookSecret: string;
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string | undefined;
  readonly nowUnixSeconds?: number;
  readonly toleranceSeconds?: number;
}): boolean {
  if (
    input.webhookSecret.trim().length === 0 ||
    input.signatureHeader === undefined ||
    input.signatureHeader.trim().length === 0
  ) {
    return false;
  }

  let timestampRaw: string | null = null;
  const h1Signatures: Array<string> = [];

  for (const segment of input.signatureHeader.split(";")) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim();
    const value = segment.slice(eqIndex + 1).trim();
    if (key === "ts" && value.length > 0) {
      timestampRaw = value;
    } else if (key === "h1" && value.length > 0) {
      h1Signatures.push(value);
    }
  }

  if (timestampRaw === null || !/^\d+$/.test(timestampRaw) || h1Signatures.length === 0) {
    return false;
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  const nowSeconds =
    input.nowUnixSeconds ?? Math.floor(DateTime.toEpochMillis(DateTime.nowUnsafe()) / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) {
    return false;
  }

  const signedPayload = `${timestampRaw}:${utf8Decoder.decode(input.rawBody)}`;
  const expected = computeHmacSha256(input.webhookSecret, signedPayload);
  return h1Signatures.some((candidate) => constantTimeHexEqual(expected, candidate));
}

export function parsePaddleWebhookPayload(
  context: SovereignIntegrationDriverContext,
  rawBody: Uint8Array,
): NormalizedPaymentWebhookReconciliation | null {
  const payload = decodeJsonRecord(utf8Decoder.decode(rawBody));
  if (payload === null) return null;

  const eventType = extractOptionalString(payload, "event_type");
  const eventId = extractOptionalString(payload, "event_id");
  const data = asRecord(payload.data);
  if (eventType === null || eventId === null || data === null) return null;

  const customData = asRecord(data.custom_data);
  const currency = normalizeCurrencyCode(data.currency_code, DEFAULT_REPORTING_CURRENCY);
  const externalRef = `${context.integration.id}:paddle:${eventId}`;

  if (eventType === "transaction.completed") {
    const details = asRecord(data.details);
    const totals = asRecord(details?.totals) ?? asRecord(data.totals);
    const amountMinor = parseIntegerMinor(totals?.total) ?? parseIntegerMinor(totals?.grand_total);
    if (amountMinor === null || amountMinor < 0) return null;
    const feeMinor = parseIntegerMinor(totals?.fee);
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata: customData,
      entryType: "collected_revenue",
      amountMinor,
      currency,
      description: `Paddle transaction completed (${eventId})`,
      externalRef,
    });
    const feeLedgerEntry =
      feeMinor !== null && feeMinor > 0
        ? buildPaymentLedgerEntry({
            context,
            metadata: customData,
            entryType: "payment_fee",
            amountMinor: feeMinor,
            currency,
            description: `Paddle processing fee (${eventId})`,
            externalRef: `${externalRef}:fee`,
          })
        : null;
    return {
      providerKind: "paddle",
      replayKey: eventId,
      eventType,
      currency,
      amountMinor,
      feeMinor,
      ledgerEntryType: "collected_revenue",
      ledgerEntry,
      feeLedgerEntry,
      externalRef,
    };
  }

  if (eventType === "adjustment.created") {
    const totals = asRecord(data.totals);
    const amountMinor = parseIntegerMinor(totals?.total);
    if (amountMinor === null) return null;
    const feeMinor = parseIntegerMinor(totals?.fee);
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata: customData,
      entryType: "refund",
      amountMinor: Math.abs(amountMinor),
      currency,
      description: `Paddle adjustment (${eventId})`,
      externalRef,
    });
    const feeLedgerEntry =
      feeMinor !== null && feeMinor !== 0
        ? buildPaymentLedgerEntry({
            context,
            metadata: customData,
            entryType: "payment_fee",
            amountMinor: Math.abs(feeMinor),
            currency,
            description: `Paddle adjustment fee (${eventId})`,
            externalRef: `${externalRef}:fee`,
          })
        : null;
    return {
      providerKind: "paddle",
      replayKey: eventId,
      eventType,
      currency,
      amountMinor: Math.abs(amountMinor),
      feeMinor: feeMinor === null ? null : Math.abs(feeMinor),
      ledgerEntryType: "refund",
      ledgerEntry,
      feeLedgerEntry,
      externalRef,
    };
  }

  return null;
}

export function verifyLemonSqueezyWebhookSignature(input: {
  readonly webhookSecret: string;
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string | undefined;
}): boolean {
  if (
    input.webhookSecret.trim().length === 0 ||
    input.signatureHeader === undefined ||
    input.signatureHeader.trim().length === 0
  ) {
    return false;
  }
  const expected = computeHmacSha256(input.webhookSecret, input.rawBody);
  return constantTimeHexEqual(expected, input.signatureHeader);
}

export function parseLemonSqueezyWebhookPayload(
  context: SovereignIntegrationDriverContext,
  rawBody: Uint8Array,
): NormalizedPaymentWebhookReconciliation | null {
  const payload = decodeJsonRecord(utf8Decoder.decode(rawBody));
  if (payload === null) return null;

  const meta = asRecord(payload.meta);
  const data = asRecord(payload.data);
  const attributes = asRecord(data?.attributes);
  const eventType = extractOptionalString(meta, "event_name");
  const dataId = extractOptionalString(data, "id");
  if (eventType === null || dataId === null || attributes === null) return null;

  const customData = asRecord(meta?.custom_data);
  const currency = normalizeCurrencyCode(attributes.currency, DEFAULT_REPORTING_CURRENCY);
  const replayKey = `${eventType}:${dataId}`;
  const externalRef = `${context.integration.id}:lemonsqueezy:${replayKey}`;

  if (eventType === "order_created" || eventType === "subscription_payment_success") {
    const amountMinor = parseIntegerMinor(attributes.total);
    if (amountMinor === null || amountMinor < 0) return null;
    const feeMinor =
      parseIntegerMinor(attributes.fee) ?? parseIntegerMinor(attributes.processing_fee);
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata: customData,
      entryType: "collected_revenue",
      amountMinor,
      currency,
      description: `Lemon Squeezy ${eventType} (${dataId})`,
      externalRef,
    });
    const feeLedgerEntry =
      feeMinor !== null && feeMinor > 0
        ? buildPaymentLedgerEntry({
            context,
            metadata: customData,
            entryType: "payment_fee",
            amountMinor: feeMinor,
            currency,
            description: `Lemon Squeezy fee (${dataId})`,
            externalRef: `${externalRef}:fee`,
          })
        : null;
    return {
      providerKind: "lemonsqueezy",
      replayKey,
      eventType,
      currency,
      amountMinor,
      feeMinor,
      ledgerEntryType: "collected_revenue",
      ledgerEntry,
      feeLedgerEntry,
      externalRef,
    };
  }

  if (eventType === "order_refunded") {
    const amountMinor =
      parseIntegerMinor(attributes.refunded_amount) ?? parseIntegerMinor(attributes.total);
    if (amountMinor === null || amountMinor < 0) return null;
    const ledgerEntry = buildPaymentLedgerEntry({
      context,
      metadata: customData,
      entryType: "refund",
      amountMinor,
      currency,
      description: `Lemon Squeezy order refunded (${dataId})`,
      externalRef,
    });
    return {
      providerKind: "lemonsqueezy",
      replayKey,
      eventType,
      currency,
      amountMinor,
      feeMinor: null,
      ledgerEntryType: "refund",
      ledgerEntry,
      feeLedgerEntry: null,
      externalRef,
    };
  }

  return null;
}

export function createStripeDriver(options?: {
  readonly transport?: HttpTransport;
  readonly nowUnixSeconds?: () => number;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "stripe",
    testConnection: Effect.fn("SovereignPaymentDrivers.stripe.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Stripe");
      if (early !== null) return early;

      const apiKey = extractSecretField(context.secret, ["apiKey", "secretKey", "key"]);
      if (apiKey === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "Stripe requires an API key in secure credential storage.",
        };
      }

      const baseUrl = stripTrailingSlash(
        context.integration.endpointUrl ?? DEFAULT_STRIPE_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/v1/balance`,
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Stripe API balance endpoint.",
        };
      }

      const parsed = decodeJsonRecord(response.value.bodyText);
      const livemode = typeof parsed?.livemode === "boolean" ? parsed.livemode : null;
      return mapHttpStatusToTestResult(
        "Stripe",
        response.value,
        livemode === null
          ? undefined
          : { successDetail: livemode ? "live mode account" : "test mode account" },
      );
    }),

    verifyAndParseWebhook: Effect.fn("SovereignPaymentDrivers.stripe.verifyAndParseWebhook")(
      function* (input) {
        const webhookSecret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "signingSecret",
          "secret",
        ]);
        const signatureHeader = lookupHeaderCaseInsensitive(input.headers, "stripe-signature");
        const nowUnixSeconds =
          options?.nowUnixSeconds !== undefined
            ? options.nowUnixSeconds()
            : Math.floor((yield* Clock.currentTimeMillis) / 1000);
        if (
          webhookSecret === null ||
          !verifyStripeWebhookSignature({
            webhookSecret,
            rawBody: input.rawBody,
            signatureHeader,
            nowUnixSeconds,
          })
        ) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Stripe webhook signature verification failed.",
          });
        }

        const normalized = parseStripeWebhookPayload(input.context, input.rawBody);
        if (normalized === null) return null;
        return {
          replayKey: normalized.replayKey,
          eventType: normalized.eventType,
          ledgerEntry: normalized.ledgerEntry,
        } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}

export function createPaddleDriver(options?: {
  readonly transport?: HttpTransport;
  readonly nowUnixSeconds?: () => number;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "paddle",
    testConnection: Effect.fn("SovereignPaymentDrivers.paddle.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "Paddle", {
        allowLiveProbeInSandbox: true,
      });
      if (early !== null) return early;

      const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
      if (apiKey === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "Paddle requires an API key in secure credential storage.",
        };
      }

      const defaultBase = context.integration.sandboxMode
        ? DEFAULT_PADDLE_SANDBOX_API_BASE
        : DEFAULT_PADDLE_LIVE_API_BASE;
      const baseUrl = stripTrailingSlash(context.integration.endpointUrl ?? defaultBase);
      const response = yield* transport
        .request({
          url: `${baseUrl}/event-types`,
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach Paddle API event-types endpoint.",
        };
      }

      return mapHttpStatusToTestResult("Paddle", response.value, {
        sandbox: context.integration.sandboxMode,
      });
    }),

    verifyAndParseWebhook: Effect.fn("SovereignPaymentDrivers.paddle.verifyAndParseWebhook")(
      function* (input) {
        const webhookSecret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "notificationSecret",
          "secret",
        ]);
        const signatureHeader = lookupHeaderCaseInsensitive(input.headers, "paddle-signature");
        const nowUnixSeconds =
          options?.nowUnixSeconds !== undefined
            ? options.nowUnixSeconds()
            : Math.floor((yield* Clock.currentTimeMillis) / 1000);
        if (
          webhookSecret === null ||
          !verifyPaddleWebhookSignature({
            webhookSecret,
            rawBody: input.rawBody,
            signatureHeader,
            nowUnixSeconds,
          })
        ) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Paddle webhook signature verification failed.",
          });
        }

        const normalized = parsePaddleWebhookPayload(input.context, input.rawBody);
        if (normalized === null) return null;
        return {
          replayKey: normalized.replayKey,
          eventType: normalized.eventType,
          ledgerEntry: normalized.ledgerEntry,
        } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}

export function createLemonSqueezyDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "lemonsqueezy",
    testConnection: Effect.fn("SovereignPaymentDrivers.lemonsqueezy.testConnection")(
      function* (context) {
        const early = checkDisabledOrSandbox(context, "Lemon Squeezy");
        if (early !== null) return early;

        const apiKey = extractSecretField(context.secret, ["apiKey", "token", "key"]);
        if (apiKey === null) {
          return {
            ok: false,
            status: "unconfigured",
            latencyMs: null,
            message: "Lemon Squeezy requires an API key in secure credential storage.",
          };
        }

        const baseUrl = stripTrailingSlash(
          context.integration.endpointUrl ?? DEFAULT_LEMON_SQUEEZY_API_BASE,
        );
        const response = yield* transport
          .request({
            url: `${baseUrl}/v1/users/me`,
            method: "GET",
            headers: {
              authorization: `Bearer ${apiKey}`,
              accept: "application/vnd.api+json",
            },
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach Lemon Squeezy API endpoint.",
          };
        }

        return mapHttpStatusToTestResult("Lemon Squeezy", response.value);
      },
    ),

    verifyAndParseWebhook: Effect.fn("SovereignPaymentDrivers.lemonsqueezy.verifyAndParseWebhook")(
      function* (input) {
        const webhookSecret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "signingSecret",
          "secret",
        ]);
        const signatureHeader = lookupHeaderCaseInsensitive(input.headers, "x-signature");
        if (
          webhookSecret === null ||
          !verifyLemonSqueezyWebhookSignature({
            webhookSecret,
            rawBody: input.rawBody,
            signatureHeader,
          })
        ) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Lemon Squeezy webhook signature verification failed.",
          });
        }

        const normalized = parseLemonSqueezyWebhookPayload(input.context, input.rawBody);
        if (normalized === null) return null;
        return {
          replayKey: normalized.replayKey,
          eventType: normalized.eventType,
          ledgerEntry: normalized.ledgerEntry,
        } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}
