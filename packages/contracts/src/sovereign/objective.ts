import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";
import { CurrencyCode, NonNegativeMinorAmount, ObjectiveId, VentureId } from "./ids.ts";
import { VentureKind } from "./venture.ts";

export const ObjectiveStatus = Schema.Literals([
  "draft",
  "active",
  "paused",
  "completed",
  "cancelled",
]);
export type ObjectiveStatus = typeof ObjectiveStatus.Type;

export const ObjectiveHorizon = Schema.Literals([
  "immediate",
  "weekly",
  "monthly",
  "quarterly",
  "ongoing",
]);
export type ObjectiveHorizon = typeof ObjectiveHorizon.Type;

export const ObjectiveStrategyStepStatus = Schema.Literals([
  "planned",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
]);
export type ObjectiveStrategyStepStatus = typeof ObjectiveStrategyStepStatus.Type;

export const ObjectiveStrategyStep = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  ventureKind: Schema.optionalKey(VentureKind),
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  estimatedImpactMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(CurrencyCode),
  status: ObjectiveStrategyStepStatus,
  requiresApproval: Schema.Boolean,
});
export type ObjectiveStrategyStep = typeof ObjectiveStrategyStep.Type;

export const ObjectiveStrategyPlan = Schema.Struct({
  summary: TrimmedNonEmptyString,
  rationale: TrimmedString,
  targetVentureIds: Schema.Array(VentureId),
  steps: Schema.Array(ObjectiveStrategyStep),
  assumptions: Schema.Array(TrimmedNonEmptyString),
  risks: Schema.Array(TrimmedNonEmptyString),
  generatedAt: IsoDateTime,
});
export type ObjectiveStrategyPlan = typeof ObjectiveStrategyPlan.Type;

export const CommercialObjective = Schema.Struct({
  id: ObjectiveId,
  ventureId: Schema.NullOr(VentureId),
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  status: ObjectiveStatus,
  horizon: ObjectiveHorizon,
  targetRevenueMinor: Schema.NullOr(NonNegativeMinorAmount),
  maxSpendMinor: NonNegativeMinorAmount,
  currency: CurrencyCode,
  targetDeadlineAt: Schema.NullOr(IsoDateTime),
  strategyPlan: Schema.NullOr(ObjectiveStrategyPlan),
  constraints: Schema.Array(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CommercialObjective = typeof CommercialObjective.Type;

export const CreateObjectiveInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedString),
  horizon: Schema.optionalKey(ObjectiveHorizon),
  targetRevenueMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  maxSpendMinor: Schema.optionalKey(NonNegativeMinorAmount),
  currency: Schema.optionalKey(CurrencyCode),
  targetDeadlineAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  constraints: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type CreateObjectiveInput = typeof CreateObjectiveInput.Type;

export const UpdateObjectiveInput = Schema.Struct({
  objectiveId: ObjectiveId,
  status: Schema.optionalKey(ObjectiveStatus),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(TrimmedString),
  horizon: Schema.optionalKey(ObjectiveHorizon),
  targetRevenueMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  maxSpendMinor: Schema.optionalKey(NonNegativeMinorAmount),
  targetDeadlineAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  strategyPlan: Schema.optionalKey(Schema.NullOr(ObjectiveStrategyPlan)),
  constraints: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type UpdateObjectiveInput = typeof UpdateObjectiveInput.Type;

export const PortfolioRecommendationPriority = Schema.Literals(["high", "medium", "low"]);
export type PortfolioRecommendationPriority = typeof PortfolioRecommendationPriority.Type;

export const PortfolioRecommendationKind = Schema.Literals([
  "new_venture",
  "focus_opportunity",
  "resolve_blocker",
  "configure_integration",
  "optimise_pool",
  "review_approval",
  "cost_guardrail",
]);
export type PortfolioRecommendationKind = typeof PortfolioRecommendationKind.Type;

export const PortfolioRecommendation = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: PortfolioRecommendationKind,
  priority: PortfolioRecommendationPriority,
  ventureId: Schema.NullOr(VentureId),
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  rationale: TrimmedString,
  estimatedUpsideMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(CurrencyCode),
  suggestedAction: Schema.optionalKey(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type PortfolioRecommendation = typeof PortfolioRecommendation.Type;
