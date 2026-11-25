import {
  type AiPermissionStatus,
  type CommercialTask,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type ObjectiveId,
  type Opportunity,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  type SovereignPersistenceError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface PaidTasksDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export type PaidTaskAutomationMode = "autonomous" | "ai_assisted" | "human_required";
export type PaidTaskQueueBucket = "automated" | "human_required" | "disqualified";

export interface OnlineWorkOfferInput {
  readonly externalId: string;
  readonly platform: string;
  readonly title: string;
  readonly description: string;
  readonly platformTosText?: string | null;
  readonly sourceUrl?: string | null;
  readonly rewardMinor: number;
  readonly currency?: CurrencyCode;
  readonly estimatedMinutes?: number;
  readonly requiresHumanExperience?: boolean;
  readonly requiresIdentityVerification?: boolean;
  readonly explicitAiPermission?: AiPermissionStatus;
  readonly structuredDeterministic?: boolean;
  readonly objectiveId?: ObjectiveId | null;
}

export interface ClassifyOnlineWorkResult {
  readonly opportunity: Opportunity;
  readonly automationMode: PaidTaskAutomationMode;
  readonly queueBucket: PaidTaskQueueBucket;
  readonly aiPermissionStatus: AiPermissionStatus;
  readonly queuedTask: CommercialTask | null;
  readonly guardReasons: ReadonlyArray<string>;
  readonly quarantined: boolean;
}

export interface PartitionedWorkQueues {
  readonly automatedQueue: ReadonlyArray<Opportunity>;
  readonly humanRequiredQueue: ReadonlyArray<Opportunity>;
  readonly disqualified: ReadonlyArray<Opportunity>;
}

const PROHIBITED_AI_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno\s+ai(?:-generated|-assisted)?\b/i,
  /\b(?:ai|llm|automated\s+tools?|bots?)\s+(?:are\s+)?(?:prohibited|forbidden|banned|not\s+allowed|strictly\s+disallowed)\b/i,
  /\bmust\s+be\s+completed\s+without\s+(?:ai|automation|bots)\b/i,
  /\bzero\s+automation\b/i,
];

const PERMITTED_AI_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:ai|automation|ai-assisted|api)\s+(?:is\s+|are\s+)?(?:permitted|allowed|welcome|accepted)\b/i,
  /\bautomated\s+submissions?\s+(?:allowed|permitted)\b/i,
];

const HUMAN_EXPERIENCE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpersonal\s+(?:experience|opinion|story|lived\s+experience)\b/i,
  /\bhuman\s+(?:evaluators?|participants?|testers?)\s+only\b/i,
  /\b(?:usability\s+test|think[\s-]aloud|speak\s+aloud|record\s+your\s+(?:screen|voice|face))\b/i,
  /\bsurvey\s+about\s+your\s+(?:life|habits|shopping|health)\b/i,
];

const IDENTITY_VERIFICATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:government|photo)\s+id\b/i,
  /\b(?:id|identity|kyc|biometric)\s+verification\b/i,
  /\b(?:selfie|liveness\s+check|prove\s+you\s+are\s+human|captcha)\b/i,
];

export const classifyAndIngestOnlineWork = Effect.fn(
  "VentureWorkflow.paidTasks.classifyAndIngestOnlineWork",
)(function* (
  deps: PaidTasksDeps,
  ventureId: VentureId,
  taskOffer: OnlineWorkOfferInput,
): Effect.fn.Return<ClassifyOnlineWorkResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }
  if (taskOffer.externalId.trim().length === 0) {
    return yield* new SovereignValidationError({
      field: "externalId",
      reason: "Online work offer requires a non-empty externalId.",
    });
  }
  if (!Number.isInteger(taskOffer.rewardMinor) || taskOffer.rewardMinor < 0) {
    return yield* new SovereignValidationError({
      field: "rewardMinor",
      reason: "Online work rewardMinor must be a non-negative integer.",
    });
  }

  const combinedUntrusted = `${taskOffer.title}\n${taskOffer.description}\n${taskOffer.platformTosText ?? ""}`;
  const sanitized = yield* deps.governance.sanitizeUntrustedContent({
    source: "paid_task_offer",
    rawText: combinedUntrusted,
    ventureId,
    actor: "paid_tasks_workflow",
  });

  const guardReasons: Array<string> = [];
  const requiresHumanExperience =
    taskOffer.requiresHumanExperience === true ||
    HUMAN_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(combinedUntrusted));
  if (requiresHumanExperience) {
    guardReasons.push(
      "Task requires genuine human personal experience or participation; anti-impersonation guard blocks AI automation.",
    );
  }

  const requiresIdentityVerification =
    taskOffer.requiresIdentityVerification === true ||
    IDENTITY_VERIFICATION_PATTERNS.some((pattern) => pattern.test(combinedUntrusted));
  if (requiresIdentityVerification) {
    guardReasons.push(
      "Task requires human identity verification or anti-bot checks; anti-impersonation guard blocks AI automation.",
    );
  }

  const tosProhibitsAi =
    taskOffer.explicitAiPermission === "prohibited" ||
    PROHIBITED_AI_PATTERNS.some((pattern) => pattern.test(combinedUntrusted));
  const tosPermitsAi =
    !tosProhibitsAi &&
    (taskOffer.explicitAiPermission === "permitted" ||
      PERMITTED_AI_PATTERNS.some((pattern) => pattern.test(combinedUntrusted)));

  const aiPermissionStatus: AiPermissionStatus = tosProhibitsAi
    ? "prohibited"
    : tosPermitsAi
      ? "permitted"
      : "unknown";
  if (tosProhibitsAi) {
    guardReasons.push("Platform terms of service prohibit AI or automated completion.");
  } else if (aiPermissionStatus === "unknown") {
    guardReasons.push(
      "Platform AI automation rules are unconfirmed; routed to human review rather than autonomous execution.",
    );
  }

  const canQueueAutomated =
    aiPermissionStatus === "permitted" &&
    !requiresHumanExperience &&
    !requiresIdentityVerification &&
    !sanitized.quarantined;

  let automationMode: PaidTaskAutomationMode;
  let queueBucket: PaidTaskQueueBucket;
  let persistedAutomationMode: Opportunity["automationMode"];
  let eligibilityStatus: Opportunity["eligibilityStatus"];
  let stage: Opportunity["stage"];

  if (tosProhibitsAi) {
    automationMode = "human_required";
    queueBucket = "disqualified";
    persistedAutomationMode = "manual";
    eligibilityStatus = "ineligible";
    stage = "disqualified";
  } else if (requiresHumanExperience || requiresIdentityVerification || !canQueueAutomated) {
    automationMode = "human_required";
    queueBucket = "human_required";
    persistedAutomationMode = "manual";
    eligibilityStatus = "needs_review";
    stage = "evaluating";
  } else {
    automationMode = taskOffer.structuredDeterministic === true ? "autonomous" : "ai_assisted";
    queueBucket = "automated";
    persistedAutomationMode =
      automationMode === "autonomous" ? "autonomous_within_policy" : "assisted";
    eligibilityStatus = "eligible";
    stage = "qualified";
  }

  const currency =
    taskOffer.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
  const effortHours = Math.max(0.25, (taskOffer.estimatedMinutes ?? 30) / 60);

  const opportunity = yield* deps.orchestrator.createOpportunity({
    ventureId,
    ...(taskOffer.objectiveId === undefined ? {} : { objectiveId: taskOffer.objectiveId }),
    title: `${taskOffer.title.trim()} (${taskOffer.platform})`,
    summary: sanitized.sanitizedText.slice(0, 500),
    source: taskOffer.platform,
    ...(taskOffer.sourceUrl === undefined ? {} : { sourceUrl: taskOffer.sourceUrl }),
    externalRef: taskOffer.externalId.trim(),
    stage,
    eligibilityStatus,
    eligibilityNotes:
      guardReasons.length > 0
        ? guardReasons.join(" ")
        : "Platform terms explicitly allow AI-assisted execution with zero identity impersonation.",
    automationMode: persistedAutomationMode,
    aiPermissionStatus,
    estimatedValueMinor: taskOffer.rewardMinor,
    currency,
    tags: ["paid_task", queueBucket, automationMode],
    metadata: {
      platform: taskOffer.platform,
      paidTaskAutomationMode: automationMode,
      queueBucket,
      requiresHumanExperience,
      requiresIdentityVerification,
      estimatedHours: effortHours,
      guardReasons,
      quarantined: sanitized.quarantined,
    },
  });

  // Strictly enforce anti-impersonation guard: never queue autonomous AI tasks for human_required/disqualified work.
  let queuedTask: CommercialTask | null = null;
  if (queueBucket === "automated") {
    queuedTask = yield* deps.orchestrator.createTask({
      ventureId,
      ...(taskOffer.objectiveId === undefined ? {} : { objectiveId: taskOffer.objectiveId }),
      opportunityId: opportunity.id,
      title: `Execute AI-permitted online work: ${taskOffer.title.trim()}`,
      description: `Complete bounded ${automationMode} deliverable for ${taskOffer.platform} and queue owner review before external submission.`,
      status: "ready",
      complexity: automationMode === "autonomous" ? "low" : "medium",
      priority: 70,
      idempotencyKey: `paid-task:${opportunity.id}`,
    });
  }

  return {
    opportunity,
    automationMode,
    queueBucket,
    aiPermissionStatus,
    queuedTask,
    guardReasons,
    quarantined: sanitized.quarantined,
  };
});

export const partitionWorkQueues = Effect.fn("VentureWorkflow.paidTasks.partitionWorkQueues")(
  function* (
    deps: PaidTasksDeps,
    ventureId: VentureId,
  ): Effect.fn.Return<PartitionedWorkQueues, SovereignPersistenceError> {
    const opportunities = yield* deps.store.listOpportunities({ ventureId });
    const automatedQueue: Array<Opportunity> = [];
    const humanRequiredQueue: Array<Opportunity> = [];
    const disqualified: Array<Opportunity> = [];

    for (const opportunity of opportunities) {
      const metadataBucket =
        typeof opportunity.metadata?.queueBucket === "string"
          ? opportunity.metadata.queueBucket
          : null;
      if (
        metadataBucket === "disqualified" ||
        opportunity.stage === "disqualified" ||
        opportunity.eligibilityStatus === "ineligible" ||
        opportunity.aiPermissionStatus === "prohibited"
      ) {
        disqualified.push(opportunity);
      } else if (
        metadataBucket === "automated" ||
        (metadataBucket !== "human_required" &&
          opportunity.aiPermissionStatus === "permitted" &&
          (opportunity.automationMode === "autonomous_within_policy" ||
            opportunity.automationMode === "assisted"))
      ) {
        automatedQueue.push(opportunity);
      } else {
        humanRequiredQueue.push(opportunity);
      }
    }

    return {
      automatedQueue,
      humanRequiredQueue,
      disqualified,
    };
  },
);
