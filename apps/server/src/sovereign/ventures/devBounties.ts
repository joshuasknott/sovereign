import {
  type CommercialTask,
  type CommercialTaskId,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type LedgerEntry,
  type ObjectiveId,
  type Opportunity,
  type OpportunityId,
  type OpportunityScore,
  type TaskComplexity,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignLedgerService from "../SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface DevBountiesDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly ledger: SovereignLedgerService.SovereignLedgerService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface RawBountyIssueInput {
  readonly externalId: string;
  readonly title: string;
  readonly body: string;
  readonly repositoryUrl?: string | null;
  readonly issueUrl?: string | null;
  readonly source?: string;
  readonly contributingPolicyText?: string | null;
  readonly rewardAmountMinor?: number | null;
  readonly currency?: CurrencyCode;
  readonly competingPrCount?: number;
  readonly difficulty?: TaskComplexity;
  readonly paymentProbability?: number;
  readonly estimatedEffortHours?: number;
  readonly labels?: ReadonlyArray<string>;
  readonly objectiveId?: ObjectiveId | null;
  readonly deadlineAt?: string | null;
}

export interface EvaluateBountyIssueResult {
  readonly opportunity: Opportunity;
  readonly sanitizedBody: string;
  readonly quarantined: boolean;
  readonly aiPermissionStatus: Opportunity["aiPermissionStatus"];
  readonly competingPrCount: number;
  readonly parsedRewardMinor: number | null;
  readonly currency: CurrencyCode;
  readonly score: OpportunityScore;
}

export interface PlanBountyExecutionResult {
  readonly opportunity: Opportunity;
  readonly tasks: ReadonlyArray<CommercialTask>;
  readonly submissionGate: SovereignGovernanceService.GateExternalActionResult;
}

export interface ReconcileBountyPayoutResult {
  readonly opportunity: Opportunity;
  readonly ledgerEntry: LedgerEntry;
}

const AI_PROHIBITED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno\s+ai(?:-generated|-assisted)?\s+(?:contributions?|prs?|pull\s+requests?|code|patches?)\b/i,
  /\bai(?:-generated|-assisted)?\s+(?:contributions?|prs?|pull\s+requests?|code|patches?)\s+(?:are\s+)?(?:not\s+allowed|prohibited|banned|forbidden|disallowed)\b/i,
  /\b(?:do\s+not|must\s+not|cannot)\s+(?:submit|use)\s+(?:ai|llm|automated)(?:-generated|-assisted)?\s+(?:code|prs?|pull\s+requests?|contributions?)\b/i,
  /\bhuman[- ]only\s+contributions?\b/i,
];

const AI_PERMITTED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bai(?:-assisted|-generated)?\s+(?:contributions?|prs?|pull\s+requests?|code)\s+(?:are\s+)?(?:allowed|permitted|welcome|accepted)\b/i,
  /\b(?:may|can)\s+use\s+ai(?:\s+tools?)?\s+(?:if|when|provided|with)\s+disclos/i,
  /\bdisclose\s+ai(?:-assisted)?\s+(?:usage|contributions?)\b/i,
];

const DIFFICULTY_MULTIPLIER: Readonly<Record<TaskComplexity, number>> = {
  trivial: 0.95,
  low: 0.88,
  medium: 0.72,
  high: 0.52,
  frontier: 0.35,
};

const DIFFICULTY_DEFAULT_HOURS: Readonly<Record<TaskComplexity, number>> = {
  trivial: 1,
  low: 2.5,
  medium: 6,
  high: 14,
  frontier: 28,
};

const parseRewardFromText = (
  text: string,
): { readonly amountMinor: number | null; readonly currency: CurrencyCode | null } => {
  const symbolMatch = text.match(/([£$€])\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (symbolMatch !== null) {
    const numeric = Number(symbolMatch[2]!.replace(/,/g, ""));
    if (Number.isFinite(numeric) && numeric >= 0) {
      const currency: CurrencyCode =
        symbolMatch[1] === "$" ? "USD" : symbolMatch[1] === "€" ? "EUR" : "GBP";
      return { amountMinor: Math.round(numeric * 100), currency };
    }
  }
  const codeMatch = text.match(/\b(GBP|USD|EUR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (codeMatch !== null) {
    const numeric = Number(codeMatch[2]!.replace(/,/g, ""));
    if (Number.isFinite(numeric) && numeric >= 0) {
      return { amountMinor: Math.round(numeric * 100), currency: codeMatch[1]!.toUpperCase() };
    }
  }
  return { amountMinor: null, currency: null };
};

const parseCompetingPrCount = (text: string): number => {
  const match = text.match(
    /\b(\d+)\s+(?:open|competing|linked|draft)\s+(?:prs?|pull\s+requests?)\b/i,
  );
  if (match === null) return 0;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const evaluateAiPolicy = (
  policyText: string,
  labels: ReadonlyArray<string>,
): {
  readonly status: Opportunity["aiPermissionStatus"];
  readonly note: string;
} => {
  const lowerLabels = labels.map((label) => label.trim().toLowerCase());
  if (
    lowerLabels.includes("no-ai") ||
    lowerLabels.includes("ai-prohibited") ||
    AI_PROHIBITED_PATTERNS.some((pattern) => pattern.test(policyText))
  ) {
    return {
      status: "prohibited",
      note: "Repository contribution policy explicitly prohibits AI-assisted contributions.",
    };
  }
  if (
    lowerLabels.includes("ai-ok") ||
    lowerLabels.includes("ai-permitted") ||
    AI_PERMITTED_PATTERNS.some((pattern) => pattern.test(policyText))
  ) {
    return {
      status: "permitted",
      note: "Repository contribution policy permits AI-assisted contributions within guidelines.",
    };
  }
  return {
    status: "unknown",
    note: "Repository contribution policy does not explicitly state AI rules; owner review required.",
  };
};

const computeBountyScore = (input: {
  readonly rewardMinor: number | null;
  readonly currency: CurrencyCode;
  readonly aiPermissionStatus: Opportunity["aiPermissionStatus"];
  readonly paymentProbability: number;
  readonly competingPrCount: number;
  readonly difficulty: TaskComplexity;
  readonly effortHours: number;
}): OpportunityScore => {
  if (input.aiPermissionStatus === "prohibited") {
    return {
      overall: 0,
      expectedValueMinor: 0,
      currency: input.currency,
      winProbability: 0,
      effortHoursEstimate: input.effortHours,
      complianceFit: 0,
      rationale: "Disqualified automatically because repository policy prohibits AI contributions.",
    };
  }

  const complianceFit = input.aiPermissionStatus === "permitted" ? 1 : 0.65;
  const clampedPayProb = Math.min(1, Math.max(0.05, input.paymentProbability));
  const competitionPenalty = 1 / (1 + Math.max(0, input.competingPrCount) * 0.55);
  const difficultyFactor = DIFFICULTY_MULTIPLIER[input.difficulty];
  const winProbability =
    Math.round(
      Math.min(1, Math.max(0, clampedPayProb * competitionPenalty * difficultyFactor)) * 100,
    ) / 100;
  const expectedValueMinor =
    input.rewardMinor === null ? null : Math.round(input.rewardMinor * winProbability);
  const hourlyExpectedMinor =
    expectedValueMinor !== null && input.effortHours > 0
      ? expectedValueMinor / input.effortHours
      : 0;

  const valueComponent = Math.min(
    55,
    Math.round((Math.log10(Math.max(1, hourlyExpectedMinor) + 1) / 4.8) * 55),
  );
  const complianceComponent = Math.round(complianceFit * 30);
  const competitionComponent = Math.round(competitionPenalty * 15);
  const overall = Math.min(
    100,
    Math.max(0, valueComponent + complianceComponent + competitionComponent),
  );

  return {
    overall,
    expectedValueMinor,
    currency: input.currency,
    winProbability,
    effortHoursEstimate: input.effortHours,
    complianceFit,
    rationale: `Reward probability ${Math.round(clampedPayProb * 100)}%, competition penalty ${Math.round(competitionPenalty * 100)}% (${input.competingPrCount} competing PRs), difficulty ${input.difficulty}, compliance fit ${Math.round(complianceFit * 100)}%.`,
  };
};

export const evaluateBountyIssue = Effect.fn("VentureWorkflow.devBounties.evaluateBountyIssue")(
  function* (
    deps: DevBountiesDeps,
    ventureId: VentureId,
    rawIssue: RawBountyIssueInput,
  ): Effect.fn.Return<EvaluateBountyIssueResult, SovereignDomainError> {
    const ventureOpt = yield* deps.store.getVenture(ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
    }
    if (rawIssue.externalId.trim().length === 0) {
      return yield* new SovereignValidationError({
        field: "externalId",
        reason: "Bounty issue externalId must be non-empty for deduplication.",
      });
    }

    const sanitizedIssue = yield* deps.governance.sanitizeUntrustedContent({
      source: "dev_bounty_issue",
      rawText: `${rawIssue.title}\n\n${rawIssue.body}`,
      ventureId,
      actor: "dev_bounties_workflow",
    });

    const sanitizedPolicy =
      rawIssue.contributingPolicyText !== undefined &&
      rawIssue.contributingPolicyText !== null &&
      rawIssue.contributingPolicyText.trim().length > 0
        ? yield* deps.governance.sanitizeUntrustedContent({
            source: "dev_bounty_contributing_policy",
            rawText: rawIssue.contributingPolicyText,
            ventureId,
            actor: "dev_bounties_workflow",
          })
        : null;

    const parsed = parseRewardFromText(`${rawIssue.title} ${rawIssue.body}`);
    const parsedRewardMinor =
      rawIssue.rewardAmountMinor !== undefined ? rawIssue.rewardAmountMinor : parsed.amountMinor;
    const currency =
      rawIssue.currency ??
      parsed.currency ??
      ventureOpt.value.budgetPolicy.currency ??
      DEFAULT_REPORTING_CURRENCY;

    const combinedPolicySource = `${rawIssue.contributingPolicyText ?? ""}\n${rawIssue.body}`;
    const policyEval = evaluateAiPolicy(combinedPolicySource, rawIssue.labels ?? []);
    const competingPrCount = rawIssue.competingPrCount ?? parseCompetingPrCount(rawIssue.body);
    const difficulty: TaskComplexity = rawIssue.difficulty ?? "medium";
    const effortHours = rawIssue.estimatedEffortHours ?? DIFFICULTY_DEFAULT_HOURS[difficulty];
    const paymentProbability =
      rawIssue.paymentProbability ?? (parsedRewardMinor !== null ? 0.85 : 0.55);

    const score = computeBountyScore({
      rewardMinor: parsedRewardMinor,
      currency,
      aiPermissionStatus: policyEval.status,
      paymentProbability,
      competingPrCount,
      difficulty,
      effortHours,
    });

    const quarantined = sanitizedIssue.quarantined || (sanitizedPolicy?.quarantined ?? false);
    const eligibilityStatus: Opportunity["eligibilityStatus"] =
      policyEval.status === "prohibited"
        ? "ineligible"
        : policyEval.status === "permitted" && !quarantined
          ? "eligible"
          : "needs_review";
    const stage: Opportunity["stage"] =
      policyEval.status === "prohibited"
        ? "disqualified"
        : eligibilityStatus === "eligible" && score.overall >= 55
          ? "qualified"
          : "evaluating";
    const automationMode: Opportunity["automationMode"] =
      policyEval.status === "prohibited" ? "manual" : "assisted";

    const opportunity = yield* deps.orchestrator.createOpportunity({
      ventureId,
      ...(rawIssue.objectiveId === undefined ? {} : { objectiveId: rawIssue.objectiveId }),
      title: rawIssue.title.trim(),
      summary: sanitizedIssue.sanitizedText.slice(0, 600),
      source: rawIssue.source ?? "github_bounties",
      ...(rawIssue.issueUrl === undefined ? {} : { sourceUrl: rawIssue.issueUrl }),
      externalRef: rawIssue.externalId.trim(),
      stage,
      eligibilityStatus,
      eligibilityNotes: quarantined
        ? `${policyEval.note} Untrusted issue text triggered prompt-injection quarantine.`
        : policyEval.note,
      automationMode,
      aiPermissionStatus: policyEval.status,
      estimatedValueMinor: parsedRewardMinor,
      currency,
      score,
      tags: ["dev_bounty", difficulty, ...(rawIssue.labels ?? [])],
      ...(rawIssue.deadlineAt === undefined ? {} : { deadlineAt: rawIssue.deadlineAt }),
      metadata: {
        repositoryUrl: rawIssue.repositoryUrl ?? null,
        competingPrCount,
        difficulty,
        paymentProbability,
        quarantined,
        policyMatched: policyEval.status,
      },
    });

    return {
      opportunity,
      sanitizedBody: sanitizedIssue.sanitizedText,
      quarantined,
      aiPermissionStatus: policyEval.status,
      competingPrCount,
      parsedRewardMinor,
      currency,
      score,
    };
  },
);

export const planBountyExecution = Effect.fn("VentureWorkflow.devBounties.planBountyExecution")(
  function* (
    deps: DevBountiesDeps,
    ventureId: VentureId,
    opportunityId: OpportunityId,
  ): Effect.fn.Return<PlanBountyExecutionResult, SovereignDomainError> {
    const oppOpt = yield* deps.store.getOpportunity(opportunityId);
    if (Option.isNone(oppOpt) || oppOpt.value.ventureId !== ventureId) {
      return yield* new SovereignNotFoundError({ entity: "opportunity", id: opportunityId });
    }
    const existing = oppOpt.value;
    if (
      existing.aiPermissionStatus === "prohibited" ||
      existing.eligibilityStatus === "ineligible" ||
      existing.stage === "disqualified"
    ) {
      return yield* new SovereignValidationError({
        field: "opportunityId",
        reason: "Cannot plan execution for a disqualified or AI-prohibited bounty opportunity.",
      });
    }

    const stepSpecs: ReadonlyArray<{
      readonly key: string;
      readonly title: string;
      readonly description: string;
      readonly complexity: TaskComplexity;
      readonly priority: number;
    }> = [
      {
        key: "analysis",
        title: `Isolated worktree and codebase analysis: ${existing.title}`,
        description:
          "Inspect repository architecture, reproduction steps, and contribution guidelines in an isolated git worktree.",
        complexity: "medium",
        priority: 85,
      },
      {
        key: "implementation",
        title: `Implement patch and run test suite: ${existing.title}`,
        description:
          "Author minimal verified patch addressing issue acceptance criteria and run full targeted test suite.",
        complexity: "high",
        priority: 80,
      },
      {
        key: "review",
        title: `Independent diff review and policy check: ${existing.title}`,
        description:
          "Verify zero unintended changes, clean lint/typecheck output, and compliance with repository contribution rules.",
        complexity: "medium",
        priority: 75,
      },
      {
        key: "pr_submission",
        title: `Prepare and submit compliant pull request: ${existing.title}`,
        description:
          "Draft clear pull request description with verification evidence and wait for owner approval before external submission.",
        complexity: "medium",
        priority: 70,
      },
    ];

    const tasks: Array<CommercialTask> = [];
    let previousTaskId: CommercialTaskId | undefined;
    for (const step of stepSpecs) {
      const task = yield* deps.orchestrator.createTask({
        ventureId,
        ...(existing.objectiveId === null ? {} : { objectiveId: existing.objectiveId }),
        opportunityId: existing.id,
        title: step.title,
        description: step.description,
        status: previousTaskId === undefined ? "ready" : "queued",
        complexity: step.complexity,
        priority: step.priority,
        idempotencyKey: `bounty:${existing.id}:${step.key}`,
        dependsOn: previousTaskId === undefined ? [] : [previousTaskId],
      });
      tasks.push(task);
      previousTaskId = task.id;
    }

    const prTask = tasks[tasks.length - 1]!;
    const submissionGate = yield* deps.governance.assertAndGateExternalAction({
      ventureId,
      ...(existing.objectiveId === null ? {} : { objectiveId: existing.objectiveId }),
      taskId: prTask.id,
      category: "external_submission",
      title: `Submit bounty PR: ${existing.title}`,
      summary: `Gate external pull request submission for bounty ${existing.externalRef ?? existing.id} after local verification and review.`,
      requestedAction: "submit_bounty_pull_request",
      targetLabel: existing.sourceUrl ?? existing.externalRef ?? existing.title,
      riskLevel: "medium",
      payload: {
        opportunityId: existing.id,
        externalRef: existing.externalRef,
        aiPermissionStatus: existing.aiPermissionStatus,
      },
      requestedBy: "dev_bounties_workflow",
      idempotencyKey: `bounty-pr-gate:${existing.id}`,
    });

    const updatedOpportunity = yield* deps.orchestrator.updateOpportunity({
      opportunityId: existing.id,
      stage: "in_progress",
    });

    return {
      opportunity: updatedOpportunity,
      tasks,
      submissionGate,
    };
  },
);

export const reconcileBountyPayout = Effect.fn("VentureWorkflow.devBounties.reconcileBountyPayout")(
  function* (
    deps: DevBountiesDeps,
    ventureId: VentureId,
    opportunityId: OpportunityId,
    amountMinor: number,
    currency: CurrencyCode,
    externalRef: string,
  ): Effect.fn.Return<ReconcileBountyPayoutResult, SovereignDomainError> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return yield* new SovereignValidationError({
        field: "amountMinor",
        reason: "Verified bounty payout amountMinor must be a positive integer.",
      });
    }
    if (externalRef.trim().length === 0) {
      return yield* new SovereignValidationError({
        field: "externalRef",
        reason: "Verified bounty payout requires a non-empty externalRef for reconciliation.",
      });
    }
    const oppOpt = yield* deps.store.getOpportunity(opportunityId);
    if (Option.isNone(oppOpt) || oppOpt.value.ventureId !== ventureId) {
      return yield* new SovereignNotFoundError({ entity: "opportunity", id: opportunityId });
    }

    const ledgerEntry = yield* deps.ledger.recordEntry(
      {
        ventureId,
        entryType: "collected_revenue",
        verificationState: "verified",
        amountMinor,
        currency,
        description: `Verified bounty payout for ${oppOpt.value.title}`,
        externalRef: externalRef.trim(),
      },
      { recordedBy: "dev_bounties_workflow" },
    );

    const opportunity = yield* deps.orchestrator.updateOpportunity({
      opportunityId,
      stage: "won",
    });

    return { opportunity, ledgerEntry };
  },
);
