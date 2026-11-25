import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";
import {
  CurrencyCode,
  MinorCurrencyAmount,
  NonNegativeMinorAmount,
  ObjectiveId,
  OpportunityId,
  Percentage,
  SovereignMetadata,
  UnitScore,
  VentureId,
} from "./ids.ts";

export const OpportunityStage = Schema.Literals([
  "discovered",
  "evaluating",
  "qualified",
  "in_progress",
  "submitted",
  "negotiating",
  "won",
  "lost",
  "disqualified",
]);
export type OpportunityStage = typeof OpportunityStage.Type;

export const EligibilityStatus = Schema.Literals([
  "eligible",
  "needs_review",
  "ineligible",
  "unknown",
]);
export type EligibilityStatus = typeof EligibilityStatus.Type;

export const AutomationMode = Schema.Literals(["manual", "assisted", "autonomous_within_policy"]);
export type AutomationMode = typeof AutomationMode.Type;

export const AiPermissionStatus = Schema.Literals(["permitted", "prohibited", "unknown"]);
export type AiPermissionStatus = typeof AiPermissionStatus.Type;

const NonNegativeHours = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

export const OpportunityScore = Schema.Struct({
  overall: Percentage,
  expectedValueMinor: Schema.NullOr(MinorCurrencyAmount),
  currency: CurrencyCode,
  winProbability: UnitScore,
  effortHoursEstimate: Schema.NullOr(NonNegativeHours),
  complianceFit: UnitScore,
  rationale: TrimmedString,
});
export type OpportunityScore = typeof OpportunityScore.Type;

export const Opportunity = Schema.Struct({
  id: OpportunityId,
  ventureId: VentureId,
  objectiveId: Schema.NullOr(ObjectiveId),
  title: TrimmedNonEmptyString,
  summary: TrimmedString,
  source: TrimmedNonEmptyString,
  sourceUrl: Schema.NullOr(TrimmedNonEmptyString),
  externalRef: Schema.NullOr(TrimmedNonEmptyString),
  stage: OpportunityStage,
  eligibilityStatus: EligibilityStatus,
  eligibilityNotes: Schema.optionalKey(TrimmedString),
  automationMode: AutomationMode,
  aiPermissionStatus: AiPermissionStatus,
  estimatedValueMinor: Schema.NullOr(NonNegativeMinorAmount),
  currency: CurrencyCode,
  score: Schema.NullOr(OpportunityScore),
  tags: Schema.Array(TrimmedNonEmptyString),
  deadlineAt: Schema.NullOr(IsoDateTime),
  metadata: Schema.optionalKey(SovereignMetadata),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Opportunity = typeof Opportunity.Type;

export const CreateOpportunityInput = Schema.Struct({
  ventureId: VentureId,
  objectiveId: Schema.optionalKey(Schema.NullOr(ObjectiveId)),
  title: TrimmedNonEmptyString,
  summary: Schema.optionalKey(TrimmedString),
  source: TrimmedNonEmptyString,
  sourceUrl: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  externalRef: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  stage: Schema.optionalKey(OpportunityStage),
  eligibilityStatus: Schema.optionalKey(EligibilityStatus),
  eligibilityNotes: Schema.optionalKey(TrimmedString),
  automationMode: Schema.optionalKey(AutomationMode),
  aiPermissionStatus: Schema.optionalKey(AiPermissionStatus),
  estimatedValueMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(CurrencyCode),
  score: Schema.optionalKey(Schema.NullOr(OpportunityScore)),
  tags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  deadlineAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  metadata: Schema.optionalKey(SovereignMetadata),
});
export type CreateOpportunityInput = typeof CreateOpportunityInput.Type;

export const UpdateOpportunityInput = Schema.Struct({
  opportunityId: OpportunityId,
  objectiveId: Schema.optionalKey(Schema.NullOr(ObjectiveId)),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  summary: Schema.optionalKey(TrimmedString),
  stage: Schema.optionalKey(OpportunityStage),
  eligibilityStatus: Schema.optionalKey(EligibilityStatus),
  eligibilityNotes: Schema.optionalKey(TrimmedString),
  automationMode: Schema.optionalKey(AutomationMode),
  aiPermissionStatus: Schema.optionalKey(AiPermissionStatus),
  estimatedValueMinor: Schema.optionalKey(Schema.NullOr(NonNegativeMinorAmount)),
  currency: Schema.optionalKey(CurrencyCode),
  score: Schema.optionalKey(Schema.NullOr(OpportunityScore)),
  tags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  deadlineAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  metadata: Schema.optionalKey(SovereignMetadata),
});
export type UpdateOpportunityInput = typeof UpdateOpportunityInput.Type;
