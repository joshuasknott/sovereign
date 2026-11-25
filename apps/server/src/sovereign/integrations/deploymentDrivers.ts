// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC verification for deployment and storefront webhooks.
import * as NodeCrypto from "node:crypto";
import {
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type RecordLedgerEntryInput,
} from "@t3tools/contracts";
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

const DEFAULT_VERCEL_API_BASE = "https://api.vercel.com";
const DEFAULT_CLOUDFLARE_API_BASE = "https://api.cloudflare.com";
const DEFAULT_GUMROAD_API_BASE = "https://api.gumroad.com";
const utf8Decoder = new TextDecoder();

export interface DeploymentStatusSummary {
  readonly providerKind: "vercel" | "cloudflare";
  readonly deploymentId: string;
  readonly state: "queued" | "building" | "ready" | "error" | "canceled" | "unknown";
  readonly url: string | null;
  readonly sandbox: boolean;
}

export interface StorefrontProductSummary {
  readonly providerKind: "gumroad";
  readonly productId: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly currency: CurrencyCode;
  readonly published: boolean;
  readonly url: string | null;
  readonly sandbox: boolean;
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

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

const readInteger = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null => {
  if (record === null) return null;
  const value = record[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const normalizeDeploymentState = (raw: string | null): DeploymentStatusSummary["state"] => {
  if (raw === null) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "ready" || lower === "success" || lower === "active") return "ready";
  if (lower === "queued" || lower === "initializing") return "queued";
  if (lower === "building" || lower === "running") return "building";
  if (lower === "error" || lower === "failure" || lower === "failed") return "error";
  if (lower === "canceled" || lower === "cancelled") return "canceled";
  return "unknown";
};

export const getVercelDeploymentStatus = Effect.fn(
  "SovereignDeploymentDrivers.getVercelDeploymentStatus",
)(function* (
  input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly deploymentId: string;
  },
  transport?: HttpTransport,
) {
  if (input.context.integration.sandboxMode) {
    return {
      providerKind: "vercel",
      deploymentId: input.deploymentId,
      state: "ready",
      url: `https://sandbox-${input.deploymentId}.vercel.app`,
      sandbox: true,
    } satisfies DeploymentStatusSummary;
  }

  const token = extractSecretField(input.context.secret, ["token", "apiKey", "secret"]);
  if (token === null) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "get_deployment_status",
      reason: "Vercel API token is not configured in secure credential storage.",
    });
  }

  const activeTransport = transport ?? createFetchHttpTransport();
  const baseUrl = stripTrailingSlash(
    input.context.integration.endpointUrl ?? DEFAULT_VERCEL_API_BASE,
  );
  const response = yield* activeTransport
    .request({
      url: `${baseUrl}/v13/deployments/${encodeURIComponent(input.deploymentId)}`,
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "get_deployment_status",
            reason: "Failed to fetch Vercel deployment status.",
            cause,
          }),
      ),
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "get_deployment_status",
      reason: `Vercel deployment lookup failed with HTTP ${response.status}.`,
    });
  }

  const parsed = decodeJsonRecord(response.bodyText);
  const rawUrl = readString(parsed, "url");
  return {
    providerKind: "vercel",
    deploymentId: readString(parsed, "id") ?? input.deploymentId,
    state: normalizeDeploymentState(
      readString(parsed, "readyState") ?? readString(parsed, "status"),
    ),
    url: rawUrl === null ? null : rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
    sandbox: false,
  } satisfies DeploymentStatusSummary;
});

export const getCloudflarePagesDeploymentStatus = Effect.fn(
  "SovereignDeploymentDrivers.getCloudflarePagesDeploymentStatus",
)(function* (
  input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly accountId: string;
    readonly projectName: string;
    readonly deploymentId: string;
  },
  transport?: HttpTransport,
) {
  if (input.context.integration.sandboxMode) {
    return {
      providerKind: "cloudflare",
      deploymentId: input.deploymentId,
      state: "ready",
      url: `https://sandbox-${input.projectName}.pages.dev`,
      sandbox: true,
    } satisfies DeploymentStatusSummary;
  }

  const token = extractSecretField(input.context.secret, ["apiToken", "token", "apiKey", "secret"]);
  if (token === null) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "get_deployment_status",
      reason: "Cloudflare API token is not configured in secure credential storage.",
    });
  }

  const activeTransport = transport ?? createFetchHttpTransport();
  const baseUrl = stripTrailingSlash(
    input.context.integration.endpointUrl ?? DEFAULT_CLOUDFLARE_API_BASE,
  );
  const response = yield* activeTransport
    .request({
      url: `${baseUrl}/client/v4/accounts/${encodeURIComponent(input.accountId)}/pages/projects/${encodeURIComponent(input.projectName)}/deployments/${encodeURIComponent(input.deploymentId)}`,
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "get_deployment_status",
            reason: "Failed to fetch Cloudflare Pages deployment status.",
            cause,
          }),
      ),
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "get_deployment_status",
      reason: `Cloudflare Pages deployment lookup failed with HTTP ${response.status}.`,
    });
  }

  const parsed = decodeJsonRecord(response.bodyText);
  const result = asRecord(parsed?.result);
  const latestStage = asRecord(result?.latest_stage);
  return {
    providerKind: "cloudflare",
    deploymentId: readString(result, "id") ?? input.deploymentId,
    state: normalizeDeploymentState(readString(latestStage, "status")),
    url: readString(result, "url"),
    sandbox: false,
  } satisfies DeploymentStatusSummary;
});

export const listGumroadProducts = Effect.fn("SovereignDeploymentDrivers.listGumroadProducts")(
  function* (
    input: { readonly context: SovereignIntegrationDriverContext },
    transport?: HttpTransport,
  ) {
    if (input.context.integration.sandboxMode) {
      return [
        {
          providerKind: "gumroad",
          productId: "gumroad_sandbox_prod_1",
          name: "Sandbox Digital Product",
          priceMinor: 2900,
          currency: DEFAULT_REPORTING_CURRENCY,
          published: true,
          url: "https://sandbox.gumroad.com/l/sample",
          sandbox: true,
        },
      ] satisfies ReadonlyArray<StorefrontProductSummary>;
    }

    const token = extractSecretField(input.context.secret, [
      "accessToken",
      "token",
      "apiKey",
      "secret",
    ]);
    if (token === null) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "list_products",
        reason: "Gumroad access token is not configured in secure credential storage.",
      });
    }

    const activeTransport = transport ?? createFetchHttpTransport();
    const baseUrl = stripTrailingSlash(
      input.context.integration.endpointUrl ?? DEFAULT_GUMROAD_API_BASE,
    );
    const response = yield* activeTransport
      .request({
        url: `${baseUrl}/v2/products`,
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "list_products",
              reason: "Failed to fetch Gumroad storefront products.",
              cause,
            }),
        ),
      );

    if (response.status < 200 || response.status >= 300) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "list_products",
        reason: `Gumroad product lookup failed with HTTP ${response.status}.`,
      });
    }

    const parsed = decodeJsonRecord(response.bodyText);
    const rawProducts = Array.isArray(parsed?.products) ? parsed.products : [];
    const products: Array<StorefrontProductSummary> = [];
    for (const rawProduct of rawProducts) {
      const product = asRecord(rawProduct);
      if (product === null) continue;
      const productId = readString(product, "id");
      const name = readString(product, "name");
      if (productId === null || name === null) continue;
      products.push({
        providerKind: "gumroad",
        productId,
        name,
        priceMinor: Math.max(0, readInteger(product, "price") ?? 0),
        currency: normalizeCurrencyCode(product.currency, DEFAULT_REPORTING_CURRENCY),
        published: product.published === true,
        url: readString(product, "short_url"),
        sandbox: false,
      });
    }
    return products satisfies ReadonlyArray<StorefrontProductSummary>;
  },
);

export function createVercelDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "vercel",
    testConnection: Effect.fn("SovereignDeploymentDrivers.vercel.testConnection")(
      function* (context) {
        const early = checkDisabledOrSandbox(context, "Vercel");
        if (early !== null) return early;

        const token = extractSecretField(context.secret, ["token", "apiKey", "secret"]);
        if (token === null) {
          return {
            ok: false,
            status: "unconfigured",
            latencyMs: null,
            message: "Vercel requires an API token in secure credential storage.",
          };
        }

        const baseUrl = stripTrailingSlash(
          context.integration.endpointUrl ?? DEFAULT_VERCEL_API_BASE,
        );
        const response = yield* transport
          .request({
            url: `${baseUrl}/v2/user`,
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach Vercel API endpoint.",
          };
        }
        return mapHttpStatusToTestResult("Vercel", response.value);
      },
    ),

    verifyAndParseWebhook: Effect.fn("SovereignDeploymentDrivers.vercel.verifyAndParseWebhook")(
      function* (input) {
        const secret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "secret",
          "token",
        ]);
        if (secret === null) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Vercel webhook secret is not configured.",
          });
        }
        const vercelSig = lookupHeaderCaseInsensitive(input.headers, "x-vercel-signature");
        const sha256Sig = lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
        const sha1Ok =
          vercelSig !== undefined &&
          constantTimeHexEqual(
            NodeCrypto.createHmac("sha1", secret).update(input.rawBody).digest("hex"),
            vercelSig,
          );
        const sha256Ok =
          sha256Sig !== undefined &&
          constantTimeHexEqual(
            NodeCrypto.createHmac("sha256", secret).update(input.rawBody).digest("hex"),
            sha256Sig.replace(/^sha256=/i, ""),
          );
        if (!sha1Ok && !sha256Ok) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Vercel webhook signature verification failed.",
          });
        }

        const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
        if (payload === null) return null;
        const replayKey =
          readString(payload, "id") ??
          NodeCrypto.createHash("sha256").update(input.rawBody).digest("hex");
        const eventType = readString(payload, "type") ?? "vercel.deployment";
        return { replayKey, eventType } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}

export function createCloudflareDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "cloudflare",
    testConnection: Effect.fn("SovereignDeploymentDrivers.cloudflare.testConnection")(
      function* (context) {
        const early = checkDisabledOrSandbox(context, "Cloudflare");
        if (early !== null) return early;

        const token = extractSecretField(context.secret, ["apiToken", "token", "apiKey", "secret"]);
        if (token === null) {
          return {
            ok: false,
            status: "unconfigured",
            latencyMs: null,
            message: "Cloudflare requires an API token in secure credential storage.",
          };
        }

        const baseUrl = stripTrailingSlash(
          context.integration.endpointUrl ?? DEFAULT_CLOUDFLARE_API_BASE,
        );
        const response = yield* transport
          .request({
            url: `${baseUrl}/client/v4/user/tokens/verify`,
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach Cloudflare token verification endpoint.",
          };
        }

        const parsed = decodeJsonRecord(response.value.bodyText);
        if (
          response.value.status >= 200 &&
          response.value.status < 300 &&
          parsed?.success === false
        ) {
          return {
            ok: false,
            status: "error",
            latencyMs: response.value.latencyMs,
            message: "Cloudflare reported that the configured API token is invalid or inactive.",
          };
        }
        return mapHttpStatusToTestResult("Cloudflare", response.value);
      },
    ),
  };
}

export function createGumroadDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "gumroad",
    testConnection: Effect.fn("SovereignDeploymentDrivers.gumroad.testConnection")(
      function* (context) {
        const early = checkDisabledOrSandbox(context, "Gumroad");
        if (early !== null) return early;

        const token = extractSecretField(context.secret, [
          "accessToken",
          "token",
          "apiKey",
          "secret",
        ]);
        if (token === null) {
          return {
            ok: false,
            status: "unconfigured",
            latencyMs: null,
            message: "Gumroad requires an access token in secure credential storage.",
          };
        }

        const baseUrl = stripTrailingSlash(
          context.integration.endpointUrl ?? DEFAULT_GUMROAD_API_BASE,
        );
        const response = yield* transport
          .request({
            url: `${baseUrl}/v2/user`,
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
          })
          .pipe(Effect.option);

        if (response._tag === "None") {
          return {
            ok: false,
            status: "error",
            latencyMs: null,
            message: "Could not reach Gumroad API endpoint.",
          };
        }

        const parsed = decodeJsonRecord(response.value.bodyText);
        if (
          response.value.status >= 200 &&
          response.value.status < 300 &&
          parsed?.success === false
        ) {
          return {
            ok: false,
            status: "error",
            latencyMs: response.value.latencyMs,
            message: "Gumroad rejected the configured access token.",
          };
        }
        return mapHttpStatusToTestResult("Gumroad", response.value);
      },
    ),

    verifyAndParseWebhook: Effect.fn("SovereignDeploymentDrivers.gumroad.verifyAndParseWebhook")(
      function* (input) {
        const secret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "secret",
          "accessToken",
        ]);
        const sigHeader =
          lookupHeaderCaseInsensitive(input.headers, "x-gumroad-signature") ??
          lookupHeaderCaseInsensitive(input.headers, "x-sovereign-signature");
        if (secret === null || sigHeader === undefined) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Gumroad webhook signature or secret is missing.",
          });
        }
        const expected = NodeCrypto.createHmac("sha256", secret)
          .update(input.rawBody)
          .digest("hex");
        if (!constantTimeHexEqual(expected, sigHeader.replace(/^sha256=/i, ""))) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "Gumroad webhook signature verification failed.",
          });
        }

        const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
        if (payload === null) return null;
        const saleId = readString(payload, "sale_id");
        const priceMinor = readInteger(payload, "price");
        if (saleId === null || priceMinor === null || priceMinor < 0) return null;

        const refunded = payload.refunded === true || payload.resource_name === "refund";
        const eventType = refunded ? "gumroad.refund" : "gumroad.sale";
        const currency = normalizeCurrencyCode(payload.currency, DEFAULT_REPORTING_CURRENCY);
        const ledgerEntry: RecordLedgerEntryInput = {
          ventureId: input.context.integration.ventureId,
          integrationId: input.context.integration.id,
          entryType: refunded ? "refund" : "collected_revenue",
          verificationState: "verified",
          amountMinor: Math.abs(priceMinor),
          currency,
          description: `Gumroad ${refunded ? "refund" : "sale"} (${saleId})`,
          externalRef: `${input.context.integration.id}:gumroad:${saleId}:${refunded ? "refund" : "sale"}`,
        };
        return {
          replayKey: `${eventType}:${saleId}`,
          eventType,
          ledgerEntry,
        } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}
