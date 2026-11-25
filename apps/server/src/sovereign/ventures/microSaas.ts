// @effect-diagnostics-next-line nodeBuiltinImport:off -- SHA-256 content checksum for persisted commercial artifacts.
import * as NodeCrypto from "node:crypto";
import {
  type CommercialArtifact,
  type CommercialTask,
  type CommercialTaskId,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type FinancialPipelineMetrics,
  type ObjectiveId,
  type Opportunity,
  type OpportunityId,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignLedgerService from "../SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface MicroSaasDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly ledger: SovereignLedgerService.SovereignLedgerService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface MicroSaasProblemInput {
  readonly externalId: string;
  readonly title: string;
  readonly narrowProblemStatement: string;
  readonly targetCustomerSegment: string;
  readonly evidenceCount: number;
  readonly preCommitmentsCount: number;
  readonly proposedMonthlyPriceMinor: number;
  readonly estimatedUpfrontCostMinor: number;
  readonly estimatedMonthlyHostingCostMinor: number;
  readonly currency?: CurrencyCode;
  readonly objectiveId?: ObjectiveId | null;
}

export interface ValidateWillingnessToPayResult {
  readonly opportunity: Opportunity;
  readonly validationArtifact: CommercialArtifact;
  readonly validationPassed: boolean;
  readonly wtpScore: number;
  readonly rejectionReasons: ReadonlyArray<string>;
}

export interface MicroSaasLaunchSpec {
  readonly appName: string;
  readonly coreWorkflowSummary: string;
  readonly monthlyPlanPriceMinor: number;
  readonly currency?: CurrencyCode;
  readonly deploymentTarget: string;
  readonly acquisitionChannel: string;
}

export interface LaunchMicroSaasPipelineResult {
  readonly opportunity: Opportunity;
  readonly tasks: ReadonlyArray<CommercialTask>;
  readonly deploymentGate: SovereignGovernanceService.GateExternalActionResult;
  readonly billingGate: SovereignGovernanceService.GateExternalActionResult;
}

export type PortfolioHealthDecision = "keep" | "improve" | "reposition" | "pause" | "discontinue";

export interface ProductPortfolioHealthResult {
  readonly ventureId: VentureId;
  readonly decision: PortfolioHealthDecision;
  readonly metrics: FinancialPipelineMetrics;
  readonly openSupportTicketsCount: number;
  readonly activeCustomersCount: number;
  readonly rationale: string;
  readonly recommendedActions: ReadonlyArray<string>;
}

const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sha256Json = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(encodeJsonUnknown(value), "utf8").digest("hex");

export const validateWillingnessToPay = Effect.fn(
  "VentureWorkflow.microSaas.validateWillingnessToPay",
)(function* (
  deps: MicroSaasDeps,
  ventureId: VentureId,
  problem: MicroSaasProblemInput,
): Effect.fn.Return<ValidateWillingnessToPayResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }
  const venture = ventureOpt.value;

  const sanitized = yield* deps.governance.sanitizeUntrustedContent({
    source: "micro_saas_wtp_validation",
    rawText: `${problem.title}\n${problem.narrowProblemStatement}\n${problem.targetCustomerSegment}`,
    ventureId,
    actor: "micro_saas_workflow",
  });

  const rejectionReasons: Array<string> = [];
  if (problem.narrowProblemStatement.trim().length < 20) {
    rejectionReasons.push("Problem statement is too vague; define a narrow commercial pain point.");
  }
  if (problem.evidenceCount < 3) {
    rejectionReasons.push(
      `Only ${problem.evidenceCount} customer evidence point(s); requires at least 3 before building.`,
    );
  }
  if (problem.preCommitmentsCount < 1) {
    rejectionReasons.push(
      "Zero willingness-to-pay pre-commitments or paid pilot commitments recorded.",
    );
  }
  if (
    !Number.isInteger(problem.proposedMonthlyPriceMinor) ||
    problem.proposedMonthlyPriceMinor <= 0
  ) {
    rejectionReasons.push("Proposed monthly subscription price must be positive.");
  }
  if (problem.estimatedUpfrontCostMinor > venture.budgetPolicy.monthlyCapMinor) {
    rejectionReasons.push(
      `Estimated upfront cost (${problem.estimatedUpfrontCostMinor}) exceeds venture monthly cap (${venture.budgetPolicy.monthlyCapMinor}).`,
    );
  }
  if (sanitized.quarantined) {
    rejectionReasons.push("Validation text triggered prompt-injection quarantine.");
  }

  const evidenceScore = Math.min(30, Math.max(0, problem.evidenceCount) * 8);
  const wtpCommitmentScore = Math.min(35, Math.max(0, problem.preCommitmentsCount) * 18);
  const marginRatio =
    problem.proposedMonthlyPriceMinor > 0
      ? Math.max(
          0,
          (problem.proposedMonthlyPriceMinor * Math.max(1, problem.preCommitmentsCount) -
            problem.estimatedMonthlyHostingCostMinor) /
            (problem.proposedMonthlyPriceMinor * Math.max(1, problem.preCommitmentsCount)),
        )
      : 0;
  const economicsScore = Math.round(marginRatio * 20);
  const costDisciplineScore = problem.estimatedUpfrontCostMinor === 0 ? 15 : 6;
  const wtpScore = Math.min(
    100,
    evidenceScore + wtpCommitmentScore + economicsScore + costDisciplineScore,
  );

  if (wtpScore < 65) {
    rejectionReasons.push(`Willingness-to-pay score ${wtpScore}/100 is below 65/100 threshold.`);
  }

  const validationPassed = rejectionReasons.length === 0;
  const currency = problem.currency ?? venture.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
  const estimatedAnnualisedMinor =
    problem.proposedMonthlyPriceMinor * Math.max(1, problem.preCommitmentsCount) * 12;

  const opportunity = yield* deps.orchestrator.createOpportunity({
    ventureId,
    ...(problem.objectiveId === undefined ? {} : { objectiveId: problem.objectiveId }),
    title: problem.title.trim(),
    summary: problem.narrowProblemStatement.trim(),
    source: "micro_saas_wtp_validation",
    externalRef: problem.externalId.trim(),
    stage: validationPassed ? "qualified" : "evaluating",
    eligibilityStatus: validationPassed ? "eligible" : "needs_review",
    eligibilityNotes: validationPassed
      ? `WTP validated (${wtpScore}/100) with ${problem.evidenceCount} interviews and ${problem.preCommitmentsCount} commitment(s).`
      : rejectionReasons.join(" "),
    automationMode: "assisted",
    aiPermissionStatus: "permitted",
    estimatedValueMinor: estimatedAnnualisedMinor,
    currency,
    score: {
      overall: wtpScore,
      expectedValueMinor: validationPassed ? Math.round(estimatedAnnualisedMinor * 0.5) : 0,
      currency,
      winProbability: validationPassed ? 0.5 : 0.1,
      effortHoursEstimate: 24,
      complianceFit: 1,
      rationale: validationPassed
        ? `Validated narrow Micro-SaaS problem for ${problem.targetCustomerSegment}.`
        : rejectionReasons.join(" "),
    },
    tags: ["micro_saas", validationPassed ? "wtp_validated" : "unvalidated"],
    metadata: {
      targetCustomerSegment: problem.targetCustomerSegment,
      evidenceCount: problem.evidenceCount,
      preCommitmentsCount: problem.preCommitmentsCount,
      proposedMonthlyPriceMinor: problem.proposedMonthlyPriceMinor,
      estimatedUpfrontCostMinor: problem.estimatedUpfrontCostMinor,
      estimatedMonthlyHostingCostMinor: problem.estimatedMonthlyHostingCostMinor,
      wtpScore,
      wtpValidated: validationPassed,
      rejectionReasons,
    },
  });

  const validationArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    opportunityId: opportunity.id,
    kind: "research_brief",
    title: `WTP validation report: ${problem.title.trim()}`,
    summary: validationPassed
      ? `Validated willingness to pay (${wtpScore}/100) at ${problem.proposedMonthlyPriceMinor} ${currency} minor/month.`
      : `Rejected unvalidated Micro-SaaS concept (${wtpScore}/100): ${rejectionReasons.join(" ")}`,
    mimeType: "application/json",
    sha256: sha256Json({
      title: problem.title,
      wtpScore,
      validationPassed,
      rejectionReasons,
    }),
    metadata: {
      wtpScore,
      wtpValidated: validationPassed,
      rejectionReasons,
    },
  });

  return {
    opportunity,
    validationArtifact,
    validationPassed,
    wtpScore,
    rejectionReasons,
  };
});

export const launchMicroSaasPipeline = Effect.fn(
  "VentureWorkflow.microSaas.launchMicroSaasPipeline",
)(function* (
  deps: MicroSaasDeps,
  ventureId: VentureId,
  opportunityId: OpportunityId,
  spec: MicroSaasLaunchSpec,
): Effect.fn.Return<LaunchMicroSaasPipelineResult, SovereignDomainError> {
  const oppOpt = yield* deps.store.getOpportunity(opportunityId);
  if (Option.isNone(oppOpt) || oppOpt.value.ventureId !== ventureId) {
    return yield* new SovereignNotFoundError({ entity: "opportunity", id: opportunityId });
  }
  const opportunity = oppOpt.value;
  if (opportunity.metadata?.wtpValidated !== true) {
    return yield* new SovereignValidationError({
      field: "opportunityId",
      reason: "Cannot launch Micro-SaaS MVP pipeline before willingness-to-pay validation passes.",
    });
  }

  const currency = spec.currency ?? opportunity.currency;
  const pipelineSpecs: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly complexity: CommercialTask["complexity"];
  }> = [
    {
      key: "mvp_build",
      title: `Build focused MVP for ${spec.appName}`,
      description: `Implement minimal single-workflow MVP: ${spec.coreWorkflowSummary}`,
      complexity: "high",
    },
    {
      key: "billing_setup",
      title: `Configure recurring subscription billing for ${spec.appName}`,
      description: `Set up monthly subscription plan (${spec.monthlyPlanPriceMinor} ${currency} minor/month) and signed checkout webhook reconciliation.`,
      complexity: "medium",
    },
    {
      key: "production_deploy",
      title: `Deploy ${spec.appName} to ${spec.deploymentTarget}`,
      description:
        "Run smoke tests, configure monitoring, and deploy to production after owner approval.",
      complexity: "high",
    },
    {
      key: "customer_acquisition",
      title: `Execute targeted acquisition via ${spec.acquisitionChannel} for ${spec.appName}`,
      description:
        "Onboard pre-committed pilot users and run policy-compliant acquisition outreach.",
      complexity: "medium",
    },
  ];

  const tasks: Array<CommercialTask> = [];
  let prevTaskId: CommercialTaskId | undefined;
  for (const step of pipelineSpecs) {
    const task = yield* deps.orchestrator.createTask({
      ventureId,
      ...(opportunity.objectiveId === null ? {} : { objectiveId: opportunity.objectiveId }),
      opportunityId: opportunity.id,
      title: step.title,
      description: step.description,
      status: prevTaskId === undefined ? "ready" : "queued",
      complexity: step.complexity,
      priority: 80,
      idempotencyKey: `micro-saas:${opportunity.id}:${step.key}`,
      dependsOn: prevTaskId === undefined ? [] : [prevTaskId],
    });
    tasks.push(task);
    prevTaskId = task.id;
  }

  const billingTask = tasks[1]!;
  const deployTask = tasks[2]!;

  const billingGate = yield* deps.governance.assertAndGateExternalAction({
    ventureId,
    taskId: billingTask.id,
    category: "payment_processing",
    title: `Approve subscription billing setup for ${spec.appName}`,
    summary: `Owner approval required before activating live recurring plan (${spec.monthlyPlanPriceMinor} ${currency} minor/month).`,
    requestedAction: "configure_subscription_billing",
    targetLabel: spec.appName,
    riskLevel: "high",
    payload: {
      opportunityId: opportunity.id,
      monthlyPlanPriceMinor: spec.monthlyPlanPriceMinor,
      currency,
    },
    requestedBy: "micro_saas_workflow",
    idempotencyKey: `micro-saas-billing-gate:${opportunity.id}`,
  });

  const deploymentGate = yield* deps.governance.assertAndGateExternalAction({
    ventureId,
    taskId: deployTask.id,
    category: "production_deployment",
    title: `Approve production deployment of ${spec.appName} to ${spec.deploymentTarget}`,
    summary: `Owner approval required before deploying ${spec.appName} to live production target ${spec.deploymentTarget}.`,
    requestedAction: "deploy_micro_saas_production",
    targetLabel: spec.deploymentTarget,
    riskLevel: "critical",
    payload: {
      opportunityId: opportunity.id,
      appName: spec.appName,
      deploymentTarget: spec.deploymentTarget,
    },
    requestedBy: "micro_saas_workflow",
    idempotencyKey: `micro-saas-deploy-gate:${opportunity.id}`,
  });

  const updatedOpportunity = yield* deps.orchestrator.updateOpportunity({
    opportunityId: opportunity.id,
    stage: "in_progress",
  });

  return {
    opportunity: updatedOpportunity,
    tasks,
    deploymentGate,
    billingGate,
  };
});

export const evaluateProductPortfolioHealth = Effect.fn(
  "VentureWorkflow.microSaas.evaluateProductPortfolioHealth",
)(function* (
  deps: MicroSaasDeps,
  ventureId: VentureId,
): Effect.fn.Return<ProductPortfolioHealthResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }

  const [metrics, tickets, customers] = yield* Effect.all([
    deps.ledger.computeFinancialMetrics(ventureId),
    deps.store.listSupportTickets(ventureId),
    deps.store.listCustomers(ventureId),
  ]);

  const openSupportTicketsCount = tickets.filter(
    (ticket) =>
      ticket.status === "open" ||
      ticket.status === "pending_customer" ||
      ticket.status === "escalated",
  ).length;
  const activeCustomersCount = customers.filter((customer) => customer.status === "active").length;
  const supportLoadRatio =
    activeCustomersCount > 0
      ? openSupportTicketsCount / activeCustomersCount
      : openSupportTicketsCount;

  let decision: PortfolioHealthDecision;
  let rationale: string;
  let recommendedActions: ReadonlyArray<string>;

  if (
    metrics.monthlyRecurringRevenueMinor > 0 &&
    metrics.netProfitMinor > 0 &&
    supportLoadRatio <= 0.35
  ) {
    decision = "keep";
    rationale = `Profitable recurring product (${metrics.monthlyRecurringRevenueMinor} ${metrics.reportingCurrency} minor MRR, ${metrics.netProfitMinor} net profit) with manageable support load (${openSupportTicketsCount} open tickets).`;
    recommendedActions = [
      "Continue organic acquisition within zero-spend policy.",
      "Monitor churn and payment webhook reconciliation.",
    ];
  } else if (metrics.monthlyRecurringRevenueMinor > 0 && metrics.netProfitMinor >= 0) {
    decision = "improve";
    rationale = `Positive MRR (${metrics.monthlyRecurringRevenueMinor} minor) but elevated support load (${openSupportTicketsCount} open tickets) or thin net margin (${metrics.netProfitMinor} minor).`;
    recommendedActions = [
      "Resolve recurring customer support friction and automate self-serve onboarding.",
      "Audit hosting and inference costs to widen contribution margin.",
    ];
  } else if (metrics.monthlyRecurringRevenueMinor > 0 && metrics.netProfitMinor < 0) {
    decision = "reposition";
    rationale = `Active paying demand exists (${metrics.monthlyRecurringRevenueMinor} minor MRR), but expenses (${metrics.confirmedExpensesMinor} minor) exceed verified revenue.`;
    recommendedActions = [
      "Increase pricing tier or shift to higher-LTV customer segment.",
      "Reduce fixed hosting/vendor overhead before adding new features.",
    ];
  } else if (metrics.confirmedExpensesMinor >= 10_000 && activeCustomersCount === 0) {
    decision = "discontinue";
    rationale = `Zero verified MRR and zero active customers while incurring ${metrics.confirmedExpensesMinor} ${metrics.reportingCurrency} minor in confirmed expenses.`;
    recommendedActions = [
      "Wind down paid hosting infrastructure to stop recurring burn.",
      "Archive venture and reallocate provider capacity to higher-return ventures.",
    ];
  } else {
    decision = "pause";
    rationale = `No verified MRR recorded yet (${metrics.confirmedExpensesMinor} minor expenses); pause engineering expansion until willingness-to-pay converts.`;
    recommendedActions = [
      "Hold further build work and interview target segment on conversion blockers.",
      "Keep infrastructure on zero-cost tier while re-validating.",
    ];
  }

  return {
    ventureId,
    decision,
    metrics,
    openSupportTicketsCount,
    activeCustomersCount,
    rationale,
    recommendedActions,
  };
});
