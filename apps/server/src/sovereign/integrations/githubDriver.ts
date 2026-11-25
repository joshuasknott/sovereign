// @effect-diagnostics-next-line nodeBuiltinImport:off -- Constant-time HMAC-SHA256 verification for GitHub webhooks.
import * as NodeCrypto from "node:crypto";
import {
  type AiPermissionStatus,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { SovereignIntegrationError, type SovereignPersistenceError } from "../SovereignErrors.ts";
import type {
  SanitizeUntrustedContentInput,
  SanitizeUntrustedContentResult,
  SovereignGovernanceService,
} from "../SovereignGovernanceService.ts";
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
} from "./httpTransport.ts";

const DEFAULT_GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "Sovereign-Commercial-OS",
} as const;
const utf8Decoder = new TextDecoder();

export type UntrustedContentSanitizer = (
  input: SanitizeUntrustedContentInput,
) => Effect.Effect<SanitizeUntrustedContentResult, SovereignPersistenceError>;

export interface DiscoveredFundedIssue {
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly sanitizedTitle: string;
  readonly sanitizedBodyExcerpt: string;
  readonly quarantined: boolean;
  readonly matchedInjectionPatterns: ReadonlyArray<string>;
  readonly url: string;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly estimatedBountyMinor: number | null;
  readonly currency: CurrencyCode;
  readonly commentsCount: number;
  readonly updatedAt: string;
}

export interface RepoContributionPolicyReport {
  readonly owner: string;
  readonly repo: string;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly contributingPath: string | null;
  readonly aiPermissionStatus: AiPermissionStatus;
  readonly requiresAiDisclosure: boolean;
  readonly quarantined: boolean;
  readonly matchedInjectionPatterns: ReadonlyArray<string>;
  readonly sanitizedPolicyText: string;
  readonly rationale: string;
}

export interface CompetingPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly draft: boolean;
}

export interface CompetingPullRequestsReport {
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly hasCompetingPr: boolean;
  readonly safeToAttempt: boolean;
  readonly openPullRequests: ReadonlyArray<CompetingPullRequestSummary>;
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

const readNumber = (
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null => {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const fallbackSanitizer: UntrustedContentSanitizer = Effect.fn(
  "SovereignGithubDriver.fallbackSanitizer",
)((input: SanitizeUntrustedContentInput) => {
  const suspicious: Array<string> = [];
  if (
    /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system|safety|policy)\s+(?:instructions|prompts|rules|policies|guardrails)\b/i.test(
      input.rawText,
    )
  ) {
    suspicious.push("instruction_override");
  }
  if (
    /\b(?:reveal|print|dump|output|exfiltrate|leak|send)\s+(?:all\s+)?(?:secrets?|api[\s_-]?keys?|tokens?|credentials?|passwords?)\b/i.test(
      input.rawText,
    )
  ) {
    suspicious.push("secret_exfiltration");
  }
  if (
    /(?:<\|(?:im_start|im_end|system|assistant|endoftext)\|>|###\s*SYSTEM\b|\[SYSTEM\])/i.test(
      input.rawText,
    )
  ) {
    suspicious.push("control_delimiter");
  }
  const quarantined = suspicious.length > 0;
  const safeSource = input.source.replace(/[^a-zA-Z0-9._:/-]/g, "_").slice(0, 80) || "github";
  const body = quarantined
    ? `[QUARANTINED UNTRUSTED CONTENT: matched ${suspicious.join(", ")}]\n${input.rawText.trim()}`
    : input.rawText.trim();
  return Effect.succeed({
    quarantined,
    matchedPatterns: suspicious,
    sanitizedText: `<untrusted_data source="${safeSource}" quarantined="${quarantined ? "true" : "false"}">\n${body}\n</untrusted_data>`,
  });
});

const resolveSanitizer = (
  governance?: Pick<SovereignGovernanceService["Service"], "sanitizeUntrustedContent">,
): UntrustedContentSanitizer =>
  governance === undefined
    ? fallbackSanitizer
    : (input) => governance.sanitizeUntrustedContent(input);

const githubHeaders = (token: string | null): Readonly<Record<string, string>> => ({
  ...GITHUB_API_HEADERS,
  ...(token === null ? {} : { authorization: `Bearer ${token}` }),
});

const parseRepoFromApiUrl = (
  repositoryUrl: string | null,
  htmlUrl: string | null,
): { readonly owner: string; readonly repo: string } => {
  if (repositoryUrl !== null) {
    const match = /\/repos\/([^/]+)\/([^/]+)$/.exec(repositoryUrl);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { owner: match[1], repo: match[2] };
    }
  }
  if (htmlUrl !== null) {
    const match = /github\.com\/([^/]+)\/([^/]+)/.exec(htmlUrl);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return { owner: "unknown", repo: "unknown" };
};

export function extractBountyAmountHint(
  text: string,
): { readonly amountMinor: number; readonly currency: CurrencyCode } | null {
  const symbolMatch = /(£|\$|€)\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/.exec(text);
  if (symbolMatch?.[1] !== undefined && symbolMatch[2] !== undefined) {
    const currency: CurrencyCode =
      symbolMatch[1] === "£" ? "GBP" : symbolMatch[1] === "€" ? "EUR" : "USD";
    const whole = Number.parseInt(symbolMatch[2].replace(/,/g, ""), 10);
    const fractional =
      symbolMatch[3] === undefined ? 0 : Number.parseInt(symbolMatch[3].padEnd(2, "0"), 10);
    if (Number.isSafeInteger(whole) && whole > 0) {
      return { amountMinor: whole * 100 + fractional, currency };
    }
  }

  const codeMatch = /\b(\d{1,3}(?:,\d{3})*|\d+)\s?(GBP|USD|EUR)\b/i.exec(text);
  if (codeMatch?.[1] !== undefined && codeMatch[2] !== undefined) {
    const whole = Number.parseInt(codeMatch[1].replace(/,/g, ""), 10);
    const currency = codeMatch[2].toUpperCase() as CurrencyCode;
    if (Number.isSafeInteger(whole) && whole > 0) {
      return { amountMinor: whole * 100, currency };
    }
  }
  return null;
}

const AI_PROHIBITED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno\s+ai[\s-]?(?:generated|authored|assisted)?\s*(?:prs?|pull\s+requests?|code|contributions?|submissions?)\b/i,
  /\bai[\s-]?generated\s+(?:prs?|pull\s+requests?|code|contributions?)\s+(?:are\s+)?(?:not\s+accepted|prohibited|banned|forbidden|disallowed)\b/i,
  /\b(?:do\s+not|don't|never)\s+submit\s+(?:ai|llm)[\s-]?(?:generated|authored)?\b/i,
  /\b(?:llm|ai)\s+(?:contributions?|code|submissions?)\s+(?:are\s+)?(?:prohibited|strictly\s+forbidden|not\s+allowed)\b/i,
  /\bno\s+llm\b/i,
];

const AI_PERMITTED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bai[\s-]?(?:assisted|generated)?\s+(?:contributions?|prs?|pull\s+requests?|tools?)\s+(?:are\s+)?(?:welcome|permitted|allowed|accepted)\b/i,
  /\b(?:llm|ai)\s+assistance\s+(?:is\s+)?(?:permitted|allowed|welcome)\b/i,
  /\bmay\s+use\s+(?:ai|llm)\s+tools?\b/i,
];

const AI_DISCLOSURE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bdisclose\s+(?:any\s+)?(?:ai|llm)\b/i,
  /\b(?:ai|llm)\s+(?:usage|assistance)\s+must\s+be\s+disclosed\b/i,
  /\blabel\s+(?:ai|llm)[\s-]?assisted\b/i,
];

export function classifyAiContributionPolicy(rawText: string): {
  readonly aiPermissionStatus: AiPermissionStatus;
  readonly requiresAiDisclosure: boolean;
  readonly rationale: string;
} {
  const requiresAiDisclosure = AI_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(rawText));

  if (AI_PROHIBITED_PATTERNS.some((pattern) => pattern.test(rawText))) {
    return {
      aiPermissionStatus: "prohibited",
      requiresAiDisclosure,
      rationale: "Repository contribution guidelines explicitly prohibit AI or LLM submissions.",
    };
  }
  if (AI_PERMITTED_PATTERNS.some((pattern) => pattern.test(rawText))) {
    return {
      aiPermissionStatus: "permitted",
      requiresAiDisclosure,
      rationale: requiresAiDisclosure
        ? "Repository guidelines permit AI-assisted contributions with explicit disclosure."
        : "Repository guidelines explicitly permit AI-assisted contributions.",
    };
  }
  return {
    aiPermissionStatus: "unknown",
    requiresAiDisclosure,
    rationale:
      "No explicit AI contribution policy was found; treat as unknown until owner review confirms eligibility.",
  };
}

export const discoverFundedIssues = Effect.fn("SovereignGithubDriver.discoverFundedIssues")(
  function* (
    input: {
      readonly context: SovereignIntegrationDriverContext;
      readonly repos?: ReadonlyArray<string>;
      readonly orgs?: ReadonlyArray<string>;
      readonly labels?: ReadonlyArray<string>;
      readonly limit?: number;
      readonly ventureId?: VentureId | null;
      readonly governance?: Pick<SovereignGovernanceService["Service"], "sanitizeUntrustedContent">;
    },
    transport?: HttpTransport,
  ) {
    const token = extractSecretField(input.context.secret, ["token", "apiKey", "pat", "secret"]);
    if (!input.context.integration.sandboxMode && token === null) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "discover_funded_issues",
        reason: "GitHub personal access token is required to query funded issues.",
      });
    }

    const activeTransport = transport ?? createFetchHttpTransport();
    const sanitizer = resolveSanitizer(input.governance);
    const baseUrl = stripTrailingSlash(
      input.context.integration.endpointUrl ?? DEFAULT_GITHUB_API_BASE,
    );

    const qualifiers: Array<string> = ["is:issue", "is:open"];
    for (const repo of input.repos ?? []) {
      const cleaned = repo.trim();
      if (cleaned.length > 0) qualifiers.push(`repo:${cleaned}`);
    }
    for (const org of input.orgs ?? []) {
      const cleaned = org.trim();
      if (cleaned.length > 0) qualifiers.push(`org:${cleaned}`);
    }
    const labels =
      input.labels !== undefined && input.labels.length > 0 ? input.labels : ["bounty"];
    for (const label of labels) {
      const cleaned = label.trim();
      if (cleaned.length > 0) qualifiers.push(`label:"${cleaned.replace(/"/g, "")}"`);
    }

    const perPage = Math.max(1, Math.min(50, input.limit ?? 20));
    const queryUrl = `${baseUrl}/search/issues?q=${encodeURIComponent(qualifiers.join(" "))}&sort=updated&order=desc&per_page=${perPage}`;
    const response = yield* activeTransport
      .request({
        url: queryUrl,
        method: "GET",
        headers: githubHeaders(token),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "discover_funded_issues",
              reason: "Failed to query GitHub search API for funded issues.",
              cause,
            }),
        ),
      );

    if (response.status < 200 || response.status >= 300) {
      return yield* new SovereignIntegrationError({
        integrationId: input.context.integration.id,
        stage: "discover_funded_issues",
        reason: `GitHub search API failed with HTTP ${response.status}.`,
      });
    }

    const parsed = decodeJsonRecord(response.bodyText);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const results: Array<DiscoveredFundedIssue> = [];

    for (const rawItem of items) {
      const item = asRecord(rawItem);
      if (item === null || item.pull_request !== undefined) continue;
      const issueNumber = readNumber(item, "number");
      const rawTitle = readString(item, "title");
      const htmlUrl = readString(item, "html_url");
      if (issueNumber === null || rawTitle === null || htmlUrl === null) continue;

      const repoRef = parseRepoFromApiUrl(readString(item, "repository_url"), htmlUrl);
      const rawLabels = Array.isArray(item.labels) ? item.labels : [];
      const labelNames: Array<string> = [];
      for (const rawLabel of rawLabels) {
        if (typeof rawLabel === "string" && rawLabel.trim().length > 0) {
          labelNames.push(rawLabel.trim());
        } else {
          const labelName = readString(asRecord(rawLabel), "name");
          if (labelName !== null) labelNames.push(labelName);
        }
      }

      const rawBody = readString(item, "body") ?? "";
      const sanitizedTitleResult = yield* sanitizer({
        source: `github:${repoRef.owner}/${repoRef.repo}#${issueNumber}:title`,
        rawText: rawTitle,
        ventureId: input.ventureId ?? input.context.integration.ventureId,
        actor: "github_driver",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "sanitize_issue",
              reason: "Failed to sanitize untrusted GitHub issue title.",
              cause,
            }),
        ),
      );

      const sanitizedBodyResult = yield* sanitizer({
        source: `github:${repoRef.owner}/${repoRef.repo}#${issueNumber}:body`,
        rawText: rawBody.slice(0, 2000),
        ventureId: input.ventureId ?? input.context.integration.ventureId,
        actor: "github_driver",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new SovereignIntegrationError({
              integrationId: input.context.integration.id,
              stage: "sanitize_issue",
              reason: "Failed to sanitize untrusted GitHub issue body.",
              cause,
            }),
        ),
      );

      const bountyHint = extractBountyAmountHint(
        `${rawTitle} ${labelNames.join(" ")} ${rawBody.slice(0, 400)}`,
      );
      const matchedPatterns = Array.from(
        new Set([...sanitizedTitleResult.matchedPatterns, ...sanitizedBodyResult.matchedPatterns]),
      );

      results.push({
        owner: repoRef.owner,
        repo: repoRef.repo,
        issueNumber,
        title: rawTitle,
        sanitizedTitle: sanitizedTitleResult.sanitizedText,
        sanitizedBodyExcerpt: sanitizedBodyResult.sanitizedText,
        quarantined: sanitizedTitleResult.quarantined || sanitizedBodyResult.quarantined,
        matchedInjectionPatterns: matchedPatterns,
        url: htmlUrl,
        state: readString(item, "state") ?? "open",
        labels: labelNames,
        estimatedBountyMinor: bountyHint?.amountMinor ?? null,
        currency: bountyHint?.currency ?? DEFAULT_REPORTING_CURRENCY,
        commentsCount: readNumber(item, "comments") ?? 0,
        updatedAt: readString(item, "updated_at") ?? "",
      });
    }

    return results satisfies ReadonlyArray<DiscoveredFundedIssue>;
  },
);

export const inspectRepoContributionPolicy = Effect.fn(
  "SovereignGithubDriver.inspectRepoContributionPolicy",
)(function* (
  input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly owner: string;
    readonly repo: string;
    readonly ventureId?: VentureId | null;
    readonly governance?: Pick<SovereignGovernanceService["Service"], "sanitizeUntrustedContent">;
  },
  transport?: HttpTransport,
) {
  const token = extractSecretField(input.context.secret, ["token", "apiKey", "pat", "secret"]);
  const activeTransport = transport ?? createFetchHttpTransport();
  const sanitizer = resolveSanitizer(input.governance);
  const baseUrl = stripTrailingSlash(
    input.context.integration.endpointUrl ?? DEFAULT_GITHUB_API_BASE,
  );
  const owner = encodeURIComponent(input.owner.trim());
  const repo = encodeURIComponent(input.repo.trim());

  const repoResponse = yield* activeTransport
    .request({
      url: `${baseUrl}/repos/${owner}/${repo}`,
      method: "GET",
      headers: githubHeaders(token),
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "inspect_repo_policy",
            reason: "Failed to fetch GitHub repository metadata.",
            cause,
          }),
      ),
    );

  if (repoResponse.status < 200 || repoResponse.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "inspect_repo_policy",
      reason: `GitHub repository lookup failed with HTTP ${repoResponse.status}.`,
    });
  }

  const repoData = decodeJsonRecord(repoResponse.bodyText);
  const archived = repoData?.archived === true;
  const defaultBranch = readString(repoData, "default_branch") ?? "main";
  const repoDescription = readString(repoData, "description") ?? "";

  let contributingPath: string | null = null;
  let contributingRawText = "";

  for (const candidatePath of ["CONTRIBUTING.md", ".github/CONTRIBUTING.md"]) {
    const fileRes = yield* activeTransport
      .request({
        url: `${baseUrl}/repos/${owner}/${repo}/contents/${candidatePath}`,
        method: "GET",
        headers: githubHeaders(token),
      })
      .pipe(Effect.option);

    if (fileRes._tag === "Some" && fileRes.value.status >= 200 && fileRes.value.status < 300) {
      const fileJson = decodeJsonRecord(fileRes.value.bodyText);
      const encoding = readString(fileJson, "encoding");
      const content = readString(fileJson, "content");
      if (content !== null) {
        contributingPath = candidatePath;
        contributingRawText =
          encoding === "base64"
            ? Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8")
            : content;
        break;
      }
    }
  }

  const combinedUntrusted = [repoDescription, contributingRawText]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  const sanitized = yield* sanitizer({
    source: `github:${input.owner}/${input.repo}:${contributingPath ?? "repo_metadata"}`,
    rawText: combinedUntrusted.slice(0, 12_000),
    ventureId: input.ventureId ?? input.context.integration.ventureId,
    actor: "github_policy_inspector",
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SovereignIntegrationError({
          integrationId: input.context.integration.id,
          stage: "sanitize_policy",
          reason: "Failed to sanitize repository contribution policy text.",
          cause,
        }),
    ),
  );

  const classification = classifyAiContributionPolicy(combinedUntrusted);
  const effectiveStatus: AiPermissionStatus = archived
    ? "prohibited"
    : classification.aiPermissionStatus;
  const rationale = archived
    ? "Repository is archived and does not accept contributions."
    : classification.rationale;

  return {
    owner: input.owner,
    repo: input.repo,
    archived,
    defaultBranch,
    contributingPath,
    aiPermissionStatus: effectiveStatus,
    requiresAiDisclosure: classification.requiresAiDisclosure,
    quarantined: sanitized.quarantined,
    matchedInjectionPatterns: sanitized.matchedPatterns,
    sanitizedPolicyText: sanitized.sanitizedText,
    rationale,
  } satisfies RepoContributionPolicyReport;
});

export const checkCompetingPullRequests = Effect.fn(
  "SovereignGithubDriver.checkCompetingPullRequests",
)(function* (
  input: {
    readonly context: SovereignIntegrationDriverContext;
    readonly owner: string;
    readonly repo: string;
    readonly issueNumber: number;
  },
  transport?: HttpTransport,
) {
  const token = extractSecretField(input.context.secret, ["token", "apiKey", "pat", "secret"]);
  const activeTransport = transport ?? createFetchHttpTransport();
  const baseUrl = stripTrailingSlash(
    input.context.integration.endpointUrl ?? DEFAULT_GITHUB_API_BASE,
  );
  const query = `repo:${input.owner.trim()}/${input.repo.trim()} is:pr is:open ${input.issueNumber}`;
  const response = yield* activeTransport
    .request({
      url: `${baseUrl}/search/issues?q=${encodeURIComponent(query)}&per_page=20`,
      method: "GET",
      headers: githubHeaders(token),
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "check_competing_prs",
            reason: "Failed to query GitHub for competing pull requests.",
            cause,
          }),
      ),
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* new SovereignIntegrationError({
      integrationId: input.context.integration.id,
      stage: "check_competing_prs",
      reason: `GitHub competing PR check failed with HTTP ${response.status}.`,
    });
  }

  const parsed = decodeJsonRecord(response.bodyText);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const openPullRequests: Array<CompetingPullRequestSummary> = [];

  for (const rawItem of items) {
    const item = asRecord(rawItem);
    if (item === null) continue;
    const number = readNumber(item, "number");
    const title = readString(item, "title");
    const url = readString(item, "html_url");
    if (number === null || title === null || url === null) continue;
    const user = asRecord(item.user);
    openPullRequests.push({
      number,
      title,
      url,
      author: readString(user, "login") ?? "unknown",
      draft: item.draft === true,
    });
  }

  const hasCompetingPr = openPullRequests.length > 0;
  return {
    owner: input.owner,
    repo: input.repo,
    issueNumber: input.issueNumber,
    hasCompetingPr,
    safeToAttempt: !hasCompetingPr,
    openPullRequests,
  } satisfies CompetingPullRequestsReport;
});

export function createGitHubDriver(options?: {
  readonly transport?: HttpTransport;
}): SovereignIntegrationDriver {
  const transport = options?.transport ?? createFetchHttpTransport();

  return {
    providerKind: "github",
    testConnection: Effect.fn("SovereignGithubDriver.testConnection")(function* (context) {
      const early = checkDisabledOrSandbox(context, "GitHub");
      if (early !== null) return early;

      const token = extractSecretField(context.secret, ["token", "apiKey", "pat", "secret"]);
      if (token === null) {
        return {
          ok: false,
          status: "unconfigured",
          latencyMs: null,
          message: "GitHub requires a personal access token or GitHub App token in secure storage.",
        };
      }

      const baseUrl = stripTrailingSlash(
        context.integration.endpointUrl ?? DEFAULT_GITHUB_API_BASE,
      );
      const response = yield* transport
        .request({
          url: `${baseUrl}/user`,
          method: "GET",
          headers: githubHeaders(token),
        })
        .pipe(Effect.option);

      if (response._tag === "None") {
        return {
          ok: false,
          status: "error",
          latencyMs: null,
          message: "Could not reach GitHub API user endpoint.",
        };
      }

      const parsed = decodeJsonRecord(response.value.bodyText);
      const login = readString(parsed, "login");
      return mapHttpStatusToTestResult(
        "GitHub",
        response.value,
        login === null ? undefined : { successDetail: `authenticated as ${login}` },
      );
    }),

    verifyAndParseWebhook: Effect.fn("SovereignGithubDriver.verifyAndParseWebhook")(
      function* (input) {
        const webhookSecret = extractSecretField(input.context.secret, [
          "webhookSecret",
          "secret",
          "token",
        ]);
        const signatureHeader = lookupHeaderCaseInsensitive(input.headers, "x-hub-signature-256");
        if (webhookSecret === null || signatureHeader === undefined) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "GitHub webhook signature header or secret is missing.",
          });
        }
        const trimmedSig = signatureHeader.trim();
        const candidateHex = trimmedSig.toLowerCase().startsWith("sha256=")
          ? trimmedSig.slice(7)
          : trimmedSig;
        const expectedHex = NodeCrypto.createHmac("sha256", webhookSecret)
          .update(input.rawBody)
          .digest("hex");
        if (!constantTimeHexEqual(expectedHex, candidateHex)) {
          return yield* new SovereignIntegrationError({
            integrationId: input.context.integration.id,
            stage: "verify_webhook",
            reason: "GitHub webhook signature verification failed.",
          });
        }

        const payload = decodeJsonRecord(utf8Decoder.decode(input.rawBody));
        if (payload === null) return null;
        const deliveryId =
          lookupHeaderCaseInsensitive(input.headers, "x-github-delivery")?.trim() ||
          NodeCrypto.createHash("sha256").update(input.rawBody).digest("hex");
        const eventType =
          lookupHeaderCaseInsensitive(input.headers, "x-github-event")?.trim() || "github.event";
        return {
          replayKey: deliveryId,
          eventType: `github.${eventType}`,
        } satisfies SovereignIntegrationWebhookEvent;
      },
    ),
  };
}
