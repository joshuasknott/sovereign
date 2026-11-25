import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt } from "../baseSchemas.ts";
import {
  ApprovalRequest,
  AuditEvent,
  GlobalControlState,
  PreapprovalPolicy,
} from "./governance.ts";
import { ApprovalRequestId, MinorCurrencyAmount, VentureId } from "./ids.ts";
import { IntegrationConfig, IntegrationSummary } from "./integration.ts";
import { FinancialPipelineMetrics, Invoice, LedgerEntry, PaymentLink } from "./ledger.ts";
import { CommercialObjective, PortfolioRecommendation } from "./objective.ts";
import { Opportunity } from "./opportunity.ts";
import { ProviderPoolSnapshot } from "./providerPool.ts";
import {
  CommunicationRecord,
  Customer,
  Lead,
  Order,
  Proposal,
  SupportTicket,
  VoiceAgentConfig,
} from "./sales.ts";
import { CommercialArtifact, CommercialTask } from "./task.ts";
import { Venture, VentureBlueprint, VentureOverviewRow } from "./venture.ts";

export const SovereignErrorCode = Schema.Literals([
  "not_found",
  "invalid_input",
  "permission_denied",
  "emergency_stop_active",
  "budget_exceeded",
  "paid_fallback_denied",
  "security_unauthorised",
  "consent_required",
  "integration_unavailable",
  "conflict",
  "internal",
]);
export type SovereignErrorCode = typeof SovereignErrorCode.Type;

export class SovereignError extends Schema.TaggedError<SovereignError>()("SovereignError", {
  code: SovereignErrorCode,
  message: Schema.String,
  ventureId: Schema.optionalKey(VentureId),
  approvalId: Schema.optionalKey(ApprovalRequestId),
}) {}

export const ProfitPeriods = Schema.Struct({
  today: MinorCurrencyAmount,
  week: MinorCurrencyAmount,
  month: MinorCurrencyAmount,
  all: MinorCurrencyAmount,
});
export type ProfitPeriods = typeof ProfitPeriods.Type;

export const SovereignOverviewSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  generatedAt: IsoDateTime,
  controlState: GlobalControlState,
  financialSummary: FinancialPipelineMetrics,
  profitPeriods: Schema.optionalKey(ProfitPeriods),
  ventures: Schema.Array(VentureOverviewRow),
  blueprints: Schema.Array(VentureBlueprint),
  activeObjectives: Schema.Array(CommercialObjective),
  pendingApprovals: Schema.Array(ApprovalRequest),
  activeTasks: Schema.Array(CommercialTask),
  recentAuditEvents: Schema.Array(AuditEvent),
  providerPool: ProviderPoolSnapshot,
  integrationsSummary: IntegrationSummary,
  recommendations: Schema.Array(PortfolioRecommendation),
});
export type SovereignOverviewSnapshot = typeof SovereignOverviewSnapshot.Type;

export const SovereignVentureDetail = Schema.Struct({
  venture: Venture,
  objectives: Schema.Array(CommercialObjective),
  opportunities: Schema.Array(Opportunity),
  tasks: Schema.Array(CommercialTask),
  leads: Schema.Array(Lead),
  customers: Schema.Array(Customer),
  proposals: Schema.Array(Proposal),
  orders: Schema.Array(Order),
  invoices: Schema.Array(Invoice),
  paymentLinks: Schema.Array(PaymentLink),
  communications: Schema.Array(CommunicationRecord),
  supportTickets: Schema.Array(SupportTicket),
  voiceAgents: Schema.Array(VoiceAgentConfig),
  financialSummary: FinancialPipelineMetrics,
  recentLedgerEntries: Schema.Array(LedgerEntry),
  approvals: Schema.Array(ApprovalRequest),
  preapprovalPolicies: Schema.Array(PreapprovalPolicy),
  artifacts: Schema.Array(CommercialArtifact),
  auditEvents: Schema.Array(AuditEvent),
  integrations: Schema.Array(IntegrationConfig),
});
export type SovereignVentureDetail = typeof SovereignVentureDetail.Type;

const sovereignEventHeader = {
  version: Schema.Literal(1),
  revision: NonNegativeInt,
};

export const SovereignSnapshotEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("snapshot"),
  payload: SovereignOverviewSnapshot,
});
export type SovereignSnapshotEvent = typeof SovereignSnapshotEvent.Type;

export const SovereignControlStateUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("controlStateUpdated"),
  payload: GlobalControlState,
});
export type SovereignControlStateUpdatedEvent = typeof SovereignControlStateUpdatedEvent.Type;

export const SovereignVentureUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("ventureUpdated"),
  payload: VentureOverviewRow,
});
export type SovereignVentureUpdatedEvent = typeof SovereignVentureUpdatedEvent.Type;

export const SovereignVentureRemovedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("ventureRemoved"),
  payload: Schema.Struct({ ventureId: VentureId }),
});
export type SovereignVentureRemovedEvent = typeof SovereignVentureRemovedEvent.Type;

export const SovereignApprovalUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("approvalUpdated"),
  payload: ApprovalRequest,
});
export type SovereignApprovalUpdatedEvent = typeof SovereignApprovalUpdatedEvent.Type;

export const SovereignTaskUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("taskUpdated"),
  payload: CommercialTask,
});
export type SovereignTaskUpdatedEvent = typeof SovereignTaskUpdatedEvent.Type;

export const SovereignLedgerEntryRecordedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("ledgerEntryRecorded"),
  payload: Schema.Struct({
    entry: LedgerEntry,
    financialSummary: FinancialPipelineMetrics,
  }),
});
export type SovereignLedgerEntryRecordedEvent = typeof SovereignLedgerEntryRecordedEvent.Type;

export const SovereignProviderPoolUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("providerPoolUpdated"),
  payload: ProviderPoolSnapshot,
});
export type SovereignProviderPoolUpdatedEvent = typeof SovereignProviderPoolUpdatedEvent.Type;

export const SovereignIntegrationUpdatedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("integrationUpdated"),
  payload: IntegrationConfig,
});
export type SovereignIntegrationUpdatedEvent = typeof SovereignIntegrationUpdatedEvent.Type;

export const SovereignAuditEventAppendedEvent = Schema.Struct({
  ...sovereignEventHeader,
  type: Schema.Literal("auditEventAppended"),
  payload: AuditEvent,
});
export type SovereignAuditEventAppendedEvent = typeof SovereignAuditEventAppendedEvent.Type;

export const SovereignEvent = Schema.Union([
  SovereignSnapshotEvent,
  SovereignControlStateUpdatedEvent,
  SovereignVentureUpdatedEvent,
  SovereignVentureRemovedEvent,
  SovereignApprovalUpdatedEvent,
  SovereignTaskUpdatedEvent,
  SovereignLedgerEntryRecordedEvent,
  SovereignProviderPoolUpdatedEvent,
  SovereignIntegrationUpdatedEvent,
  SovereignAuditEventAppendedEvent,
]);
export type SovereignEvent = typeof SovereignEvent.Type;
