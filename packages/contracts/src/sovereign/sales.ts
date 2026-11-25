import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, PositiveInt, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";
import {
  ApprovalRequestId,
  CommunicationId,
  CurrencyCode,
  CustomerId,
  DEFAULT_REPORTING_CURRENCY,
  IntegrationId,
  LeadId,
  MinorCurrencyAmount,
  NonNegativeMinorAmount,
  OpportunityId,
  OrderId,
  Percentage,
  ProposalId,
  SupportTicketId,
  VentureId,
  VoiceAgentId,
} from "./ids.ts";

export const ConsentLawfulBasis = Schema.Literals([
  "consent",
  "contract",
  "legitimate_interest",
  "legal_obligation",
  "not_established",
]);
export type ConsentLawfulBasis = typeof ConsentLawfulBasis.Type;

export const ConsentChannel = Schema.Literals([
  "email",
  "phone",
  "sms",
  "web_chat",
  "voice_ai",
  "social",
  "in_app",
]);
export type ConsentChannel = typeof ConsentChannel.Type;

export const ConsentStatus = Schema.Literals(["granted", "pending", "withdrawn", "unknown"]);
export type ConsentStatus = typeof ConsentStatus.Type;

/** Tracks UK PECR and UK GDPR consent, opt-out state, and required disclosures per channel. */
export const ConsentRecord = Schema.Struct({
  channel: ConsentChannel,
  status: ConsentStatus,
  lawfulBasis: ConsentLawfulBasis,
  optedOut: Schema.Boolean,
  optedOutAt: Schema.NullOr(IsoDateTime),
  consentCapturedAt: Schema.NullOr(IsoDateTime),
  consentSource: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  aiDisclosureGiven: Schema.Boolean,
  recordingDisclosureGiven: Schema.Boolean,
  jurisdiction: TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed("UK"))),
});
export type ConsentRecord = typeof ConsentRecord.Type;

export const LeadStage = Schema.Literals([
  "new",
  "researched",
  "contacted",
  "qualified",
  "proposal_sent",
  "converted",
  "unsubscribed",
  "disqualified",
]);
export type LeadStage = typeof LeadStage.Type;

export const Lead = Schema.Struct({
  id: LeadId,
  ventureId: VentureId,
  name: TrimmedNonEmptyString,
  company: Schema.NullOr(TrimmedNonEmptyString),
  email: Schema.NullOr(TrimmedNonEmptyString),
  phone: Schema.NullOr(TrimmedNonEmptyString),
  websiteUrl: Schema.NullOr(TrimmedNonEmptyString),
  source: TrimmedNonEmptyString,
  stage: LeadStage,
  consents: Schema.Array(ConsentRecord),
  notes: TrimmedString,
  tags: Schema.Array(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Lead = typeof Lead.Type;

export const CreateLeadInput = Schema.Struct({
  ventureId: VentureId,
  name: TrimmedNonEmptyString,
  company: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  email: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  phone: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  websiteUrl: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  source: TrimmedNonEmptyString,
  stage: Schema.optionalKey(LeadStage),
  consents: Schema.optionalKey(Schema.Array(ConsentRecord)),
  notes: Schema.optionalKey(TrimmedString),
  tags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type CreateLeadInput = typeof CreateLeadInput.Type;

export const CustomerStatus = Schema.Literals(["active", "onboarding", "paused", "churned"]);
export type CustomerStatus = typeof CustomerStatus.Type;

export const Customer = Schema.Struct({
  id: CustomerId,
  ventureId: VentureId,
  leadId: Schema.NullOr(LeadId),
  name: TrimmedNonEmptyString,
  company: Schema.NullOr(TrimmedNonEmptyString),
  email: Schema.NullOr(TrimmedNonEmptyString),
  phone: Schema.NullOr(TrimmedNonEmptyString),
  status: CustomerStatus,
  consents: Schema.Array(ConsentRecord),
  billingCurrency: CurrencyCode,
  lifetimeCollectedMinor: MinorCurrencyAmount,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Customer = typeof Customer.Type;

export const ProposalStatus = Schema.Literals([
  "draft",
  "pending_approval",
  "sent",
  "accepted",
  "rejected",
  "expired",
]);
export type ProposalStatus = typeof ProposalStatus.Type;

export const ProposalLineItem = Schema.Struct({
  description: TrimmedNonEmptyString,
  quantity: PositiveInt,
  unitAmountMinor: NonNegativeMinorAmount,
});
export type ProposalLineItem = typeof ProposalLineItem.Type;

export const Proposal = Schema.Struct({
  id: ProposalId,
  ventureId: VentureId,
  leadId: Schema.NullOr(LeadId),
  customerId: Schema.NullOr(CustomerId),
  opportunityId: Schema.NullOr(OpportunityId),
  title: TrimmedNonEmptyString,
  summary: TrimmedString,
  lineItems: Schema.Array(ProposalLineItem),
  subtotalMinor: NonNegativeMinorAmount,
  discountPct: Percentage,
  totalMinor: NonNegativeMinorAmount,
  currency: CurrencyCode,
  status: ProposalStatus,
  approvalId: Schema.NullOr(ApprovalRequestId),
  validUntil: Schema.NullOr(IsoDateTime),
  sentAt: Schema.NullOr(IsoDateTime),
  decidedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Proposal = typeof Proposal.Type;

export const CreateProposalInput = Schema.Struct({
  ventureId: VentureId,
  leadId: Schema.optionalKey(Schema.NullOr(LeadId)),
  customerId: Schema.optionalKey(Schema.NullOr(CustomerId)),
  opportunityId: Schema.optionalKey(Schema.NullOr(OpportunityId)),
  title: TrimmedNonEmptyString,
  summary: Schema.optionalKey(TrimmedString),
  lineItems: Schema.Array(ProposalLineItem),
  discountPct: Schema.optionalKey(Percentage),
  currency: Schema.optionalKey(CurrencyCode),
  validUntil: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type CreateProposalInput = typeof CreateProposalInput.Type;

export const OrderStatus = Schema.Literals([
  "accepted",
  "in_delivery",
  "delivered",
  "completed",
  "refunded",
  "cancelled",
]);
export type OrderStatus = typeof OrderStatus.Type;

export const Order = Schema.Struct({
  id: OrderId,
  ventureId: VentureId,
  customerId: CustomerId,
  proposalId: Schema.NullOr(ProposalId),
  title: TrimmedNonEmptyString,
  amountMinor: NonNegativeMinorAmount,
  currency: CurrencyCode,
  status: OrderStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Order = typeof Order.Type;

export const CommunicationDirection = Schema.Literals(["outbound", "inbound"]);
export type CommunicationDirection = typeof CommunicationDirection.Type;

export const CommunicationSenderType = Schema.Literals(["ai_agent", "human"]);
export type CommunicationSenderType = typeof CommunicationSenderType.Type;

export const CommunicationStatus = Schema.Literals([
  "draft",
  "pending_approval",
  "queued",
  "sent",
  "delivered",
  "received",
  "blocked",
  "failed",
]);
export type CommunicationStatus = typeof CommunicationStatus.Type;

export const CommunicationRecord = Schema.Struct({
  id: CommunicationId,
  ventureId: VentureId,
  leadId: Schema.NullOr(LeadId),
  customerId: Schema.NullOr(CustomerId),
  channel: ConsentChannel,
  direction: CommunicationDirection,
  senderType: CommunicationSenderType,
  aiDisclosed: Schema.Boolean,
  consentVerified: Schema.Boolean,
  subject: Schema.NullOr(TrimmedNonEmptyString),
  bodyPreview: TrimmedString,
  status: CommunicationStatus,
  approvalId: Schema.NullOr(ApprovalRequestId),
  externalMessageId: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  sentAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type CommunicationRecord = typeof CommunicationRecord.Type;

export const CreateCommunicationInput = Schema.Struct({
  ventureId: VentureId,
  leadId: Schema.optionalKey(Schema.NullOr(LeadId)),
  customerId: Schema.optionalKey(Schema.NullOr(CustomerId)),
  channel: ConsentChannel,
  direction: CommunicationDirection,
  senderType: CommunicationSenderType,
  aiDisclosed: Schema.Boolean,
  consentVerified: Schema.Boolean,
  subject: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  bodyPreview: TrimmedString,
});
export type CreateCommunicationInput = typeof CreateCommunicationInput.Type;

export const SupportTicketStatus = Schema.Literals([
  "open",
  "pending_customer",
  "escalated",
  "resolved",
  "closed",
]);
export type SupportTicketStatus = typeof SupportTicketStatus.Type;

export const SupportTicketPriority = Schema.Literals(["low", "normal", "high", "urgent"]);
export type SupportTicketPriority = typeof SupportTicketPriority.Type;

export const SupportTicket = Schema.Struct({
  id: SupportTicketId,
  ventureId: VentureId,
  customerId: CustomerId,
  orderId: Schema.NullOr(OrderId),
  subject: TrimmedNonEmptyString,
  summary: TrimmedString,
  status: SupportTicketStatus,
  priority: SupportTicketPriority,
  handledBy: CommunicationSenderType,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type SupportTicket = typeof SupportTicket.Type;

export const VoiceAgentDirection = Schema.Literals(["inbound", "outbound", "both"]);
export type VoiceAgentDirection = typeof VoiceAgentDirection.Type;

export const VoiceAgentStatus = Schema.Literals(["draft", "paused", "active", "archived"]);
export type VoiceAgentStatus = typeof VoiceAgentStatus.Type;

export const VoiceAgentConfig = Schema.Struct({
  id: VoiceAgentId,
  ventureId: VentureId,
  name: TrimmedNonEmptyString,
  providerIntegrationId: Schema.NullOr(IntegrationId),
  direction: VoiceAgentDirection,
  status: VoiceAgentStatus,
  phoneNumberLabel: Schema.NullOr(TrimmedNonEmptyString),
  aiDisclosureGreeting: TrimmedNonEmptyString,
  recordingDisclosureEnabled: Schema.Boolean,
  optOutPhraseEnabled: Schema.Boolean,
  escalationNumberLabel: Schema.NullOr(TrimmedNonEmptyString),
  scriptSummary: TrimmedString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VoiceAgentConfig = typeof VoiceAgentConfig.Type;

export const UpsertVoiceAgentInput = Schema.Struct({
  id: Schema.optionalKey(VoiceAgentId),
  ventureId: VentureId,
  name: TrimmedNonEmptyString,
  providerIntegrationId: Schema.optionalKey(Schema.NullOr(IntegrationId)),
  direction: VoiceAgentDirection,
  status: Schema.optionalKey(VoiceAgentStatus),
  phoneNumberLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  aiDisclosureGreeting: TrimmedNonEmptyString,
  recordingDisclosureEnabled: Schema.optionalKey(Schema.Boolean),
  optOutPhraseEnabled: Schema.optionalKey(Schema.Boolean),
  escalationNumberLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  scriptSummary: Schema.optionalKey(TrimmedString),
});
export type UpsertVoiceAgentInput = typeof UpsertVoiceAgentInput.Type;

export const SalesPolicy = Schema.Struct({
  requireExplicitConsentForOutbound: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  requireAiIdentityDisclosure: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  requireRecordingDisclosure: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  honourOptOutImmediately: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  maxAutonomousQuoteMinor: NonNegativeMinorAmount.pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  maxDiscountPct: Percentage.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  currency: CurrencyCode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_REPORTING_CURRENCY)),
  ),
});
export type SalesPolicy = typeof SalesPolicy.Type;

export const DEFAULT_SALES_POLICY: SalesPolicy = Schema.decodeSync(SalesPolicy)({});
