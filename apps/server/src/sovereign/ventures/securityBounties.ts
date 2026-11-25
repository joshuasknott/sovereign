// @effect-diagnostics-next-line nodeBuiltinImport:off -- SHA-256 content checksum for persisted security evidence artifacts.
import * as NodeCrypto from "node:crypto";
import {
  type CommercialArtifact,
  type CommercialTask,
  type CommercialTaskId,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
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
  SovereignPermissionError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface SecurityBountiesDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface RegisterSecurityProgrammeInput {
  readonly externalId: string;
  readonly programmeName: string;
  readonly platform: string;
  readonly programmeUrl?: string | null;
  readonly policyText: string;
  readonly scopeTargets: ReadonlyArray<string>;
  readonly outOfScopeTargets?: ReadonlyArray<string>;
  readonly permittedMethods: ReadonlyArray<string>;
  readonly automationRestrictions?: ReadonlyArray<string>;
  readonly disclosureRequirements: string;
  readonly maxRewardMinor?: number | null;
  readonly currency?: CurrencyCode;
  readonly safeHarbour?: boolean;
  readonly objectiveId?: ObjectiveId | null;
}

export interface RegisterSecurityProgrammeResult {
  readonly opportunity: Opportunity;
  readonly quarantined: boolean;
  readonly scopeTargets: ReadonlyArray<string>;
  readonly permittedMethods: ReadonlyArray<string>;
}

export interface ExecuteSecurityAssessmentOptions {
  readonly opportunityId?: OpportunityId | null;
  readonly taskId?: CommercialTaskId | null;
  readonly notes?: string;
  readonly requestedBy?: string;
}

export interface ExecuteSecurityAssessmentResult {
  readonly status: "executed" | "approval_required";
  readonly gate: SovereignGovernanceService.GateExternalActionResult;
  readonly task: CommercialTask | null;
  readonly evidenceArtifact: CommercialArtifact | null;
}

const AUTOMATION_BAN_RE =
  /\b(?:no\s+automated\s+(?:scanning|scanners|tools)|automated\s+(?:scanning|scanners|testing)\s+(?:is\s+)?prohibited)\b/i;

const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

const sha256Json = (value: unknown): string => sha256Hex(encodeJsonUnknown(value));

export const registerSecurityProgramme = Effect.fn(
  "VentureWorkflow.securityBounties.registerSecurityProgramme",
)(function* (
  deps: SecurityBountiesDeps,
  ventureId: VentureId,
  programme: RegisterSecurityProgrammeInput,
): Effect.fn.Return<RegisterSecurityProgrammeResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }
  const scopeTargets = programme.scopeTargets
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
  const permittedMethods = programme.permittedMethods
    .map((method) => method.trim())
    .filter((method) => method.length > 0);

  if (scopeTargets.length === 0) {
    return yield* new SovereignValidationError({
      field: "scopeTargets",
      reason: "Security programme must specify at least one explicit in-scope target.",
    });
  }
  if (permittedMethods.length === 0) {
    return yield* new SovereignValidationError({
      field: "permittedMethods",
      reason: "Security programme must specify at least one permitted testing method.",
    });
  }

  const sanitizedPolicy = yield* deps.governance.sanitizeUntrustedContent({
    source: "security_programme_policy",
    rawText: `${programme.policyText}\n\n${programme.disclosureRequirements}`,
    ventureId,
    actor: "security_bounties_workflow",
  });

  const automationProhibited =
    AUTOMATION_BAN_RE.test(programme.policyText) ||
    (programme.automationRestrictions ?? []).some((rule) => AUTOMATION_BAN_RE.test(rule));
  const aiPermissionStatus: Opportunity["aiPermissionStatus"] = automationProhibited
    ? "prohibited"
    : "permitted";
  const eligibilityStatus: Opportunity["eligibilityStatus"] = automationProhibited
    ? "ineligible"
    : sanitizedPolicy.quarantined
      ? "needs_review"
      : "eligible";
  const currency =
    programme.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;

  const opportunity = yield* deps.orchestrator.createOpportunity({
    ventureId,
    ...(programme.objectiveId === undefined ? {} : { objectiveId: programme.objectiveId }),
    title: `${programme.programmeName} (${programme.platform})`,
    summary: sanitizedPolicy.sanitizedText.slice(0, 600),
    source: programme.platform,
    ...(programme.programmeUrl === undefined ? {} : { sourceUrl: programme.programmeUrl }),
    externalRef: programme.externalId.trim(),
    stage: automationProhibited ? "disqualified" : "qualified",
    eligibilityStatus,
    eligibilityNotes: automationProhibited
      ? "Programme prohibits automated testing tools."
      : `Authorised scope targets (${scopeTargets.length}) and permitted methods (${permittedMethods.length}) parsed; requires owner security authorisation before any testing.`,
    automationMode: "manual",
    aiPermissionStatus,
    estimatedValueMinor: programme.maxRewardMinor ?? null,
    currency,
    tags: ["security_programme", programme.platform.toLowerCase()],
    metadata: {
      programmeName: programme.programmeName,
      scopeTargets,
      outOfScopeTargets: programme.outOfScopeTargets ?? [],
      permittedMethods,
      automationRestrictions: programme.automationRestrictions ?? [],
      disclosureRequirements: programme.disclosureRequirements,
      safeHarbour: programme.safeHarbour ?? false,
      quarantined: sanitizedPolicy.quarantined,
    },
  });

  return {
    opportunity,
    quarantined: sanitizedPolicy.quarantined,
    scopeTargets,
    permittedMethods,
  };
});

export const executeAuthorisedSecurityAssessment = Effect.fn(
  "VentureWorkflow.securityBounties.executeAuthorisedSecurityAssessment",
)(function* (
  deps: SecurityBountiesDeps,
  ventureId: VentureId,
  target: string,
  method: string,
  options?: ExecuteSecurityAssessmentOptions,
): Effect.fn.Return<ExecuteSecurityAssessmentResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }
  const venture = ventureOpt.value;

  // Application-level lock independent of prompt instructions before delegating to governance.
  if (venture.permissionPolicy.securityAuthorisation.authorised !== true) {
    yield* deps.governance.recordAuditEvent({
      kind: "permission_denied",
      severity: "warning",
      ventureId,
      actor: options?.requestedBy ?? "security_bounties_workflow",
      summary: `Hard-denied security assessment against "${target}" because securityAuthorisation.authorised is false.`,
      category: "security_testing",
    });
    return yield* new SovereignPermissionError({
      code: "security_unauthorised",
      reason:
        "Security testing is locked at the application level until explicit owner authorisation is granted.",
      ventureId,
    });
  }

  const gate = yield* deps.governance.assertAndGateExternalAction({
    ventureId,
    ...(options?.taskId === undefined ? {} : { taskId: options.taskId }),
    category: "security_testing",
    title: `Authorised security assessment (${method}) on ${target}`,
    summary:
      options?.notes ??
      `Execute scope-bound ${method} assessment against authorised target ${target}.`,
    requestedAction: `security_assessment:${method}`,
    targetLabel: target,
    method,
    riskLevel: "critical",
    payload: {
      target,
      method,
      opportunityId: options?.opportunityId ?? null,
    },
    requestedBy: options?.requestedBy ?? "security_bounties_workflow",
  });

  if (gate.outcome === "approval_required") {
    return {
      status: "approval_required",
      gate,
      task: null,
      evidenceArtifact: null,
    };
  }

  const task = yield* deps.orchestrator.createTask({
    ventureId,
    ...(options?.opportunityId === undefined ? {} : { opportunityId: options.opportunityId }),
    title: `Security assessment (${method}): ${target}`,
    description:
      options?.notes ??
      `Scope-verified ${method} assessment executed against ${target} under programme "${venture.permissionPolicy.securityAuthorisation.programmeName ?? "authorised"}".`,
    status: "completed",
    complexity: "high",
    priority: 90,
  });

  const evidenceBody = {
    ventureId,
    programmeName: venture.permissionPolicy.securityAuthorisation.programmeName ?? null,
    target,
    method,
    notes: options?.notes ?? null,
    status: "scope_verified_and_recorded",
  };

  const evidenceArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    taskId: task.id,
    ...(options?.opportunityId === undefined ? {} : { opportunityId: options.opportunityId }),
    kind: "audit_bundle",
    title: `Security assessment evidence: ${target}`,
    summary: `Scope-bound ${method} evidence bundle recorded for ${target}.`,
    mimeType: "application/json",
    sha256: sha256Json(evidenceBody),
    metadata: {
      target,
      method,
      programmeName: venture.permissionPolicy.securityAuthorisation.programmeName ?? null,
    },
  });

  return {
    status: "executed",
    gate,
    task,
    evidenceArtifact,
  };
});
