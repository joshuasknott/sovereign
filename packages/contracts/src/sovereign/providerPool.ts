import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "../providerInstance.ts";
import {
  ApprovalRequestId,
  CommercialTaskId,
  CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  NonNegativeMinorAmount,
  Percentage,
  UnitScore,
  VentureId,
} from "./ids.ts";
import {
  DEFAULT_PAID_FALLBACK_MODE,
  PaidFallbackMode,
  ProviderBillingClass,
  ProviderModelTier,
  ProviderPoolMetadata,
  ProviderPoolPriority,
} from "./providerPoolMetadata.ts";

export {
  PaidFallbackMode,
  ProviderBillingClass,
  ProviderModelTier,
  ProviderPoolMetadata,
  ProviderPoolPriority,
};

const DEFAULT_ALLOWED_BILLING_CLASSES: ReadonlyArray<ProviderBillingClass> = [
  "subscription",
  "local",
  "free",
];

export const ProviderRoutingPolicy = Schema.Struct({
  allowedBillingClasses: Schema.Array(ProviderBillingClass).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ALLOWED_BILLING_CLASSES)),
  ),
  paidFallbackMode: PaidFallbackMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PAID_FALLBACK_MODE)),
  ),
  preferredTier: ProviderModelTier.pipe(
    Schema.withDecodingDefault(Effect.succeed("balanced" as const)),
  ),
  requireTools: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  manualInstanceId: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
  maxEstimatedCostMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: CurrencyCode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_REPORTING_CURRENCY)),
  ),
});
export type ProviderRoutingPolicy = typeof ProviderRoutingPolicy.Type;

export const DEFAULT_PROVIDER_ROUTING_POLICY: ProviderRoutingPolicy = Schema.decodeSync(
  ProviderRoutingPolicy,
)({});

/** `"unavailable"` prevents clients and services from fabricating quota percentages. */
export const ProviderQuotaAvailability = Schema.Literals(["available", "exhausted", "unavailable"]);
export type ProviderQuotaAvailability = typeof ProviderQuotaAvailability.Type;

export const ProviderPoolHealthStatus = Schema.Literals([
  "healthy",
  "degraded",
  "cooldown",
  "unavailable",
  "disabled",
]);
export type ProviderPoolHealthStatus = typeof ProviderPoolHealthStatus.Type;

export const ProviderPoolModelSummary = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  tier: Schema.optionalKey(ProviderModelTier),
  supportsTools: Schema.optionalKey(Schema.Boolean),
  contextWindow: Schema.optionalKey(PositiveInt),
});
export type ProviderPoolModelSummary = typeof ProviderPoolModelSummary.Type;

export const ProviderPoolMemberStatus = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  poolEnabled: Schema.Boolean,
  poolPriority: ProviderPoolPriority,
  billingClass: ProviderBillingClass,
  billingClassInferred: Schema.Boolean,
  subscriptionPlanLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  monthlySubscriptionCostMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  subscriptionCurrency: Schema.optionalKey(Schema.NullOr(CurrencyCode)),
  healthStatus: ProviderPoolHealthStatus,
  activeRunCount: NonNegativeInt,
  maxConcurrentRuns: PositiveInt,
  quotaAvailability: ProviderQuotaAvailability,
  /** Populated only when verified from live provider telemetry; null otherwise. */
  quotaRemainingPct: Schema.NullOr(Percentage),
  quotaResetAt: Schema.NullOr(IsoDateTime),
  cooldownUntil: Schema.NullOr(IsoDateTime),
  cooldownReason: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  reliabilityScore: Schema.NullOr(UnitScore),
  preferredTiers: Schema.Array(ProviderModelTier),
  poolTags: Schema.Array(TrimmedNonEmptyString),
  availableModels: Schema.Array(ProviderPoolModelSummary),
  checkedAt: IsoDateTime,
});
export type ProviderPoolMemberStatus = typeof ProviderPoolMemberStatus.Type;

export const ProviderPoolSnapshot = Schema.Struct({
  updatedAt: IsoDateTime,
  defaultRoutingPolicy: ProviderRoutingPolicy,
  members: Schema.Array(ProviderPoolMemberStatus),
  healthyCount: NonNegativeInt,
  activeRunCount: NonNegativeInt,
  paidInstancesCount: NonNegativeInt,
});
export type ProviderPoolSnapshot = typeof ProviderPoolSnapshot.Type;

export const ProviderRouteRequest = Schema.Struct({
  routingPolicy: Schema.optionalKey(ProviderRoutingPolicy),
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  requestedTier: Schema.optionalKey(ProviderModelTier),
  requiredTags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  excludeInstanceIds: Schema.optionalKey(Schema.Array(ProviderInstanceId)),
  estimatedTokens: Schema.optionalKey(NonNegativeInt),
});
export type ProviderRouteRequest = typeof ProviderRouteRequest.Type;

export const ProviderRouteDecisionStatus = Schema.Literals([
  "routed",
  "approval_required",
  "denied",
  "no_eligible_provider",
]);
export type ProviderRouteDecisionStatus = typeof ProviderRouteDecisionStatus.Type;

export const ProviderRouteDecision = Schema.Struct({
  status: ProviderRouteDecisionStatus,
  selectedInstanceId: Schema.NullOr(ProviderInstanceId),
  selectedModel: Schema.NullOr(TrimmedNonEmptyString),
  billingClass: Schema.NullOr(ProviderBillingClass),
  reason: TrimmedNonEmptyString,
  approvalRequestId: Schema.optionalKey(Schema.NullOr(ApprovalRequestId)),
  estimatedCostMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(Schema.NullOr(CurrencyCode)),
});
export type ProviderRouteDecision = typeof ProviderRouteDecision.Type;

export const UpdateProviderPoolConfigInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  pool: Schema.NullOr(ProviderPoolMetadata),
});
export type UpdateProviderPoolConfigInput = typeof UpdateProviderPoolConfigInput.Type;
