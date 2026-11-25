import {
  ArtifactId,
  type CommercialArtifact,
  type CommercialObjective,
  type CommercialTask,
  CommercialTaskId,
  type CreateCommercialArtifactInput,
  type CreateCommercialTaskInput,
  type CreateObjectiveInput,
  type CreateOpportunityInput,
  type CreateVentureInput,
  type CurrencyCode,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_REPORTING_CURRENCY,
  type DeleteVentureInput,
  ObjectiveId,
  type ObjectiveHorizon,
  type ObjectiveStrategyPlan,
  type ObjectiveStrategyStep,
  type Opportunity,
  OpportunityId,
  type OpportunityScore,
  type PortfolioRecommendation,
  type ProviderBillingClass,
  type ProviderInstanceConfig,
  type ProviderModelTier,
  type ProviderPoolHealthStatus,
  type ProviderPoolMemberStatus,
  type ProviderPoolSnapshot,
  type ProviderRouteDecision,
  type ProviderRouteRequest,
  type ProviderRoutingPolicy,
  type ServerProvider,
  type SovereignEvent,
  type SovereignOverviewSnapshot,
  type SovereignVentureDetail,
  type UpdateCommercialTaskInput,
  type UpdateObjectiveInput,
  type UpdateOpportunityInput,
  type UpdateProviderPoolConfigInput,
  type UpdateVentureInput,
  type Venture,
  type VentureBlueprint,
  VentureId,
  type VentureKind,
  type VentureOverviewRow,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import * as ProviderPoolRouter from "../provider/ProviderPoolRouter.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { getVentureBlueprint, SOVEREIGN_BLUEPRINTS } from "./SovereignBlueprints.ts";
import {
  SovereignConflictError,
  type SovereignDomainError,
  SovereignNotFoundError,
  type SovereignPersistenceError,
  SovereignValidationError,
} from "./SovereignErrors.ts";
import * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import * as SovereignIntegrationService from "./SovereignIntegrationService.ts";
import * as SovereignLedgerService from "./SovereignLedgerService.ts";
import * as SovereignStore from "./SovereignStore.ts";

export interface StartupRecoverySummary {
  readonly recoveredTaskIds: ReadonlyArray<CommercialTaskId>;
  readonly failedTaskIds: ReadonlyArray<CommercialTaskId>;
}

const slugifyName = (name: string): string => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base.length > 0 ? base : "venture";
};

const VENTURE_KEYWORDS: ReadonlyArray<{
  readonly kind: VentureKind;
  readonly keywords: ReadonlyArray<string>;
}> = [
  {
    kind: "security_bounties",
    keywords: [
      "security",
      "vulnerability",
      "cve",
      "bug bounty",
      "hackerone",
      "bugcrowd",
      "pentest",
    ],
  },
  {
    kind: "dev_bounties",
    keywords: [
      "bounty",
      "bounties",
      "github issue",
      "open source",
      "pull request",
      "algora",
      "patch",
    ],
  },
  {
    kind: "web_agency",
    keywords: ["website", "web agency", "agency", "client site", "landing page", "software agency"],
  },
  {
    kind: "voice_ai",
    keywords: [
      "voice",
      "receptionist",
      "phone",
      "telephony",
      "call centre",
      "call center",
      "twilio",
    ],
  },
  {
    kind: "paid_tasks",
    keywords: ["paid task", "freelance", "microtask", "online work", "data task"],
  },
  {
    kind: "digital_products",
    keywords: ["digital product", "template", "ebook", "gumroad", "storefront", "course", "kit"],
  },
  {
    kind: "micro_saas",
    keywords: ["saas", "micro-saas", "subscription", "mrr", "recurring", "web app"],
  },
];

const parseMoneyTarget = (
  text: string,
): { readonly targetRevenueMinor: number | null; readonly currency: CurrencyCode | null } => {
  const symbolMatch = text.match(/([£$€])\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (symbolMatch !== null) {
    const symbol = symbolMatch[1];
    const amount = Number(symbolMatch[2]!.replace(/,/g, ""));
    if (Number.isFinite(amount) && amount >= 0) {
      const currency: CurrencyCode = symbol === "$" ? "USD" : symbol === "€" ? "EUR" : "GBP";
      return { targetRevenueMinor: Math.round(amount * 100), currency };
    }
  }
  const codeMatch = text.match(/\b(GBP|USD|EUR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (codeMatch !== null) {
    const amount = Number(codeMatch[2]!.replace(/,/g, ""));
    if (Number.isFinite(amount) && amount >= 0) {
      return {
        targetRevenueMinor: Math.round(amount * 100),
        currency: codeMatch[1]!.toUpperCase(),
      };
    }
  }
  return { targetRevenueMinor: null, currency: null };
};

const inferHorizonFromText = (text: string): ObjectiveHorizon => {
  const lower = text.toLowerCase();
  if (/\b(?:today|tonight|now|asap|immediate|24\s*hours?)\b/.test(lower)) return "immediate";
  if (/\b(?:this\s+week|weekly|7\s*days?|next\s+week)\b/.test(lower)) return "weekly";
  if (/\b(?:this\s+month|monthly|30\s*days?|next\s+month)\b/.test(lower)) return "monthly";
  if (/\b(?:quarter|quarterly|90\s*days?)\b/.test(lower)) return "quarterly";
  return "ongoing";
};

const detectMentionedVentureKinds = (text: string): ReadonlyArray<VentureKind> => {
  const lower = text.toLowerCase();
  const kinds: Array<VentureKind> = [];
  for (const entry of VENTURE_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      kinds.push(entry.kind);
    }
  }
  return kinds;
};

function scoreOpportunityDeterministically(input: {
  readonly estimatedValueMinor: number | null;
  readonly currency: CurrencyCode;
  readonly eligibilityStatus: Opportunity["eligibilityStatus"];
  readonly automationMode: Opportunity["automationMode"];
  readonly aiPermissionStatus: Opportunity["aiPermissionStatus"];
  readonly effortHoursEstimate?: number | null;
}): OpportunityScore {
  const complianceFit =
    input.aiPermissionStatus === "prohibited" || input.eligibilityStatus === "ineligible"
      ? 0
      : input.eligibilityStatus === "eligible" && input.aiPermissionStatus === "permitted"
        ? 1
        : input.eligibilityStatus === "eligible"
          ? 0.75
          : 0.45;

  const baseWinProb =
    complianceFit === 0
      ? 0
      : input.automationMode === "autonomous_within_policy"
        ? 0.55
        : input.automationMode === "assisted"
          ? 0.42
          : 0.28;
  const winProbability =
    Math.round(Math.min(1, Math.max(0, baseWinProb * (0.5 + 0.5 * complianceFit))) * 100) / 100;

  const valueMinor = input.estimatedValueMinor ?? 0;
  const expectedValueMinor =
    input.estimatedValueMinor === null ? null : Math.round(valueMinor * winProbability);
  const effortHours =
    input.effortHoursEstimate ?? (valueMinor >= 50_000 ? 12 : valueMinor >= 10_000 ? 5 : 2);
  const valuePerHour = effortHours > 0 ? (expectedValueMinor ?? 0) / effortHours : 0;
  const valueScore = Math.min(45, Math.round((Math.log10(Math.max(1, valuePerHour) + 1) / 5) * 45));
  const complianceScore = Math.round(complianceFit * 35);
  const automationScore =
    input.automationMode === "autonomous_within_policy"
      ? 20
      : input.automationMode === "assisted"
        ? 12
        : 6;

  const overall =
    complianceFit === 0
      ? 0
      : Math.min(100, Math.max(0, valueScore + complianceScore + automationScore));

  const rationaleParts: Array<string> = [];
  if (complianceFit === 0) {
    rationaleParts.push("Marked ineligible due to AI or platform policy restrictions.");
  } else {
    rationaleParts.push(`Compliance fit ${Math.round(complianceFit * 100)}%.`);
    rationaleParts.push(`Estimated win probability ${Math.round(winProbability * 100)}%.`);
    if (expectedValueMinor !== null) {
      rationaleParts.push(`Expected value ${expectedValueMinor} ${input.currency} minor units.`);
    }
  }

  return {
    overall,
    expectedValueMinor,
    currency: input.currency,
    winProbability,
    effortHoursEstimate: effortHours,
    complianceFit,
    rationale: rationaleParts.join(" "),
  };
}

const API_KEY_ENV_PATTERN = /(?:_API_KEY|_TOKEN|OPENAI_KEY|ANTHROPIC_KEY)$/i;

const inferProviderBillingClass = (
  provider: ServerProvider,
  instanceConfig: ProviderInstanceConfig | undefined,
): { readonly billingClass: ProviderBillingClass; readonly inferred: boolean } => {
  if (instanceConfig?.pool?.billingClass !== undefined) {
    return { billingClass: instanceConfig.pool.billingClass, inferred: false };
  }
  const hasApiKeyEnv = (instanceConfig?.environment ?? []).some(
    (variable) => API_KEY_ENV_PATTERN.test(variable.name) && variable.sensitive,
  );
  if (hasApiKeyEnv) {
    return { billingClass: "metered_api", inferred: true };
  }
  const driver = String(provider.driver).toLowerCase();
  if (driver === "ollama" || driver === "local" || driver === "lmstudio") {
    return { billingClass: "local", inferred: true };
  }
  if (
    driver === "codex" ||
    driver === "claudeagent" ||
    driver === "cursor" ||
    driver === "antigravity" ||
    driver === "kiro" ||
    driver === "grok" ||
    driver === "opencode" ||
    driver === "pi" ||
    driver === "muse"
  ) {
    return { billingClass: "subscription", inferred: true };
  }
  return { billingClass: "unknown", inferred: true };
};

const inferHealthStatus = (provider: ServerProvider): ProviderPoolHealthStatus => {
  if (!provider.enabled) return "disabled";
  if (!provider.installed || provider.status === "error") return "unavailable";
  if (provider.auth.status === "unauthenticated") return "unavailable";
  if (provider.status === "warning") return "degraded";
  return "healthy";
};

const inferModelTier = (slug: string): ProviderModelTier => {
  const lower = slug.toLowerCase();
  if (
    lower.includes("opus") ||
    lower.includes("pro") ||
    lower.includes("frontier") ||
    lower.includes("o3")
  ) {
    return "frontier";
  }
  if (
    lower.includes("reason") ||
    lower.includes("thinking") ||
    lower.includes("sonnet") ||
    lower.includes("codex")
  ) {
    return "reasoning";
  }
  if (
    lower.includes("haiku") ||
    lower.includes("mini") ||
    lower.includes("flash") ||
    lower.includes("nano") ||
    lower.includes("fast")
  ) {
    return "fast";
  }
  return "balanced";
};

export class SovereignOrchestratorService extends Context.Service<
  SovereignOrchestratorService,
  {
    readonly listBlueprints: Effect.Effect<{
      readonly blueprints: ReadonlyArray<VentureBlueprint>;
    }>;
    readonly getOverview: Effect.Effect<SovereignOverviewSnapshot, SovereignDomainError>;
    readonly getVentureDetail: (
      ventureId: VentureId,
    ) => Effect.Effect<SovereignVentureDetail, SovereignDomainError>;
    readonly createVenture: (
      input: CreateVentureInput,
    ) => Effect.Effect<Venture, SovereignDomainError>;
    readonly updateVenture: (
      input: UpdateVentureInput,
    ) => Effect.Effect<Venture, SovereignDomainError>;
    readonly deleteVenture: (
      input: DeleteVentureInput,
    ) => Effect.Effect<{ readonly deleted: boolean }, SovereignDomainError>;
    readonly createObjective: (
      input: CreateObjectiveInput,
    ) => Effect.Effect<CommercialObjective, SovereignDomainError>;
    readonly updateObjective: (
      input: UpdateObjectiveInput,
    ) => Effect.Effect<CommercialObjective, SovereignDomainError>;
    readonly createOpportunity: (
      input: CreateOpportunityInput,
    ) => Effect.Effect<Opportunity, SovereignDomainError>;
    readonly updateOpportunity: (
      input: UpdateOpportunityInput,
    ) => Effect.Effect<Opportunity, SovereignDomainError>;
    readonly listOpportunities: (filter?: {
      readonly ventureId?: VentureId;
    }) => Effect.Effect<ReadonlyArray<Opportunity>, SovereignPersistenceError>;
    readonly createTask: (
      input: CreateCommercialTaskInput & {
        readonly idempotencyKey?: string | null;
        readonly checkpointJson?: string | null;
        readonly handoffSummary?: string | null;
        readonly dependsOn?: ReadonlyArray<CommercialTaskId>;
        readonly maxRetries?: number;
      },
    ) => Effect.Effect<CommercialTask, SovereignDomainError>;
    readonly updateTask: (
      input: UpdateCommercialTaskInput & {
        readonly checkpointJson?: string | null;
        readonly handoffSummary?: string | null;
      },
    ) => Effect.Effect<CommercialTask, SovereignDomainError>;
    readonly createArtifact: (
      input: CreateCommercialArtifactInput,
    ) => Effect.Effect<CommercialArtifact, SovereignDomainError>;
    readonly recoverInterruptedWork: Effect.Effect<
      StartupRecoverySummary,
      SovereignPersistenceError
    >;
    readonly computePortfolioRecommendations: Effect.Effect<
      ReadonlyArray<PortfolioRecommendation>,
      SovereignPersistenceError
    >;
    readonly getProviderPool: Effect.Effect<ProviderPoolSnapshot, SovereignPersistenceError>;
    readonly routeProvider: (
      request: ProviderRouteRequest,
    ) => Effect.Effect<ProviderRouteDecision, SovereignDomainError>;
    readonly updateProviderPoolConfig: (
      input: UpdateProviderPoolConfigInput,
    ) => Effect.Effect<ProviderPoolSnapshot, SovereignDomainError>;
    readonly subscribeEvents: Effect.Effect<Stream.Stream<SovereignEvent>, never, Scope.Scope>;
  }
>()("t3/sovereign/SovereignOrchestratorService") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const governance = yield* SovereignGovernanceService.SovereignGovernanceService;
  const ledger = yield* SovereignLedgerService.SovereignLedgerService;
  const integrations = yield* SovereignIntegrationService.SovereignIntegrationService;
  const random = yield* SecureRandom.SecureRandom;
  const providerPoolRouterOpt = yield* Effect.serviceOption(ProviderPoolRouter.ProviderPoolRouter);
  const providerRegistryOpt = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const serverSettingsOpt = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);

  const generateId = <Id extends string>(prefix: string, makeId: (value: string) => Id) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.map((uuid) => makeId(`${prefix}_${uuid.replace(/-/g, "")}`)),
    );

  const buildVentureOverviewRow = Effect.fnUntraced(function* (
    venture: Venture,
  ): Effect.fn.Return<VentureOverviewRow, SovereignPersistenceError> {
    const [objectives, opportunities, tasks, approvals, metrics] = yield* Effect.all([
      store.listObjectives({ ventureId: venture.id, activeOnly: true }),
      store.listOpportunities({ ventureId: venture.id }),
      store.listTasks({ ventureId: venture.id, activeOnly: true }),
      store.listApprovals({ ventureId: venture.id, status: "pending" }),
      ledger.computeFinancialMetrics(venture.id),
    ]);

    const openOpportunities = opportunities.filter(
      (opp) => opp.stage !== "won" && opp.stage !== "lost" && opp.stage !== "disqualified",
    );
    const activityTimestamps = [
      venture.updatedAt,
      ...tasks.map((record) => record.task.updatedAt),
      ...opportunities.map((opp) => opp.updatedAt),
      ...approvals.map((apr) => apr.requestedAt),
    ];
    const lastActivityAt =
      activityTimestamps.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0] ?? null;

    return {
      venture,
      activeObjectivesCount: objectives.length,
      openOpportunitiesCount: openOpportunities.length,
      activeTasksCount: tasks.length,
      pendingApprovalsCount: approvals.length,
      collectedRevenueMinor: metrics.collectedRevenueMinor,
      confirmedExpensesMinor: metrics.confirmedExpensesMinor,
      netProfitMinor: metrics.netProfitMinor,
      pipelineValueMinor:
        metrics.discoveredOpportunityValueMinor +
        metrics.proposedQuotationsMinor +
        metrics.acceptedOrdersMinor,
      currency: metrics.reportingCurrency,
      lastActivityAt,
    } satisfies VentureOverviewRow;
  });

  const getProviderPool = Effect.fn("SovereignOrchestratorService.getProviderPool")(function* () {
    const { controlState } = yield* store.getControlState;
    if (Option.isSome(providerPoolRouterOpt)) {
      const snapshot = yield* providerPoolRouterOpt.value.getSnapshot();
      return {
        ...snapshot,
        defaultRoutingPolicy: {
          ...snapshot.defaultRoutingPolicy,
          paidFallbackMode: controlState.defaultPaidFallbackMode,
          currency: controlState.reportingCurrency,
        },
      } satisfies ProviderPoolSnapshot;
    }

    const [now, providers, settings] = yield* Effect.all([
      store.nowIso,
      Option.isSome(providerRegistryOpt)
        ? providerRegistryOpt.value.getProviders
        : Effect.succeed<ReadonlyArray<ServerProvider>>([]),
      Option.isSome(serverSettingsOpt)
        ? serverSettingsOpt.value.getSettings.pipe(Effect.orElseSucceed(() => undefined))
        : Effect.undefined,
    ]);

    const members: Array<ProviderPoolMemberStatus> = providers.map((provider) => {
      const instanceConfig = settings?.providerInstances[provider.instanceId];
      const pool = instanceConfig?.pool;
      const { billingClass, inferred } = inferProviderBillingClass(provider, instanceConfig);
      const healthStatus = inferHealthStatus(provider);
      const availableModels = provider.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        tier: inferModelTier(model.slug),
        supportsTools: true,
      }));
      return {
        instanceId: provider.instanceId,
        driver: provider.driver,
        displayName: instanceConfig?.displayName ?? provider.displayName ?? provider.instanceId,
        enabled: provider.enabled,
        poolEnabled: pool?.poolEnabled ?? provider.enabled,
        poolPriority: pool?.poolPriority ?? 100,
        billingClass,
        billingClassInferred: inferred,
        ...(pool?.subscriptionPlanLabel === undefined
          ? {}
          : { subscriptionPlanLabel: pool.subscriptionPlanLabel }),
        ...(pool?.monthlySubscriptionCostMinor === undefined
          ? {}
          : { monthlySubscriptionCostMinor: pool.monthlySubscriptionCostMinor }),
        ...(pool?.subscriptionCurrency === undefined
          ? {}
          : { subscriptionCurrency: pool.subscriptionCurrency }),
        healthStatus,
        activeRunCount: 0,
        maxConcurrentRuns: pool?.maxConcurrentRuns ?? 2,
        // Never fabricate quota numbers when live telemetry is unavailable.
        quotaAvailability: "unavailable",
        quotaRemainingPct: null,
        quotaResetAt: null,
        cooldownUntil: null,
        reliabilityScore: null,
        preferredTiers: pool?.preferredTiers ?? ["balanced", "reasoning"],
        poolTags: pool?.poolTags ?? [],
        availableModels,
        checkedAt: provider.checkedAt ?? now,
      };
    });

    const healthyCount = members.filter(
      (member) =>
        member.enabled &&
        member.poolEnabled &&
        (member.healthStatus === "healthy" || member.healthStatus === "degraded"),
    ).length;
    const activeRunCount = members.reduce((sum, member) => sum + member.activeRunCount, 0);
    const paidInstancesCount = members.filter(
      (member) => member.billingClass === "metered_api",
    ).length;

    return {
      updatedAt: now,
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        paidFallbackMode: controlState.defaultPaidFallbackMode,
        currency: controlState.reportingCurrency,
      },
      members,
      healthyCount,
      activeRunCount,
      paidInstancesCount,
    } satisfies ProviderPoolSnapshot;
  });

  const routeProvider = Effect.fn("SovereignOrchestratorService.routeProvider")(function* (
    request: ProviderRouteRequest,
  ) {
    const { controlState } = yield* store.getControlState;
    const venture =
      request.ventureId !== undefined && request.ventureId !== null
        ? Option.getOrUndefined(yield* store.getVenture(request.ventureId))
        : undefined;
    const policy: ProviderRoutingPolicy = request.routingPolicy ??
      venture?.routingPolicy ?? {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        paidFallbackMode: controlState.defaultPaidFallbackMode,
        currency: controlState.reportingCurrency,
      };

    if (Option.isSome(providerPoolRouterOpt)) {
      return yield* providerPoolRouterOpt.value.route({ ...request, routingPolicy: policy }).pipe(
        Effect.flatMap((decision): Effect.Effect<ProviderRouteDecision, SovereignDomainError> =>
          Effect.gen(function* () {
            if (decision.status === "approval_required") {
              const approval = yield* governance.requestApproval({
                ...(request.ventureId === undefined ? {} : { ventureId: request.ventureId }),
                ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
                category: "paid_provider_fallback",
                riskLevel: "high",
                title: `Approve paid API fallback to ${decision.selectedInstanceId ?? "metered provider"}`,
                summary: decision.reason,
                requestedAction: "route_metered_provider",
                ...(decision.selectedInstanceId === null
                  ? {}
                  : { targetLabel: decision.selectedInstanceId }),
                ...(decision.estimatedCostMinor === undefined
                  ? {}
                  : { estimatedCostMinor: decision.estimatedCostMinor }),
                currency: decision.currency ?? policy.currency,
                requestedBy: "sovereign_router",
              });
              return {
                status: "approval_required",
                selectedInstanceId: decision.selectedInstanceId,
                selectedModel: decision.selectedModel,
                billingClass: decision.billingClass,
                reason: decision.reason,
                approvalRequestId: approval.id,
                ...(decision.estimatedCostMinor === undefined
                  ? {}
                  : { estimatedCostMinor: decision.estimatedCostMinor }),
                ...(decision.currency === undefined ? {} : { currency: decision.currency }),
              } satisfies ProviderRouteDecision;
            }
            if (decision.status === "routed" && decision.selectedInstanceId !== null) {
              yield* governance.recordAuditEvent({
                kind: "provider_routed",
                severity: "info",
                ventureId: request.ventureId ?? null,
                actor: "sovereign_router",
                summary: `Routed to ${decision.billingClass ?? "unknown"} provider ${decision.selectedInstanceId}.`,
                providerInstanceId: decision.selectedInstanceId,
                ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
              });
            }
            return {
              status: decision.status,
              selectedInstanceId: decision.selectedInstanceId,
              selectedModel: decision.selectedModel,
              billingClass: decision.billingClass,
              reason: decision.reason,
              ...(decision.approvalRequestId === undefined
                ? {}
                : { approvalRequestId: decision.approvalRequestId }),
              ...(decision.estimatedCostMinor === undefined
                ? {}
                : { estimatedCostMinor: decision.estimatedCostMinor }),
              ...(decision.currency === undefined ? {} : { currency: decision.currency }),
            } satisfies ProviderRouteDecision;
          }),
        ),
        Effect.catchTags({
          ProviderPoolRoutingError: Effect.fnUntraced(function* (error) {
            if (error.code === "paid_fallback_requires_approval") {
              const approval = yield* governance.requestApproval({
                ...(request.ventureId === undefined ? {} : { ventureId: request.ventureId }),
                ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
                category: "paid_provider_fallback",
                riskLevel: "high",
                title: `Approve paid API fallback to ${error.candidateInstanceId ?? "metered provider"}`,
                summary: error.detail,
                requestedAction: "route_metered_provider",
                ...(error.candidateInstanceId === undefined
                  ? {}
                  : { targetLabel: error.candidateInstanceId }),
                ...(error.estimatedCostMinor === undefined
                  ? {}
                  : { estimatedCostMinor: Math.round(error.estimatedCostMinor) }),
                currency: error.currency ?? policy.currency,
                requestedBy: "sovereign_router",
              });
              return {
                status: "approval_required",
                selectedInstanceId: error.candidateInstanceId ?? null,
                selectedModel: error.candidateModel ?? null,
                billingClass: error.candidateBillingClass ?? "metered_api",
                reason: error.detail,
                approvalRequestId: approval.id,
                ...(error.estimatedCostMinor === undefined
                  ? {}
                  : { estimatedCostMinor: Math.round(error.estimatedCostMinor) }),
                currency: error.currency ?? policy.currency,
              } satisfies ProviderRouteDecision;
            }
            if (error.code === "paid_fallback_denied" || error.code === "cost_limit_exceeded") {
              yield* governance.recordAuditEvent({
                kind: "permission_denied",
                severity: "warning",
                ventureId: request.ventureId ?? null,
                actor: "sovereign_router",
                summary: error.detail,
                category: "paid_provider_fallback",
                ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
              });
              return {
                status: "denied",
                selectedInstanceId: null,
                selectedModel: null,
                billingClass: null,
                reason: error.detail,
              } satisfies ProviderRouteDecision;
            }
            return {
              status: "no_eligible_provider",
              selectedInstanceId: null,
              selectedModel: null,
              billingClass: null,
              reason: error.detail,
            } satisfies ProviderRouteDecision;
          }),
        }),
      );
    }

    const pool = yield* getProviderPool();
    const requestedTier = request.requestedTier ?? policy.preferredTier;
    const excluded = new Set(request.excludeInstanceIds ?? []);
    const requiredTags = request.requiredTags ?? [];

    const isEligibleMember = (member: ProviderPoolMemberStatus) =>
      member.enabled &&
      member.poolEnabled &&
      !excluded.has(member.instanceId) &&
      (member.healthStatus === "healthy" || member.healthStatus === "degraded") &&
      member.quotaAvailability !== "exhausted" &&
      member.activeRunCount < member.maxConcurrentRuns &&
      requiredTags.every((tag) => member.poolTags.includes(tag));

    const pickModelFor = (member: ProviderPoolMemberStatus): string | null => {
      const exact = member.availableModels.find((model) => model.tier === requestedTier);
      return exact?.slug ?? member.availableModels[0]?.slug ?? null;
    };

    const scoreMember = (member: ProviderPoolMemberStatus): number => {
      let score = member.poolPriority;
      if (member.healthStatus === "healthy") score += 20;
      if (member.preferredTiers.includes(requestedTier)) score += 15;
      if (member.billingClass === "local" || member.billingClass === "free") score += 10;
      if (member.billingClass === "subscription") score += 8;
      return score;
    };

    const eligible = pool.members
      .filter(isEligibleMember)
      .sort((a, b) => scoreMember(b) - scoreMember(a));

    if (policy.manualInstanceId !== undefined && policy.manualInstanceId !== null) {
      const manual = eligible.find((member) => member.instanceId === policy.manualInstanceId);
      if (manual !== undefined) {
        if (manual.billingClass !== "metered_api" || policy.paidFallbackMode === "allow") {
          const selectedModel = pickModelFor(manual);
          yield* governance.recordAuditEvent({
            kind: "provider_routed",
            severity: "info",
            ventureId: request.ventureId ?? null,
            actor: "sovereign_router",
            summary: `Routed to pinned provider ${manual.displayName}.`,
            providerInstanceId: manual.instanceId,
            ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
          });
          return {
            status: "routed",
            selectedInstanceId: manual.instanceId,
            selectedModel,
            billingClass: manual.billingClass,
            reason: `Pinned provider ${manual.displayName} is healthy and eligible.`,
          } satisfies ProviderRouteDecision;
        }
      }
    }

    const allowedClasses = new Set(policy.allowedBillingClasses);
    const includedCandidates = eligible.filter(
      (member) => member.billingClass !== "metered_api" && allowedClasses.has(member.billingClass),
    );
    const chosenIncluded = includedCandidates[0];
    if (chosenIncluded !== undefined) {
      const selectedModel = pickModelFor(chosenIncluded);
      yield* governance.recordAuditEvent({
        kind: "provider_routed",
        severity: "info",
        ventureId: request.ventureId ?? null,
        actor: "sovereign_router",
        summary: `Routed to ${chosenIncluded.billingClass} provider ${chosenIncluded.displayName}.`,
        providerInstanceId: chosenIncluded.instanceId,
        ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      });
      return {
        status: "routed",
        selectedInstanceId: chosenIncluded.instanceId,
        selectedModel,
        billingClass: chosenIncluded.billingClass,
        reason: `Selected ${chosenIncluded.displayName} (${chosenIncluded.billingClass}) matching ${requestedTier} tier.`,
      } satisfies ProviderRouteDecision;
    }

    const paidCandidate = eligible.find((member) => member.billingClass === "metered_api");
    if (paidCandidate !== undefined) {
      const selectedModel = pickModelFor(paidCandidate);
      if (policy.paidFallbackMode === "deny") {
        return {
          status: "denied",
          selectedInstanceId: null,
          selectedModel: null,
          billingClass: null,
          reason:
            "No included subscription, local, or free provider is eligible and paid API fallback is denied.",
        } satisfies ProviderRouteDecision;
      }
      if (policy.paidFallbackMode === "ask_approval") {
        const approval = yield* governance.requestApproval({
          ...(request.ventureId === undefined ? {} : { ventureId: request.ventureId }),
          ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
          category: "paid_provider_fallback",
          riskLevel: "high",
          title: `Approve paid API fallback to ${paidCandidate.displayName}`,
          summary:
            "All included subscription/local providers are unavailable or exhausted; requesting owner sign-off for metered API usage.",
          requestedAction: "route_metered_provider",
          targetLabel: paidCandidate.instanceId,
          estimatedCostMinor: policy.maxEstimatedCostMinor ?? null,
          currency: policy.currency,
          requestedBy: "sovereign_router",
        });
        return {
          status: "approval_required",
          selectedInstanceId: paidCandidate.instanceId,
          selectedModel,
          billingClass: "metered_api",
          reason: `Owner approval required before falling back to metered provider ${paidCandidate.displayName}.`,
          approvalRequestId: approval.id,
          ...(policy.maxEstimatedCostMinor === undefined
            ? {}
            : { estimatedCostMinor: policy.maxEstimatedCostMinor }),
          currency: policy.currency,
        } satisfies ProviderRouteDecision;
      }

      yield* governance.recordAuditEvent({
        kind: "provider_routed",
        severity: "info",
        ventureId: request.ventureId ?? null,
        actor: "sovereign_router",
        summary: `Routed via allowed paid fallback to ${paidCandidate.displayName}.`,
        providerInstanceId: paidCandidate.instanceId,
        ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      });
      return {
        status: "routed",
        selectedInstanceId: paidCandidate.instanceId,
        selectedModel,
        billingClass: "metered_api",
        reason: `Routed to metered provider ${paidCandidate.displayName} under allow policy.`,
      } satisfies ProviderRouteDecision;
    }

    return {
      status: "no_eligible_provider",
      selectedInstanceId: null,
      selectedModel: null,
      billingClass: null,
      reason: "No enabled and healthy provider instances are currently available in the pool.",
    } satisfies ProviderRouteDecision;
  });

  const updateProviderPoolConfig = Effect.fn(
    "SovereignOrchestratorService.updateProviderPoolConfig",
  )(function* (input: UpdateProviderPoolConfigInput) {
    if (Option.isNone(serverSettingsOpt)) {
      return yield* new SovereignValidationError({
        field: "serverSettings",
        reason: "Server settings service is unavailable.",
      });
    }
    const settingsService = serverSettingsOpt.value;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new SovereignValidationError({
            field: "instanceId",
            reason: `Could not load server settings (${cause.operation}).`,
          }),
      ),
    );
    const existing = settings.providerInstances[input.instanceId];
    if (existing === undefined) {
      return yield* new SovereignNotFoundError({
        entity: "provider_instance",
        id: input.instanceId,
      });
    }

    const { pool: _oldPool, ...withoutPool } = existing;
    const nextInstance: ProviderInstanceConfig =
      input.pool === null ? withoutPool : { ...withoutPool, pool: input.pool };
    yield* settingsService
      .updateProviderInstance({
        operation: "upsert",
        instanceId: input.instanceId,
        instance: nextInstance,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SovereignValidationError({
              field: "pool",
              reason: `Failed to save provider pool config (${cause.operation}).`,
            }),
        ),
      );

    const snapshot = yield* getProviderPool();
    yield* store.publishEvent({ type: "providerPoolUpdated", payload: snapshot });
    return snapshot;
  });

  const computePortfolioRecommendations = Effect.fn(
    "SovereignOrchestratorService.computePortfolioRecommendations",
  )(function* () {
    const [now, ventures, approvals, opportunities, integrationSummary, pool, { controlState }] =
      yield* Effect.all([
        store.nowIso,
        store.listVentures,
        store.listApprovals({ status: "pending" }),
        store.listOpportunities(),
        integrations.listIntegrations(),
        getProviderPool(),
        store.getControlState,
      ]);

    const recommendations: Array<PortfolioRecommendation> = [];

    if (approvals.length > 0) {
      const oldest = approvals[approvals.length - 1]!;
      recommendations.push({
        id: `rec_approvals_${approvals.length}`,
        kind: "review_approval",
        priority: "high",
        ventureId: oldest.ventureId,
        title: `Review ${approvals.length} pending approval${approvals.length === 1 ? "" : "s"}`,
        summary: `Blocked commercial actions are awaiting owner sign-off, starting with "${oldest.title}".`,
        rationale: "Pending approvals pause external submissions, proposals, and outbound sends.",
        suggestedAction: "Open Approvals inbox",
        createdAt: now,
      });
    }

    const highScoreOpps = opportunities
      .filter(
        (opp) =>
          opp.stage !== "won" &&
          opp.stage !== "lost" &&
          opp.stage !== "disqualified" &&
          opp.eligibilityStatus !== "ineligible" &&
          (opp.score?.overall ?? 0) >= 65,
      )
      .sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0));

    const topOpp = highScoreOpps[0];
    if (topOpp !== undefined) {
      recommendations.push({
        id: `rec_opp_${topOpp.id}`,
        kind: "focus_opportunity",
        priority: "high",
        ventureId: topOpp.ventureId,
        title: `Prioritise high-scoring opportunity: ${topOpp.title}`,
        summary: `Scored ${topOpp.score?.overall ?? 0}/100 with compliant execution path.`,
        rationale: topOpp.score?.rationale ?? "Strong expected return relative to effort.",
        estimatedUpsideMinor: topOpp.estimatedValueMinor,
        currency: topOpp.currency,
        suggestedAction: "Assign execution task",
        createdAt: now,
      });
    }

    if (integrationSummary.errorCount > 0 || integrationSummary.connectedCount === 0) {
      recommendations.push({
        id: "rec_integrations_setup",
        kind: "configure_integration",
        priority: integrationSummary.errorCount > 0 ? "high" : "medium",
        ventureId: null,
        title:
          integrationSummary.errorCount > 0
            ? "Repair failing commercial integrations"
            : "Connect a payment or source control integration",
        summary:
          integrationSummary.errorCount > 0
            ? `${integrationSummary.errorCount} integration(s) reported connection errors.`
            : "Connect Stripe, Paddle, GitHub, or Resend to reconcile real verified revenue and workflows.",
        rationale: "Verified ledger totals rely on real payment webhooks and connected channels.",
        suggestedAction: "Open Integrations Hub",
        createdAt: now,
      });
    }

    if (ventures.length === 0) {
      recommendations.push({
        id: "rec_first_venture",
        kind: "new_venture",
        priority: "medium",
        ventureId: null,
        title: "Create your first commercial venture",
        summary:
          "Launch from a blueprint such as Development Bounties, Website & Software Agency, or Micro-SaaS Studio.",
        rationale: "Ventures isolate budgets, permissions, CRM records, and financial performance.",
        suggestedAction: "Browse Venture Blueprints",
        createdAt: now,
      });
    }

    if (pool.healthyCount === 0 && pool.members.length > 0) {
      recommendations.push({
        id: "rec_pool_health",
        kind: "optimise_pool",
        priority: "high",
        ventureId: null,
        title: "Restore at least one healthy subscription or local provider",
        summary: "No provider instance in the pool is currently healthy for autonomous routing.",
        rationale:
          "Paid API fallback remains denied by default unless explicitly changed by the owner.",
        suggestedAction: "Open Provider Pool",
        createdAt: now,
      });
    }

    if (controlState.emergencyStopActive) {
      recommendations.unshift({
        id: "rec_emergency_stop",
        kind: "resolve_blocker",
        priority: "high",
        ventureId: null,
        title: "Global Emergency Stop is active",
        summary:
          controlState.emergencyStopReason ??
          "All autonomous tasks and external actions remain halted until cleared.",
        rationale: "Clear the emergency stop in Governance when ready to resume.",
        suggestedAction: "Review Emergency Stop",
        createdAt: now,
      });
    }

    return recommendations;
  });

  const getOverview = Effect.fn("SovereignOrchestratorService.getOverview")(function* () {
    const [
      { controlState, revision },
      now,
      financialSummary,
      ventures,
      activeObjectives,
      pendingApprovals,
      activeTaskRecords,
      recentAuditEvents,
      providerPool,
      integrationsSummary,
      recommendations,
    ] = yield* Effect.all([
      store.getControlState,
      store.nowIso,
      ledger.computeFinancialMetrics(null),
      store.listVentures,
      store.listObjectives({ activeOnly: true }),
      store.listApprovals({ status: "pending" }),
      store.listTasks({ activeOnly: true }),
      store.listAuditEvents({ limit: 50 }),
      getProviderPool(),
      integrations.listIntegrations(),
      computePortfolioRecommendations(),
    ]);

    const rate =
      controlState.reportingCurrency === DEFAULT_REPORTING_CURRENCY
        ? 1
        : controlState.fxRatesToGbp[controlState.reportingCurrency];
    const profitPeriods = rate === undefined ? undefined : yield* store.getProfitPeriods(now, rate);
    const ventureRows = yield* Effect.forEach(ventures, buildVentureOverviewRow);

    return {
      revision,
      generatedAt: now,
      controlState,
      financialSummary,
      ...(profitPeriods ? { profitPeriods } : {}),
      ventures: ventureRows,
      blueprints: SOVEREIGN_BLUEPRINTS,
      activeObjectives,
      pendingApprovals,
      activeTasks: activeTaskRecords.map((record) => record.task),
      recentAuditEvents,
      providerPool,
      integrationsSummary,
      recommendations,
    } satisfies SovereignOverviewSnapshot;
  });

  const getVentureDetail = Effect.fn("SovereignOrchestratorService.getVentureDetail")(function* (
    ventureId: VentureId,
  ) {
    const ventureOpt = yield* store.getVenture(ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
    }
    const [
      objectives,
      opportunities,
      taskRecords,
      leads,
      customers,
      proposals,
      orders,
      invoices,
      paymentLinks,
      communications,
      supportTickets,
      voiceAgents,
      financialSummary,
      recentLedgerEntries,
      approvals,
      preapprovalPolicies,
      artifacts,
      auditEvents,
      ventureIntegrations,
    ] = yield* Effect.all([
      store.listObjectives({ ventureId }),
      store.listOpportunities({ ventureId }),
      store.listTasks({ ventureId }),
      store.listLeads(ventureId),
      store.listCustomers(ventureId),
      store.listProposals(ventureId),
      store.listOrders(ventureId),
      store.listInvoices(ventureId),
      store.listPaymentLinks(ventureId),
      store.listCommunications(ventureId),
      store.listSupportTickets(ventureId),
      store.listVoiceAgents(ventureId),
      ledger.computeFinancialMetrics(ventureId),
      store.listLedgerEntries({ ventureId, limit: 100 }),
      store.listApprovals({ ventureId }),
      store.listPreapprovalPolicies({ ventureId }),
      store.listArtifacts({ ventureId }),
      store.listAuditEvents({ ventureId, limit: 100 }),
      store.listIntegrations({ ventureId }),
    ]);

    return {
      venture: ventureOpt.value,
      objectives,
      opportunities,
      tasks: taskRecords.map((record) => record.task),
      leads,
      customers,
      proposals,
      orders,
      invoices,
      paymentLinks,
      communications,
      supportTickets,
      voiceAgents,
      financialSummary,
      recentLedgerEntries,
      approvals,
      preapprovalPolicies,
      artifacts,
      auditEvents,
      integrations: ventureIntegrations,
    } satisfies SovereignVentureDetail;
  });

  const createVenture = Effect.fn("SovereignOrchestratorService.createVenture")(function* (
    input: CreateVentureInput,
  ) {
    const blueprint = getVentureBlueprint(input.templateKey ?? input.kind);
    const now = yield* store.nowIso;
    const baseSlug = slugifyName(input.slug ?? input.name);
    const existingSlug = yield* store.getVentureBySlug(baseSlug);
    const slug = Option.isSome(existingSlug)
      ? `${baseSlug}-${(yield* random.uuidV4().pipe(Effect.orDie)).slice(0, 6)}`
      : baseSlug;

    const venture: Venture = {
      id: yield* generateId("ven", VentureId.make),
      slug,
      name: input.name,
      kind: input.kind,
      templateKey: input.templateKey ?? blueprint.templateKey,
      status: input.status ?? "active",
      summary: input.summary ?? blueprint.description,
      uiModules: input.uiModules ?? blueprint.uiModules,
      budgetPolicy: input.budgetPolicy ?? blueprint.defaultBudgetPolicy,
      permissionPolicy: input.permissionPolicy ?? blueprint.defaultPermissionPolicy,
      routingPolicy: input.routingPolicy ?? blueprint.defaultRoutingPolicy,
      linkedProjectIds: input.linkedProjectIds ?? [],
      linkedThreadIds: [],
      linkedScheduledTaskIds: [],
      tags: input.tags ?? blueprint.defaultWorkflowTags,
      ...(input.config === undefined ? {} : { config: input.config }),
      createdAt: now,
      updatedAt: now,
    };

    yield* store.insertVenture(venture);
    yield* governance.recordAuditEvent({
      kind: "venture_state_changed",
      severity: "info",
      ventureId: venture.id,
      actor: "owner",
      summary: `Created venture "${venture.name}" (${venture.kind}).`,
    });
    const row = yield* buildVentureOverviewRow(venture);
    yield* store.publishEvent({ type: "ventureUpdated", payload: row });
    return venture;
  });

  const updateVenture = Effect.fn("SovereignOrchestratorService.updateVenture")(function* (
    input: UpdateVentureInput,
  ) {
    const existingOpt = yield* store.getVenture(input.ventureId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
    }
    const existing = existingOpt.value;
    const now = yield* store.nowIso;
    const updated: Venture = {
      ...existing,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      summary: input.summary ?? existing.summary,
      uiModules: input.uiModules ?? existing.uiModules,
      budgetPolicy: input.budgetPolicy ?? existing.budgetPolicy,
      permissionPolicy: input.permissionPolicy ?? existing.permissionPolicy,
      routingPolicy: input.routingPolicy ?? existing.routingPolicy,
      linkedProjectIds: input.linkedProjectIds ?? existing.linkedProjectIds,
      linkedThreadIds: input.linkedThreadIds ?? existing.linkedThreadIds,
      linkedScheduledTaskIds: input.linkedScheduledTaskIds ?? existing.linkedScheduledTaskIds,
      tags: input.tags ?? existing.tags,
      ...(input.config !== undefined
        ? { config: input.config }
        : existing.config === undefined
          ? {}
          : { config: existing.config }),
      updatedAt: now,
    };
    yield* store.updateVenture(updated);
    if (updated.status !== existing.status) {
      yield* governance.recordAuditEvent({
        kind: "venture_state_changed",
        severity: "info",
        ventureId: updated.id,
        actor: "owner",
        summary: `Changed venture "${updated.name}" status from ${existing.status} to ${updated.status}.`,
      });
    }
    const row = yield* buildVentureOverviewRow(updated);
    yield* store.publishEvent({ type: "ventureUpdated", payload: row });
    return updated;
  });

  const deleteVenture = Effect.fn("SovereignOrchestratorService.deleteVenture")(function* (
    input: DeleteVentureInput,
  ) {
    const deleted = yield* store.deleteVenture(input.ventureId);
    if (deleted) {
      yield* store.publishEvent({
        type: "ventureRemoved",
        payload: { ventureId: input.ventureId },
      });
    }
    return { deleted };
  });

  const createTask = Effect.fn("SovereignOrchestratorService.createTask")(function* (
    input: CreateCommercialTaskInput & {
      readonly idempotencyKey?: string | null;
      readonly checkpointJson?: string | null;
      readonly handoffSummary?: string | null;
      readonly dependsOn?: ReadonlyArray<CommercialTaskId>;
      readonly maxRetries?: number;
    },
  ) {
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
      const existing = yield* store.findTaskByIdempotencyKey(input.idempotencyKey);
      if (Option.isSome(existing)) {
        return existing.value.task;
      }
    }
    const ventureOpt = yield* store.getVenture(input.ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
    }
    const now = yield* store.nowIso;
    const task: CommercialTask = {
      id: yield* generateId("tsk", CommercialTaskId.make),
      ventureId: input.ventureId,
      objectiveId: input.objectiveId ?? null,
      opportunityId: input.opportunityId ?? null,
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "queued",
      complexity: input.complexity ?? "medium",
      priority: input.priority ?? 50,
      assignedProviderInstanceId: input.assignedProviderInstanceId ?? null,
      assignedModel: input.assignedModel ?? null,
      linkedThreadId: input.linkedThreadId ?? null,
      linkedRunId: null,
      pendingApprovalId: null,
      ...(input.routingPolicyOverride === undefined
        ? {}
        : { routingPolicyOverride: input.routingPolicyOverride }),
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    yield* store.insertTask({
      task,
      idempotencyKey: input.idempotencyKey ?? null,
      checkpointJson: input.checkpointJson ?? null,
      handoffSummary: input.handoffSummary ?? null,
      dependsOn: input.dependsOn ?? [],
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      nextRetryAt: null,
    });
    yield* store.publishEvent({ type: "taskUpdated", payload: task });
    return task;
  });

  const updateTask = Effect.fn("SovereignOrchestratorService.updateTask")(function* (
    input: UpdateCommercialTaskInput & {
      readonly checkpointJson?: string | null;
      readonly handoffSummary?: string | null;
    },
  ) {
    const existingOpt = yield* store.getTask(input.taskId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "task", id: input.taskId });
    }
    const existing = existingOpt.value;
    const now = yield* store.nowIso;
    const nextStatus = input.status ?? existing.task.status;
    const nextBlockedReason =
      input.blockedReason !== undefined ? input.blockedReason : existing.task.blockedReason;
    const nextRoutingOverride =
      input.routingPolicyOverride !== undefined
        ? input.routingPolicyOverride
        : existing.task.routingPolicyOverride;

    const updatedTask: CommercialTask = {
      ...existing.task,
      title: input.title ?? existing.task.title,
      description: input.description ?? existing.task.description,
      status: nextStatus,
      complexity: input.complexity ?? existing.task.complexity,
      priority: input.priority ?? existing.task.priority,
      assignedProviderInstanceId:
        input.assignedProviderInstanceId !== undefined
          ? input.assignedProviderInstanceId
          : existing.task.assignedProviderInstanceId,
      assignedModel:
        input.assignedModel !== undefined ? input.assignedModel : existing.task.assignedModel,
      linkedThreadId:
        input.linkedThreadId !== undefined ? input.linkedThreadId : existing.task.linkedThreadId,
      linkedRunId: input.linkedRunId !== undefined ? input.linkedRunId : existing.task.linkedRunId,
      pendingApprovalId:
        input.pendingApprovalId !== undefined
          ? input.pendingApprovalId
          : existing.task.pendingApprovalId,
      ...(nextRoutingOverride === undefined ? {} : { routingPolicyOverride: nextRoutingOverride }),
      ...(nextBlockedReason === undefined ? {} : { blockedReason: nextBlockedReason }),
      updatedAt: now,
      completedAt:
        nextStatus === "completed" && existing.task.completedAt === null
          ? now
          : existing.task.completedAt,
    };

    const updatedRecord: SovereignStore.PersistedTaskRecord = {
      ...existing,
      task: updatedTask,
      checkpointJson:
        input.checkpointJson !== undefined ? input.checkpointJson : existing.checkpointJson,
      handoffSummary:
        input.handoffSummary !== undefined ? input.handoffSummary : existing.handoffSummary,
    };
    yield* store.updateTask(updatedRecord);
    yield* store.publishEvent({ type: "taskUpdated", payload: updatedTask });
    return updatedTask;
  });

  const createObjective = Effect.fn("SovereignOrchestratorService.createObjective")(function* (
    input: CreateObjectiveInput,
  ) {
    const [{ controlState }, allVentures, now] = yield* Effect.all([
      store.getControlState,
      store.listVentures,
      store.nowIso,
    ]);

    const combinedText = `${input.title} ${input.description ?? ""}`.trim();
    const parsedMoney = parseMoneyTarget(combinedText);
    const targetRevenueMinor =
      input.targetRevenueMinor !== undefined
        ? input.targetRevenueMinor
        : parsedMoney.targetRevenueMinor;
    const currency = input.currency ?? parsedMoney.currency ?? controlState.reportingCurrency;
    const horizon = input.horizon ?? inferHorizonFromText(combinedText);
    const activeVentures = allVentures.filter((venture) => venture.status === "active");

    let targetVentures: ReadonlyArray<Venture> = [];
    if (input.ventureId !== undefined && input.ventureId !== null) {
      const explicit = allVentures.find((venture) => venture.id === input.ventureId);
      if (explicit === undefined) {
        return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
      }
      targetVentures = [explicit];
    } else {
      const mentionedKinds = detectMentionedVentureKinds(combinedText);
      const matched = activeVentures.filter((venture) => mentionedKinds.includes(venture.kind));
      targetVentures = matched.length > 0 ? matched : activeVentures;
    }

    const asksForNewVenture =
      /\b(?:new\s+(?:business|venture|revenue\s+stream)|additional\s+ways|discover\s+opportunities|launch\s+a\s+new)\b/i.test(
        combinedText,
      );
    const mentionedKinds = detectMentionedVentureKinds(combinedText);
    const steps: Array<ObjectiveStrategyStep> = [];

    if (asksForNewVenture || targetVentures.length === 0) {
      const suggestedKinds: ReadonlyArray<VentureKind> =
        mentionedKinds.length > 0
          ? mentionedKinds
          : ["dev_bounties", "web_agency", "digital_products"];
      for (const kind of suggestedKinds.slice(0, 3)) {
        const blueprint = getVentureBlueprint(kind);
        steps.push({
          id: `propose_${kind}`,
          title: `Evaluate ${blueprint.name} opportunity`,
          description: `Assess market demand, policy guardrails, and initial unit economics for ${blueprint.name}.`,
          ventureKind: kind,
          ventureId: null,
          estimatedImpactMinor:
            targetRevenueMinor !== null
              ? Math.round(targetRevenueMinor / Math.max(1, Math.min(3, suggestedKinds.length)))
              : null,
          currency,
          status: "planned",
          requiresApproval: true,
        });
      }
    }

    for (const venture of targetVentures.slice(0, 4)) {
      steps.push({
        id: `source_${venture.slug}`,
        title: `Source qualified opportunities for ${venture.name}`,
        description: `Identify compliant, high-ROI opportunities for ${venture.name} aligned with "${input.title}".`,
        ventureKind: venture.kind,
        ventureId: venture.id,
        estimatedImpactMinor:
          targetRevenueMinor !== null
            ? Math.round(targetRevenueMinor / Math.max(1, targetVentures.length))
            : null,
        currency,
        status: "planned",
        requiresApproval: false,
      });
      steps.push({
        id: `deliver_${venture.slug}`,
        title: `Prepare approval-ready deliverables for ${venture.name}`,
        description: `Draft work product, verify quality locally, and queue owner approval before external submission.`,
        ventureKind: venture.kind,
        ventureId: venture.id,
        estimatedImpactMinor: null,
        currency,
        status: "planned",
        requiresApproval: true,
      });
    }

    const strategyPlan: ObjectiveStrategyPlan = {
      summary:
        targetVentures.length > 0
          ? `Execute ${steps.length} bounded step(s) across ${targetVentures.map((v) => v.name).join(", ")} toward "${input.title}".`
          : `Evaluate ${steps.length} candidate venture path(s) to pursue "${input.title}" with owner approval before external spend or launch.`,
      rationale:
        "Prioritises compliant, verified-revenue work using included provider capacity first while keeping external actions approval-gated.",
      targetVentureIds: targetVentures.map((venture) => venture.id),
      steps,
      assumptions: [
        "All real revenue is counted only after verified payment reconciliation.",
        "Included subscription or local provider capacity is preferred before metered APIs.",
      ],
      risks: [
        "External submissions, outreach, and spend remain paused until owner approval.",
        "Unconnected payment or channel integrations will block automated settlement.",
      ],
      generatedAt: now,
    };

    const objective: CommercialObjective = {
      id: yield* generateId("obj", ObjectiveId.make),
      ventureId: input.ventureId ?? (targetVentures.length === 1 ? targetVentures[0]!.id : null),
      title: input.title,
      description: input.description ?? "",
      status: "active",
      horizon,
      targetRevenueMinor,
      maxSpendMinor: input.maxSpendMinor ?? 0,
      currency,
      targetDeadlineAt: input.targetDeadlineAt ?? null,
      strategyPlan,
      constraints: input.constraints ?? [],
      createdAt: now,
      updatedAt: now,
    };

    yield* store.insertObjective(objective);

    // Materialize initial bounded tasks with idempotency keys and step dependencies.
    let previousTaskIdByVenture = new Map<VentureId, CommercialTaskId>();
    for (const step of steps) {
      if (step.ventureId === undefined || step.ventureId === null) continue;
      const previousTaskId = previousTaskIdByVenture.get(step.ventureId);
      const created = yield* createTask({
        ventureId: step.ventureId,
        objectiveId: objective.id,
        title: step.title,
        description: step.description,
        status: previousTaskId === undefined ? "ready" : "queued",
        complexity: step.requiresApproval ? "high" : "medium",
        priority: step.requiresApproval ? 60 : 75,
        idempotencyKey: `obj:${objective.id}:step:${step.id}`,
        dependsOn: previousTaskId === undefined ? [] : [previousTaskId],
      });
      previousTaskIdByVenture.set(step.ventureId, created.id);
    }

    yield* governance.recordAuditEvent({
      kind: "venture_state_changed",
      severity: "info",
      ventureId: objective.ventureId,
      actor: "owner",
      summary: `Created commercial objective "${objective.title}" with ${steps.length} planned step(s).`,
      metadata: {
        objectiveId: objective.id,
        targetRevenueMinor: objective.targetRevenueMinor,
        currency: objective.currency,
      },
    });

    return objective;
  });

  const updateObjective = Effect.fn("SovereignOrchestratorService.updateObjective")(function* (
    input: UpdateObjectiveInput,
  ) {
    const existingOpt = yield* store.getObjective(input.objectiveId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "objective", id: input.objectiveId });
    }
    const existing = existingOpt.value;
    const now = yield* store.nowIso;
    const updated: CommercialObjective = {
      ...existing,
      status: input.status ?? existing.status,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      horizon: input.horizon ?? existing.horizon,
      targetRevenueMinor:
        input.targetRevenueMinor !== undefined
          ? input.targetRevenueMinor
          : existing.targetRevenueMinor,
      maxSpendMinor: input.maxSpendMinor ?? existing.maxSpendMinor,
      targetDeadlineAt:
        input.targetDeadlineAt !== undefined ? input.targetDeadlineAt : existing.targetDeadlineAt,
      strategyPlan: input.strategyPlan !== undefined ? input.strategyPlan : existing.strategyPlan,
      constraints: input.constraints ?? existing.constraints,
      updatedAt: now,
    };
    yield* store.updateObjective(updated);
    return updated;
  });

  const createOpportunity = Effect.fn("SovereignOrchestratorService.createOpportunity")(function* (
    input: CreateOpportunityInput,
  ) {
    const ventureOpt = yield* store.getVenture(input.ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
    }

    if (input.externalRef !== undefined && input.externalRef !== null) {
      const duplicate = yield* store.findOpportunityByExternalRef(
        input.ventureId,
        input.externalRef,
      );
      if (Option.isSome(duplicate)) {
        return duplicate.value;
      }
    }

    const aiPermissionStatus = input.aiPermissionStatus ?? "unknown";
    const prohibitedAi = aiPermissionStatus === "prohibited";
    const eligibilityStatus = prohibitedAi
      ? "ineligible"
      : (input.eligibilityStatus ?? "needs_review");
    const automationMode = prohibitedAi ? "manual" : (input.automationMode ?? "assisted");
    const eligibilityNotes = prohibitedAi
      ? (input.eligibilityNotes ??
        "Marked ineligible because platform or client policy prohibits AI assistance.")
      : input.eligibilityNotes;

    const currency =
      input.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
    const estimatedValueMinor = input.estimatedValueMinor ?? null;
    const score =
      input.score !== undefined
        ? input.score
        : scoreOpportunityDeterministically({
            estimatedValueMinor,
            currency,
            eligibilityStatus,
            automationMode,
            aiPermissionStatus,
          });

    const now = yield* store.nowIso;
    const opportunity: Opportunity = {
      id: yield* generateId("opp", OpportunityId.make),
      ventureId: input.ventureId,
      objectiveId: input.objectiveId ?? null,
      title: input.title,
      summary: input.summary ?? "",
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      externalRef: input.externalRef ?? null,
      stage: prohibitedAi ? "disqualified" : (input.stage ?? "discovered"),
      eligibilityStatus,
      ...(eligibilityNotes === undefined ? {} : { eligibilityNotes }),
      automationMode,
      aiPermissionStatus,
      estimatedValueMinor,
      currency,
      score,
      tags: input.tags ?? [],
      deadlineAt: input.deadlineAt ?? null,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      createdAt: now,
      updatedAt: now,
    };

    yield* store.insertOpportunity(opportunity);
    return opportunity;
  });

  const updateOpportunity = Effect.fn("SovereignOrchestratorService.updateOpportunity")(function* (
    input: UpdateOpportunityInput,
  ) {
    const existingOpt = yield* store.getOpportunity(input.opportunityId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "opportunity", id: input.opportunityId });
    }
    const existing = existingOpt.value;
    const now = yield* store.nowIso;
    const aiPermissionStatus = input.aiPermissionStatus ?? existing.aiPermissionStatus;
    const prohibitedAi = aiPermissionStatus === "prohibited";
    const eligibilityStatus = prohibitedAi
      ? "ineligible"
      : (input.eligibilityStatus ?? existing.eligibilityStatus);
    const automationMode = prohibitedAi
      ? "manual"
      : (input.automationMode ?? existing.automationMode);
    const estimatedValueMinor =
      input.estimatedValueMinor !== undefined
        ? input.estimatedValueMinor
        : existing.estimatedValueMinor;
    const currency = input.currency ?? existing.currency;
    const score =
      input.score !== undefined
        ? input.score
        : scoreOpportunityDeterministically({
            estimatedValueMinor,
            currency,
            eligibilityStatus,
            automationMode,
            aiPermissionStatus,
          });
    const nextNotes =
      input.eligibilityNotes !== undefined ? input.eligibilityNotes : existing.eligibilityNotes;
    const nextMetadata = input.metadata !== undefined ? input.metadata : existing.metadata;

    const updated: Opportunity = {
      ...existing,
      objectiveId: input.objectiveId !== undefined ? input.objectiveId : existing.objectiveId,
      title: input.title ?? existing.title,
      summary: input.summary ?? existing.summary,
      stage: prohibitedAi ? "disqualified" : (input.stage ?? existing.stage),
      eligibilityStatus,
      ...(nextNotes === undefined ? {} : { eligibilityNotes: nextNotes }),
      automationMode,
      aiPermissionStatus,
      estimatedValueMinor,
      currency,
      score,
      tags: input.tags ?? existing.tags,
      deadlineAt: input.deadlineAt !== undefined ? input.deadlineAt : existing.deadlineAt,
      ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
      updatedAt: now,
    };
    yield* store.updateOpportunity(updated);
    return updated;
  });

  const listOpportunities = Effect.fn("SovereignOrchestratorService.listOpportunities")(
    function* (filter?: { readonly ventureId?: VentureId }) {
      return yield* store.listOpportunities(filter);
    },
  );

  const createArtifact = Effect.fn("SovereignOrchestratorService.createArtifact")(function* (
    input: CreateCommercialArtifactInput,
  ) {
    const ventureOpt = yield* store.getVenture(input.ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
    }
    if (input.taskId !== undefined && input.taskId !== null) {
      const taskOpt = yield* store.getTask(input.taskId);
      if (Option.isNone(taskOpt)) {
        return yield* new SovereignConflictError({
          entity: "task",
          id: input.taskId,
          reason: "Referenced task does not exist.",
        });
      }
    }
    const now = yield* store.nowIso;
    const artifact: CommercialArtifact = {
      id: yield* generateId("art", ArtifactId.make),
      ventureId: input.ventureId,
      taskId: input.taskId ?? null,
      ...(input.opportunityId === undefined ? {} : { opportunityId: input.opportunityId }),
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? "",
      uri: input.uri ?? null,
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      createdAt: now,
    };
    yield* store.insertArtifact(artifact);
    return artifact;
  });

  const recoverInterruptedWork = Effect.fn("SovereignOrchestratorService.recoverInterruptedWork")(
    function* () {
      const interrupted = yield* store.listInterruptedTasks;
      const now = yield* store.nowIso;
      const recoveredTaskIds: Array<CommercialTaskId> = [];
      const failedTaskIds: Array<CommercialTaskId> = [];

      for (const record of interrupted) {
        const nextRetryCount = record.retryCount + 1;
        const exhausted = nextRetryCount > record.maxRetries;
        const nextStatus: CommercialTask["status"] = exhausted ? "failed" : "queued";
        const nextTask: CommercialTask = {
          ...record.task,
          status: nextStatus,
          ...(exhausted
            ? { blockedReason: "Maximum startup recovery retries exceeded." }
            : { blockedReason: "Recovered after server restart; queued for continuation." }),
          updatedAt: now,
        };
        const updatedRecord: SovereignStore.PersistedTaskRecord = {
          ...record,
          task: nextTask,
          retryCount: nextRetryCount,
        };
        yield* store.updateTask(updatedRecord);
        yield* governance.recordAuditEvent({
          kind: "venture_state_changed",
          severity: exhausted ? "warning" : "info",
          ventureId: nextTask.ventureId,
          actor: "sovereign_recovery",
          summary: exhausted
            ? `Marked interrupted task "${nextTask.title}" failed after ${record.maxRetries} recovery retries.`
            : `Recovered interrupted task "${nextTask.title}" back to queued (attempt ${nextRetryCount}/${record.maxRetries}).`,
          taskId: nextTask.id,
          metadata: {
            retryCount: nextRetryCount,
            maxRetries: record.maxRetries,
            hasHandoffSummary: record.handoffSummary !== null,
          },
        });
        yield* store.publishEvent({ type: "taskUpdated", payload: nextTask });
        if (exhausted) {
          failedTaskIds.push(nextTask.id);
        } else {
          recoveredTaskIds.push(nextTask.id);
        }
      }

      return { recoveredTaskIds, failedTaskIds } satisfies StartupRecoverySummary;
    },
  );

  return SovereignOrchestratorService.of({
    listBlueprints: Effect.succeed({ blueprints: SOVEREIGN_BLUEPRINTS }),
    getOverview: getOverview(),
    getVentureDetail,
    createVenture,
    updateVenture,
    deleteVenture,
    createObjective,
    updateObjective,
    createOpportunity,
    updateOpportunity,
    listOpportunities,
    createTask,
    updateTask,
    createArtifact,
    recoverInterruptedWork: recoverInterruptedWork(),
    computePortfolioRecommendations: computePortfolioRecommendations(),
    getProviderPool: getProviderPool(),
    routeProvider,
    updateProviderPoolConfig,
    subscribeEvents: store.subscribeEvents,
  });
});

export const layer = Layer.effect(SovereignOrchestratorService, make);
