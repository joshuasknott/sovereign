import * as NodeNet from "node:net";
import type { VentureId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  SanitizeUntrustedContentInput,
  SanitizeUntrustedContentResult,
  SovereignGovernanceService,
} from "../SovereignGovernanceService.ts";
import { createFetchHttpTransport, type HttpTransport, safeUrlHost } from "./httpTransport.ts";

const DEFAULT_RESEARCH_TIMEOUT_MS = 8_000;
const DEFAULT_RESEARCH_MAX_BYTES = 262_144;
const MAX_REDIRECT_HOPS = 3;

export class WebResearchError extends Schema.TaggedError<WebResearchError>()("WebResearchError", {
  urlHost: Schema.String,
  stage: Schema.Literals(["invalid_url", "ssrf_guard", "fetch", "redirect_limit", "sanitize"]),
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `Web research ${this.stage} error for ${this.urlHost}: ${this.reason}`;
  }
}

export interface WebsiteAuditResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly usesHttps: boolean;
  readonly contentType: string | null;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly latencyMs: number;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly hasViewportMeta: boolean;
  readonly h1Count: number;
  readonly h2Count: number;
  readonly h1Texts: ReadonlyArray<string>;
  readonly scriptCount: number;
  readonly stylesheetCount: number;
  readonly imageCount: number;
  readonly imagesMissingAltCount: number;
  readonly auditFindings: ReadonlyArray<string>;
  readonly quarantined: boolean;
  readonly matchedInjectionPatterns: ReadonlyArray<string>;
  readonly sanitizedTitle: string;
  readonly sanitizedMetaDescription: string;
  readonly sanitizedExcerpt: string;
}

export interface FetchAndAuditWebsiteOptions {
  readonly transport?: HttpTransport;
  readonly allowLocalLab?: boolean;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly ventureId?: VentureId | null;
  readonly governance?: Pick<SovereignGovernanceService["Service"], "sanitizeUntrustedContent">;
}

const PROMPT_INJECTION_RULES: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  {
    name: "instruction_override",
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system|safety|policy)\s+(?:instructions|prompts|rules|policies|guardrails)\b/i,
  },
  {
    name: "policy_bypass",
    pattern:
      /\b(?:bypass|disable|turn\s+off)\s+(?:the\s+)?(?:approval|permission|emergency\s+stop|budget|security|governance)\b/i,
  },
  {
    name: "secret_exfiltration",
    pattern:
      /\b(?:reveal|print|dump|output|exfiltrate|leak|send)\s+(?:all\s+)?(?:secrets?|api[\s_-]?keys?|tokens?|credentials?|passwords?|private[\s_-]?keys?|env(?:ironment)?\s+variables?)\b/i,
  },
  {
    name: "unauthorised_financial_action",
    pattern:
      /\b(?:immediately\s+)?(?:transfer|wire|send)\s+(?:all\s+)?(?:funds|money|balance|payout)|(?:issue|approve)\s+(?:an?\s+)?unauthorised\s+(?:payment|refund|spend)\b/i,
  },
  {
    name: "unauthorised_execution",
    pattern:
      /\b(?:execute|run)\s+(?:unauthorised|arbitrary)\s+(?:shell|command|deploy|scan|exploit)\b/i,
  },
  {
    name: "control_delimiter",
    pattern: /(?:<\|(?:im_start|im_end|system|assistant|endoftext)\|>|###\s*SYSTEM\b|\[SYSTEM\])/i,
  },
];

const CONTROL_DELIMITER_STRIP_RE =
  /(?:<\|(?:im_start|im_end|system|assistant|endoftext)\|>|###\s*SYSTEM\b|\[SYSTEM\]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F])/gi;

const isPrivateOrReservedIpv4 = (ip: string): boolean => {
  const parts = ip.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
};

const isPrivateOrReservedIpv6 = (rawHost: string): boolean => {
  const normalized = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")) {
    return true;
  }

  const mappedDottedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mappedDottedMatch?.[1] !== undefined) {
    return isPrivateOrReservedIpv4(mappedDottedMatch[1]);
  }

  const mappedHexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHexMatch?.[1] !== undefined && mappedHexMatch[2] !== undefined) {
    const hi = Number.parseInt(mappedHexMatch[1], 16);
    const lo = Number.parseInt(mappedHexMatch[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateOrReservedIpv4(ipv4);
  }
  return false;
};

const isBlockedHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase().replace(/\.+$/, "");
  if (lower.length === 0) return true;
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower === "metadata" ||
    lower === "metadata.google.internal" ||
    lower === "host.docker.internal"
  ) {
    return true;
  }

  const unbracketed = lower.replace(/^\[|\]$/g, "");
  const ipVersion = NodeNet.isIP(unbracketed);
  if (ipVersion === 4) {
    return isPrivateOrReservedIpv4(unbracketed);
  }
  if (ipVersion === 6) {
    return isPrivateOrReservedIpv6(unbracketed);
  }
  return false;
};

export function validateResearchUrl(
  rawUrl: string,
  options?: { readonly allowLocalLab?: boolean },
): Effect.Effect<URL, WebResearchError> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return Effect.fail(
      new WebResearchError({
        urlHost: "invalid-url",
        stage: "invalid_url",
        reason: "URL could not be parsed.",
      }),
    );
  }

  const urlHost = `${parsed.protocol}//${parsed.host}`;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Effect.fail(
      new WebResearchError({
        urlHost,
        stage: "ssrf_guard",
        reason: `Disallowed URL scheme "${parsed.protocol}"; only http: and https: are permitted.`,
      }),
    );
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return Effect.fail(
      new WebResearchError({
        urlHost,
        stage: "ssrf_guard",
        reason: "Embedded URL credentials are not permitted for web research requests.",
      }),
    );
  }

  if (options?.allowLocalLab !== true && isBlockedHostname(parsed.hostname)) {
    return Effect.fail(
      new WebResearchError({
        urlHost,
        stage: "ssrf_guard",
        reason:
          "Target host resolves to a blocked loopback, link-local, metadata, or private network address.",
      }),
    );
  }

  return Effect.succeed(parsed);
}

const decodeHtmlEntities = (raw: string): string =>
  raw
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripTags = (html: string): string => decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));

const extractHtmlSignals = (html: string) => {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] !== undefined ? stripTags(titleMatch[1]) || null : null;

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  let metaDescription: string | null = null;
  let hasViewportMeta = false;
  for (const tag of metaTags) {
    const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? "").toLowerCase();
    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const content = decodeHtmlEntities(
      contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? "",
    );
    if (name === "description" && content.length > 0 && metaDescription === null) {
      metaDescription = content;
    }
    if (name === "viewport") {
      hasViewportMeta = true;
    }
  }

  const h1Matches = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi));
  const h1Texts = h1Matches
    .map((m) => stripTags(m[1] ?? ""))
    .filter((text) => text.length > 0)
    .slice(0, 10);
  const h2Count = (html.match(/<h2\b[^>]*>/gi) ?? []).length;
  const scriptCount = (html.match(/<script\b[^>]*>/gi) ?? []).length;
  const stylesheetCount = (html.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi) ?? [])
    .length;
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imageCount = imgTags.length;
  let imagesMissingAltCount = 0;
  for (const imgTag of imgTags) {
    if (!/\balt\s*=\s*(?:"[^"]+"|'[^']+')/i.test(imgTag)) {
      imagesMissingAltCount += 1;
    }
  }

  const visibleExcerpt = decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 2000);

  return {
    title,
    metaDescription,
    hasViewportMeta,
    h1Count: h1Matches.length,
    h2Count,
    h1Texts,
    scriptCount,
    stylesheetCount,
    imageCount,
    imagesMissingAltCount,
    visibleExcerpt,
  };
};

const localSanitizeUntrusted = (
  input: SanitizeUntrustedContentInput,
): Effect.Effect<SanitizeUntrustedContentResult> => {
  const stripped = input.rawText.replace(CONTROL_DELIMITER_STRIP_RE, "").trim();
  const matchedPatterns: Array<string> = [];
  for (const rule of PROMPT_INJECTION_RULES) {
    if (rule.pattern.test(input.rawText)) {
      matchedPatterns.push(rule.name);
    }
  }
  const quarantined = matchedPatterns.length > 0;
  const safeSource = input.source.replace(/[^a-zA-Z0-9._:/-]/g, "_").slice(0, 80) || "web_research";
  const body = quarantined
    ? `[QUARANTINED UNTRUSTED CONTENT: matched ${matchedPatterns.join(", ")}]\n${stripped}`
    : stripped;
  return Effect.succeed({
    quarantined,
    matchedPatterns,
    sanitizedText: `<untrusted_data source="${safeSource}" quarantined="${quarantined ? "true" : "false"}">\n${body}\n</untrusted_data>`,
  });
};

export const fetchAndAuditWebsite = Effect.fn("SovereignWebResearchDriver.fetchAndAuditWebsite")(
  function* (url: string, options?: FetchAndAuditWebsiteOptions) {
    const initialUrl = yield* validateResearchUrl(
      url,
      options?.allowLocalLab === undefined ? undefined : { allowLocalLab: options.allowLocalLab },
    );
    const transport = options?.transport ?? createFetchHttpTransport();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
    const maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_RESEARCH_MAX_BYTES;

    let currentUrl = initialUrl;
    let response = yield* transport
      .request({
        url: currentUrl.toString(),
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "user-agent": "Sovereign-Commercial-OS-Audit/1.0",
        },
        timeoutMs,
        maxResponseBytes,
        redirect: "manual",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WebResearchError({
              urlHost: safeUrlHost(currentUrl.toString()),
              stage: "fetch",
              reason: cause.reason,
              cause,
            }),
        ),
      );

    let hops = 0;
    while (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.location !== undefined
    ) {
      hops += 1;
      if (hops > MAX_REDIRECT_HOPS) {
        return yield* new WebResearchError({
          urlHost: safeUrlHost(currentUrl.toString()),
          stage: "redirect_limit",
          reason: `Exceeded maximum redirect limit (${MAX_REDIRECT_HOPS}).`,
        });
      }
      const nextRaw = new URL(response.headers.location, currentUrl).toString();
      currentUrl = yield* validateResearchUrl(
        nextRaw,
        options?.allowLocalLab === undefined ? undefined : { allowLocalLab: options.allowLocalLab },
      );
      response = yield* transport
        .request({
          url: currentUrl.toString(),
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
            "user-agent": "Sovereign-Commercial-OS-Audit/1.0",
          },
          timeoutMs,
          maxResponseBytes,
          redirect: "manual",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WebResearchError({
                urlHost: safeUrlHost(currentUrl.toString()),
                stage: "fetch",
                reason: cause.reason,
                cause,
              }),
          ),
        );
    }

    const finalUrl = currentUrl.toString();
    const usesHttps = currentUrl.protocol === "https:";
    const signals = extractHtmlSignals(response.bodyText);

    const auditFindings: Array<string> = [];
    if (!usesHttps) {
      auditFindings.push("Site does not serve over HTTPS.");
    }
    if (response.status >= 400) {
      auditFindings.push(`Page returned HTTP error status ${response.status}.`);
    }
    if (signals.title === null) {
      auditFindings.push("Missing <title> tag.");
    }
    if (signals.metaDescription === null) {
      auditFindings.push("Missing meta description for search snippets.");
    }
    if (!signals.hasViewportMeta) {
      auditFindings.push("Missing mobile viewport meta tag.");
    }
    if (signals.h1Count === 0) {
      auditFindings.push("Missing primary <h1> heading.");
    }
    if (signals.scriptCount > 15) {
      auditFindings.push(
        `Heavy client-side script footprint (${signals.scriptCount} script tags).`,
      );
    }
    if (signals.imagesMissingAltCount > 0) {
      auditFindings.push(`${signals.imagesMissingAltCount} image(s) missing alt text.`);
    }

    const runSanitize = (sourceSuffix: string, rawText: string) => {
      const sanitizeInput: SanitizeUntrustedContentInput = {
        source: `web:${currentUrl.hostname}:${sourceSuffix}`,
        rawText,
        ventureId: options?.ventureId ?? null,
        actor: "web_research_driver",
      };
      if (options?.governance !== undefined) {
        return options.governance.sanitizeUntrustedContent(sanitizeInput).pipe(
          Effect.mapError(
            (cause) =>
              new WebResearchError({
                urlHost: safeUrlHost(finalUrl),
                stage: "sanitize",
                reason: "Failed to sanitize untrusted web page content.",
                cause,
              }),
          ),
        );
      }
      return localSanitizeUntrusted(sanitizeInput);
    };

    const [sanitizedTitleRes, sanitizedDescRes, sanitizedExcerptRes] = yield* Effect.all([
      runSanitize("title", signals.title ?? ""),
      runSanitize("meta_description", signals.metaDescription ?? ""),
      runSanitize("body_excerpt", signals.visibleExcerpt),
    ]);

    const matchedInjectionPatterns = Array.from(
      new Set([
        ...sanitizedTitleRes.matchedPatterns,
        ...sanitizedDescRes.matchedPatterns,
        ...sanitizedExcerptRes.matchedPatterns,
      ]),
    );
    const quarantined =
      sanitizedTitleRes.quarantined ||
      sanitizedDescRes.quarantined ||
      sanitizedExcerptRes.quarantined;

    return {
      requestedUrl: url,
      finalUrl,
      statusCode: response.status,
      usesHttps,
      contentType: response.headers["content-type"] ?? null,
      byteLength: response.byteLength,
      truncated: response.truncated,
      latencyMs: response.latencyMs,
      title: signals.title,
      metaDescription: signals.metaDescription,
      hasViewportMeta: signals.hasViewportMeta,
      h1Count: signals.h1Count,
      h2Count: signals.h2Count,
      h1Texts: signals.h1Texts,
      scriptCount: signals.scriptCount,
      stylesheetCount: signals.stylesheetCount,
      imageCount: signals.imageCount,
      imagesMissingAltCount: signals.imagesMissingAltCount,
      auditFindings,
      quarantined,
      matchedInjectionPatterns,
      sanitizedTitle: sanitizedTitleRes.sanitizedText,
      sanitizedMetaDescription: sanitizedDescRes.sanitizedText,
      sanitizedExcerpt: sanitizedExcerptRes.sanitizedText,
    } satisfies WebsiteAuditResult;
  },
);
