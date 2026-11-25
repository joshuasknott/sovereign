import {
  type ApprovalDecisionInput,
  type ApprovalRequest,
  ApprovalRequestId,
  type ApprovalRiskLevel,
  type ApprovalStatus,
  type AuditEvent,
  AuditEventId,
  type AuditEventKind,
  type AuditEventSeverity,
  type CommercialTaskId,
  type CreateApprovalRequestInput,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  DEFAULT_VENTURE_ACTION_MODES,
  type DeletePreapprovalPolicyInput,
  type ExternalActionCategory,
  type FxRatesToGbp,
  type GlobalControlState,
  type IntegrationId,
  type ObjectiveId,
  type PreapprovalPolicy,
  PreapprovalPolicyId,
  type ProviderInstanceId,
  type SovereignMetadata,
  type TriggerEmergencyStopInput,
  type UpdateGlobalControlStateInput,
  type UpsertPreapprovalPolicyInput,
  type VentureId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  SovereignConflictError,
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignPermissionError,
  type SovereignPersistenceError,
  SovereignValidationError,
} from "./SovereignErrors.ts";
import * as SovereignStore from "./SovereignStore.ts";

export interface GateExternalActionInput {
  readonly ventureId?: VentureId | null;
  readonly objectiveId?: ObjectiveId | null;
  readonly taskId?: CommercialTaskId | null;
  readonly category: ExternalActionCategory;
  readonly title: string;
  readonly summary: string;
  readonly requestedAction: string;
  readonly targetLabel?: string | null;
  readonly method?: string | null;
  readonly channel?: string | null;
  readonly estimatedCostMinor?: number | null;
  readonly currency?: CurrencyCode | null;
  readonly discountPct?: number | null;
  readonly riskLevel?: ApprovalRiskLevel;
  readonly payload?: SovereignMetadata;
  readonly requestedBy?: string;
  readonly idempotencyKey?: string | null;
}

export type GateExternalActionResult =
  | {
      readonly outcome: "allowed";
      readonly preapprovalPolicyId: PreapprovalPolicyId | null;
    }
  | {
      readonly outcome: "approval_required";
      readonly approval: ApprovalRequest;
    };

export interface SanitizeUntrustedContentInput {
  readonly source: string;
  readonly rawText: string;
  readonly ventureId?: VentureId | null;
  readonly actor?: string;
}

export interface SanitizeUntrustedContentResult {
  readonly quarantined: boolean;
  readonly matchedPatterns: ReadonlyArray<string>;
  readonly sanitizedText: string;
}

export interface AppendAuditInput {
  readonly kind: AuditEventKind;
  readonly severity: AuditEventSeverity;
  readonly ventureId?: VentureId | null;
  readonly actor: string;
  readonly summary: string;
  readonly category?: ExternalActionCategory | null;
  readonly approvalId?: ApprovalRequestId | null;
  readonly taskId?: CommercialTaskId | null;
  readonly providerInstanceId?: ProviderInstanceId | null;
  readonly integrationId?: IntegrationId | null;
  readonly metadata?: SovereignMetadata;
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

const extractTargetHost = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return trimmed;
    }
  }
  const slashIndex = trimmed.indexOf("/");
  return slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex);
};

const matchesScopeTarget = (target: string, allowedScopes: ReadonlyArray<string>): boolean => {
  const normalizedTarget = target.trim().toLowerCase();
  if (normalizedTarget.length === 0) return false;
  const targetHost = extractTargetHost(normalizedTarget);
  for (const rawScope of allowedScopes) {
    const scope = rawScope.trim().toLowerCase();
    if (scope.length === 0) continue;
    if (normalizedTarget === scope || targetHost === scope) return true;
    if (scope.startsWith("*.")) {
      const suffix = scope.slice(1);
      if (targetHost.endsWith(suffix) && targetHost.length > suffix.length) return true;
    }
    if (scope.includes("://") && normalizedTarget.startsWith(scope)) return true;
  }
  return false;
};

const convertMinorToGbp = (
  amountMinor: number,
  currency: CurrencyCode,
  fxRatesToGbp: FxRatesToGbp,
): Effect.Effect<number, SovereignValidationError> => {
  if (currency === DEFAULT_REPORTING_CURRENCY) return Effect.succeed(amountMinor);
  const rate = fxRatesToGbp[currency];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    return Effect.fail(
      new SovereignValidationError({
        field: "currency",
        reason: `No FX rate to GBP is configured for ${currency}.`,
      }),
    );
  }
  return Effect.succeed(Math.round(amountMinor * rate));
};

const startOfCurrentUtcMonthIso = (nowIso: string): string =>
  `${nowIso.slice(0, 7)}-01T00:00:00.000Z`;

const defaultRiskLevelForCategory = (category: ExternalActionCategory): ApprovalRiskLevel => {
  switch (category) {
    case "security_testing":
    case "production_deployment":
    case "account_modification":
      return "critical";
    case "financial_expenditure":
    case "payment_processing":
    case "contractual_commitment":
    case "refund":
    case "paid_provider_fallback":
      return "high";
    case "customer_communication":
    case "marketing_campaign":
    case "external_submission":
    case "personal_data":
    case "new_venture_creation":
      return "medium";
  }
};

export class SovereignGovernanceService extends Context.Service<
  SovereignGovernanceService,
  {
    readonly getControlState: Effect.Effect<GlobalControlState, SovereignPersistenceError>;
    readonly updateControlState: (
      input: UpdateGlobalControlStateInput,
    ) => Effect.Effect<GlobalControlState, SovereignDomainError>;
    readonly triggerEmergencyStop: (
      input: TriggerEmergencyStopInput,
    ) => Effect.Effect<GlobalControlState, SovereignDomainError>;
    readonly assertAndGateExternalAction: (
      input: GateExternalActionInput,
    ) => Effect.Effect<GateExternalActionResult, SovereignDomainError>;
    readonly sanitizeUntrustedContent: (
      input: SanitizeUntrustedContentInput,
    ) => Effect.Effect<SanitizeUntrustedContentResult, SovereignPersistenceError>;
    readonly requestApproval: (
      input: CreateApprovalRequestInput & { readonly idempotencyKey?: string | null },
    ) => Effect.Effect<ApprovalRequest, SovereignDomainError>;
    readonly decideApproval: (
      input: ApprovalDecisionInput,
      decidedBy?: string,
    ) => Effect.Effect<ApprovalRequest, SovereignDomainError>;
    readonly listApprovals: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly status?: ApprovalStatus;
    }) => Effect.Effect<
      {
        readonly approvals: ReadonlyArray<ApprovalRequest>;
        readonly preapprovalPolicies: ReadonlyArray<PreapprovalPolicy>;
      },
      SovereignPersistenceError
    >;
    readonly upsertPreapprovalPolicy: (
      input: UpsertPreapprovalPolicyInput,
      createdBy?: string,
    ) => Effect.Effect<PreapprovalPolicy, SovereignDomainError>;
    readonly deletePreapprovalPolicy: (
      input: DeletePreapprovalPolicyInput,
    ) => Effect.Effect<{ readonly deleted: boolean }, SovereignPersistenceError>;
    readonly listAuditEvents: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly kind?: AuditEventKind;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<AuditEvent>, SovereignPersistenceError>;
    readonly recordAuditEvent: (
      input: AppendAuditInput,
    ) => Effect.Effect<AuditEvent, SovereignPersistenceError>;
  }
>()("t3/sovereign/SovereignGovernanceService") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const random = yield* SecureRandom.SecureRandom;

  const generateId = <Id extends string>(prefix: string, makeId: (value: string) => Id) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.map((uuid) => makeId(`${prefix}_${uuid.replace(/-/g, "")}`)),
    );

  const recordAuditEvent = Effect.fn("SovereignGovernanceService.recordAuditEvent")(function* (
    input: AppendAuditInput,
  ) {
    const now = yield* store.nowIso;
    const event: AuditEvent = {
      id: yield* generateId("aud", AuditEventId.make),
      kind: input.kind,
      severity: input.severity,
      ventureId: input.ventureId ?? null,
      actor: input.actor,
      summary: input.summary,
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.providerInstanceId === undefined
        ? {}
        : { providerInstanceId: input.providerInstanceId }),
      ...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      createdAt: now,
    };
    yield* store.appendAuditEvent(event);
    yield* store.publishEvent({ type: "auditEventAppended", payload: event });
    return event;
  });

  const getControlState = Effect.fn("SovereignGovernanceService.getControlState")(function* () {
    const { controlState } = yield* store.getControlState;
    return controlState;
  });

  const updateControlState = Effect.fn("SovereignGovernanceService.updateControlState")(function* (
    input: UpdateGlobalControlStateInput,
  ) {
    const { controlState: current } = yield* store.getControlState;
    const now = yield* store.nowIso;
    const emergencyStopActive = input.emergencyStopActive ?? current.emergencyStopActive;
    const next: GlobalControlState = {
      emergencyStopActive,
      emergencyStopReason:
        input.emergencyStopReason !== undefined
          ? input.emergencyStopReason
          : emergencyStopActive
            ? current.emergencyStopReason
            : null,
      emergencyStopAt:
        emergencyStopActive && !current.emergencyStopActive
          ? now
          : emergencyStopActive
            ? current.emergencyStopAt
            : null,
      reportingCurrency: input.reportingCurrency ?? current.reportingCurrency,
      globalMonthlyBudgetMinor: input.globalMonthlyBudgetMinor ?? current.globalMonthlyBudgetMinor,
      defaultPaidFallbackMode: input.defaultPaidFallbackMode ?? current.defaultPaidFallbackMode,
      promptInjectionGuardEnabled:
        input.promptInjectionGuardEnabled ?? current.promptInjectionGuardEnabled,
      fxRatesToGbp: input.fxRatesToGbp ?? current.fxRatesToGbp,
      updatedAt: now,
    };

    const pausedTasks = yield* store.withTransaction(
      Effect.gen(function* () {
        yield* store.saveControlState(next);
        if (emergencyStopActive && !current.emergencyStopActive) {
          return yield* store.pauseActiveTasksForEmergencyStop(
            next.emergencyStopReason ?? "Global emergency stop active",
            now,
          );
        }
        return [];
      }),
    );

    if (emergencyStopActive !== current.emergencyStopActive) {
      yield* recordAuditEvent({
        kind: "emergency_stop",
        severity: emergencyStopActive ? "critical" : "info",
        actor: "owner",
        summary: emergencyStopActive
          ? `Global emergency stop activated${next.emergencyStopReason ? `: ${next.emergencyStopReason}` : "."}`
          : "Global emergency stop cleared.",
        metadata: {
          active: emergencyStopActive,
          pausedTasksCount: pausedTasks.length,
        },
      });
    }

    yield* store.publishEvent({ type: "controlStateUpdated", payload: next });
    for (const task of pausedTasks) {
      yield* store.publishEvent({ type: "taskUpdated", payload: task });
    }
    return next;
  });

  const triggerEmergencyStop = Effect.fn("SovereignGovernanceService.triggerEmergencyStop")(
    function* (input: TriggerEmergencyStopInput) {
      return yield* updateControlState({
        emergencyStopActive: input.active,
        emergencyStopReason: input.active
          ? (input.reason ?? "Owner triggered emergency stop")
          : null,
      });
    },
  );

  const requestApproval = Effect.fn("SovereignGovernanceService.requestApproval")(function* (
    input: CreateApprovalRequestInput & { readonly idempotencyKey?: string | null },
  ) {
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
      const existing = yield* store.findApprovalByIdempotencyKey(input.idempotencyKey);
      if (Option.isSome(existing)) {
        return existing.value;
      }
    }

    const now = yield* store.nowIso;
    const approval: ApprovalRequest = {
      id: yield* generateId("apr", ApprovalRequestId.make),
      ventureId: input.ventureId ?? null,
      ...(input.objectiveId === undefined ? {} : { objectiveId: input.objectiveId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      category: input.category,
      status: "pending",
      riskLevel: input.riskLevel ?? defaultRiskLevelForCategory(input.category),
      title: input.title,
      summary: input.summary,
      requestedAction: input.requestedAction,
      ...(input.targetLabel === undefined ? {} : { targetLabel: input.targetLabel }),
      ...(input.estimatedCostMinor === undefined
        ? {}
        : { estimatedCostMinor: input.estimatedCostMinor }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      requestedBy: input.requestedBy ?? "sovereign",
      requestedAt: now,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };

    const pausedTask = yield* store.withTransaction(
      Effect.gen(function* () {
        yield* store.insertApproval(approval, input.idempotencyKey ?? null);
        if (input.taskId !== undefined && input.taskId !== null) {
          const existingTask = yield* store.getTask(input.taskId);
          if (Option.isSome(existingTask)) {
            const updatedRecord: SovereignStore.PersistedTaskRecord = {
              ...existingTask.value,
              task: {
                ...existingTask.value.task,
                status: "waiting_approval",
                pendingApprovalId: approval.id,
                blockedReason: `Awaiting owner approval: ${approval.title}`,
                updatedAt: now,
              },
            };
            yield* store.updateTask(updatedRecord);
            return updatedRecord.task;
          }
        }
        return undefined;
      }),
    );

    yield* recordAuditEvent({
      kind: "approval_requested",
      severity: approval.riskLevel === "critical" ? "warning" : "info",
      ventureId: approval.ventureId,
      actor: approval.requestedBy,
      summary: `Approval requested for ${approval.category}: ${approval.title}`,
      category: approval.category,
      approvalId: approval.id,
      ...(approval.taskId === undefined ? {} : { taskId: approval.taskId }),
    });
    yield* store.publishEvent({ type: "approvalUpdated", payload: approval });
    if (pausedTask !== undefined) {
      yield* store.publishEvent({ type: "taskUpdated", payload: pausedTask });
    }
    return approval;
  });

  const decideApproval = Effect.fn("SovereignGovernanceService.decideApproval")(function* (
    input: ApprovalDecisionInput,
    decidedBy = "owner",
  ) {
    const existingOpt = yield* store.getApproval(input.approvalId);
    if (Option.isNone(existingOpt)) {
      return yield* new SovereignNotFoundError({ entity: "approval", id: input.approvalId });
    }
    const existing = existingOpt.value;
    if (existing.status !== "pending") {
      return yield* new SovereignConflictError({
        entity: "approval",
        id: existing.id,
        reason: `Approval is already ${existing.status}.`,
      });
    }

    const { controlState } = yield* store.getControlState;
    if (input.decision === "approve" && controlState.emergencyStopActive) {
      return yield* new SovereignPermissionError({
        code: "emergency_stop_active",
        reason: "Cannot approve action while global emergency stop is active.",
        ...(existing.ventureId === null ? {} : { ventureId: existing.ventureId }),
        approvalId: existing.id,
      });
    }

    const now = yield* store.nowIso;
    const nextStatus: ApprovalStatus = input.decision === "approve" ? "approved" : "rejected";
    let createdPolicyId: PreapprovalPolicyId | undefined;

    const { updatedApproval, updatedTask } = yield* store.withTransaction(
      Effect.gen(function* () {
        if (input.decision === "approve" && input.createPreapproval === true) {
          createdPolicyId = yield* generateId("pap", PreapprovalPolicyId.make);
          const policy: PreapprovalPolicy = {
            id: createdPolicyId,
            ventureId: existing.ventureId,
            category: existing.category,
            label: `Preapproval from ${existing.title}`,
            enabled: true,
            maxSingleActionMinor: input.preapprovalCapMinor ?? existing.estimatedCostMinor ?? null,
            maxMonthlyAggregateMinor: input.preapprovalCapMinor ?? null,
            currency: existing.currency ?? controlState.reportingCurrency,
            allowedTargets:
              existing.targetLabel !== undefined && existing.targetLabel !== null
                ? [existing.targetLabel]
                : [],
            expiresAt: input.preapprovalExpiresAt ?? null,
            createdBy: decidedBy,
            createdAt: now,
            updatedAt: now,
          };
          yield* store.upsertPreapprovalPolicy(policy);
        }

        const nextApproval: ApprovalRequest = {
          ...existing,
          status: nextStatus,
          decidedBy,
          decidedAt: now,
          ...(input.note === undefined ? {} : { decisionNote: input.note }),
          ...(createdPolicyId === undefined ? {} : { preapprovalPolicyId: createdPolicyId }),
        };
        yield* store.updateApproval(nextApproval);

        let resumedTask: SovereignStore.PersistedTaskRecord["task"] | undefined;
        if (existing.taskId !== undefined && existing.taskId !== null) {
          const taskOpt = yield* store.getTask(existing.taskId);
          if (Option.isSome(taskOpt) && taskOpt.value.task.status === "waiting_approval") {
            const { blockedReason: _oldReason, ...taskWithoutReason } = taskOpt.value.task;
            const nextTaskRecord: SovereignStore.PersistedTaskRecord = {
              ...taskOpt.value,
              task: {
                ...taskWithoutReason,
                status: input.decision === "approve" ? "ready" : "blocked",
                pendingApprovalId: null,
                ...(input.decision === "approve"
                  ? {}
                  : {
                      blockedReason: input.note ?? "Owner rejected requested external action.",
                    }),
                updatedAt: now,
              },
            };
            yield* store.updateTask(nextTaskRecord);
            resumedTask = nextTaskRecord.task;
          }
        }

        const linkedProposal = yield* store.findProposalByApprovalId(existing.id);
        if (Option.isSome(linkedProposal) && linkedProposal.value.status === "pending_approval") {
          yield* store.updateProposalStatus({
            proposalId: linkedProposal.value.id,
            status: input.decision === "approve" ? "sent" : "rejected",
            decidedAt: now,
            updatedAt: now,
          });
        }

        return { updatedApproval: nextApproval, updatedTask: resumedTask };
      }),
    );

    yield* recordAuditEvent({
      kind: "approval_decided",
      severity: "info",
      ventureId: updatedApproval.ventureId,
      actor: decidedBy,
      summary: `Approval ${nextStatus}: ${updatedApproval.title}`,
      category: updatedApproval.category,
      approvalId: updatedApproval.id,
      ...(updatedApproval.taskId === undefined ? {} : { taskId: updatedApproval.taskId }),
      ...(input.note === undefined ? {} : { metadata: { note: input.note } }),
    });
    yield* store.publishEvent({ type: "approvalUpdated", payload: updatedApproval });
    if (updatedTask !== undefined) {
      yield* store.publishEvent({ type: "taskUpdated", payload: updatedTask });
    }
    return updatedApproval;
  });

  const assertAndGateExternalAction = Effect.fn(
    "SovereignGovernanceService.assertAndGateExternalAction",
  )(function* (input: GateExternalActionInput) {
    const actor = input.requestedBy ?? "sovereign";
    const { controlState } = yield* store.getControlState;
    const now = yield* store.nowIso;

    if (controlState.emergencyStopActive) {
      yield* recordAuditEvent({
        kind: "permission_denied",
        severity: "critical",
        ventureId: input.ventureId ?? null,
        actor,
        summary: `Blocked ${input.category} because global emergency stop is active.`,
        category: input.category,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      });
      return yield* new SovereignPermissionError({
        code: "emergency_stop_active",
        reason: "Global emergency stop is active; all external actions are halted.",
        ...(input.ventureId === undefined || input.ventureId === null
          ? {}
          : { ventureId: input.ventureId }),
      });
    }

    const venture =
      input.ventureId !== undefined && input.ventureId !== null
        ? yield* store.getVenture(input.ventureId).pipe(
            Effect.flatMap(
              Option.match({
                onSome: Effect.succeed,
                onNone: () =>
                  Effect.fail(
                    new SovereignNotFoundError({ entity: "venture", id: input.ventureId! }),
                  ),
              }),
            ),
          )
        : undefined;

    if (venture !== undefined && (venture.status === "paused" || venture.status === "archived")) {
      yield* recordAuditEvent({
        kind: "permission_denied",
        severity: "warning",
        ventureId: venture.id,
        actor,
        summary: `Blocked ${input.category} because venture "${venture.name}" is ${venture.status}.`,
        category: input.category,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      });
      return yield* new SovereignPermissionError({
        code: "permission_denied",
        reason: `Venture "${venture.name}" is ${venture.status} and cannot execute external actions.`,
        ventureId: venture.id,
      });
    }

    if (input.category === "security_testing") {
      const auth = venture?.permissionPolicy.securityAuthorisation;
      const methodRaw =
        input.method ?? (typeof input.payload?.method === "string" ? input.payload.method : null);
      const target = input.targetLabel ?? null;
      const isExpired =
        auth?.expiresAt !== undefined &&
        Number.isFinite(Date.parse(auth.expiresAt)) &&
        Date.parse(auth.expiresAt) <= Date.parse(now);
      const targetAllowed =
        target !== null && auth !== undefined && matchesScopeTarget(target, auth.targetScope);
      const methodAllowed =
        methodRaw !== null &&
        auth !== undefined &&
        auth.permittedMethods.some(
          (permitted) => permitted.trim().toLowerCase() === methodRaw.trim().toLowerCase(),
        );

      let denialReason: string | null = null;
      if (auth === undefined || !auth.authorised) {
        denialReason = "Security testing requires explicit owner programme authorisation.";
      } else if (isExpired) {
        denialReason = "Security testing authorisation has expired.";
      } else if (!targetAllowed) {
        denialReason = "Security testing target is outside the authorised target scope.";
      } else if (!methodAllowed) {
        denialReason = "Security testing method is not in the permitted methods list.";
      }

      if (denialReason !== null) {
        yield* recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId: venture?.id ?? null,
          actor,
          summary: `Denied security testing action: ${denialReason}`,
          category: "security_testing",
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        });
        return yield* new SovereignPermissionError({
          code: "security_unauthorised",
          reason: denialReason,
          ...(venture === undefined ? {} : { ventureId: venture.id }),
        });
      }
    }

    const currency =
      input.currency ?? venture?.budgetPolicy.currency ?? controlState.reportingCurrency;
    const estimatedCostMinor = input.estimatedCostMinor ?? 0;
    const estimatedCostGbpMinor =
      estimatedCostMinor > 0
        ? yield* convertMinorToGbp(estimatedCostMinor, currency, controlState.fxRatesToGbp)
        : 0;
    const monthStartIso = startOfCurrentUtcMonthIso(now);

    if (input.category === "financial_expenditure" || estimatedCostGbpMinor > 0) {
      if (venture !== undefined && !venture.budgetPolicy.discretionarySpendAllowed) {
        const reason = `Discretionary expenditure is disabled for venture "${venture.name}".`;
        yield* recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId: venture.id,
          actor,
          summary: reason,
          category: input.category,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        });
        return yield* new SovereignPermissionError({
          code: "budget_exceeded",
          reason,
          ventureId: venture.id,
        });
      }

      const [ventureSpendGbp, globalSpendGbp] = yield* Effect.all([
        venture === undefined
          ? Effect.succeed(0)
          : store.sumVerifiedMonthlySpendGbpMinor({
              ventureId: venture.id,
              sinceIso: monthStartIso,
            }),
        store.sumVerifiedMonthlySpendGbpMinor({ sinceIso: monthStartIso }),
      ]);

      if (venture !== undefined) {
        const ventureCapGbp = yield* convertMinorToGbp(
          venture.budgetPolicy.monthlyCapMinor,
          venture.budgetPolicy.currency,
          controlState.fxRatesToGbp,
        );
        if (ventureSpendGbp + estimatedCostGbpMinor > ventureCapGbp) {
          const reason = `Proposed expenditure exceeds the monthly budget cap for venture "${venture.name}".`;
          yield* recordAuditEvent({
            kind: "permission_denied",
            severity: "warning",
            ventureId: venture.id,
            actor,
            summary: reason,
            category: input.category,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          });
          return yield* new SovereignPermissionError({
            code: "budget_exceeded",
            reason,
            ventureId: venture.id,
          });
        }
      }

      if (globalSpendGbp + estimatedCostGbpMinor > controlState.globalMonthlyBudgetMinor) {
        const reason = "Proposed expenditure exceeds the global monthly Sovereign budget cap.";
        yield* recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId: venture?.id ?? null,
          actor,
          summary: reason,
          category: input.category,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        });
        return yield* new SovereignPermissionError({
          code: "budget_exceeded",
          reason,
          ...(venture === undefined ? {} : { ventureId: venture.id }),
        });
      }
    }

    const actionMode =
      venture?.permissionPolicy.actionModes[input.category] ??
      DEFAULT_VENTURE_ACTION_MODES[input.category];

    if (actionMode === "deny") {
      const code =
        input.category === "paid_provider_fallback"
          ? "paid_fallback_denied"
          : input.category === "security_testing"
            ? "security_unauthorised"
            : "permission_denied";
      const reason = `Action category "${input.category}" is denied by venture policy.`;
      yield* recordAuditEvent({
        kind: "permission_denied",
        severity: "warning",
        ventureId: venture?.id ?? null,
        actor,
        summary: reason,
        category: input.category,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      });
      return yield* new SovereignPermissionError({
        code,
        reason,
        ...(venture === undefined ? {} : { ventureId: venture.id }),
      });
    }

    const channelRestricted =
      venture !== undefined &&
      input.channel !== undefined &&
      input.channel !== null &&
      venture.permissionPolicy.allowedChannels.length > 0 &&
      !venture.permissionPolicy.allowedChannels.includes(input.channel);

    const discountExceedsPolicy =
      venture !== undefined &&
      input.discountPct !== undefined &&
      input.discountPct !== null &&
      input.discountPct > venture.permissionPolicy.maxDiscountPct;

    const policies = yield* store.listPreapprovalPolicies({
      ventureId: venture?.id ?? null,
      enabledOnly: true,
    });
    const ventureMonthlySpendGbp =
      policies.length > 0
        ? yield* store.sumVerifiedMonthlySpendGbpMinor({
            ventureId: venture?.id ?? null,
            sinceIso: monthStartIso,
          })
        : 0;

    let matchedPolicy: PreapprovalPolicy | undefined;
    if (!channelRestricted && !discountExceedsPolicy) {
      for (const policy of policies) {
        if (policy.category !== input.category) continue;
        if (
          policy.expiresAt !== null &&
          Number.isFinite(Date.parse(policy.expiresAt)) &&
          Date.parse(policy.expiresAt) <= Date.parse(now)
        ) {
          continue;
        }
        if (
          policy.allowedTargets.length > 0 &&
          (input.targetLabel === undefined ||
            input.targetLabel === null ||
            !matchesScopeTarget(input.targetLabel, policy.allowedTargets))
        ) {
          continue;
        }
        if (policy.maxSingleActionMinor !== null) {
          const capGbp = yield* convertMinorToGbp(
            policy.maxSingleActionMinor,
            policy.currency,
            controlState.fxRatesToGbp,
          );
          if (estimatedCostGbpMinor > capGbp) continue;
        }
        if (policy.maxMonthlyAggregateMinor !== null) {
          const aggregateCapGbp = yield* convertMinorToGbp(
            policy.maxMonthlyAggregateMinor,
            policy.currency,
            controlState.fxRatesToGbp,
          );
          if (ventureMonthlySpendGbp + estimatedCostGbpMinor > aggregateCapGbp) continue;
        }
        matchedPolicy = policy;
        break;
      }
    }

    if (
      matchedPolicy !== undefined ||
      (actionMode === "preapproved" && !channelRestricted && !discountExceedsPolicy)
    ) {
      yield* recordAuditEvent({
        kind: "external_action_executed",
        severity: "info",
        ventureId: venture?.id ?? null,
        actor,
        summary: `Executed ${input.category} within policy: ${input.title}`,
        category: input.category,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(matchedPolicy === undefined
          ? {}
          : { metadata: { preapprovalPolicyId: matchedPolicy.id } }),
      });
      return {
        outcome: "allowed",
        preapprovalPolicyId: matchedPolicy?.id ?? null,
      } satisfies GateExternalActionResult;
    }

    const approval = yield* requestApproval({
      ...(input.ventureId === undefined ? {} : { ventureId: input.ventureId }),
      ...(input.objectiveId === undefined ? {} : { objectiveId: input.objectiveId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      category: input.category,
      ...(input.riskLevel === undefined ? {} : { riskLevel: input.riskLevel }),
      title: input.title,
      summary: input.summary,
      requestedAction: input.requestedAction,
      ...(input.targetLabel === undefined ? {} : { targetLabel: input.targetLabel }),
      ...(input.estimatedCostMinor === undefined
        ? {}
        : { estimatedCostMinor: input.estimatedCostMinor }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      requestedBy: actor,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });

    return {
      outcome: "approval_required",
      approval,
    } satisfies GateExternalActionResult;
  });

  const sanitizeUntrustedContent = Effect.fn("SovereignGovernanceService.sanitizeUntrustedContent")(
    function* (input: SanitizeUntrustedContentInput) {
      const { controlState } = yield* store.getControlState;
      const stripped = input.rawText.replace(CONTROL_DELIMITER_STRIP_RE, "").trim();
      const matchedPatterns: Array<string> = [];

      if (controlState.promptInjectionGuardEnabled) {
        for (const rule of PROMPT_INJECTION_RULES) {
          if (rule.pattern.test(input.rawText)) {
            matchedPatterns.push(rule.name);
          }
        }
      }

      const quarantined = matchedPatterns.length > 0;
      const safeSource = input.source.replace(/[^a-zA-Z0-9._:/-]/g, "_").slice(0, 80) || "external";
      const body = quarantined
        ? `[QUARANTINED UNTRUSTED CONTENT: matched ${matchedPatterns.join(", ")}]\n${stripped}`
        : stripped;
      const sanitizedText = `<untrusted_data source="${safeSource}" quarantined="${quarantined ? "true" : "false"}">\n${body}\n</untrusted_data>`;

      if (quarantined) {
        yield* recordAuditEvent({
          kind: "prompt_injection_quarantined",
          severity: "warning",
          ventureId: input.ventureId ?? null,
          actor: input.actor ?? "prompt_injection_guard",
          summary: `Quarantined untrusted content from ${safeSource} matching ${matchedPatterns.join(", ")}.`,
          metadata: {
            source: safeSource,
            matchedPatterns,
            length: input.rawText.length,
          },
        });
      }

      return {
        quarantined,
        matchedPatterns,
        sanitizedText,
      } satisfies SanitizeUntrustedContentResult;
    },
  );

  const listApprovals = Effect.fn("SovereignGovernanceService.listApprovals")(function* (filter?: {
    readonly ventureId?: VentureId | null;
    readonly status?: ApprovalStatus;
  }) {
    const [approvals, preapprovalPolicies] = yield* Effect.all([
      store.listApprovals(filter),
      store.listPreapprovalPolicies(
        filter?.ventureId === undefined ? {} : { ventureId: filter.ventureId },
      ),
    ]);
    return { approvals, preapprovalPolicies };
  });

  const upsertPreapprovalPolicy = Effect.fn("SovereignGovernanceService.upsertPreapprovalPolicy")(
    function* (input: UpsertPreapprovalPolicyInput, createdBy = "owner") {
      const now = yield* store.nowIso;
      const existing =
        input.id === undefined ? Option.none() : yield* store.getPreapprovalPolicy(input.id);
      const id = input.id ?? (yield* generateId("pap", PreapprovalPolicyId.make));
      const { controlState } = yield* store.getControlState;
      const policy: PreapprovalPolicy = {
        id,
        ventureId: input.ventureId ?? null,
        category: input.category,
        label: input.label,
        enabled: input.enabled ?? true,
        maxSingleActionMinor: input.maxSingleActionMinor ?? null,
        maxMonthlyAggregateMinor: input.maxMonthlyAggregateMinor ?? null,
        currency: input.currency ?? controlState.reportingCurrency,
        allowedTargets: input.allowedTargets ?? [],
        expiresAt: input.expiresAt ?? null,
        createdBy: Option.isSome(existing) ? existing.value.createdBy : createdBy,
        createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
        updatedAt: now,
      };
      yield* store.upsertPreapprovalPolicy(policy);
      return policy;
    },
  );

  const deletePreapprovalPolicy = Effect.fn("SovereignGovernanceService.deletePreapprovalPolicy")(
    function* (input: DeletePreapprovalPolicyInput) {
      const deleted = yield* store.deletePreapprovalPolicy(input.policyId);
      return { deleted };
    },
  );

  const listAuditEvents = Effect.fn("SovereignGovernanceService.listAuditEvents")(
    function* (filter?: {
      readonly ventureId?: VentureId | null;
      readonly kind?: AuditEventKind;
      readonly limit?: number;
    }) {
      return yield* store.listAuditEvents(filter);
    },
  );

  return SovereignGovernanceService.of({
    getControlState: getControlState(),
    updateControlState,
    triggerEmergencyStop,
    assertAndGateExternalAction,
    sanitizeUntrustedContent,
    requestApproval,
    decideApproval,
    listApprovals,
    upsertPreapprovalPolicy,
    deletePreapprovalPolicy,
    listAuditEvents,
    recordAuditEvent,
  });
});

export const layer = Layer.effect(SovereignGovernanceService, make);
