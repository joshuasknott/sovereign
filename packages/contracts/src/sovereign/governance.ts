import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import {
  ApprovalRequestId,
  AuditEventId,
  CommercialTaskId,
  CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  IntegrationId,
  NonNegativeMinorAmount,
  ObjectiveId,
  Percentage,
  PreapprovalPolicyId,
  SovereignMetadata,
  VentureId,
} from "./ids.ts";
import { DEFAULT_PAID_FALLBACK_MODE, PaidFallbackMode } from "./providerPoolMetadata.ts";

export const ExternalActionCategory = Schema.Literals([
  "customer_communication",
  "marketing_campaign",
  "external_submission",
  "financial_expenditure",
  "payment_processing",
  "production_deployment",
  "contractual_commitment",
  "refund",
  "security_testing",
  "personal_data",
  "account_modification",
  "paid_provider_fallback",
  "new_venture_creation",
]);
export type ExternalActionCategory = typeof ExternalActionCategory.Type;

export const PermissionDecisionMode = Schema.Literals(["deny", "require_approval", "preapproved"]);
export type PermissionDecisionMode = typeof PermissionDecisionMode.Type;

export const DEFAULT_VENTURE_ACTION_MODES: Readonly<
  Record<ExternalActionCategory, PermissionDecisionMode>
> = {
  customer_communication: "require_approval",
  marketing_campaign: "require_approval",
  external_submission: "require_approval",
  financial_expenditure: "require_approval",
  payment_processing: "require_approval",
  production_deployment: "require_approval",
  contractual_commitment: "require_approval",
  refund: "require_approval",
  security_testing: "deny",
  personal_data: "require_approval",
  account_modification: "require_approval",
  paid_provider_fallback: "deny",
  new_venture_creation: "require_approval",
};

export const VentureActionModes = Schema.Struct({
  customer_communication: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.customer_communication)),
  ),
  marketing_campaign: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.marketing_campaign)),
  ),
  external_submission: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.external_submission)),
  ),
  financial_expenditure: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.financial_expenditure)),
  ),
  payment_processing: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.payment_processing)),
  ),
  production_deployment: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.production_deployment)),
  ),
  contractual_commitment: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.contractual_commitment)),
  ),
  refund: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.refund)),
  ),
  security_testing: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.security_testing)),
  ),
  personal_data: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.personal_data)),
  ),
  account_modification: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.account_modification)),
  ),
  paid_provider_fallback: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.paid_provider_fallback)),
  ),
  new_venture_creation: PermissionDecisionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES.new_venture_creation)),
  ),
});
export type VentureActionModes = typeof VentureActionModes.Type;

export const SecurityAuthorisation = Schema.Struct({
  authorised: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  programmeName: Schema.optionalKey(TrimmedNonEmptyString),
  targetScope: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  permittedMethods: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  disclosurePolicy: Schema.optionalKey(TrimmedNonEmptyString),
  authorisedAt: Schema.optionalKey(IsoDateTime),
  expiresAt: Schema.optionalKey(IsoDateTime),
  authorisedBy: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SecurityAuthorisation = typeof SecurityAuthorisation.Type;

export const DEFAULT_SECURITY_AUTHORISATION: SecurityAuthorisation = Schema.decodeSync(
  SecurityAuthorisation,
)({});

export const VenturePermissionPolicy = Schema.Struct({
  actionModes: VentureActionModes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_ACTION_MODES)),
  ),
  maxAutonomousQuoteMinor: NonNegativeMinorAmount.pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  maxDiscountPct: Percentage.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  allowedChannels: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  securityAuthorisation: SecurityAuthorisation.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SECURITY_AUTHORISATION)),
  ),
});
export type VenturePermissionPolicy = typeof VenturePermissionPolicy.Type;

export const DEFAULT_VENTURE_PERMISSION_POLICY: VenturePermissionPolicy = Schema.decodeSync(
  VenturePermissionPolicy,
)({});

const PositiveFxRate = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0));
export const FxRatesToGbp = Schema.Record(CurrencyCode, PositiveFxRate);
export type FxRatesToGbp = typeof FxRatesToGbp.Type;

export const GlobalControlState = Schema.Struct({
  emergencyStopActive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  emergencyStopReason: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  emergencyStopAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  reportingCurrency: CurrencyCode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_REPORTING_CURRENCY)),
  ),
  globalMonthlyBudgetMinor: NonNegativeMinorAmount.pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  defaultPaidFallbackMode: PaidFallbackMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PAID_FALLBACK_MODE)),
  ),
  promptInjectionGuardEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  fxRatesToGbp: FxRatesToGbp.pipe(Schema.withDecodingDefault(Effect.succeed({ GBP: 1 }))),
  updatedAt: Schema.optionalKey(IsoDateTime),
});
export type GlobalControlState = typeof GlobalControlState.Type;

export const DEFAULT_GLOBAL_CONTROL_STATE: GlobalControlState = Schema.decodeSync(
  GlobalControlState,
)({});

export const UpdateGlobalControlStateInput = Schema.Struct({
  emergencyStopActive: Schema.optionalKey(Schema.Boolean),
  emergencyStopReason: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  reportingCurrency: Schema.optionalKey(CurrencyCode),
  globalMonthlyBudgetMinor: Schema.optionalKey(NonNegativeMinorAmount),
  defaultPaidFallbackMode: Schema.optionalKey(PaidFallbackMode),
  promptInjectionGuardEnabled: Schema.optionalKey(Schema.Boolean),
  fxRatesToGbp: Schema.optionalKey(FxRatesToGbp),
});
export type UpdateGlobalControlStateInput = typeof UpdateGlobalControlStateInput.Type;

export const TriggerEmergencyStopInput = Schema.Struct({
  active: Schema.Boolean,
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
export type TriggerEmergencyStopInput = typeof TriggerEmergencyStopInput.Type;

export const ApprovalStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
]);
export type ApprovalStatus = typeof ApprovalStatus.Type;

export const ApprovalRiskLevel = Schema.Literals(["low", "medium", "high", "critical"]);
export type ApprovalRiskLevel = typeof ApprovalRiskLevel.Type;

export const ApprovalRequest = Schema.Struct({
  id: ApprovalRequestId,
  ventureId: Schema.NullOr(VentureId),
  objectiveId: Schema.optionalKey(Schema.NullOr(ObjectiveId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  category: ExternalActionCategory,
  status: ApprovalStatus,
  riskLevel: ApprovalRiskLevel,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  requestedAction: TrimmedNonEmptyString,
  targetLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  estimatedCostMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(Schema.NullOr(CurrencyCode)),
  payload: Schema.optionalKey(SovereignMetadata),
  requestedBy: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  decidedBy: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  decidedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  decisionNote: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  preapprovalPolicyId: Schema.optionalKey(Schema.NullOr(PreapprovalPolicyId)),
});
export type ApprovalRequest = typeof ApprovalRequest.Type;

export const CreateApprovalRequestInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  objectiveId: Schema.optionalKey(Schema.NullOr(ObjectiveId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  category: ExternalActionCategory,
  riskLevel: Schema.optionalKey(ApprovalRiskLevel),
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  requestedAction: TrimmedNonEmptyString,
  targetLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  estimatedCostMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(Schema.NullOr(CurrencyCode)),
  payload: Schema.optionalKey(SovereignMetadata),
  requestedBy: Schema.optionalKey(TrimmedNonEmptyString),
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type CreateApprovalRequestInput = typeof CreateApprovalRequestInput.Type;

export const ApprovalDecision = Schema.Literals(["approve", "reject"]);
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const ApprovalDecisionInput = Schema.Struct({
  approvalId: ApprovalRequestId,
  decision: ApprovalDecision,
  note: Schema.optionalKey(TrimmedNonEmptyString),
  createPreapproval: Schema.optionalKey(Schema.Boolean),
  preapprovalCapMinor: Schema.optionalKey(NonNegativeMinorAmount),
  preapprovalExpiresAt: Schema.optionalKey(IsoDateTime),
});
export type ApprovalDecisionInput = typeof ApprovalDecisionInput.Type;

export const PreapprovalPolicy = Schema.Struct({
  id: PreapprovalPolicyId,
  ventureId: Schema.NullOr(VentureId),
  category: ExternalActionCategory,
  label: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  maxSingleActionMinor: Schema.NullOr(NonNegativeMinorAmount),
  maxMonthlyAggregateMinor: Schema.NullOr(NonNegativeMinorAmount),
  currency: CurrencyCode,
  allowedTargets: Schema.Array(TrimmedNonEmptyString),
  expiresAt: Schema.NullOr(IsoDateTime),
  createdBy: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PreapprovalPolicy = typeof PreapprovalPolicy.Type;

export const UpsertPreapprovalPolicyInput = Schema.Struct({
  id: Schema.optionalKey(PreapprovalPolicyId),
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  category: ExternalActionCategory,
  label: TrimmedNonEmptyString,
  enabled: Schema.optionalKey(Schema.Boolean),
  maxSingleActionMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  maxMonthlyAggregateMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(CurrencyCode),
  allowedTargets: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type UpsertPreapprovalPolicyInput = typeof UpsertPreapprovalPolicyInput.Type;

export const DeletePreapprovalPolicyInput = Schema.Struct({
  policyId: PreapprovalPolicyId,
});
export type DeletePreapprovalPolicyInput = typeof DeletePreapprovalPolicyInput.Type;

export const AuditEventKind = Schema.Literals([
  "permission_denied",
  "approval_requested",
  "approval_decided",
  "emergency_stop",
  "prompt_injection_quarantined",
  "provider_routed",
  "external_action_executed",
  "ledger_recorded",
  "venture_state_changed",
  "integration_tested",
]);
export type AuditEventKind = typeof AuditEventKind.Type;

export const AuditEventSeverity = Schema.Literals(["info", "warning", "critical"]);
export type AuditEventSeverity = typeof AuditEventSeverity.Type;

export const AuditEvent = Schema.Struct({
  id: AuditEventId,
  kind: AuditEventKind,
  severity: AuditEventSeverity,
  ventureId: Schema.NullOr(VentureId),
  actor: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  category: Schema.optionalKey(Schema.NullOr(ExternalActionCategory)),
  approvalId: Schema.optionalKey(Schema.NullOr(ApprovalRequestId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  providerInstanceId: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
  integrationId: Schema.optionalKey(Schema.NullOr(IntegrationId)),
  metadata: Schema.optionalKey(SovereignMetadata),
  createdAt: IsoDateTime,
});
export type AuditEvent = typeof AuditEvent.Type;
