import {
  type CommercialTask,
  type CommercialTaskId,
  type CurrencyCode,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_REPORTING_CURRENCY,
  DEFAULT_VENTURE_ACTION_MODES,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  type ProviderModelTier,
  type ProviderPoolSnapshot,
  type Venture,
  type VentureBudgetPolicy,
  type VentureKind,
  type VenturePermissionPolicy,
  type VentureStatus,
  type VentureUiModule,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { type SovereignDomainError, SovereignValidationError } from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";

export interface CustomVentureDeps {
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface VentureObjectiveDirectiveInput {
  readonly title: string;
  readonly description?: string;
  readonly targetRevenueMinor?: number | null;
  readonly currency?: CurrencyCode;
  readonly maxUpfrontCostMinor?: number;
  readonly excludedKinds?: ReadonlyArray<VentureKind>;
}

export interface DynamicVentureProposal {
  readonly proposalKey: string;
  readonly name: string;
  readonly kind: VentureKind;
  readonly templateKey: string;
  readonly summary: string;
  readonly uiModules: ReadonlyArray<VentureUiModule>;
  readonly workflowStages: ReadonlyArray<string>;
  readonly estimatedUpfrontCostMinor: number;
  readonly recommendedRoutingTier: ProviderModelTier;
  readonly defaultBudgetPolicy: VentureBudgetPolicy;
  readonly defaultPermissionPolicy: VenturePermissionPolicy;
  readonly fitScore: number;
  readonly rationale: string;
  readonly tags: ReadonlyArray<string>;
}

export interface ProposeNewVenturesResult {
  readonly proposals: ReadonlyArray<DynamicVentureProposal>;
  readonly poolSummary: {
    readonly healthyCount: number;
    readonly includedCapacityAvailable: boolean;
    readonly availableTiers: ReadonlyArray<ProviderModelTier>;
  };
}

export interface InstantiateDynamicVentureOptions {
  readonly requestedStatus?: VentureStatus;
  readonly requestedBy?: string;
}

export interface InstantiateDynamicVentureResult {
  readonly venture: Venture;
  readonly initialTasks: ReadonlyArray<CommercialTask>;
  readonly creationGate: SovereignGovernanceService.GateExternalActionResult;
}

interface DynamicCandidateTemplate {
  readonly proposalKey: string;
  readonly name: string;
  readonly kind: VentureKind;
  readonly templateKey: string;
  readonly summary: string;
  readonly uiModules: ReadonlyArray<VentureUiModule>;
  readonly workflowStages: ReadonlyArray<string>;
  readonly requiredTier: ProviderModelTier;
  readonly keywords: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
}

const DYNAMIC_CANDIDATE_TEMPLATES: ReadonlyArray<DynamicCandidateTemplate> = [
  {
    proposalKey: "technical_audit_packs",
    name: "Automated Codebase & Compliance Audit Packs",
    kind: "custom",
    templateKey: "custom_technical_audit_packs",
    summary:
      "Deliver fixed-scope codebase performance, accessibility, and dependency audit packs to SMEs using existing subscription coding agents with zero upfront spend.",
    uiModules: [
      "operations",
      "prospects_sales",
      "finances",
      "workspace_conversations",
      "approvals",
      "artifacts",
    ],
    workflowStages: [
      "Define fixed-scope audit rubric and sample report",
      "Qualify inbound SME prospects with verified consent",
      "Generate reproducible repository audit report artifact",
      "Deliver approved proposal and reconcile invoice payment",
    ],
    requiredTier: "reasoning",
    keywords: ["audit", "codebase", "compliance", "consulting", "report", "sme", "zero cost"],
    tags: ["custom", "zero_upfront_cost", "audit_packs"],
  },
  {
    proposalKey: "niche_workflow_templates",
    name: "Vertical AI Workflow & SOP Template Studio",
    kind: "digital_products",
    templateKey: "digital_products",
    summary:
      "Validate buyer demand for vertical operational templates, checklists, and automation packs, then publish packaged digital assets with approval-gated storefront listings.",
    uiModules: [
      "operations",
      "digital_products",
      "prospects_sales",
      "finances",
      "workspace_conversations",
      "approvals",
      "artifacts",
    ],
    workflowStages: [
      "Collect concrete buyer demand signals and competitor gaps",
      "Build and verify packaged template bundle and buyer guide",
      "Prepare approval-gated storefront listing and fulfilment webhook",
    ],
    requiredTier: "balanced",
    keywords: ["template", "pack", "playbook", "digital", "passive", "storefront", "guide"],
    tags: ["custom_proposal", "zero_upfront_cost", "digital_assets"],
  },
  {
    proposalKey: "b2b_micro_utilities",
    name: "B2B Micro-Utility Automation Desk",
    kind: "custom",
    templateKey: "custom_b2b_micro_utilities",
    summary:
      "Build focused internal data converters, API glue scripts, and reporting utilities on fixed-fee quotes for small businesses without recurring hosting overhead.",
    uiModules: [
      "operations",
      "prospects_sales",
      "finances",
      "workspace_conversations",
      "approvals",
      "artifacts",
    ],
    workflowStages: [
      "Scope narrow recurring manual workflow pain point",
      "Produce local prototype demo and approval-gated quotation",
      "Deliver tested utility package and reconcile client invoice",
    ],
    requiredTier: "reasoning",
    keywords: ["automation", "b2b", "script", "integration", "api", "tool", "utility"],
    tags: ["custom", "zero_upfront_cost", "b2b_automation"],
  },
  {
    proposalKey: "oss_bounty_sprint",
    name: "Zero-Upfront Open Source Bounty Sprint",
    kind: "dev_bounties",
    templateKey: "dev_bounties",
    summary:
      "Target funded open-source engineering bounties with explicit AI-permitted policies, isolated test verification, and approval-gated pull request submissions.",
    uiModules: [
      "operations",
      "bounties",
      "finances",
      "workspace_conversations",
      "approvals",
      "artifacts",
    ],
    workflowStages: [
      "Screen funded issues and verify AI contribution policy",
      "Implement verified patch in isolated worktree",
      "Submit pull request after owner approval and reconcile payout",
    ],
    requiredTier: "reasoning",
    keywords: ["bounty", "open source", "github", "bug", "code", "fast cash", "immediate"],
    tags: ["zero_upfront_cost", "bounties"],
  },
];

const conservativeBudgetPolicy = (currency: CurrencyCode): VentureBudgetPolicy => ({
  ...DEFAULT_VENTURE_BUDGET_POLICY,
  currency,
  monthlyCapMinor: 0,
  discretionarySpendAllowed: false,
});

const conservativePermissionPolicy = (): VenturePermissionPolicy => ({
  ...DEFAULT_VENTURE_PERMISSION_POLICY,
  actionModes: {
    ...DEFAULT_VENTURE_ACTION_MODES,
    security_testing: "deny",
    paid_provider_fallback: "deny",
  },
});

export const proposeNewVenturesFromObjective = Effect.fn(
  "VentureWorkflow.customVenture.proposeNewVenturesFromObjective",
)(function* (
  deps: CustomVentureDeps,
  directive: VentureObjectiveDirectiveInput,
  availablePoolSnapshot?: ProviderPoolSnapshot,
): Effect.fn.Return<ProposeNewVenturesResult, SovereignDomainError> {
  if (directive.title.trim().length === 0) {
    return yield* new SovereignValidationError({
      field: "title",
      reason: "Objective directive title must be non-empty.",
    });
  }

  const pool = availablePoolSnapshot ?? (yield* deps.orchestrator.getProviderPool);
  const includedHealthyMembers = pool.members.filter(
    (member) =>
      member.enabled &&
      member.poolEnabled &&
      (member.healthStatus === "healthy" || member.healthStatus === "degraded") &&
      member.billingClass !== "metered_api",
  );

  const tierSet = new Set<ProviderModelTier>();
  for (const member of includedHealthyMembers) {
    for (const tier of member.preferredTiers) {
      tierSet.add(tier);
    }
    for (const model of member.availableModels) {
      if (model.tier !== undefined) {
        tierSet.add(model.tier);
      }
    }
  }
  const availableTiers = Array.from(tierSet);
  const includedCapacityAvailable = includedHealthyMembers.length > 0;
  const maxUpfrontCostMinor = directive.maxUpfrontCostMinor ?? 0;
  const currency = directive.currency ?? DEFAULT_REPORTING_CURRENCY;
  const excludedKinds = new Set(directive.excludedKinds ?? []);
  const combinedText = `${directive.title} ${directive.description ?? ""}`.toLowerCase();

  const proposals: Array<DynamicVentureProposal> = [];
  for (const template of DYNAMIC_CANDIDATE_TEMPLATES) {
    if (excludedKinds.has(template.kind)) continue;
    const keywordHits = template.keywords.filter((kw) => combinedText.includes(kw)).length;
    const tierSupported = availableTiers.includes(template.requiredTier);
    const baseFit =
      52 + keywordHits * 12 + (tierSupported ? 16 : 4) + (includedCapacityAvailable ? 8 : 0);
    const fitScore = Math.min(100, baseFit);

    proposals.push({
      proposalKey: template.proposalKey,
      name: template.name,
      kind: template.kind,
      templateKey: template.templateKey,
      summary: template.summary,
      uiModules: template.uiModules,
      workflowStages: template.workflowStages,
      estimatedUpfrontCostMinor: Math.min(0, maxUpfrontCostMinor),
      recommendedRoutingTier: tierSupported ? template.requiredTier : "balanced",
      defaultBudgetPolicy: conservativeBudgetPolicy(currency),
      defaultPermissionPolicy: conservativePermissionPolicy(),
      fitScore,
      rationale: [
        `Matches objective "${directive.title.trim()}" with ${keywordHits} keyword alignment(s).`,
        includedCapacityAvailable
          ? `Can execute on ${includedHealthyMembers.length} included subscription/local provider(s) with £0 upfront spend.`
          : "Designed for £0 upfront spend; connect at least one subscription or local provider before autonomous runs.",
      ].join(" "),
      tags: template.tags,
    });
  }

  proposals.sort((a, b) => b.fitScore - a.fitScore);

  return {
    proposals,
    poolSummary: {
      healthyCount: pool.healthyCount,
      includedCapacityAvailable,
      availableTiers,
    },
  };
});

export const instantiateDynamicVenture = Effect.fn(
  "VentureWorkflow.customVenture.instantiateDynamicVenture",
)(function* (
  deps: CustomVentureDeps,
  proposal: DynamicVentureProposal,
  options?: InstantiateDynamicVentureOptions,
): Effect.fn.Return<InstantiateDynamicVentureResult, SovereignDomainError> {
  if (proposal.name.trim().length === 0) {
    return yield* new SovereignValidationError({
      field: "name",
      reason: "Dynamic venture proposal must include a non-empty name.",
    });
  }
  if (proposal.uiModules.length === 0) {
    return yield* new SovereignValidationError({
      field: "uiModules",
      reason: "Dynamic venture proposal must declare at least one uiModule.",
    });
  }

  const creationGate = yield* deps.governance.assertAndGateExternalAction({
    category: "new_venture_creation",
    title: `Activate dynamic venture: ${proposal.name.trim()}`,
    summary: proposal.summary,
    requestedAction: "instantiate_dynamic_venture",
    targetLabel: proposal.proposalKey,
    riskLevel: "medium",
    payload: {
      proposalKey: proposal.proposalKey,
      kind: proposal.kind,
      templateKey: proposal.templateKey,
      estimatedUpfrontCostMinor: proposal.estimatedUpfrontCostMinor,
    },
    requestedBy: options?.requestedBy ?? "custom_venture_workflow",
    idempotencyKey: `dynamic-venture:${proposal.proposalKey}`,
  });

  // Never bypass governance controls: default to draft when owner approval is still pending.
  const persistedStatus: VentureStatus =
    creationGate.outcome === "allowed" ? (options?.requestedStatus ?? "active") : "draft";

  const enforcedBudgetPolicy: VentureBudgetPolicy = {
    ...conservativeBudgetPolicy(proposal.defaultBudgetPolicy.currency),
    monthlyCapMinor: 0,
    discretionarySpendAllowed: false,
  };

  const enforcedPermissionPolicy: VenturePermissionPolicy = {
    ...conservativePermissionPolicy(),
    actionModes: {
      ...DEFAULT_VENTURE_ACTION_MODES,
      security_testing: "deny",
      paid_provider_fallback: "deny",
    },
  };

  const venture = yield* deps.orchestrator.createVenture({
    name: proposal.name.trim(),
    kind: proposal.kind,
    templateKey: proposal.templateKey,
    status: persistedStatus,
    summary: proposal.summary,
    uiModules: proposal.uiModules,
    budgetPolicy: enforcedBudgetPolicy,
    permissionPolicy: enforcedPermissionPolicy,
    routingPolicy: {
      ...DEFAULT_PROVIDER_ROUTING_POLICY,
      preferredTier: proposal.recommendedRoutingTier,
      currency: enforcedBudgetPolicy.currency,
    },
    tags: [...proposal.tags, "dynamic_venture"],
    config: {
      proposalKey: proposal.proposalKey,
      workflowStages: proposal.workflowStages,
      fitScore: proposal.fitScore,
      pendingActivationApprovalId:
        creationGate.outcome === "approval_required" ? creationGate.approval.id : null,
    },
  });

  const initialTasks: Array<CommercialTask> = [];
  let prevTaskId: CommercialTaskId | undefined;
  for (const [index, stage] of proposal.workflowStages.entries()) {
    const task = yield* deps.orchestrator.createTask({
      ventureId: venture.id,
      title: stage,
      description: `Dynamic workflow stage ${index + 1} for ${venture.name}.`,
      status: creationGate.outcome === "allowed" && prevTaskId === undefined ? "ready" : "queued",
      complexity: index === 0 ? "low" : "medium",
      priority: Math.max(40, 80 - index * 10),
      idempotencyKey: `dynamic-venture:${venture.id}:stage:${index}`,
      dependsOn: prevTaskId === undefined ? [] : [prevTaskId],
    });
    initialTasks.push(task);
    prevTaskId = task.id;
  }

  return {
    venture,
    initialTasks,
    creationGate,
  };
});
