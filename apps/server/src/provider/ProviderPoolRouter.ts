import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_SERVER_SETTINGS,
  PROVIDER_DISPLAY_NAMES,
  ProviderBillingClass,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type CurrencyCode,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderModelTier,
  type ProviderPoolHealthStatus,
  type ProviderPoolMemberStatus,
  type ProviderPoolModelSummary,
  type ProviderPoolSnapshot,
  type ProviderQuotaAvailability,
  type ProviderRouteDecision,
  type ProviderRouteRequest,
  type ProviderRoutingPolicy,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderUsageWindow,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "../usage/UsageLimitSources.ts";
import {
  billingClassCostRank,
  classifyProviderInstanceBilling,
  defaultRoutingPriorityForBillingClass,
  isPaidMeteredClass,
} from "./billingClassifier.ts";
import * as ProviderAvailabilityLedger from "./ProviderAvailabilityLedger.ts";
import { isInstanceCoolingDown } from "./ProviderAvailabilityLedger.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

export const ProviderPoolRoutingErrorCode = Schema.Literals([
  "paid_fallback_denied",
  "paid_fallback_requires_approval",
  "manual_instance_unavailable",
  "cost_limit_exceeded",
  "no_eligible_provider",
]);
export type ProviderPoolRoutingErrorCode = typeof ProviderPoolRoutingErrorCode.Type;

export class ProviderPoolRoutingError extends Schema.TaggedError<ProviderPoolRoutingError>()(
  "ProviderPoolRoutingError",
  {
    code: ProviderPoolRoutingErrorCode,
    detail: Schema.String,
    candidateInstanceId: Schema.optionalKey(ProviderInstanceId),
    candidateModel: Schema.optionalKey(Schema.String),
    candidateBillingClass: Schema.optionalKey(ProviderBillingClass),
    approvalCategory: Schema.optionalKey(Schema.Literal("paid_provider_fallback")),
    estimatedCostMinor: Schema.optionalKey(Schema.Number),
    currency: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ProviderPoolRouteCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly billingClass: ProviderBillingClass;
  readonly score: number;
}

export interface ProviderPoolRouteDecision extends ProviderRouteDecision {
  readonly requiresApproval?: boolean;
  readonly approvalCategory?: "paid_provider_fallback";
  readonly fallbackCandidates: ReadonlyArray<ProviderPoolRouteCandidate>;
}

export interface ProviderReassignmentTarget {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly billingClass: ProviderBillingClass;
  readonly reason: string;
}

export class ProviderPoolRouter extends Context.Service<
  ProviderPoolRouter,
  {
    readonly getSnapshot: () => Effect.Effect<ProviderPoolSnapshot>;
    readonly route: (
      request?: ProviderRouteRequest,
    ) => Effect.Effect<ProviderPoolRouteDecision, ProviderPoolRoutingError>;
    readonly selectReassignmentTarget: (
      failedInstanceId: ProviderInstanceId,
      policy?: ProviderRoutingPolicy,
      preferredTier?: ProviderModelTier,
    ) => Effect.Effect<ProviderReassignmentTarget | null>;
  }
>()("t3/provider/ProviderPoolRouter") {}

const SHARED_SESSION_DRIVERS = new Set(["codex", "opencode"]);
const DEFAULT_ESTIMATED_TOKENS = 4_000;

const CONSERVATIVE_USD_MINOR_PER_MILLION_TOKENS: Record<ProviderModelTier, number> = {
  fast: 100,
  balanced: 600,
  reasoning: 1_500,
  frontier: 3_000,
};

const APPROX_USD_TO_CURRENCY_RATE: Readonly<Record<string, number>> = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
};

const FAST_MODEL_PATTERN =
  /(?:^|[-_./\s])(?:haiku|mini|flash|lite|nano|spark|luna|fast|instant|small|3b|4b|7b|8b)(?:$|[-_./\s])/i;
const REASONING_MODEL_PATTERN =
  /(?:^|[-_./\s])(?:o1|o3|o4|r1|qwq|reasoner|reasoning|thinking)(?:$|[-_./\s])/i;
const FRONTIER_MODEL_PATTERN =
  /(?:^|[-_./\s])(?:opus|astra|ultra|frontier|flagship|heavy|gpt-6|gpt-5\.6|gpt-5\.4|grok-4|gemini-2\.5-pro|gemini-3-pro|pro)(?:$|[-_./\s])/i;

function defaultMaxConcurrentRunsForDriver(driver: ProviderDriverKind): number {
  return SHARED_SESSION_DRIVERS.has(driver as string) ? 4 : 1;
}

function inferModelTier(model: Pick<ServerProviderModel, "slug" | "name">): ProviderModelTier {
  const combined = `${model.slug} ${model.name}`;
  if (FAST_MODEL_PATTERN.test(combined)) return "fast";
  if (REASONING_MODEL_PATTERN.test(combined)) return "reasoning";
  if (FRONTIER_MODEL_PATTERN.test(combined)) return "frontier";
  return "balanced";
}

function toPoolModelSummary(model: ServerProviderModel): ProviderPoolModelSummary {
  return {
    slug: model.slug,
    name: model.name,
    tier: inferModelTier(model),
    supportsTools: true,
  };
}

function fallbackModelSummariesForDriver(
  driver: ProviderDriverKind,
): ReadonlyArray<ProviderPoolModelSummary> {
  const defaultSlug = DEFAULT_MODEL_BY_PROVIDER[driver] ?? "default";
  return [
    {
      slug: defaultSlug,
      name: defaultSlug,
      tier: inferModelTier({ slug: defaultSlug, name: defaultSlug }),
      supportsTools: true,
    },
  ];
}

function readExternalQuotaWindows(
  instanceId: ProviderInstanceId,
  sources: ReadonlyArray<UsageLimitSourceSnapshot>,
): ReadonlyArray<Pick<ServerProviderUsageWindow, "usedPercent" | "resetsAt">> {
  const windows: Array<Pick<ServerProviderUsageWindow, "usedPercent" | "resetsAt">> = [];
  for (const source of sources) {
    for (const account of source.quotaAccounts ?? []) {
      if (account.providerInstanceId === instanceId) {
        windows.push(...account.windows);
      }
    }
  }
  return windows;
}

function summarizeQuota(
  snapshot: ServerProvider | undefined,
  externalWindows: ReadonlyArray<Pick<ServerProviderUsageWindow, "usedPercent" | "resetsAt">>,
  nowMs: number,
): {
  readonly quotaAvailability: ProviderQuotaAvailability;
  readonly quotaRemainingPct: number | null;
  readonly quotaResetAt: string | null;
} {
  const limits = snapshot?.usageLimits;
  const directWindows = limits?.windows ?? [];
  const rawWindows = directWindows.length > 0 ? directWindows : externalWindows;

  if (limits?.zeroSpendCap === true) {
    return {
      quotaAvailability: "exhausted",
      quotaRemainingPct: 0,
      quotaResetAt: null,
    };
  }

  if (rawWindows.length === 0) {
    return {
      quotaAvailability: "unavailable",
      quotaRemainingPct: null,
      quotaResetAt: null,
    };
  }

  const activeWindows = rawWindows.filter((window) => {
    if (window.resetsAt === undefined) return true;
    const resetMs = Date.parse(window.resetsAt);
    return !Number.isFinite(resetMs) || resetMs > nowMs;
  });

  if (activeWindows.length === 0) {
    return {
      quotaAvailability: "unavailable",
      quotaRemainingPct: null,
      quotaResetAt: null,
    };
  }

  let maxUsedPercent = 0;
  let latestExhaustedResetMs: number | null = null;
  let earliestActiveResetMs: number | null = null;

  for (const window of activeWindows) {
    const used = Math.max(0, Math.min(100, window.usedPercent));
    if (used > maxUsedPercent) {
      maxUsedPercent = used;
    }
    const resetMs = window.resetsAt === undefined ? NaN : Date.parse(window.resetsAt);
    if (Number.isFinite(resetMs) && resetMs > nowMs) {
      if (used >= 100) {
        latestExhaustedResetMs =
          latestExhaustedResetMs === null ? resetMs : Math.max(latestExhaustedResetMs, resetMs);
      }
      earliestActiveResetMs =
        earliestActiveResetMs === null ? resetMs : Math.min(earliestActiveResetMs, resetMs);
    }
  }

  const remaining = Math.max(0, Math.min(100, Math.round((100 - maxUsedPercent) * 100) / 100));
  if (remaining <= 0) {
    return {
      quotaAvailability: "exhausted",
      quotaRemainingPct: 0,
      quotaResetAt:
        latestExhaustedResetMs === null
          ? null
          : DateTime.formatIso(DateTime.makeUnsafe(latestExhaustedResetMs)),
    };
  }

  return {
    quotaAvailability: "available",
    quotaRemainingPct: remaining,
    quotaResetAt:
      earliestActiveResetMs === null
        ? null
        : DateTime.formatIso(DateTime.makeUnsafe(earliestActiveResetMs)),
  };
}

function resolveHealthStatus(input: {
  readonly enabled: boolean;
  readonly snapshot: ServerProvider | undefined;
  readonly coolingDown: boolean;
  readonly quotaAvailability: ProviderQuotaAvailability;
}): ProviderPoolHealthStatus {
  if (!input.enabled) return "disabled";
  const snapshot = input.snapshot;
  if (
    snapshot === undefined ||
    snapshot.availability === "unavailable" ||
    !snapshot.installed ||
    snapshot.auth.status === "unauthenticated" ||
    snapshot.status === "error" ||
    snapshot.compatibilityAdvisory?.status === "broken"
  ) {
    return "unavailable";
  }
  if (input.coolingDown || input.quotaAvailability === "exhausted") {
    return "cooldown";
  }
  if (snapshot.status === "warning" || snapshot.compatibilityAdvisory?.status === "unsupported") {
    return "degraded";
  }
  return "healthy";
}

function tierMatchScore(
  modelTier: ProviderModelTier,
  requestedTier: ProviderModelTier,
  preferredTiers: ReadonlyArray<ProviderModelTier>,
): number {
  const preferredBonus = preferredTiers.includes(requestedTier) ? 25 : 0;
  if (modelTier === requestedTier) return 100 + preferredBonus;
  switch (requestedTier) {
    case "fast":
      return (modelTier === "balanced" ? 65 : modelTier === "reasoning" ? 35 : 25) + preferredBonus;
    case "balanced":
      return (modelTier === "frontier" ? 75 : modelTier === "reasoning" ? 70 : 50) + preferredBonus;
    case "reasoning":
      return (modelTier === "frontier" ? 80 : modelTier === "balanced" ? 55 : 20) + preferredBonus;
    case "frontier":
      return (modelTier === "reasoning" ? 75 : modelTier === "balanced" ? 50 : 20) + preferredBonus;
  }
}

function selectBestModelForMember(
  member: ProviderPoolMemberStatus,
  snapshot: ServerProvider | undefined,
  requestedTier: ProviderModelTier,
  requireTools: boolean,
): { readonly model: ProviderPoolModelSummary; readonly tierScore: number } | null {
  const candidates = member.availableModels.filter(
    (model) => !requireTools || model.supportsTools !== false,
  );
  if (candidates.length === 0) return null;

  const snapshotBySlug = new Map(
    (snapshot?.models ?? []).map((model) => [model.slug, model] as const),
  );

  let best: {
    readonly model: ProviderPoolModelSummary;
    readonly tierScore: number;
    readonly tieBreaker: number;
  } | null = null;

  for (const model of candidates) {
    const modelTier = model.tier ?? inferModelTier(model);
    const tierScore = tierMatchScore(modelTier, requestedTier, member.preferredTiers);
    const raw = snapshotBySlug.get(model.slug);
    const tieBreaker =
      (raw?.isDefault === true ? 4 : 0) +
      (raw?.isLegacy === true ? -2 : 1) +
      (raw?.isCustom === true ? 0 : 1);
    if (
      best === null ||
      tierScore > best.tierScore ||
      (tierScore === best.tierScore && tieBreaker > best.tieBreaker)
    ) {
      best = { model, tierScore, tieBreaker };
    }
  }

  return best === null ? null : { model: best.model, tierScore: best.tierScore };
}

function estimateMeteredCostMinor(
  billingClass: ProviderBillingClass,
  modelTier: ProviderModelTier,
  estimatedTokens: number | undefined,
  currency: CurrencyCode,
): number {
  if (!isPaidMeteredClass(billingClass)) return 0;
  const tokens = estimatedTokens ?? DEFAULT_ESTIMATED_TOKENS;
  if (tokens <= 0) return 0;
  const usdMinorPerMillion = CONSERVATIVE_USD_MINOR_PER_MILLION_TOKENS[modelTier];
  const fxRate = APPROX_USD_TO_CURRENCY_RATE[currency.toUpperCase()] ?? 1;
  return Math.max(1, Math.ceil((tokens / 1_000_000) * usdMinorPerMillion * fxRate));
}

function matchesRequiredTags(
  memberTags: ReadonlyArray<string>,
  requiredTags: ReadonlyArray<string>,
): boolean {
  if (requiredTags.length === 0) return true;
  const normalized = new Set(memberTags.map((tag) => tag.trim().toLowerCase()));
  return requiredTags.every((tag) => normalized.has(tag.trim().toLowerCase()));
}

interface ScoredCandidate {
  readonly member: ProviderPoolMemberStatus;
  readonly model: ProviderPoolModelSummary;
  readonly tierScore: number;
  readonly score: number;
  readonly estimatedCostMinor: number;
}

function scoreCandidate(
  member: ProviderPoolMemberStatus,
  model: ProviderPoolModelSummary,
  tierScore: number,
  estimatedTokens: number | undefined,
  currency: CurrencyCode,
): ScoredCandidate {
  const headroom = member.quotaRemainingPct ?? 50;
  const loadRatio =
    member.maxConcurrentRuns > 0
      ? Math.min(1, member.activeRunCount / member.maxConcurrentRuns)
      : 1;
  const reliability = member.reliabilityScore ?? 1;
  const score =
    tierScore * 1_000 +
    Math.round(headroom * 2.5) +
    Math.round((1 - loadRatio) * 300) +
    member.poolPriority +
    Math.round(reliability * 150);
  const modelTier = model.tier ?? inferModelTier(model);
  const estimatedCostMinor = estimateMeteredCostMinor(
    member.billingClass,
    modelTier,
    estimatedTokens,
    currency,
  );
  return { member, model, tierScore, score, estimatedCostMinor };
}

function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.member.instanceId.localeCompare(right.member.instanceId);
}

function toFallbackCandidates(
  candidates: ReadonlyArray<ScoredCandidate>,
): ReadonlyArray<ProviderPoolRouteCandidate> {
  return candidates.map((candidate) => ({
    instanceId: candidate.member.instanceId,
    model: candidate.model.slug,
    billingClass: candidate.member.billingClass,
    score: candidate.score,
  }));
}

const make = Effect.gen(function* () {
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const availabilityLedger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
  const usageLimitSourcesOption = yield* Effect.serviceOption(UsageLimitSources.UsageLimitSources);

  const loadPoolContext = Effect.fn("ProviderPoolRouter.loadPoolContext")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    const providers = yield* providerRegistry.getProviders;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchTags({
        ServerSettingsError: (error) =>
          Effect.logWarning("ProviderPoolRouter failed to read settings, using defaults.", {
            operation: error.operation,
          }).pipe(Effect.as(DEFAULT_SERVER_SETTINGS)),
      }),
    );
    const ledgerSnapshot = yield* availabilityLedger.getSnapshot;
    const usageSources = Option.isSome(usageLimitSourcesOption)
      ? yield* usageLimitSourcesOption.value.current
      : [];

    const snapshotById = new Map(providers.map((provider) => [provider.instanceId, provider]));
    const configById = new Map<ProviderInstanceId, ProviderInstanceConfig>(
      Object.entries(settings.providerInstances).map(([id, config]) => [
        id as ProviderInstanceId,
        config,
      ]),
    );

    const allIds = new Set<ProviderInstanceId>([...snapshotById.keys(), ...configById.keys()]);
    const members: Array<ProviderPoolMemberStatus> = [];

    for (const instanceId of [...allIds].toSorted((left, right) => left.localeCompare(right))) {
      const snapshot = snapshotById.get(instanceId);
      const storedConfig = configById.get(instanceId);
      const driver = storedConfig?.driver ?? snapshot?.driver;
      if (driver === undefined) continue;

      const effectiveConfig: ProviderInstanceConfig = storedConfig ?? {
        driver,
        ...(snapshot?.displayName === undefined ? {} : { displayName: snapshot.displayName }),
        ...(snapshot === undefined ? {} : { enabled: snapshot.enabled }),
      };

      const billingClass = classifyProviderInstanceBilling(effectiveConfig, snapshot);
      const billingClassInferred = effectiveConfig.pool?.billingClass === undefined;
      const poolEnabled = effectiveConfig.pool?.poolEnabled ?? true;
      const poolPriority =
        effectiveConfig.pool?.poolPriority ?? defaultRoutingPriorityForBillingClass(billingClass);

      const enabled =
        storedConfig === undefined
          ? (snapshot?.enabled ?? false)
          : storedConfig.enabled === false
            ? false
            : storedConfig.enabled === true
              ? (snapshot?.enabled ?? true)
              : (snapshot?.enabled ?? resolveProviderInstanceEnabled(storedConfig));

      const ledgerState = ledgerSnapshot.get(instanceId);
      const coolingDown = isInstanceCoolingDown(ledgerState, nowMs);
      const activeRunCount = ledgerState?.activeRuns ?? 0;
      const maxConcurrentRuns =
        effectiveConfig.pool?.maxConcurrentRuns ?? defaultMaxConcurrentRunsForDriver(driver);

      const externalWindows = readExternalQuotaWindows(instanceId, usageSources);
      const quota = summarizeQuota(snapshot, externalWindows, nowMs);
      const healthStatus = resolveHealthStatus({
        enabled,
        snapshot,
        coolingDown,
        quotaAvailability: quota.quotaAvailability,
      });

      const availableModels =
        snapshot !== undefined && snapshot.models.length > 0
          ? snapshot.models.map(toPoolModelSummary)
          : fallbackModelSummariesForDriver(driver);

      const displayName =
        effectiveConfig.displayName?.trim() ||
        snapshot?.displayName?.trim() ||
        PROVIDER_DISPLAY_NAMES[driver] ||
        instanceId;

      const subscriptionPlanLabel =
        effectiveConfig.pool?.subscriptionPlanLabel ??
        (billingClass === "subscription" ? (snapshot?.auth.label ?? null) : null);

      const cooldownUntil =
        coolingDown && ledgerState?.cooldownUntil != null
          ? DateTime.formatIso(DateTime.makeUnsafe(ledgerState.cooldownUntil))
          : null;

      const reliabilityScore =
        ledgerState !== undefined && ledgerState.successCount + ledgerState.failureCount > 0
          ? ledgerState.reliabilityScore
          : null;

      members.push({
        instanceId,
        driver,
        displayName,
        enabled,
        poolEnabled,
        poolPriority,
        billingClass,
        billingClassInferred,
        ...(subscriptionPlanLabel === null ? {} : { subscriptionPlanLabel }),
        ...(effectiveConfig.pool?.monthlySubscriptionCostMinor === undefined
          ? {}
          : { monthlySubscriptionCostMinor: effectiveConfig.pool.monthlySubscriptionCostMinor }),
        ...(effectiveConfig.pool?.subscriptionCurrency === undefined
          ? {}
          : { subscriptionCurrency: effectiveConfig.pool.subscriptionCurrency }),
        healthStatus,
        activeRunCount,
        maxConcurrentRuns,
        quotaAvailability: quota.quotaAvailability,
        quotaRemainingPct: quota.quotaRemainingPct,
        quotaResetAt: quota.quotaResetAt,
        cooldownUntil,
        ...(coolingDown && ledgerState?.cooldownReason != null
          ? { cooldownReason: ledgerState.cooldownReason }
          : {}),
        reliabilityScore,
        preferredTiers: effectiveConfig.pool?.preferredTiers ?? [],
        poolTags: effectiveConfig.pool?.poolTags ?? [],
        availableModels,
        checkedAt: snapshot?.checkedAt ?? nowIso,
      });
    }

    const healthyCount = members.filter(
      (member) => member.enabled && member.poolEnabled && member.healthStatus === "healthy",
    ).length;
    const activeRunCount = members.reduce((sum, member) => sum + member.activeRunCount, 0);
    const paidInstancesCount = members.filter(
      (member) => member.billingClass === "metered_api",
    ).length;

    const poolSnapshot: ProviderPoolSnapshot = {
      updatedAt: nowIso,
      defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
      members,
      healthyCount,
      activeRunCount,
      paidInstancesCount,
    };

    return { poolSnapshot, snapshotById } as const;
  });

  const getSnapshot = Effect.fn("ProviderPoolRouter.getSnapshot")(function* () {
    const { poolSnapshot } = yield* loadPoolContext();
    return poolSnapshot;
  });

  const route = Effect.fn("ProviderPoolRouter.route")(function* (
    request: ProviderRouteRequest = {},
  ) {
    const { poolSnapshot, snapshotById } = yield* loadPoolContext();
    const policy = request.routingPolicy ?? DEFAULT_PROVIDER_ROUTING_POLICY;
    const requestedTier = request.requestedTier ?? policy.preferredTier;
    const excluded = new Set(request.excludeInstanceIds ?? []);
    const requiredTags = request.requiredTags ?? [];

    const isEligibleMember = (member: ProviderPoolMemberStatus): boolean =>
      member.enabled &&
      member.poolEnabled &&
      !excluded.has(member.instanceId) &&
      member.healthStatus === "healthy" &&
      member.quotaAvailability !== "exhausted" &&
      member.activeRunCount < member.maxConcurrentRuns &&
      matchesRequiredTags(member.poolTags, requiredTags);

    const evaluatePaidGate = (
      candidate: ScoredCandidate,
      fallbacks: ReadonlyArray<ScoredCandidate>,
    ): Effect.Effect<ProviderPoolRouteDecision, ProviderPoolRoutingError> => {
      if (policy.paidFallbackMode === "deny") {
        return Effect.fail(
          new ProviderPoolRoutingError({
            code: "paid_fallback_denied",
            detail: `Routing to ${candidate.member.billingClass} instance ${candidate.member.instanceId} is blocked because paid fallback mode is set to deny.`,
            candidateInstanceId: candidate.member.instanceId,
            candidateModel: candidate.model.slug,
            candidateBillingClass: candidate.member.billingClass,
            estimatedCostMinor: candidate.estimatedCostMinor,
            currency: policy.currency,
          }),
        );
      }

      if (policy.paidFallbackMode === "ask_approval") {
        return Effect.succeed({
          status: "approval_required" as const,
          requiresApproval: true,
          approvalCategory: "paid_provider_fallback" as const,
          selectedInstanceId: candidate.member.instanceId,
          selectedModel: candidate.model.slug,
          billingClass: candidate.member.billingClass,
          reason: `Owner approval is required before falling back to ${candidate.member.billingClass} instance ${candidate.member.instanceId}.`,
          estimatedCostMinor: candidate.estimatedCostMinor,
          currency: policy.currency,
          fallbackCandidates: toFallbackCandidates(fallbacks),
        });
      }

      if (!policy.allowedBillingClasses.includes(candidate.member.billingClass)) {
        return Effect.fail(
          new ProviderPoolRoutingError({
            code: "paid_fallback_denied",
            detail: `Billing class ${candidate.member.billingClass} for instance ${candidate.member.instanceId} is not permitted by allowedBillingClasses.`,
            candidateInstanceId: candidate.member.instanceId,
            candidateModel: candidate.model.slug,
            candidateBillingClass: candidate.member.billingClass,
            estimatedCostMinor: candidate.estimatedCostMinor,
            currency: policy.currency,
          }),
        );
      }

      if (
        policy.maxEstimatedCostMinor !== undefined &&
        policy.maxEstimatedCostMinor !== null &&
        candidate.estimatedCostMinor > policy.maxEstimatedCostMinor
      ) {
        return Effect.fail(
          new ProviderPoolRoutingError({
            code: "cost_limit_exceeded",
            detail: `Estimated cost ${candidate.estimatedCostMinor} ${policy.currency} exceeds maxEstimatedCostMinor (${policy.maxEstimatedCostMinor}).`,
            candidateInstanceId: candidate.member.instanceId,
            candidateModel: candidate.model.slug,
            candidateBillingClass: candidate.member.billingClass,
            estimatedCostMinor: candidate.estimatedCostMinor,
            currency: policy.currency,
          }),
        );
      }

      return Effect.succeed({
        status: "routed" as const,
        selectedInstanceId: candidate.member.instanceId,
        selectedModel: candidate.model.slug,
        billingClass: candidate.member.billingClass,
        reason: `Routed to permitted ${candidate.member.billingClass} instance ${candidate.member.instanceId} (${candidate.model.slug}) for tier ${requestedTier}.`,
        estimatedCostMinor: candidate.estimatedCostMinor,
        currency: policy.currency,
        fallbackCandidates: toFallbackCandidates(fallbacks),
      });
    };

    if (policy.manualInstanceId !== undefined && policy.manualInstanceId !== null) {
      const manualMember = poolSnapshot.members.find(
        (member) => member.instanceId === policy.manualInstanceId,
      );
      if (
        manualMember === undefined ||
        !manualMember.enabled ||
        excluded.has(manualMember.instanceId) ||
        manualMember.healthStatus !== "healthy" ||
        manualMember.quotaAvailability === "exhausted" ||
        manualMember.activeRunCount >= manualMember.maxConcurrentRuns
      ) {
        return yield* new ProviderPoolRoutingError({
          code: "manual_instance_unavailable",
          detail: `Manually requested provider instance ${policy.manualInstanceId} is unavailable or at capacity.`,
          candidateInstanceId: policy.manualInstanceId,
        });
      }
      const chosen = selectBestModelForMember(
        manualMember,
        snapshotById.get(manualMember.instanceId),
        requestedTier,
        policy.requireTools,
      );
      if (chosen === null) {
        return yield* new ProviderPoolRoutingError({
          code: "manual_instance_unavailable",
          detail: `Manually requested provider instance ${policy.manualInstanceId} has no matching model.`,
          candidateInstanceId: manualMember.instanceId,
        });
      }
      const scored = scoreCandidate(
        manualMember,
        chosen.model,
        chosen.tierScore,
        request.estimatedTokens,
        policy.currency,
      );
      if (isPaidMeteredClass(manualMember.billingClass)) {
        return yield* evaluatePaidGate(scored, []);
      }
      return {
        status: "routed" as const,
        selectedInstanceId: manualMember.instanceId,
        selectedModel: chosen.model.slug,
        billingClass: manualMember.billingClass,
        reason: `Routed to manual override instance ${manualMember.instanceId} (${chosen.model.slug}).`,
        estimatedCostMinor: 0,
        currency: policy.currency,
        fallbackCandidates: [],
      };
    }

    const nonMeteredCandidates: Array<ScoredCandidate> = [];
    const paidCandidates: Array<ScoredCandidate> = [];

    for (const member of poolSnapshot.members) {
      if (!isEligibleMember(member)) continue;
      if (member.billingClass === "manual_only") continue;

      const chosen = selectBestModelForMember(
        member,
        snapshotById.get(member.instanceId),
        requestedTier,
        policy.requireTools,
      );
      if (chosen === null) continue;

      const scored = scoreCandidate(
        member,
        chosen.model,
        chosen.tierScore,
        request.estimatedTokens,
        policy.currency,
      );

      if (isPaidMeteredClass(member.billingClass)) {
        paidCandidates.push(scored);
      } else if (policy.allowedBillingClasses.includes(member.billingClass)) {
        nonMeteredCandidates.push(scored);
      }
    }

    nonMeteredCandidates.sort(compareScoredCandidates);
    paidCandidates.sort(compareScoredCandidates);

    const bestNonMetered = nonMeteredCandidates[0];
    if (bestNonMetered !== undefined) {
      return {
        status: "routed" as const,
        selectedInstanceId: bestNonMetered.member.instanceId,
        selectedModel: bestNonMetered.model.slug,
        billingClass: bestNonMetered.member.billingClass,
        reason: `Selected ${bestNonMetered.member.billingClass} instance ${bestNonMetered.member.instanceId} (${bestNonMetered.model.slug}) for tier ${requestedTier}.`,
        estimatedCostMinor: 0,
        currency: policy.currency,
        fallbackCandidates: toFallbackCandidates(nonMeteredCandidates.slice(1)),
      };
    }

    if (paidCandidates.length === 0) {
      return yield* new ProviderPoolRoutingError({
        code: "no_eligible_provider",
        detail: "No healthy eligible provider instances are available for routing.",
      });
    }

    if (policy.paidFallbackMode === "allow") {
      const permittedPaid = paidCandidates.filter((candidate) =>
        policy.allowedBillingClasses.includes(candidate.member.billingClass),
      );
      if (permittedPaid.length === 0) {
        return yield* evaluatePaidGate(paidCandidates[0]!, paidCandidates.slice(1));
      }
      const withinBudget =
        policy.maxEstimatedCostMinor === undefined || policy.maxEstimatedCostMinor === null
          ? permittedPaid
          : permittedPaid.filter(
              (candidate) => candidate.estimatedCostMinor <= policy.maxEstimatedCostMinor!,
            );
      if (withinBudget.length === 0) {
        return yield* evaluatePaidGate(permittedPaid[0]!, permittedPaid.slice(1));
      }
      return yield* evaluatePaidGate(withinBudget[0]!, withinBudget.slice(1));
    }

    return yield* evaluatePaidGate(paidCandidates[0]!, paidCandidates.slice(1));
  });

  const selectReassignmentTarget = Effect.fn("ProviderPoolRouter.selectReassignmentTarget")(
    function* (
      failedInstanceId: ProviderInstanceId,
      policy: ProviderRoutingPolicy = DEFAULT_PROVIDER_ROUTING_POLICY,
      preferredTier?: ProviderModelTier,
    ): Effect.fn.Return<ProviderReassignmentTarget | null> {
      const { poolSnapshot } = yield* loadPoolContext();
      const failedMember = poolSnapshot.members.find(
        (member) => member.instanceId === failedInstanceId,
      );
      const failedClass = failedMember?.billingClass ?? "subscription";
      const failedCostRank = billingClassCostRank(failedClass);
      const failedWasPaid = isPaidMeteredClass(failedClass);

      // Reassignment may stay in the same tier or move cheaper, never silently escalating to paid.
      const allowedForReassignment = policy.allowedBillingClasses.filter((billingClass) => {
        if (billingClass === "manual_only") return false;
        if (!failedWasPaid && isPaidMeteredClass(billingClass)) return false;
        return billingClassCostRank(billingClass) <= failedCostRank;
      });

      if (allowedForReassignment.length === 0) return null;

      const reassignmentPolicy: ProviderRoutingPolicy = {
        ...policy,
        allowedBillingClasses: allowedForReassignment,
        paidFallbackMode: failedWasPaid ? policy.paidFallbackMode : "deny",
        manualInstanceId: null,
        preferredTier: preferredTier ?? policy.preferredTier,
      };

      const decision = yield* route({
        routingPolicy: reassignmentPolicy,
        requestedTier: preferredTier ?? policy.preferredTier,
        excludeInstanceIds: [failedInstanceId],
      }).pipe(
        Effect.catchTags({
          ProviderPoolRoutingError: () => Effect.succeed(null),
        }),
      );

      if (
        decision === null ||
        decision.status !== "routed" ||
        decision.selectedInstanceId === null ||
        decision.selectedModel === null ||
        decision.billingClass === null
      ) {
        return null;
      }

      return {
        instanceId: decision.selectedInstanceId,
        model: decision.selectedModel,
        billingClass: decision.billingClass,
        reason: `Reassigned from ${failedInstanceId} to same-or-cheaper peer ${decision.selectedInstanceId} (${decision.selectedModel}).`,
      };
    },
  );

  return ProviderPoolRouter.of({
    getSnapshot,
    route,
    selectReassignmentTarget,
  });
});

export const layer = Layer.effect(ProviderPoolRouter, make);
