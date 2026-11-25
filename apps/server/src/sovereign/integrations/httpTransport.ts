// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC comparison for webhook signature verification.
import * as NodeCrypto from "node:crypto";
import {
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type IntegrationConfig,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  SovereignIntegrationDriverContext,
  SovereignIntegrationDriverTestOutput,
} from "../SovereignIntegrationService.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface HttpTransportRequest {
  readonly url: string;
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly redirect?: "follow" | "manual" | "error";
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly latencyMs: number;
}

export class HttpTransportError extends Schema.TaggedError<HttpTransportError>()(
  "HttpTransportError",
  {
    urlHost: Schema.String,
    stage: Schema.Literals(["invalid_url", "timeout", "network", "read_body"]),
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `HTTP ${this.stage} error for ${this.urlHost}: ${this.reason}`;
  }
}

export interface HttpTransport {
  readonly request: (
    request: HttpTransportRequest,
  ) => Effect.Effect<HttpTransportResponse, HttpTransportError>;
}

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

const JsonRecordSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const JsonUnknownSchema = Schema.fromJsonString(Schema.Unknown);
const decodeJsonRecordOption = Schema.decodeUnknownOption(JsonRecordSchema);
const encodeJsonUnknownSync = Schema.encodeSync(JsonUnknownSchema);
const utf8Decoder = new TextDecoder();

export function encodeJsonString(value: unknown): string {
  return encodeJsonUnknownSync(value);
}

const parseUrlOrNull = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

export function safeUrlHost(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid-url";
  }
}

const readBoundedResponseBytes = async (
  response: Response,
  maxBytes: number,
): Promise<{ readonly bytes: Uint8Array; readonly truncated: boolean }> => {
  if (response.body === null) {
    const buffer = await response.arrayBuffer();
    const raw = new Uint8Array(buffer);
    if (raw.byteLength <= maxBytes) {
      return { bytes: raw, truncated: false };
    }
    return { bytes: raw.subarray(0, maxBytes), truncated: true };
  }

  const reader = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = step.value;
      const remaining = maxBytes - total;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: combined, truncated };
};

export function createFetchHttpTransport(options?: {
  readonly defaultTimeoutMs?: number;
  readonly defaultMaxResponseBytes?: number;
  readonly fetchImpl?: typeof globalThis.fetch;
}): HttpTransport {
  const defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const defaultMaxResponseBytes = options?.defaultMaxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  const request = Effect.fn("SovereignHttpTransport.request")(function* (
    req: HttpTransportRequest,
  ) {
    const parsedUrl = parseUrlOrNull(req.url);
    if (parsedUrl === null) {
      return yield* new HttpTransportError({
        urlHost: "invalid-url",
        stage: "invalid_url",
        reason: "Request URL could not be parsed.",
      });
    }

    const urlHost = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const timeoutMs = Math.max(100, req.timeoutMs ?? defaultTimeoutMs);
    const maxBytes = Math.max(1024, req.maxResponseBytes ?? defaultMaxResponseBytes);
    const startedAt = yield* Clock.currentTimeMillis;

    const responseData = yield* Effect.tryPromise({
      try: async () => {
        const requestBody: RequestInit["body"] =
          req.body === undefined
            ? undefined
            : typeof req.body === "string"
              ? req.body
              : new Uint8Array(req.body);
        const init: RequestInit = {
          method: req.method ?? "GET",
          headers: req.headers === undefined ? {} : { ...req.headers },
          redirect: req.redirect ?? "follow",
          signal: AbortSignal.timeout(timeoutMs),
          ...(requestBody === undefined ? {} : { body: requestBody }),
        };
        const response = await fetchImpl(parsedUrl.toString(), init);
        const { bytes, truncated } = await readBoundedResponseBytes(response, maxBytes);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return {
          status: response.status,
          ok: response.ok,
          url: response.url || parsedUrl.toString(),
          headers,
          bodyText: utf8Decoder.decode(bytes),
          byteLength: bytes.byteLength,
          truncated,
        };
      },
      catch: (cause) => {
        const isAbort =
          cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
        return new HttpTransportError({
          urlHost,
          stage: isAbort ? "timeout" : "network",
          reason: isAbort
            ? `Request timed out after ${timeoutMs}ms.`
            : "Network request failed before receiving a valid response.",
          cause,
        });
      },
    });

    const endedAt = yield* Clock.currentTimeMillis;
    return {
      ...responseData,
      latencyMs: Math.max(0, endedAt - startedAt),
    } satisfies HttpTransportResponse;
  });

  return { request };
}

export function decodeJsonRecord(text: string): Readonly<Record<string, unknown>> | null {
  const decoded = decodeJsonRecordOption(text);
  return Option.isSome(decoded) ? decoded.value : null;
}

export function extractSecretField(
  secret: string | null,
  preferredKeys: ReadonlyArray<string>,
): string | null {
  if (secret === null) return null;
  const trimmed = secret.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("{")) {
    const parsed = decodeJsonRecord(trimmed);
    if (parsed !== null) {
      for (const key of preferredKeys) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
      return null;
    }
  }
  return trimmed;
}

export function readStringSetting(
  settings: IntegrationConfig["settings"],
  key: string,
): string | null {
  const value = settings[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNumberSetting(
  settings: IntegrationConfig["settings"],
  key: string,
): number | null {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readBooleanSetting(
  settings: IntegrationConfig["settings"],
  key: string,
): boolean | null {
  const value = settings[key];
  return typeof value === "boolean" ? value : null;
}

export function lookupHeaderCaseInsensitive(
  headers: Readonly<Record<string, string>>,
  headerName: string,
): string | undefined {
  const target = headerName.toLowerCase();
  const direct = headers[target];
  if (direct !== undefined) return direct;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

export function constantTimeHexEqual(expectedHex: string, candidateHex: string): boolean {
  const expected = expectedHex.trim().toLowerCase();
  const candidate = candidateHex.trim().toLowerCase();
  if (
    expected.length === 0 ||
    expected.length !== candidate.length ||
    expected.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(expected) ||
    !/^[0-9a-f]+$/.test(candidate)
  ) {
    return false;
  }
  const expectedBuf = Buffer.from(expected, "hex");
  const candidateBuf = Buffer.from(candidate, "hex");
  if (expectedBuf.length !== candidateBuf.length) return false;
  return NodeCrypto.timingSafeEqual(expectedBuf, candidateBuf);
}

export function constantTimeBase64Equal(expectedBase64: string, candidateBase64: string): boolean {
  const expected = expectedBase64.trim();
  const candidate = candidateBase64.trim();
  if (expected.length === 0 || candidate.length === 0) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");
  if (expectedBuf.length !== candidateBuf.length) return false;
  return NodeCrypto.timingSafeEqual(expectedBuf, candidateBuf);
}

export function normalizeCurrencyCode(
  raw: unknown,
  fallback: CurrencyCode = DEFAULT_REPORTING_CURRENCY,
): CurrencyCode {
  if (typeof raw !== "string") return fallback;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? (upper as CurrencyCode) : fallback;
}

export function checkDisabledOrSandbox(
  context: SovereignIntegrationDriverContext,
  providerLabel: string,
  options?: { readonly allowLiveProbeInSandbox?: boolean },
): SovereignIntegrationDriverTestOutput | null {
  if (!context.integration.enabled) {
    return {
      ok: false,
      status: "disabled",
      latencyMs: null,
      message: `${providerLabel} integration is disabled.`,
    };
  }
  if (
    context.integration.sandboxMode &&
    (!options?.allowLiveProbeInSandbox || context.secret === null || context.secret.trim() === "")
  ) {
    return {
      ok: true,
      status: "connected",
      latencyMs: 0,
      message: `${providerLabel} sandbox mode verified (no live production credentials exercised).`,
    };
  }
  return null;
}

export function mapHttpStatusToTestResult(
  providerLabel: string,
  response: HttpTransportResponse,
  options?: { readonly successDetail?: string; readonly sandbox?: boolean },
): SovereignIntegrationDriverTestOutput {
  const sandboxSuffix = options?.sandbox ? " (sandbox)" : "";
  if (response.status >= 200 && response.status < 300) {
    const detail = options?.successDetail ? `: ${options.successDetail}` : "";
    return {
      ok: true,
      status: "connected",
      latencyMs: response.latencyMs,
      message: `${providerLabel} connection verified${sandboxSuffix}${detail}.`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: "error",
      latencyMs: response.latencyMs,
      message: `${providerLabel} rejected the configured credentials${sandboxSuffix} (HTTP ${response.status}).`,
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      status: "error",
      latencyMs: response.latencyMs,
      message: `${providerLabel} rate-limited the connection test${sandboxSuffix} (HTTP 429).`,
    };
  }
  return {
    ok: false,
    status: "error",
    latencyMs: response.latencyMs,
    message: `${providerLabel} connection test failed${sandboxSuffix} (HTTP ${response.status}).`,
  };
}
