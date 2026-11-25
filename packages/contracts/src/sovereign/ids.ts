import * as Schema from "effect/Schema";
import { ApprovalRequestId, NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

const makeSovereignId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export { ApprovalRequestId };

export const VentureId = makeSovereignId("VentureId");
export type VentureId = typeof VentureId.Type;

export const ObjectiveId = makeSovereignId("ObjectiveId");
export type ObjectiveId = typeof ObjectiveId.Type;

export const OpportunityId = makeSovereignId("OpportunityId");
export type OpportunityId = typeof OpportunityId.Type;

export const CommercialTaskId = makeSovereignId("CommercialTaskId");
export type CommercialTaskId = typeof CommercialTaskId.Type;

export const LeadId = makeSovereignId("LeadId");
export type LeadId = typeof LeadId.Type;

export const CustomerId = makeSovereignId("CustomerId");
export type CustomerId = typeof CustomerId.Type;

export const ProposalId = makeSovereignId("ProposalId");
export type ProposalId = typeof ProposalId.Type;

export const OrderId = makeSovereignId("OrderId");
export type OrderId = typeof OrderId.Type;

export const InvoiceId = makeSovereignId("InvoiceId");
export type InvoiceId = typeof InvoiceId.Type;

export const LedgerEntryId = makeSovereignId("LedgerEntryId");
export type LedgerEntryId = typeof LedgerEntryId.Type;

export const PreapprovalPolicyId = makeSovereignId("PreapprovalPolicyId");
export type PreapprovalPolicyId = typeof PreapprovalPolicyId.Type;

export const IntegrationId = makeSovereignId("IntegrationId");
export type IntegrationId = typeof IntegrationId.Type;

export const ArtifactId = makeSovereignId("ArtifactId");
export type ArtifactId = typeof ArtifactId.Type;

export const AuditEventId = makeSovereignId("AuditEventId");
export type AuditEventId = typeof AuditEventId.Type;

export const CommunicationId = makeSovereignId("CommunicationId");
export type CommunicationId = typeof CommunicationId.Type;

export const SupportTicketId = makeSovereignId("SupportTicketId");
export type SupportTicketId = typeof SupportTicketId.Type;

export const VoiceAgentId = makeSovereignId("VoiceAgentId");
export type VoiceAgentId = typeof VoiceAgentId.Type;

export const CurrencyCode = TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Z]{3}$/));
export type CurrencyCode = typeof CurrencyCode.Type;
export const DEFAULT_REPORTING_CURRENCY: CurrencyCode = "GBP";

export const MinorCurrencyAmount = Schema.Int;
export type MinorCurrencyAmount = typeof MinorCurrencyAmount.Type;

export const NonNegativeMinorAmount = NonNegativeInt;
export type NonNegativeMinorAmount = typeof NonNegativeMinorAmount.Type;

export const Percentage = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);
export type Percentage = typeof Percentage.Type;

export const UnitScore = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);
export type UnitScore = typeof UnitScore.Type;

export const SovereignMetadata = Schema.Record(TrimmedNonEmptyString, Schema.Unknown);
export type SovereignMetadata = typeof SovereignMetadata.Type;
