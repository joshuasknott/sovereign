import {
  type ApprovalRequest,
  ApprovalRequestId,
  type ApprovalStatus,
  type AuditEvent,
  AuditEventId,
  type AuditEventKind,
  type CommercialArtifact,
  ArtifactId,
  type CommercialObjective,
  ObjectiveId,
  type CommercialTask,
  CommercialTaskId,
  type CommercialTaskStatus,
  ConsentRecord,
  type CommunicationRecord,
  CommunicationId,
  type Customer,
  CustomerId,
  DEFAULT_GLOBAL_CONTROL_STATE,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  FxRatesToGbp,
  type GlobalControlState,
  type IntegrationConfig,
  IntegrationId,
  IntegrationSettingsMap,
  type Invoice,
  InvoiceId,
  type Lead,
  LeadId,
  type LedgerEntry,
  LedgerEntryId,
  type LedgerVerificationState,
  ObjectiveStrategyPlan as ObjectiveStrategyPlanSchema,
  type Opportunity,
  OpportunityId,
  OpportunityScore,
  type Order,
  OrderId,
  type PaymentLink,
  type PreapprovalPolicy,
  PreapprovalPolicyId,
  type ProfitPeriods,
  ProjectId,
  ProviderInstanceId,
  ProviderRoutingPolicy,
  ProposalLineItem,
  type Proposal,
  ProposalId,
  RunId,
  ScheduledTaskId,
  SecretReference,
  type SovereignEvent,
  SovereignMetadata,
  type SupportTicket,
  SupportTicketId,
  ThreadId,
  type Venture,
  VentureBudgetPolicy,
  VentureId,
  VenturePermissionPolicy,
  VentureUiModule,
  type VoiceAgentConfig,
  VoiceAgentId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { SovereignPersistenceError } from "./SovereignErrors.ts";

const decodeStringArrayJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const decodeUiModulesJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(VentureUiModule)),
);
const decodeBudgetPolicyJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(VentureBudgetPolicy),
);
const decodePermissionPolicyJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(VenturePermissionPolicy),
);
const decodeRoutingPolicyJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(ProviderRoutingPolicy),
);
const decodeFxRatesJson = Schema.decodeUnknownOption(Schema.fromJsonString(FxRatesToGbp));
const decodeMetadataJson = Schema.decodeUnknownOption(Schema.fromJsonString(SovereignMetadata));
const decodeStrategyPlanJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(ObjectiveStrategyPlanSchema),
);
const decodeOpportunityScoreJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(OpportunityScore),
);
const decodeConsentsJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(ConsentRecord)),
);
const decodeProposalLineItemsJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(ProposalLineItem)),
);
const decodeSecretReferenceJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(SecretReference),
);
const decodeIntegrationSettingsJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(IntegrationSettingsMap),
);

const encodeUnknownJson = (value: unknown): string => JSON.stringify(value);

const parseJsonOr = <A>(
  raw: string | null | undefined,
  decode: (input: unknown) => Option.Option<A>,
  fallback: A,
): A => {
  if (raw === null || raw === undefined || raw.length === 0) return fallback;
  return Option.getOrElse(decode(raw), () => fallback);
};

const mapPersistenceError =
  (operation: string, entity: string) =>
  (cause: unknown): SovereignPersistenceError =>
    new SovereignPersistenceError({ operation, entity, cause });

interface ControlStateRow {
  readonly id: string;
  readonly emergency_stop_active: number;
  readonly emergency_stop_reason: string | null;
  readonly emergency_stop_at: string | null;
  readonly reporting_currency: string;
  readonly global_monthly_budget_minor: number;
  readonly default_paid_fallback_mode: string;
  readonly prompt_injection_guard_enabled: number;
  readonly fx_rates_json: string;
  readonly revision: number;
  readonly updated_at: string;
}

interface VentureRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly template_key: string;
  readonly status: string;
  readonly summary: string;
  readonly ui_modules_json: string;
  readonly budget_policy_json: string;
  readonly permission_policy_json: string;
  readonly routing_policy_json: string;
  readonly linked_project_ids_json: string;
  readonly linked_thread_ids_json: string;
  readonly linked_scheduled_task_ids_json: string;
  readonly tags_json: string;
  readonly config_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ObjectiveRow {
  readonly id: string;
  readonly venture_id: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly horizon: string;
  readonly target_revenue_minor: number | null;
  readonly max_spend_minor: number;
  readonly currency: string;
  readonly target_deadline_at: string | null;
  readonly strategy_plan_json: string | null;
  readonly constraints_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface OpportunityRow {
  readonly id: string;
  readonly venture_id: string;
  readonly objective_id: string | null;
  readonly title: string;
  readonly summary: string;
  readonly source: string;
  readonly source_url: string | null;
  readonly external_id: string | null;
  readonly stage: string;
  readonly eligibility_status: string;
  readonly eligibility_notes: string | null;
  readonly automation_mode: string;
  readonly ai_permission_status: string;
  readonly estimated_value_minor: number | null;
  readonly currency: string;
  readonly score_json: string | null;
  readonly tags_json: string;
  readonly deadline_at: string | null;
  readonly metadata_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TaskRow {
  readonly id: string;
  readonly venture_id: string;
  readonly objective_id: string | null;
  readonly opportunity_id: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly complexity: string;
  readonly priority: number;
  readonly assigned_provider_instance_id: string | null;
  readonly assigned_model: string | null;
  readonly linked_thread_id: string | null;
  readonly linked_run_id: string | null;
  readonly pending_approval_id: string | null;
  readonly routing_policy_override_json: string | null;
  readonly blocked_reason: string | null;
  readonly idempotency_key: string | null;
  readonly checkpoint_json: string | null;
  readonly handoff_summary: string | null;
  readonly depends_on_json: string;
  readonly retry_count: number;
  readonly max_retries: number;
  readonly next_retry_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

interface ArtifactRow {
  readonly id: string;
  readonly venture_id: string;
  readonly task_id: string | null;
  readonly opportunity_id: string | null;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  readonly uri: string | null;
  readonly mime_type: string | null;
  readonly sha256: string | null;
  readonly metadata_json: string | null;
  readonly created_at: string;
}

interface LeadRow {
  readonly id: string;
  readonly venture_id: string;
  readonly name: string;
  readonly company: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website_url: string | null;
  readonly source: string;
  readonly stage: string;
  readonly consents_json: string;
  readonly notes: string;
  readonly tags_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CustomerRow {
  readonly id: string;
  readonly venture_id: string;
  readonly lead_id: string | null;
  readonly name: string;
  readonly company: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string;
  readonly consents_json: string;
  readonly billing_currency: string;
  readonly lifetime_collected_minor: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ProposalRow {
  readonly id: string;
  readonly venture_id: string;
  readonly lead_id: string | null;
  readonly customer_id: string | null;
  readonly opportunity_id: string | null;
  readonly title: string;
  readonly summary: string;
  readonly line_items_json: string;
  readonly subtotal_minor: number;
  readonly discount_pct: number;
  readonly total_minor: number;
  readonly currency: string;
  readonly status: string;
  readonly approval_id: string | null;
  readonly valid_until: string | null;
  readonly sent_at: string | null;
  readonly decided_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface OrderRow {
  readonly id: string;
  readonly venture_id: string;
  readonly customer_id: string;
  readonly proposal_id: string | null;
  readonly title: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface InvoiceRow {
  readonly id: string;
  readonly venture_id: string;
  readonly customer_id: string;
  readonly order_id: string | null;
  readonly invoice_number: string;
  readonly amount_minor: number;
  readonly paid_amount_minor: number;
  readonly currency: string;
  readonly status: string;
  readonly payment_link_url: string | null;
  readonly external_invoice_id: string | null;
  readonly issued_at: string | null;
  readonly due_at: string | null;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PaymentLinkRow {
  readonly id: string;
  readonly venture_id: string;
  readonly invoice_id: string | null;
  readonly integration_id: string | null;
  readonly label: string;
  readonly url: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly active: number;
  readonly created_at: string;
}

interface CommunicationRow {
  readonly id: string;
  readonly venture_id: string;
  readonly lead_id: string | null;
  readonly customer_id: string | null;
  readonly channel: string;
  readonly direction: string;
  readonly sender_type: string;
  readonly ai_disclosed: number;
  readonly consent_verified: number;
  readonly subject: string | null;
  readonly body_preview: string;
  readonly status: string;
  readonly approval_id: string | null;
  readonly external_message_id: string | null;
  readonly sent_at: string | null;
  readonly created_at: string;
}

interface SupportTicketRow {
  readonly id: string;
  readonly venture_id: string;
  readonly customer_id: string;
  readonly order_id: string | null;
  readonly subject: string;
  readonly summary: string;
  readonly status: string;
  readonly priority: string;
  readonly handled_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly resolved_at: string | null;
}

interface VoiceAgentRow {
  readonly id: string;
  readonly venture_id: string;
  readonly name: string;
  readonly provider_integration_id: string | null;
  readonly direction: string;
  readonly status: string;
  readonly phone_number_label: string | null;
  readonly ai_disclosure_greeting: string;
  readonly recording_disclosure_enabled: number;
  readonly opt_out_phrase_enabled: number;
  readonly escalation_number_label: string | null;
  readonly script_summary: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface LedgerEntryRow {
  readonly id: string;
  readonly venture_id: string | null;
  readonly order_id: string | null;
  readonly invoice_id: string | null;
  readonly task_id: string | null;
  readonly integration_id: string | null;
  readonly entry_type: string;
  readonly verification_state: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly reporting_amount_gbp_minor: number;
  readonly fx_rate_to_gbp: number;
  readonly description: string;
  readonly external_ref: string | null;
  readonly recorded_by: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
}

interface ApprovalRow {
  readonly id: string;
  readonly venture_id: string | null;
  readonly objective_id: string | null;
  readonly task_id: string | null;
  readonly category: string;
  readonly status: string;
  readonly risk_level: string;
  readonly title: string;
  readonly summary: string;
  readonly requested_action: string;
  readonly target_label: string | null;
  readonly estimated_cost_minor: number | null;
  readonly currency: string | null;
  readonly payload_json: string | null;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly expires_at: string | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
  readonly decision_note: string | null;
  readonly preapproval_policy_id: string | null;
  readonly idempotency_key: string | null;
}

interface PreapprovalPolicyRow {
  readonly id: string;
  readonly venture_id: string | null;
  readonly category: string;
  readonly label: string;
  readonly enabled: number;
  readonly max_single_action_minor: number | null;
  readonly max_monthly_aggregate_minor: number | null;
  readonly currency: string;
  readonly allowed_targets_json: string;
  readonly expires_at: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface IntegrationRow {
  readonly id: string;
  readonly venture_id: string | null;
  readonly category: string;
  readonly provider_kind: string;
  readonly display_name: string;
  readonly status: string;
  readonly enabled: number;
  readonly sandbox_mode: number;
  readonly endpoint_url: string | null;
  readonly account_label: string | null;
  readonly has_secret: number;
  readonly secret_reference_json: string | null;
  readonly settings_json: string;
  readonly last_tested_at: string | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuditEventRow {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly venture_id: string | null;
  readonly actor: string;
  readonly summary: string;
  readonly category: string | null;
  readonly approval_id: string | null;
  readonly task_id: string | null;
  readonly provider_instance_id: string | null;
  readonly integration_id: string | null;
  readonly metadata_json: string | null;
  readonly created_at: string;
}

export interface PersistedTaskRecord {
  readonly task: CommercialTask;
  readonly idempotencyKey: string | null;
  readonly checkpointJson: string | null;
  readonly handoffSummary: string | null;
  readonly dependsOn: ReadonlyArray<CommercialTaskId>;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly nextRetryAt: string | null;
}

export interface ControlStateWithRevision {
  readonly controlState: GlobalControlState;
  readonly revision: number;
}

const mapControlStateRow = (row: ControlStateRow): ControlStateWithRevision => ({
  revision: row.revision,
  controlState: {
    emergencyStopActive: row.emergency_stop_active === 1,
    emergencyStopReason: row.emergency_stop_reason,
    emergencyStopAt: row.emergency_stop_at,
    reportingCurrency: row.reporting_currency,
    globalMonthlyBudgetMinor: row.global_monthly_budget_minor,
    defaultPaidFallbackMode:
      row.default_paid_fallback_mode as GlobalControlState["defaultPaidFallbackMode"],
    promptInjectionGuardEnabled: row.prompt_injection_guard_enabled === 1,
    fxRatesToGbp: parseJsonOr(
      row.fx_rates_json,
      decodeFxRatesJson,
      DEFAULT_GLOBAL_CONTROL_STATE.fxRatesToGbp,
    ),
    updatedAt: row.updated_at,
  },
});

const mapVentureRow = (row: VentureRow): Venture => {
  const config = row.config_json
    ? Option.getOrUndefined(decodeMetadataJson(row.config_json))
    : undefined;
  return {
    id: VentureId.make(row.id),
    slug: row.slug,
    name: row.name,
    kind: row.kind as Venture["kind"],
    templateKey: row.template_key,
    status: row.status as Venture["status"],
    summary: row.summary,
    uiModules: parseJsonOr(row.ui_modules_json, decodeUiModulesJson, ["operations"]),
    budgetPolicy: parseJsonOr(
      row.budget_policy_json,
      decodeBudgetPolicyJson,
      DEFAULT_VENTURE_BUDGET_POLICY,
    ),
    permissionPolicy: parseJsonOr(
      row.permission_policy_json,
      decodePermissionPolicyJson,
      DEFAULT_VENTURE_PERMISSION_POLICY,
    ),
    routingPolicy: parseJsonOr(
      row.routing_policy_json,
      decodeRoutingPolicyJson,
      DEFAULT_PROVIDER_ROUTING_POLICY,
    ),
    linkedProjectIds: parseJsonOr(row.linked_project_ids_json, decodeStringArrayJson, []).map(
      (id) => ProjectId.make(id),
    ),
    linkedThreadIds: parseJsonOr(row.linked_thread_ids_json, decodeStringArrayJson, []).map((id) =>
      ThreadId.make(id),
    ),
    linkedScheduledTaskIds: parseJsonOr(
      row.linked_scheduled_task_ids_json,
      decodeStringArrayJson,
      [],
    ).map((id) => ScheduledTaskId.make(id)),
    tags: parseJsonOr(row.tags_json, decodeStringArrayJson, []),
    ...(config === undefined ? {} : { config }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapObjectiveRow = (row: ObjectiveRow): CommercialObjective => ({
  id: ObjectiveId.make(row.id),
  ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
  title: row.title,
  description: row.description,
  status: row.status as CommercialObjective["status"],
  horizon: row.horizon as CommercialObjective["horizon"],
  targetRevenueMinor: row.target_revenue_minor,
  maxSpendMinor: row.max_spend_minor,
  currency: row.currency,
  targetDeadlineAt: row.target_deadline_at,
  strategyPlan: row.strategy_plan_json
    ? Option.getOrElse(decodeStrategyPlanJson(row.strategy_plan_json), () => null)
    : null,
  constraints: parseJsonOr(row.constraints_json, decodeStringArrayJson, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapOpportunityRow = (row: OpportunityRow): Opportunity => {
  const metadata = row.metadata_json
    ? Option.getOrUndefined(decodeMetadataJson(row.metadata_json))
    : undefined;
  return {
    id: OpportunityId.make(row.id),
    ventureId: VentureId.make(row.venture_id),
    objectiveId: row.objective_id === null ? null : ObjectiveId.make(row.objective_id),
    title: row.title,
    summary: row.summary,
    source: row.source,
    sourceUrl: row.source_url,
    externalRef: row.external_id,
    stage: row.stage as Opportunity["stage"],
    eligibilityStatus: row.eligibility_status as Opportunity["eligibilityStatus"],
    ...(row.eligibility_notes === null ? {} : { eligibilityNotes: row.eligibility_notes }),
    automationMode: row.automation_mode as Opportunity["automationMode"],
    aiPermissionStatus: row.ai_permission_status as Opportunity["aiPermissionStatus"],
    estimatedValueMinor: row.estimated_value_minor,
    currency: row.currency,
    score: row.score_json
      ? Option.getOrElse(decodeOpportunityScoreJson(row.score_json), () => null)
      : null,
    tags: parseJsonOr(row.tags_json, decodeStringArrayJson, []),
    deadlineAt: row.deadline_at,
    ...(metadata === undefined ? {} : { metadata }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapTaskRow = (row: TaskRow, artifactIds: ReadonlyArray<ArtifactId>): PersistedTaskRecord => {
  const routingOverride = row.routing_policy_override_json
    ? Option.getOrNull(decodeRoutingPolicyJson(row.routing_policy_override_json))
    : undefined;
  const normalizedStatus: CommercialTaskStatus =
    row.status === "running" ? "in_progress" : (row.status as CommercialTaskStatus);
  return {
    task: {
      id: CommercialTaskId.make(row.id),
      ventureId: VentureId.make(row.venture_id),
      objectiveId: row.objective_id === null ? null : ObjectiveId.make(row.objective_id),
      opportunityId: row.opportunity_id === null ? null : OpportunityId.make(row.opportunity_id),
      title: row.title,
      description: row.description,
      status: normalizedStatus,
      complexity: row.complexity as CommercialTask["complexity"],
      priority: row.priority,
      assignedProviderInstanceId:
        row.assigned_provider_instance_id === null
          ? null
          : ProviderInstanceId.make(row.assigned_provider_instance_id),
      assignedModel: row.assigned_model,
      linkedThreadId: row.linked_thread_id === null ? null : ThreadId.make(row.linked_thread_id),
      linkedRunId: row.linked_run_id === null ? null : RunId.make(row.linked_run_id),
      pendingApprovalId:
        row.pending_approval_id === null ? null : ApprovalRequestId.make(row.pending_approval_id),
      ...(routingOverride === undefined ? {} : { routingPolicyOverride: routingOverride }),
      ...(row.blocked_reason === null ? {} : { blockedReason: row.blocked_reason }),
      artifactIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    },
    idempotencyKey: row.idempotency_key,
    checkpointJson: row.checkpoint_json,
    handoffSummary: row.handoff_summary,
    dependsOn: parseJsonOr(row.depends_on_json, decodeStringArrayJson, []).map((id) =>
      CommercialTaskId.make(id),
    ),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at,
  };
};

const mapArtifactRow = (row: ArtifactRow): CommercialArtifact => {
  const metadata = row.metadata_json
    ? Option.getOrUndefined(decodeMetadataJson(row.metadata_json))
    : undefined;
  return {
    id: ArtifactId.make(row.id),
    ventureId: VentureId.make(row.venture_id),
    taskId: row.task_id === null ? null : CommercialTaskId.make(row.task_id),
    ...(row.opportunity_id === null
      ? {}
      : { opportunityId: OpportunityId.make(row.opportunity_id) }),
    kind: row.kind as CommercialArtifact["kind"],
    title: row.title,
    summary: row.summary,
    uri: row.uri,
    ...(row.mime_type === null ? {} : { mimeType: row.mime_type }),
    ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
    ...(metadata === undefined ? {} : { metadata }),
    createdAt: row.created_at,
  };
};

const mapLeadRow = (row: LeadRow): Lead => ({
  id: LeadId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  name: row.name,
  company: row.company,
  email: row.email,
  phone: row.phone,
  websiteUrl: row.website_url,
  source: row.source,
  stage: row.stage as Lead["stage"],
  consents: parseJsonOr(row.consents_json, decodeConsentsJson, []),
  notes: row.notes,
  tags: parseJsonOr(row.tags_json, decodeStringArrayJson, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapCustomerRow = (row: CustomerRow): Customer => ({
  id: CustomerId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  leadId: row.lead_id === null ? null : LeadId.make(row.lead_id),
  name: row.name,
  company: row.company,
  email: row.email,
  phone: row.phone,
  status: row.status as Customer["status"],
  consents: parseJsonOr(row.consents_json, decodeConsentsJson, []),
  billingCurrency: row.billing_currency,
  lifetimeCollectedMinor: row.lifetime_collected_minor,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapProposalRow = (row: ProposalRow): Proposal => ({
  id: ProposalId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  leadId: row.lead_id === null ? null : LeadId.make(row.lead_id),
  customerId: row.customer_id === null ? null : CustomerId.make(row.customer_id),
  opportunityId: row.opportunity_id === null ? null : OpportunityId.make(row.opportunity_id),
  title: row.title,
  summary: row.summary,
  lineItems: parseJsonOr(row.line_items_json, decodeProposalLineItemsJson, []),
  subtotalMinor: row.subtotal_minor,
  discountPct: row.discount_pct,
  totalMinor: row.total_minor,
  currency: row.currency,
  status: row.status as Proposal["status"],
  approvalId: row.approval_id === null ? null : ApprovalRequestId.make(row.approval_id),
  validUntil: row.valid_until,
  sentAt: row.sent_at,
  decidedAt: row.decided_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapOrderRow = (row: OrderRow): Order => ({
  id: OrderId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  customerId: CustomerId.make(row.customer_id),
  proposalId: row.proposal_id === null ? null : ProposalId.make(row.proposal_id),
  title: row.title,
  amountMinor: row.amount_minor,
  currency: row.currency,
  status: row.status as Order["status"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapInvoiceRow = (row: InvoiceRow): Invoice => ({
  id: InvoiceId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  customerId: CustomerId.make(row.customer_id),
  orderId: row.order_id === null ? null : OrderId.make(row.order_id),
  invoiceNumber: row.invoice_number,
  amountMinor: row.amount_minor,
  paidAmountMinor: row.paid_amount_minor,
  currency: row.currency,
  status: row.status as Invoice["status"],
  paymentLinkUrl: row.payment_link_url,
  externalInvoiceId: row.external_invoice_id,
  issuedAt: row.issued_at,
  dueAt: row.due_at,
  paidAt: row.paid_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapPaymentLinkRow = (row: PaymentLinkRow): PaymentLink => ({
  id: row.id,
  ventureId: VentureId.make(row.venture_id),
  invoiceId: row.invoice_id === null ? null : InvoiceId.make(row.invoice_id),
  integrationId: row.integration_id === null ? null : IntegrationId.make(row.integration_id),
  label: row.label,
  url: row.url,
  amountMinor: row.amount_minor,
  currency: row.currency,
  active: row.active === 1,
  createdAt: row.created_at,
});

const mapCommunicationRow = (row: CommunicationRow): CommunicationRecord => ({
  id: CommunicationId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  leadId: row.lead_id === null ? null : LeadId.make(row.lead_id),
  customerId: row.customer_id === null ? null : CustomerId.make(row.customer_id),
  channel: row.channel as CommunicationRecord["channel"],
  direction: row.direction as CommunicationRecord["direction"],
  senderType: row.sender_type as CommunicationRecord["senderType"],
  aiDisclosed: row.ai_disclosed === 1,
  consentVerified: row.consent_verified === 1,
  subject: row.subject,
  bodyPreview: row.body_preview,
  status: row.status as CommunicationRecord["status"],
  approvalId: row.approval_id === null ? null : ApprovalRequestId.make(row.approval_id),
  ...(row.external_message_id === null ? {} : { externalMessageId: row.external_message_id }),
  sentAt: row.sent_at,
  createdAt: row.created_at,
});

const mapSupportTicketRow = (row: SupportTicketRow): SupportTicket => ({
  id: SupportTicketId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  customerId: CustomerId.make(row.customer_id),
  orderId: row.order_id === null ? null : OrderId.make(row.order_id),
  subject: row.subject,
  summary: row.summary,
  status: row.status as SupportTicket["status"],
  priority: row.priority as SupportTicket["priority"],
  handledBy: row.handled_by as SupportTicket["handledBy"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
});

const mapVoiceAgentRow = (row: VoiceAgentRow): VoiceAgentConfig => ({
  id: VoiceAgentId.make(row.id),
  ventureId: VentureId.make(row.venture_id),
  name: row.name,
  providerIntegrationId:
    row.provider_integration_id === null ? null : IntegrationId.make(row.provider_integration_id),
  direction: row.direction as VoiceAgentConfig["direction"],
  status: row.status as VoiceAgentConfig["status"],
  phoneNumberLabel: row.phone_number_label,
  aiDisclosureGreeting: row.ai_disclosure_greeting,
  recordingDisclosureEnabled: row.recording_disclosure_enabled === 1,
  optOutPhraseEnabled: row.opt_out_phrase_enabled === 1,
  escalationNumberLabel: row.escalation_number_label,
  scriptSummary: row.script_summary,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapLedgerEntryRow = (row: LedgerEntryRow): LedgerEntry => ({
  id: LedgerEntryId.make(row.id),
  ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
  ...(row.order_id === null ? {} : { orderId: OrderId.make(row.order_id) }),
  ...(row.invoice_id === null ? {} : { invoiceId: InvoiceId.make(row.invoice_id) }),
  ...(row.task_id === null ? {} : { taskId: CommercialTaskId.make(row.task_id) }),
  ...(row.integration_id === null ? {} : { integrationId: IntegrationId.make(row.integration_id) }),
  entryType: row.entry_type as LedgerEntry["entryType"],
  verificationState: row.verification_state as LedgerVerificationState,
  amountMinor: row.amount_minor,
  currency: row.currency,
  reportingAmountGbpMinor: row.reporting_amount_gbp_minor,
  fxRateToGbp: row.fx_rate_to_gbp,
  description: row.description,
  externalRef: row.external_ref,
  recordedBy: row.recorded_by,
  occurredAt: row.occurred_at,
  recordedAt: row.recorded_at,
});

const mapApprovalRow = (row: ApprovalRow): ApprovalRequest => {
  const payload = row.payload_json
    ? Option.getOrUndefined(decodeMetadataJson(row.payload_json))
    : undefined;
  return {
    id: ApprovalRequestId.make(row.id),
    ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
    ...(row.objective_id === null ? {} : { objectiveId: ObjectiveId.make(row.objective_id) }),
    ...(row.task_id === null ? {} : { taskId: CommercialTaskId.make(row.task_id) }),
    category: row.category as ApprovalRequest["category"],
    status: row.status as ApprovalStatus,
    riskLevel: row.risk_level as ApprovalRequest["riskLevel"],
    title: row.title,
    summary: row.summary,
    requestedAction: row.requested_action,
    ...(row.target_label === null ? {} : { targetLabel: row.target_label }),
    ...(row.estimated_cost_minor === null ? {} : { estimatedCostMinor: row.estimated_cost_minor }),
    ...(row.currency === null ? {} : { currency: row.currency }),
    ...(payload === undefined ? {} : { payload }),
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
    ...(row.decision_note === null ? {} : { decisionNote: row.decision_note }),
    ...(row.preapproval_policy_id === null
      ? {}
      : { preapprovalPolicyId: PreapprovalPolicyId.make(row.preapproval_policy_id) }),
  };
};

const mapPreapprovalPolicyRow = (row: PreapprovalPolicyRow): PreapprovalPolicy => ({
  id: PreapprovalPolicyId.make(row.id),
  ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
  category: row.category as PreapprovalPolicy["category"],
  label: row.label,
  enabled: row.enabled === 1,
  maxSingleActionMinor: row.max_single_action_minor,
  maxMonthlyAggregateMinor: row.max_monthly_aggregate_minor,
  currency: row.currency,
  allowedTargets: parseJsonOr(row.allowed_targets_json, decodeStringArrayJson, []),
  expiresAt: row.expires_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapIntegrationRow = (row: IntegrationRow): IntegrationConfig => {
  const secretRef = row.secret_reference_json
    ? Option.getOrNull(decodeSecretReferenceJson(row.secret_reference_json))
    : undefined;
  return {
    id: IntegrationId.make(row.id),
    ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
    category: row.category as IntegrationConfig["category"],
    providerKind: row.provider_kind as IntegrationConfig["providerKind"],
    displayName: row.display_name,
    status: row.status as IntegrationConfig["status"],
    enabled: row.enabled === 1,
    sandboxMode: row.sandbox_mode === 1,
    endpointUrl: row.endpoint_url,
    accountLabel: row.account_label,
    hasSecret: row.has_secret === 1,
    ...(secretRef === undefined ? {} : { secretReference: secretRef }),
    settings: parseJsonOr(row.settings_json, decodeIntegrationSettingsJson, {}),
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapAuditEventRow = (row: AuditEventRow): AuditEvent => {
  const metadata = row.metadata_json
    ? Option.getOrUndefined(decodeMetadataJson(row.metadata_json))
    : undefined;
  return {
    id: AuditEventId.make(row.id),
    kind: row.kind as AuditEventKind,
    severity: row.severity as AuditEvent["severity"],
    ventureId: row.venture_id === null ? null : VentureId.make(row.venture_id),
    actor: row.actor,
    summary: row.summary,
    ...(row.category === null
      ? {}
      : { category: row.category as NonNullable<AuditEvent["category"]> }),
    ...(row.approval_id === null ? {} : { approvalId: ApprovalRequestId.make(row.approval_id) }),
    ...(row.task_id === null ? {} : { taskId: CommercialTaskId.make(row.task_id) }),
    ...(row.provider_instance_id === null
      ? {}
      : { providerInstanceId: ProviderInstanceId.make(row.provider_instance_id) }),
    ...(row.integration_id === null
      ? {}
      : { integrationId: IntegrationId.make(row.integration_id) }),
    ...(metadata === undefined ? {} : { metadata }),
    createdAt: row.created_at,
  };
};

export type SovereignEventWithoutHeader =
  | { readonly type: "controlStateUpdated"; readonly payload: GlobalControlState }
  | {
      readonly type: "ventureUpdated";
      readonly payload: Extract<SovereignEvent, { readonly type: "ventureUpdated" }>["payload"];
    }
  | { readonly type: "ventureRemoved"; readonly payload: { readonly ventureId: VentureId } }
  | { readonly type: "approvalUpdated"; readonly payload: ApprovalRequest }
  | { readonly type: "taskUpdated"; readonly payload: CommercialTask }
  | {
      readonly type: "ledgerEntryRecorded";
      readonly payload: Extract<
        SovereignEvent,
        { readonly type: "ledgerEntryRecorded" }
      >["payload"];
    }
  | {
      readonly type: "providerPoolUpdated";
      readonly payload: Extract<
        SovereignEvent,
        { readonly type: "providerPoolUpdated" }
      >["payload"];
    }
  | { readonly type: "integrationUpdated"; readonly payload: IntegrationConfig }
  | { readonly type: "auditEventAppended"; readonly payload: AuditEvent };

export class SovereignStore extends Context.Service<
  SovereignStore,
  {
    readonly nowIso: Effect.Effect<string>;
    readonly withTransaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | SovereignPersistenceError, R>;
    readonly getControlState: Effect.Effect<ControlStateWithRevision, SovereignPersistenceError>;
    readonly saveControlState: (
      next: GlobalControlState,
    ) => Effect.Effect<ControlStateWithRevision, SovereignPersistenceError>;
    readonly nextRevision: Effect.Effect<number, SovereignPersistenceError>;
    readonly publishEvent: (
      event: SovereignEventWithoutHeader,
    ) => Effect.Effect<SovereignEvent, SovereignPersistenceError>;
    readonly subscribeEvents: Effect.Effect<Stream.Stream<SovereignEvent>, never, Scope.Scope>;

    readonly listVentures: Effect.Effect<ReadonlyArray<Venture>, SovereignPersistenceError>;
    readonly getVenture: (
      ventureId: VentureId,
    ) => Effect.Effect<Option.Option<Venture>, SovereignPersistenceError>;
    readonly getVentureBySlug: (
      slug: string,
    ) => Effect.Effect<Option.Option<Venture>, SovereignPersistenceError>;
    readonly insertVenture: (venture: Venture) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateVenture: (venture: Venture) => Effect.Effect<void, SovereignPersistenceError>;
    readonly deleteVenture: (
      ventureId: VentureId,
    ) => Effect.Effect<boolean, SovereignPersistenceError>;

    readonly listObjectives: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly activeOnly?: boolean;
    }) => Effect.Effect<ReadonlyArray<CommercialObjective>, SovereignPersistenceError>;
    readonly getObjective: (
      objectiveId: ObjectiveId,
    ) => Effect.Effect<Option.Option<CommercialObjective>, SovereignPersistenceError>;
    readonly insertObjective: (
      objective: CommercialObjective,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateObjective: (
      objective: CommercialObjective,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listOpportunities: (filter?: {
      readonly ventureId?: VentureId;
    }) => Effect.Effect<ReadonlyArray<Opportunity>, SovereignPersistenceError>;
    readonly getOpportunity: (
      opportunityId: OpportunityId,
    ) => Effect.Effect<Option.Option<Opportunity>, SovereignPersistenceError>;
    readonly findOpportunityByExternalRef: (
      ventureId: VentureId,
      externalRef: string,
    ) => Effect.Effect<Option.Option<Opportunity>, SovereignPersistenceError>;
    readonly insertOpportunity: (
      opportunity: Opportunity,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateOpportunity: (
      opportunity: Opportunity,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listTasks: (filter?: {
      readonly ventureId?: VentureId;
      readonly activeOnly?: boolean;
    }) => Effect.Effect<ReadonlyArray<PersistedTaskRecord>, SovereignPersistenceError>;
    readonly getTask: (
      taskId: CommercialTaskId,
    ) => Effect.Effect<Option.Option<PersistedTaskRecord>, SovereignPersistenceError>;
    readonly findTaskByIdempotencyKey: (
      idempotencyKey: string,
    ) => Effect.Effect<Option.Option<PersistedTaskRecord>, SovereignPersistenceError>;
    readonly insertTask: (
      record: PersistedTaskRecord,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateTask: (
      record: PersistedTaskRecord,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly listInterruptedTasks: Effect.Effect<
      ReadonlyArray<PersistedTaskRecord>,
      SovereignPersistenceError
    >;
    readonly pauseActiveTasksForEmergencyStop: (
      reason: string,
      updatedAt: string,
    ) => Effect.Effect<ReadonlyArray<CommercialTask>, SovereignPersistenceError>;

    readonly listArtifacts: (filter?: {
      readonly ventureId?: VentureId;
      readonly taskId?: CommercialTaskId;
    }) => Effect.Effect<ReadonlyArray<CommercialArtifact>, SovereignPersistenceError>;
    readonly insertArtifact: (
      artifact: CommercialArtifact,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listLeads: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<Lead>, SovereignPersistenceError>;
    readonly getLead: (
      leadId: LeadId,
    ) => Effect.Effect<Option.Option<Lead>, SovereignPersistenceError>;
    readonly insertLead: (lead: Lead) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listCustomers: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<Customer>, SovereignPersistenceError>;
    readonly getCustomer: (
      customerId: CustomerId,
    ) => Effect.Effect<Option.Option<Customer>, SovereignPersistenceError>;
    readonly insertCustomer: (customer: Customer) => Effect.Effect<void, SovereignPersistenceError>;
    readonly addCustomerCollectedMinor: (
      customerId: CustomerId,
      deltaMinor: number,
      updatedAt: string,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listProposals: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<Proposal>, SovereignPersistenceError>;
    readonly findProposalByApprovalId: (
      approvalId: ApprovalRequestId,
    ) => Effect.Effect<Option.Option<Proposal>, SovereignPersistenceError>;
    readonly insertProposal: (proposal: Proposal) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateProposalStatus: (input: {
      readonly proposalId: ProposalId;
      readonly status: Proposal["status"];
      readonly decidedAt?: string | null;
      readonly updatedAt: string;
    }) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listOrders: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<Order>, SovereignPersistenceError>;
    readonly insertOrder: (order: Order) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listInvoices: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<Invoice>, SovereignPersistenceError>;
    readonly getInvoice: (
      invoiceId: InvoiceId,
    ) => Effect.Effect<Option.Option<Invoice>, SovereignPersistenceError>;
    readonly insertInvoice: (invoice: Invoice) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateInvoicePayment: (input: {
      readonly invoiceId: InvoiceId;
      readonly paidAmountMinor: number;
      readonly status: Invoice["status"];
      readonly paidAt: string | null;
      readonly updatedAt: string;
    }) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listPaymentLinks: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<PaymentLink>, SovereignPersistenceError>;

    readonly listCommunications: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<CommunicationRecord>, SovereignPersistenceError>;
    readonly insertCommunication: (
      record: CommunicationRecord,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listSupportTickets: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<SupportTicket>, SovereignPersistenceError>;
    readonly insertSupportTicket: (
      ticket: SupportTicket,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listVoiceAgents: (
      ventureId?: VentureId,
    ) => Effect.Effect<ReadonlyArray<VoiceAgentConfig>, SovereignPersistenceError>;
    readonly getVoiceAgent: (
      voiceAgentId: VoiceAgentId,
    ) => Effect.Effect<Option.Option<VoiceAgentConfig>, SovereignPersistenceError>;
    readonly upsertVoiceAgent: (
      agent: VoiceAgentConfig,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly getProfitPeriods: (
      asOf: string,
      reportingRate: number,
    ) => Effect.Effect<ProfitPeriods, SovereignPersistenceError>;
    readonly listLedgerEntries: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly verificationState?: LedgerVerificationState;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<LedgerEntry>, SovereignPersistenceError>;
    readonly findLedgerEntryByExternalRef: (
      externalRef: string,
    ) => Effect.Effect<Option.Option<LedgerEntry>, SovereignPersistenceError>;
    readonly insertLedgerEntry: (
      entry: LedgerEntry,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly sumVerifiedMonthlySpendGbpMinor: (input: {
      readonly ventureId?: VentureId | null;
      readonly sinceIso: string;
    }) => Effect.Effect<number, SovereignPersistenceError>;

    readonly listApprovals: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly status?: ApprovalStatus;
    }) => Effect.Effect<ReadonlyArray<ApprovalRequest>, SovereignPersistenceError>;
    readonly getApproval: (
      approvalId: ApprovalRequestId,
    ) => Effect.Effect<Option.Option<ApprovalRequest>, SovereignPersistenceError>;
    readonly findApprovalByIdempotencyKey: (
      idempotencyKey: string,
    ) => Effect.Effect<Option.Option<ApprovalRequest>, SovereignPersistenceError>;
    readonly insertApproval: (
      approval: ApprovalRequest,
      idempotencyKey?: string | null,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly updateApproval: (
      approval: ApprovalRequest,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly listPreapprovalPolicies: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly enabledOnly?: boolean;
    }) => Effect.Effect<ReadonlyArray<PreapprovalPolicy>, SovereignPersistenceError>;
    readonly getPreapprovalPolicy: (
      policyId: PreapprovalPolicyId,
    ) => Effect.Effect<Option.Option<PreapprovalPolicy>, SovereignPersistenceError>;
    readonly upsertPreapprovalPolicy: (
      policy: PreapprovalPolicy,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly deletePreapprovalPolicy: (
      policyId: PreapprovalPolicyId,
    ) => Effect.Effect<boolean, SovereignPersistenceError>;

    readonly listIntegrations: (filter?: {
      readonly ventureId?: VentureId | null;
    }) => Effect.Effect<ReadonlyArray<IntegrationConfig>, SovereignPersistenceError>;
    readonly getIntegration: (
      integrationId: IntegrationId,
    ) => Effect.Effect<Option.Option<IntegrationConfig>, SovereignPersistenceError>;
    readonly upsertIntegration: (
      integration: IntegrationConfig,
    ) => Effect.Effect<void, SovereignPersistenceError>;
    readonly deleteIntegration: (
      integrationId: IntegrationId,
    ) => Effect.Effect<boolean, SovereignPersistenceError>;

    readonly listAuditEvents: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly kind?: AuditEventKind;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<AuditEvent>, SovereignPersistenceError>;
    readonly appendAuditEvent: (
      event: AuditEvent,
    ) => Effect.Effect<void, SovereignPersistenceError>;

    readonly claimWebhookReplayKey: (input: {
      readonly integrationId: IntegrationId;
      readonly replayKey: string;
      readonly eventType: string;
      readonly receivedAt: string;
    }) => Effect.Effect<boolean, SovereignPersistenceError>;
  }
>()("t3/sovereign/SovereignStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventsPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<SovereignEvent>(),
    PubSub.shutdown,
  );

  const nowIso = Clock.currentTimeMillis.pipe(
    Effect.map((millis) => DateTime.formatIso(DateTime.makeUnsafe(millis))),
  );

  const withTransaction: SovereignStore["Service"]["withTransaction"] = (effect) =>
    sql.withTransaction(effect).pipe(
      Effect.catchIf(
        (error): error is Exclude<typeof error, never> =>
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "SqlError",
        (cause) =>
          Effect.fail(
            new SovereignPersistenceError({ operation: "commit", entity: "transaction", cause }),
          ),
      ),
    );

  const getControlState = Effect.fn("SovereignStore.getControlState")(function* () {
    const rows = yield* sql<ControlStateRow>`
      SELECT * FROM sovereign_control_state WHERE id = 'global'
    `.pipe(Effect.mapError(mapPersistenceError("read", "control_state")));
    const row = rows[0];
    if (row === undefined) {
      return {
        revision: 0,
        controlState: DEFAULT_GLOBAL_CONTROL_STATE,
      } satisfies ControlStateWithRevision;
    }
    return mapControlStateRow(row);
  });

  const nextRevision = Effect.fn("SovereignStore.nextRevision")(function* () {
    const rows = yield* sql<{ readonly revision: number }>`
      UPDATE sovereign_control_state
      SET revision = revision + 1
      WHERE id = 'global'
      RETURNING revision
    `.pipe(Effect.mapError(mapPersistenceError("increment", "revision")));
    return rows[0]?.revision ?? 1;
  });

  const saveControlState = Effect.fn("SovereignStore.saveControlState")(function* (
    next: GlobalControlState,
  ) {
    const updatedAt = next.updatedAt ?? (yield* nowIso);
    const rows = yield* sql<ControlStateRow>`
      UPDATE sovereign_control_state
      SET
        emergency_stop_active = ${next.emergencyStopActive ? 1 : 0},
        emergency_stop_reason = ${next.emergencyStopReason},
        emergency_stop_at = ${next.emergencyStopAt},
        reporting_currency = ${next.reportingCurrency},
        global_monthly_budget_minor = ${next.globalMonthlyBudgetMinor},
        default_paid_fallback_mode = ${next.defaultPaidFallbackMode},
        prompt_injection_guard_enabled = ${next.promptInjectionGuardEnabled ? 1 : 0},
        fx_rates_json = ${encodeUnknownJson(next.fxRatesToGbp)},
        revision = revision + 1,
        updated_at = ${updatedAt}
      WHERE id = 'global'
      RETURNING *
    `.pipe(Effect.mapError(mapPersistenceError("update", "control_state")));
    const row = rows[0];
    if (row === undefined) {
      return { revision: 1, controlState: { ...next, updatedAt } };
    }
    return mapControlStateRow(row);
  });

  const publishEvent = Effect.fn("SovereignStore.publishEvent")(function* (
    event: SovereignEventWithoutHeader,
  ) {
    const revision = yield* nextRevision();
    const full = {
      version: 1 as const,
      revision,
      ...event,
    } as SovereignEvent;
    yield* PubSub.publish(eventsPubSub, full);
    return full;
  });

  const subscribeEvents = Effect.map(PubSub.subscribe(eventsPubSub), (subscription) =>
    Stream.fromSubscription(subscription),
  );

  const listVentures = Effect.fn("SovereignStore.listVentures")(function* () {
    const rows = yield* sql<VentureRow>`
      SELECT * FROM sovereign_ventures ORDER BY created_at DESC
    `.pipe(Effect.mapError(mapPersistenceError("list", "ventures")));
    return rows.map(mapVentureRow);
  });

  const getVenture = Effect.fn("SovereignStore.getVenture")(function* (ventureId: VentureId) {
    const rows = yield* sql<VentureRow>`
      SELECT * FROM sovereign_ventures WHERE id = ${ventureId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "venture")));
    return rows[0] === undefined ? Option.none() : Option.some(mapVentureRow(rows[0]));
  });

  const getVentureBySlug = Effect.fn("SovereignStore.getVentureBySlug")(function* (slug: string) {
    const rows = yield* sql<VentureRow>`
      SELECT * FROM sovereign_ventures WHERE slug = ${slug}
    `.pipe(Effect.mapError(mapPersistenceError("get", "venture")));
    return rows[0] === undefined ? Option.none() : Option.some(mapVentureRow(rows[0]));
  });

  const insertVenture = Effect.fn("SovereignStore.insertVenture")(function* (venture: Venture) {
    yield* sql`
      INSERT INTO sovereign_ventures (
        id, slug, name, kind, template_key, status, summary,
        ui_modules_json, budget_policy_json, permission_policy_json, routing_policy_json,
        linked_project_ids_json, linked_thread_ids_json, linked_scheduled_task_ids_json,
        tags_json, config_json, created_at, updated_at
      ) VALUES (
        ${venture.id}, ${venture.slug}, ${venture.name}, ${venture.kind},
        ${venture.templateKey}, ${venture.status}, ${venture.summary},
        ${encodeUnknownJson(venture.uiModules)},
        ${encodeUnknownJson(venture.budgetPolicy)},
        ${encodeUnknownJson(venture.permissionPolicy)},
        ${encodeUnknownJson(venture.routingPolicy)},
        ${encodeUnknownJson(venture.linkedProjectIds)},
        ${encodeUnknownJson(venture.linkedThreadIds)},
        ${encodeUnknownJson(venture.linkedScheduledTaskIds)},
        ${encodeUnknownJson(venture.tags)},
        ${venture.config === undefined ? null : encodeUnknownJson(venture.config)},
        ${venture.createdAt}, ${venture.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "venture")));
  });

  const updateVenture = Effect.fn("SovereignStore.updateVenture")(function* (venture: Venture) {
    yield* sql`
      UPDATE sovereign_ventures SET
        name = ${venture.name},
        status = ${venture.status},
        summary = ${venture.summary},
        ui_modules_json = ${encodeUnknownJson(venture.uiModules)},
        budget_policy_json = ${encodeUnknownJson(venture.budgetPolicy)},
        permission_policy_json = ${encodeUnknownJson(venture.permissionPolicy)},
        routing_policy_json = ${encodeUnknownJson(venture.routingPolicy)},
        linked_project_ids_json = ${encodeUnknownJson(venture.linkedProjectIds)},
        linked_thread_ids_json = ${encodeUnknownJson(venture.linkedThreadIds)},
        linked_scheduled_task_ids_json = ${encodeUnknownJson(venture.linkedScheduledTaskIds)},
        tags_json = ${encodeUnknownJson(venture.tags)},
        config_json = ${venture.config === undefined ? null : encodeUnknownJson(venture.config)},
        updated_at = ${venture.updatedAt}
      WHERE id = ${venture.id}
    `.pipe(Effect.mapError(mapPersistenceError("update", "venture")));
  });

  const deleteVenture = Effect.fn("SovereignStore.deleteVenture")(function* (ventureId: VentureId) {
    const rows = yield* sql<{ readonly id: string }>`
      DELETE FROM sovereign_ventures WHERE id = ${ventureId} RETURNING id
    `.pipe(Effect.mapError(mapPersistenceError("delete", "venture")));
    return rows.length > 0;
  });

  const listObjectives = Effect.fn("SovereignStore.listObjectives")(
    function* (filter?: { readonly ventureId?: VentureId | null; readonly activeOnly?: boolean }) {
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<ObjectiveRow>`
              SELECT * FROM sovereign_objectives
              WHERE venture_id = ${filter.ventureId}
              ORDER BY updated_at DESC
            `
          : yield* sql<ObjectiveRow>`
              SELECT * FROM sovereign_objectives
              ORDER BY updated_at DESC
            `;
      const mapped = rows.map(mapObjectiveRow);
      return filter?.activeOnly
        ? mapped.filter((item) => item.status === "active" || item.status === "draft")
        : mapped;
    },
    Effect.mapError(mapPersistenceError("list", "objectives")),
  );

  const getObjective = Effect.fn("SovereignStore.getObjective")(function* (
    objectiveId: ObjectiveId,
  ) {
    const rows = yield* sql<ObjectiveRow>`
      SELECT * FROM sovereign_objectives WHERE id = ${objectiveId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "objective")));
    return rows[0] === undefined ? Option.none() : Option.some(mapObjectiveRow(rows[0]));
  });

  const insertObjective = Effect.fn("SovereignStore.insertObjective")(function* (
    objective: CommercialObjective,
  ) {
    yield* sql`
      INSERT INTO sovereign_objectives (
        id, venture_id, title, description, status, horizon,
        target_revenue_minor, max_spend_minor, currency, target_deadline_at,
        strategy_plan_json, constraints_json, created_at, updated_at
      ) VALUES (
        ${objective.id}, ${objective.ventureId}, ${objective.title}, ${objective.description},
        ${objective.status}, ${objective.horizon}, ${objective.targetRevenueMinor},
        ${objective.maxSpendMinor}, ${objective.currency}, ${objective.targetDeadlineAt},
        ${objective.strategyPlan === null ? null : encodeUnknownJson(objective.strategyPlan)},
        ${encodeUnknownJson(objective.constraints)},
        ${objective.createdAt}, ${objective.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "objective")));
  });

  const updateObjective = Effect.fn("SovereignStore.updateObjective")(function* (
    objective: CommercialObjective,
  ) {
    yield* sql`
      UPDATE sovereign_objectives SET
        status = ${objective.status},
        title = ${objective.title},
        description = ${objective.description},
        horizon = ${objective.horizon},
        target_revenue_minor = ${objective.targetRevenueMinor},
        max_spend_minor = ${objective.maxSpendMinor},
        target_deadline_at = ${objective.targetDeadlineAt},
        strategy_plan_json = ${objective.strategyPlan === null ? null : encodeUnknownJson(objective.strategyPlan)},
        constraints_json = ${encodeUnknownJson(objective.constraints)},
        updated_at = ${objective.updatedAt}
      WHERE id = ${objective.id}
    `.pipe(Effect.mapError(mapPersistenceError("update", "objective")));
  });

  const listOpportunities = Effect.fn("SovereignStore.listOpportunities")(
    function* (filter?: { readonly ventureId?: VentureId }) {
      const rows =
        filter?.ventureId !== undefined
          ? yield* sql<OpportunityRow>`
              SELECT * FROM sovereign_opportunities
              WHERE venture_id = ${filter.ventureId}
              ORDER BY updated_at DESC
            `
          : yield* sql<OpportunityRow>`
              SELECT * FROM sovereign_opportunities
              ORDER BY updated_at DESC
            `;
      return rows.map(mapOpportunityRow);
    },
    Effect.mapError(mapPersistenceError("list", "opportunities")),
  );

  const getOpportunity = Effect.fn("SovereignStore.getOpportunity")(function* (
    opportunityId: OpportunityId,
  ) {
    const rows = yield* sql<OpportunityRow>`
      SELECT * FROM sovereign_opportunities WHERE id = ${opportunityId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "opportunity")));
    return rows[0] === undefined ? Option.none() : Option.some(mapOpportunityRow(rows[0]));
  });

  const findOpportunityByExternalRef = Effect.fn("SovereignStore.findOpportunityByExternalRef")(
    function* (ventureId: VentureId, externalRef: string) {
      const rows = yield* sql<OpportunityRow>`
        SELECT * FROM sovereign_opportunities
        WHERE venture_id = ${ventureId} AND external_id = ${externalRef}
      `.pipe(Effect.mapError(mapPersistenceError("find", "opportunity")));
      return rows[0] === undefined ? Option.none() : Option.some(mapOpportunityRow(rows[0]));
    },
  );

  const insertOpportunity = Effect.fn("SovereignStore.insertOpportunity")(function* (
    opportunity: Opportunity,
  ) {
    yield* sql`
      INSERT INTO sovereign_opportunities (
        id, venture_id, objective_id, title, summary, source, source_url, external_id,
        stage, eligibility_status, eligibility_notes, automation_mode, ai_permission_status,
        estimated_value_minor, currency, score_json, tags_json, deadline_at, metadata_json,
        created_at, updated_at
      ) VALUES (
        ${opportunity.id}, ${opportunity.ventureId}, ${opportunity.objectiveId},
        ${opportunity.title}, ${opportunity.summary}, ${opportunity.source},
        ${opportunity.sourceUrl}, ${opportunity.externalRef},
        ${opportunity.stage}, ${opportunity.eligibilityStatus},
        ${opportunity.eligibilityNotes ?? null}, ${opportunity.automationMode},
        ${opportunity.aiPermissionStatus}, ${opportunity.estimatedValueMinor},
        ${opportunity.currency},
        ${opportunity.score === null ? null : encodeUnknownJson(opportunity.score)},
        ${encodeUnknownJson(opportunity.tags)}, ${opportunity.deadlineAt},
        ${opportunity.metadata === undefined ? null : encodeUnknownJson(opportunity.metadata)},
        ${opportunity.createdAt}, ${opportunity.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "opportunity")));
  });

  const updateOpportunity = Effect.fn("SovereignStore.updateOpportunity")(function* (
    opportunity: Opportunity,
  ) {
    yield* sql`
      UPDATE sovereign_opportunities SET
        objective_id = ${opportunity.objectiveId},
        title = ${opportunity.title},
        summary = ${opportunity.summary},
        stage = ${opportunity.stage},
        eligibility_status = ${opportunity.eligibilityStatus},
        eligibility_notes = ${opportunity.eligibilityNotes ?? null},
        automation_mode = ${opportunity.automationMode},
        ai_permission_status = ${opportunity.aiPermissionStatus},
        estimated_value_minor = ${opportunity.estimatedValueMinor},
        currency = ${opportunity.currency},
        score_json = ${opportunity.score === null ? null : encodeUnknownJson(opportunity.score)},
        tags_json = ${encodeUnknownJson(opportunity.tags)},
        deadline_at = ${opportunity.deadlineAt},
        metadata_json = ${opportunity.metadata === undefined ? null : encodeUnknownJson(opportunity.metadata)},
        updated_at = ${opportunity.updatedAt}
      WHERE id = ${opportunity.id}
    `.pipe(Effect.mapError(mapPersistenceError("update", "opportunity")));
  });

  const loadTaskArtifactMap = Effect.fnUntraced(function* (taskIds: ReadonlyArray<string>) {
    const map = new Map<string, Array<ArtifactId>>();
    if (taskIds.length === 0) return map;
    const rows = yield* sql<{ readonly id: string; readonly task_id: string | null }>`
      SELECT id, task_id FROM sovereign_artifacts WHERE task_id IS NOT NULL
    `.pipe(Effect.mapError(mapPersistenceError("list", "task_artifacts")));
    const allowed = new Set(taskIds);
    for (const row of rows) {
      if (row.task_id === null || !allowed.has(row.task_id)) continue;
      const list = map.get(row.task_id) ?? [];
      list.push(ArtifactId.make(row.id));
      map.set(row.task_id, list);
    }
    return map;
  });

  const hydrateTasks = Effect.fnUntraced(function* (rows: ReadonlyArray<TaskRow>) {
    const artifactsByTask = yield* loadTaskArtifactMap(rows.map((row) => row.id));
    return rows.map((row) => mapTaskRow(row, artifactsByTask.get(row.id) ?? []));
  });

  const listTasks = Effect.fn("SovereignStore.listTasks")(function* (filter?: {
    readonly ventureId?: VentureId;
    readonly activeOnly?: boolean;
  }) {
    const rows =
      filter?.ventureId !== undefined
        ? yield* sql<TaskRow>`
            SELECT * FROM sovereign_tasks
            WHERE venture_id = ${filter.ventureId}
            ORDER BY priority DESC, updated_at DESC
          `.pipe(Effect.mapError(mapPersistenceError("list", "tasks")))
        : yield* sql<TaskRow>`
            SELECT * FROM sovereign_tasks
            ORDER BY priority DESC, updated_at DESC
          `.pipe(Effect.mapError(mapPersistenceError("list", "tasks")));
    const hydrated = yield* hydrateTasks(rows);
    return filter?.activeOnly
      ? hydrated.filter(
          ({ task }) =>
            task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled",
        )
      : hydrated;
  });

  const getTask = Effect.fn("SovereignStore.getTask")(function* (taskId: CommercialTaskId) {
    const rows = yield* sql<TaskRow>`
      SELECT * FROM sovereign_tasks WHERE id = ${taskId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "task")));
    if (rows.length === 0) return Option.none();
    const hydrated = yield* hydrateTasks(rows);
    return hydrated[0] === undefined ? Option.none() : Option.some(hydrated[0]);
  });

  const findTaskByIdempotencyKey = Effect.fn("SovereignStore.findTaskByIdempotencyKey")(function* (
    idempotencyKey: string,
  ) {
    const rows = yield* sql<TaskRow>`
      SELECT * FROM sovereign_tasks WHERE idempotency_key = ${idempotencyKey}
    `.pipe(Effect.mapError(mapPersistenceError("find", "task")));
    if (rows.length === 0) return Option.none();
    const hydrated = yield* hydrateTasks(rows);
    return hydrated[0] === undefined ? Option.none() : Option.some(hydrated[0]);
  });

  const insertTask = Effect.fn("SovereignStore.insertTask")(function* (
    record: PersistedTaskRecord,
  ) {
    const { task } = record;
    yield* sql`
      INSERT INTO sovereign_tasks (
        id, venture_id, objective_id, opportunity_id, title, description,
        status, complexity, priority, assigned_provider_instance_id, assigned_model,
        linked_thread_id, linked_run_id, pending_approval_id, routing_policy_override_json,
        blocked_reason, idempotency_key, checkpoint_json, handoff_summary, depends_on_json,
        retry_count, max_retries, next_retry_at, created_at, updated_at, completed_at
      ) VALUES (
        ${task.id}, ${task.ventureId}, ${task.objectiveId}, ${task.opportunityId},
        ${task.title}, ${task.description}, ${task.status}, ${task.complexity}, ${task.priority},
        ${task.assignedProviderInstanceId}, ${task.assignedModel},
        ${task.linkedThreadId}, ${task.linkedRunId}, ${task.pendingApprovalId},
        ${
          task.routingPolicyOverride === undefined || task.routingPolicyOverride === null
            ? null
            : encodeUnknownJson(task.routingPolicyOverride)
        },
        ${task.blockedReason ?? null},
        ${record.idempotencyKey}, ${record.checkpointJson}, ${record.handoffSummary},
        ${encodeUnknownJson(record.dependsOn)}, ${record.retryCount}, ${record.maxRetries},
        ${record.nextRetryAt}, ${task.createdAt}, ${task.updatedAt}, ${task.completedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "task")));
  });

  const updateTask = Effect.fn("SovereignStore.updateTask")(function* (
    record: PersistedTaskRecord,
  ) {
    const { task } = record;
    yield* sql`
      UPDATE sovereign_tasks SET
        title = ${task.title},
        description = ${task.description},
        status = ${task.status},
        complexity = ${task.complexity},
        priority = ${task.priority},
        assigned_provider_instance_id = ${task.assignedProviderInstanceId},
        assigned_model = ${task.assignedModel},
        linked_thread_id = ${task.linkedThreadId},
        linked_run_id = ${task.linkedRunId},
        pending_approval_id = ${task.pendingApprovalId},
        routing_policy_override_json = ${
          task.routingPolicyOverride === undefined || task.routingPolicyOverride === null
            ? null
            : encodeUnknownJson(task.routingPolicyOverride)
        },
        blocked_reason = ${task.blockedReason ?? null},
        checkpoint_json = ${record.checkpointJson},
        handoff_summary = ${record.handoffSummary},
        depends_on_json = ${encodeUnknownJson(record.dependsOn)},
        retry_count = ${record.retryCount},
        max_retries = ${record.maxRetries},
        next_retry_at = ${record.nextRetryAt},
        updated_at = ${task.updatedAt},
        completed_at = ${task.completedAt}
      WHERE id = ${task.id}
    `.pipe(Effect.mapError(mapPersistenceError("update", "task")));
  });

  const listInterruptedTasks = Effect.fn("SovereignStore.listInterruptedTasks")(function* () {
    const rows = yield* sql<TaskRow>`
      SELECT * FROM sovereign_tasks
      WHERE status IN ('in_progress', 'running')
      ORDER BY updated_at ASC
    `.pipe(Effect.mapError(mapPersistenceError("list", "interrupted_tasks")));
    return yield* hydrateTasks(rows);
  });

  const pauseActiveTasksForEmergencyStop = Effect.fn(
    "SovereignStore.pauseActiveTasksForEmergencyStop",
  )(function* (reason: string, updatedAt: string) {
    const rows = yield* sql<TaskRow>`
      UPDATE sovereign_tasks
      SET status = 'blocked', blocked_reason = ${reason}, updated_at = ${updatedAt}
      WHERE status IN ('queued', 'ready', 'in_progress', 'running')
      RETURNING *
    `.pipe(Effect.mapError(mapPersistenceError("pause", "tasks")));
    const hydrated = yield* hydrateTasks(rows);
    return hydrated.map((item) => item.task);
  });

  const listArtifacts = Effect.fn("SovereignStore.listArtifacts")(
    function* (filter?: { readonly ventureId?: VentureId; readonly taskId?: CommercialTaskId }) {
      const rows =
        filter?.taskId !== undefined
          ? yield* sql<ArtifactRow>`
              SELECT * FROM sovereign_artifacts
              WHERE task_id = ${filter.taskId}
              ORDER BY created_at DESC
            `
          : filter?.ventureId !== undefined
            ? yield* sql<ArtifactRow>`
                SELECT * FROM sovereign_artifacts
                WHERE venture_id = ${filter.ventureId}
                ORDER BY created_at DESC
              `
            : yield* sql<ArtifactRow>`
                SELECT * FROM sovereign_artifacts ORDER BY created_at DESC
              `;
      return rows.map(mapArtifactRow);
    },
    Effect.mapError(mapPersistenceError("list", "artifacts")),
  );

  const insertArtifact = Effect.fn("SovereignStore.insertArtifact")(function* (
    artifact: CommercialArtifact,
  ) {
    yield* sql`
      INSERT INTO sovereign_artifacts (
        id, venture_id, task_id, opportunity_id, kind, title, summary,
        uri, mime_type, sha256, metadata_json, created_at
      ) VALUES (
        ${artifact.id}, ${artifact.ventureId}, ${artifact.taskId},
        ${artifact.opportunityId ?? null}, ${artifact.kind}, ${artifact.title},
        ${artifact.summary}, ${artifact.uri}, ${artifact.mimeType ?? null},
        ${artifact.sha256 ?? null},
        ${artifact.metadata === undefined ? null : encodeUnknownJson(artifact.metadata)},
        ${artifact.createdAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "artifact")));
  });

  const listLeads = Effect.fn("SovereignStore.listLeads")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<LeadRow>`
              SELECT * FROM sovereign_leads WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<LeadRow>`
              SELECT * FROM sovereign_leads ORDER BY updated_at DESC
            `;
      return rows.map(mapLeadRow);
    },
    Effect.mapError(mapPersistenceError("list", "leads")),
  );

  const getLead = Effect.fn("SovereignStore.getLead")(function* (leadId: LeadId) {
    const rows = yield* sql<LeadRow>`
      SELECT * FROM sovereign_leads WHERE id = ${leadId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "lead")));
    return rows[0] === undefined ? Option.none() : Option.some(mapLeadRow(rows[0]));
  });

  const insertLead = Effect.fn("SovereignStore.insertLead")(function* (lead: Lead) {
    yield* sql`
      INSERT INTO sovereign_leads (
        id, venture_id, name, company, email, phone, website_url,
        source, stage, consents_json, notes, tags_json, created_at, updated_at
      ) VALUES (
        ${lead.id}, ${lead.ventureId}, ${lead.name}, ${lead.company}, ${lead.email},
        ${lead.phone}, ${lead.websiteUrl}, ${lead.source}, ${lead.stage},
        ${encodeUnknownJson(lead.consents)}, ${lead.notes},
        ${encodeUnknownJson(lead.tags)}, ${lead.createdAt}, ${lead.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "lead")));
  });

  const listCustomers = Effect.fn("SovereignStore.listCustomers")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<CustomerRow>`
              SELECT * FROM sovereign_customers WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<CustomerRow>`
              SELECT * FROM sovereign_customers ORDER BY updated_at DESC
            `;
      return rows.map(mapCustomerRow);
    },
    Effect.mapError(mapPersistenceError("list", "customers")),
  );

  const getCustomer = Effect.fn("SovereignStore.getCustomer")(function* (customerId: CustomerId) {
    const rows = yield* sql<CustomerRow>`
      SELECT * FROM sovereign_customers WHERE id = ${customerId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "customer")));
    return rows[0] === undefined ? Option.none() : Option.some(mapCustomerRow(rows[0]));
  });

  const insertCustomer = Effect.fn("SovereignStore.insertCustomer")(function* (customer: Customer) {
    yield* sql`
      INSERT INTO sovereign_customers (
        id, venture_id, lead_id, name, company, email, phone, status,
        consents_json, billing_currency, lifetime_collected_minor, created_at, updated_at
      ) VALUES (
        ${customer.id}, ${customer.ventureId}, ${customer.leadId}, ${customer.name},
        ${customer.company}, ${customer.email}, ${customer.phone}, ${customer.status},
        ${encodeUnknownJson(customer.consents)}, ${customer.billingCurrency},
        ${customer.lifetimeCollectedMinor}, ${customer.createdAt}, ${customer.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "customer")));
  });

  const addCustomerCollectedMinor = Effect.fn("SovereignStore.addCustomerCollectedMinor")(
    function* (customerId: CustomerId, deltaMinor: number, updatedAt: string) {
      yield* sql`
        UPDATE sovereign_customers
        SET lifetime_collected_minor = lifetime_collected_minor + ${deltaMinor},
            updated_at = ${updatedAt}
        WHERE id = ${customerId}
      `.pipe(Effect.mapError(mapPersistenceError("update", "customer")));
    },
  );

  const listProposals = Effect.fn("SovereignStore.listProposals")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<ProposalRow>`
              SELECT * FROM sovereign_proposals WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<ProposalRow>`
              SELECT * FROM sovereign_proposals ORDER BY updated_at DESC
            `;
      return rows.map(mapProposalRow);
    },
    Effect.mapError(mapPersistenceError("list", "proposals")),
  );

  const findProposalByApprovalId = Effect.fn("SovereignStore.findProposalByApprovalId")(function* (
    approvalId: ApprovalRequestId,
  ) {
    const rows = yield* sql<ProposalRow>`
      SELECT * FROM sovereign_proposals WHERE approval_id = ${approvalId}
    `.pipe(Effect.mapError(mapPersistenceError("find", "proposal")));
    return rows[0] === undefined ? Option.none() : Option.some(mapProposalRow(rows[0]));
  });

  const insertProposal = Effect.fn("SovereignStore.insertProposal")(function* (proposal: Proposal) {
    yield* sql`
      INSERT INTO sovereign_proposals (
        id, venture_id, lead_id, customer_id, opportunity_id, title, summary,
        line_items_json, subtotal_minor, discount_pct, total_minor, currency,
        status, approval_id, valid_until, sent_at, decided_at, created_at, updated_at
      ) VALUES (
        ${proposal.id}, ${proposal.ventureId}, ${proposal.leadId}, ${proposal.customerId},
        ${proposal.opportunityId}, ${proposal.title}, ${proposal.summary},
        ${encodeUnknownJson(proposal.lineItems)}, ${proposal.subtotalMinor},
        ${proposal.discountPct}, ${proposal.totalMinor}, ${proposal.currency},
        ${proposal.status}, ${proposal.approvalId}, ${proposal.validUntil},
        ${proposal.sentAt}, ${proposal.decidedAt}, ${proposal.createdAt}, ${proposal.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "proposal")));
  });

  const updateProposalStatus = Effect.fn("SovereignStore.updateProposalStatus")(function* (input: {
    readonly proposalId: ProposalId;
    readonly status: Proposal["status"];
    readonly decidedAt?: string | null;
    readonly updatedAt: string;
  }) {
    yield* sql`
      UPDATE sovereign_proposals
      SET status = ${input.status},
          decided_at = COALESCE(${input.decidedAt ?? null}, decided_at),
          updated_at = ${input.updatedAt}
      WHERE id = ${input.proposalId}
    `.pipe(Effect.mapError(mapPersistenceError("update", "proposal")));
  });

  const listOrders = Effect.fn("SovereignStore.listOrders")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<OrderRow>`
              SELECT * FROM sovereign_orders WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<OrderRow>`
              SELECT * FROM sovereign_orders ORDER BY updated_at DESC
            `;
      return rows.map(mapOrderRow);
    },
    Effect.mapError(mapPersistenceError("list", "orders")),
  );

  const insertOrder = Effect.fn("SovereignStore.insertOrder")(function* (order: Order) {
    yield* sql`
      INSERT INTO sovereign_orders (
        id, venture_id, customer_id, proposal_id, title, amount_minor,
        currency, status, created_at, updated_at
      ) VALUES (
        ${order.id}, ${order.ventureId}, ${order.customerId}, ${order.proposalId},
        ${order.title}, ${order.amountMinor}, ${order.currency}, ${order.status},
        ${order.createdAt}, ${order.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "order")));
  });

  const listInvoices = Effect.fn("SovereignStore.listInvoices")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<InvoiceRow>`
              SELECT * FROM sovereign_invoices WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<InvoiceRow>`
              SELECT * FROM sovereign_invoices ORDER BY updated_at DESC
            `;
      return rows.map(mapInvoiceRow);
    },
    Effect.mapError(mapPersistenceError("list", "invoices")),
  );

  const getInvoice = Effect.fn("SovereignStore.getInvoice")(function* (invoiceId: InvoiceId) {
    const rows = yield* sql<InvoiceRow>`
      SELECT * FROM sovereign_invoices WHERE id = ${invoiceId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "invoice")));
    return rows[0] === undefined ? Option.none() : Option.some(mapInvoiceRow(rows[0]));
  });

  const insertInvoice = Effect.fn("SovereignStore.insertInvoice")(function* (invoice: Invoice) {
    yield* sql`
      INSERT INTO sovereign_invoices (
        id, venture_id, customer_id, order_id, invoice_number, amount_minor,
        paid_amount_minor, currency, status, payment_link_url, external_invoice_id,
        issued_at, due_at, paid_at, created_at, updated_at
      ) VALUES (
        ${invoice.id}, ${invoice.ventureId}, ${invoice.customerId}, ${invoice.orderId},
        ${invoice.invoiceNumber}, ${invoice.amountMinor}, ${invoice.paidAmountMinor},
        ${invoice.currency}, ${invoice.status}, ${invoice.paymentLinkUrl},
        ${invoice.externalInvoiceId}, ${invoice.issuedAt}, ${invoice.dueAt},
        ${invoice.paidAt}, ${invoice.createdAt}, ${invoice.updatedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "invoice")));
  });

  const updateInvoicePayment = Effect.fn("SovereignStore.updateInvoicePayment")(function* (input: {
    readonly invoiceId: InvoiceId;
    readonly paidAmountMinor: number;
    readonly status: Invoice["status"];
    readonly paidAt: string | null;
    readonly updatedAt: string;
  }) {
    yield* sql`
      UPDATE sovereign_invoices
      SET paid_amount_minor = ${input.paidAmountMinor},
          status = ${input.status},
          paid_at = ${input.paidAt},
          updated_at = ${input.updatedAt}
      WHERE id = ${input.invoiceId}
    `.pipe(Effect.mapError(mapPersistenceError("update", "invoice")));
  });

  const listPaymentLinks = Effect.fn("SovereignStore.listPaymentLinks")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<PaymentLinkRow>`
              SELECT * FROM sovereign_payment_links WHERE venture_id = ${ventureId} ORDER BY created_at DESC
            `
          : yield* sql<PaymentLinkRow>`
              SELECT * FROM sovereign_payment_links ORDER BY created_at DESC
            `;
      return rows.map(mapPaymentLinkRow);
    },
    Effect.mapError(mapPersistenceError("list", "payment_links")),
  );

  const listCommunications = Effect.fn("SovereignStore.listCommunications")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<CommunicationRow>`
              SELECT * FROM sovereign_communications WHERE venture_id = ${ventureId} ORDER BY created_at DESC
            `
          : yield* sql<CommunicationRow>`
              SELECT * FROM sovereign_communications ORDER BY created_at DESC
            `;
      return rows.map(mapCommunicationRow);
    },
    Effect.mapError(mapPersistenceError("list", "communications")),
  );

  const insertCommunication = Effect.fn("SovereignStore.insertCommunication")(function* (
    record: CommunicationRecord,
  ) {
    yield* sql`
      INSERT INTO sovereign_communications (
        id, venture_id, lead_id, customer_id, channel, direction, sender_type,
        ai_disclosed, consent_verified, subject, body_preview, status,
        approval_id, external_message_id, sent_at, created_at
      ) VALUES (
        ${record.id}, ${record.ventureId}, ${record.leadId}, ${record.customerId},
        ${record.channel}, ${record.direction}, ${record.senderType},
        ${record.aiDisclosed ? 1 : 0}, ${record.consentVerified ? 1 : 0},
        ${record.subject}, ${record.bodyPreview}, ${record.status},
        ${record.approvalId}, ${record.externalMessageId ?? null},
        ${record.sentAt}, ${record.createdAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "communication")));
  });

  const listSupportTickets = Effect.fn("SovereignStore.listSupportTickets")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<SupportTicketRow>`
              SELECT * FROM sovereign_support_tickets WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<SupportTicketRow>`
              SELECT * FROM sovereign_support_tickets ORDER BY updated_at DESC
            `;
      return rows.map(mapSupportTicketRow);
    },
    Effect.mapError(mapPersistenceError("list", "support_tickets")),
  );

  const insertSupportTicket = Effect.fn("SovereignStore.insertSupportTicket")(function* (
    ticket: SupportTicket,
  ) {
    yield* sql`
      INSERT INTO sovereign_support_tickets (
        id, venture_id, customer_id, order_id, subject, summary, status,
        priority, handled_by, created_at, updated_at, resolved_at
      ) VALUES (
        ${ticket.id}, ${ticket.ventureId}, ${ticket.customerId}, ${ticket.orderId},
        ${ticket.subject}, ${ticket.summary}, ${ticket.status}, ${ticket.priority},
        ${ticket.handledBy}, ${ticket.createdAt}, ${ticket.updatedAt}, ${ticket.resolvedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "support_ticket")));
  });

  const listVoiceAgents = Effect.fn("SovereignStore.listVoiceAgents")(
    function* (ventureId?: VentureId) {
      const rows =
        ventureId !== undefined
          ? yield* sql<VoiceAgentRow>`
              SELECT * FROM sovereign_voice_agents WHERE venture_id = ${ventureId} ORDER BY updated_at DESC
            `
          : yield* sql<VoiceAgentRow>`
              SELECT * FROM sovereign_voice_agents ORDER BY updated_at DESC
            `;
      return rows.map(mapVoiceAgentRow);
    },
    Effect.mapError(mapPersistenceError("list", "voice_agents")),
  );

  const getVoiceAgent = Effect.fn("SovereignStore.getVoiceAgent")(function* (
    voiceAgentId: VoiceAgentId,
  ) {
    const rows = yield* sql<VoiceAgentRow>`
      SELECT * FROM sovereign_voice_agents WHERE id = ${voiceAgentId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "voice_agent")));
    return rows[0] === undefined ? Option.none() : Option.some(mapVoiceAgentRow(rows[0]));
  });

  const upsertVoiceAgent = Effect.fn("SovereignStore.upsertVoiceAgent")(function* (
    agent: VoiceAgentConfig,
  ) {
    yield* sql`
      INSERT INTO sovereign_voice_agents (
        id, venture_id, name, provider_integration_id, direction, status,
        phone_number_label, ai_disclosure_greeting, recording_disclosure_enabled,
        opt_out_phrase_enabled, escalation_number_label, script_summary, created_at, updated_at
      ) VALUES (
        ${agent.id}, ${agent.ventureId}, ${agent.name}, ${agent.providerIntegrationId},
        ${agent.direction}, ${agent.status}, ${agent.phoneNumberLabel},
        ${agent.aiDisclosureGreeting}, ${agent.recordingDisclosureEnabled ? 1 : 0},
        ${agent.optOutPhraseEnabled ? 1 : 0}, ${agent.escalationNumberLabel},
        ${agent.scriptSummary}, ${agent.createdAt}, ${agent.updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        provider_integration_id = excluded.provider_integration_id,
        direction = excluded.direction,
        status = excluded.status,
        phone_number_label = excluded.phone_number_label,
        ai_disclosure_greeting = excluded.ai_disclosure_greeting,
        recording_disclosure_enabled = excluded.recording_disclosure_enabled,
        opt_out_phrase_enabled = excluded.opt_out_phrase_enabled,
        escalation_number_label = excluded.escalation_number_label,
        script_summary = excluded.script_summary,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(mapPersistenceError("upsert", "voice_agent")));
  });

  const getProfitPeriods = Effect.fn("SovereignStore.getProfitPeriods")(
    function* (asOf: string, reportingRate: number) {
      // Round each converted entry as in ledger reporting (including negative half-minor amounts).
      const rows = yield* sql<ProfitPeriods>`
        WITH converted AS (
          SELECT julianday(occurred_at) AS occurred, entry_type,
                 reporting_amount_gbp_minor / (1.0 * ${reportingRate}) AS amount
          FROM sovereign_ledger_entries
          WHERE verification_state = 'verified' AND julianday(occurred_at) <= julianday(${asOf})
        ), rounded AS (
          SELECT occurred, entry_type, CAST(amount AS INTEGER)
            + CASE WHEN amount - CAST(amount AS INTEGER) >= 0.5 THEN 1
                   WHEN amount - CAST(amount AS INTEGER) < -0.5 THEN -1 ELSE 0 END AS minor
          FROM converted
        ), net AS (
          SELECT occurred, CASE
            WHEN entry_type = 'collected_revenue' THEN ABS(minor)
            WHEN entry_type = 'adjustment' THEN minor
            WHEN entry_type IN ('confirmed_expense', 'payment_fee', 'refund', 'inference_cost',
                 'hosting_cost', 'deployment_cost', 'telephony_cost', 'subscription_allocation')
              THEN -ABS(minor)
            ELSE 0 END AS profit
          FROM rounded
        )
        SELECT COALESCE(SUM(profit) FILTER (WHERE occurred >= julianday(${asOf}, 'start of day')), 0) AS today,
               COALESCE(SUM(profit) FILTER (WHERE occurred >= julianday(${asOf}, '-7 days')), 0) AS week,
               COALESCE(SUM(profit) FILTER (WHERE occurred >= julianday(${asOf}, '-30 days')), 0) AS month,
               COALESCE(SUM(profit), 0) AS "all"
        FROM net
      `;
      return rows[0]!;
    },
    Effect.mapError(mapPersistenceError("read", "ledger_entries")),
  );

  const listLedgerEntries = Effect.fn("SovereignStore.listLedgerEntries")(
    function* (filter?: {
      readonly ventureId?: VentureId | null;
      readonly verificationState?: LedgerVerificationState;
      readonly limit?: number;
    }) {
      const limit = filter?.limit ?? 500;
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<LedgerEntryRow>`
              SELECT * FROM sovereign_ledger_entries
              WHERE venture_id = ${filter.ventureId}
              ORDER BY occurred_at DESC, recorded_at DESC
              LIMIT ${limit}
            `
          : yield* sql<LedgerEntryRow>`
              SELECT * FROM sovereign_ledger_entries
              ORDER BY occurred_at DESC, recorded_at DESC
              LIMIT ${limit}
            `;
      const mapped = rows.map(mapLedgerEntryRow);
      return filter?.verificationState === undefined
        ? mapped
        : mapped.filter((entry) => entry.verificationState === filter.verificationState);
    },
    Effect.mapError(mapPersistenceError("list", "ledger_entries")),
  );

  const findLedgerEntryByExternalRef = Effect.fn("SovereignStore.findLedgerEntryByExternalRef")(
    function* (externalRef: string) {
      const rows = yield* sql<LedgerEntryRow>`
        SELECT * FROM sovereign_ledger_entries WHERE external_ref = ${externalRef}
      `.pipe(Effect.mapError(mapPersistenceError("find", "ledger_entry")));
      return rows[0] === undefined ? Option.none() : Option.some(mapLedgerEntryRow(rows[0]));
    },
  );

  const insertLedgerEntry = Effect.fn("SovereignStore.insertLedgerEntry")(function* (
    entry: LedgerEntry,
  ) {
    yield* sql`
      INSERT INTO sovereign_ledger_entries (
        id, venture_id, order_id, invoice_id, task_id, integration_id,
        entry_type, verification_state, amount_minor, currency,
        reporting_amount_gbp_minor, fx_rate_to_gbp, description,
        external_ref, recorded_by, occurred_at, recorded_at
      ) VALUES (
        ${entry.id}, ${entry.ventureId}, ${entry.orderId ?? null}, ${entry.invoiceId ?? null},
        ${entry.taskId ?? null}, ${entry.integrationId ?? null}, ${entry.entryType},
        ${entry.verificationState}, ${entry.amountMinor}, ${entry.currency},
        ${entry.reportingAmountGbpMinor}, ${entry.fxRateToGbp}, ${entry.description},
        ${entry.externalRef}, ${entry.recordedBy}, ${entry.occurredAt}, ${entry.recordedAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "ledger_entry")));
  });

  const sumVerifiedMonthlySpendGbpMinor = Effect.fn(
    "SovereignStore.sumVerifiedMonthlySpendGbpMinor",
  )(
    function* (input: { readonly ventureId?: VentureId | null; readonly sinceIso: string }) {
      const rows =
        input.ventureId !== undefined && input.ventureId !== null
          ? yield* sql<{ readonly total: number | null }>`
              SELECT COALESCE(SUM(ABS(reporting_amount_gbp_minor)), 0) AS total
              FROM sovereign_ledger_entries
              WHERE venture_id = ${input.ventureId}
                AND verification_state = 'verified'
                AND entry_type IN (
                  'confirmed_expense', 'payment_fee', 'inference_cost',
                  'hosting_cost', 'deployment_cost', 'telephony_cost', 'subscription_allocation'
                )
                AND occurred_at >= ${input.sinceIso}
            `
          : yield* sql<{ readonly total: number | null }>`
              SELECT COALESCE(SUM(ABS(reporting_amount_gbp_minor)), 0) AS total
              FROM sovereign_ledger_entries
              WHERE verification_state = 'verified'
                AND entry_type IN (
                  'confirmed_expense', 'payment_fee', 'inference_cost',
                  'hosting_cost', 'deployment_cost', 'telephony_cost', 'subscription_allocation'
                )
                AND occurred_at >= ${input.sinceIso}
            `;
      return rows[0]?.total ?? 0;
    },
    Effect.mapError(mapPersistenceError("aggregate", "ledger_spend")),
  );

  const listApprovals = Effect.fn("SovereignStore.listApprovals")(
    function* (filter?: {
      readonly ventureId?: VentureId | null;
      readonly status?: ApprovalStatus;
    }) {
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<ApprovalRow>`
              SELECT * FROM sovereign_approvals
              WHERE venture_id = ${filter.ventureId}
              ORDER BY requested_at DESC
            `
          : yield* sql<ApprovalRow>`
              SELECT * FROM sovereign_approvals
              ORDER BY requested_at DESC
            `;
      const mapped = rows.map(mapApprovalRow);
      return filter?.status === undefined
        ? mapped
        : mapped.filter((item) => item.status === filter.status);
    },
    Effect.mapError(mapPersistenceError("list", "approvals")),
  );

  const getApproval = Effect.fn("SovereignStore.getApproval")(function* (
    approvalId: ApprovalRequestId,
  ) {
    const rows = yield* sql<ApprovalRow>`
      SELECT * FROM sovereign_approvals WHERE id = ${approvalId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "approval")));
    return rows[0] === undefined ? Option.none() : Option.some(mapApprovalRow(rows[0]));
  });

  const findApprovalByIdempotencyKey = Effect.fn("SovereignStore.findApprovalByIdempotencyKey")(
    function* (idempotencyKey: string) {
      const rows = yield* sql<ApprovalRow>`
        SELECT * FROM sovereign_approvals WHERE idempotency_key = ${idempotencyKey}
      `.pipe(Effect.mapError(mapPersistenceError("find", "approval")));
      return rows[0] === undefined ? Option.none() : Option.some(mapApprovalRow(rows[0]));
    },
  );

  const insertApproval = Effect.fn("SovereignStore.insertApproval")(function* (
    approval: ApprovalRequest,
    idempotencyKey: string | null = null,
  ) {
    yield* sql`
      INSERT INTO sovereign_approvals (
        id, venture_id, objective_id, task_id, category, status, risk_level,
        title, summary, requested_action, target_label, estimated_cost_minor,
        currency, payload_json, requested_by, requested_at, expires_at,
        decided_by, decided_at, decision_note, preapproval_policy_id, idempotency_key
      ) VALUES (
        ${approval.id}, ${approval.ventureId}, ${approval.objectiveId ?? null},
        ${approval.taskId ?? null}, ${approval.category}, ${approval.status},
        ${approval.riskLevel}, ${approval.title}, ${approval.summary},
        ${approval.requestedAction}, ${approval.targetLabel ?? null},
        ${approval.estimatedCostMinor ?? null}, ${approval.currency ?? null},
        ${approval.payload === undefined ? null : encodeUnknownJson(approval.payload)},
        ${approval.requestedBy}, ${approval.requestedAt}, ${approval.expiresAt ?? null},
        ${approval.decidedBy ?? null}, ${approval.decidedAt ?? null},
        ${approval.decisionNote ?? null}, ${approval.preapprovalPolicyId ?? null},
        ${idempotencyKey}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "approval")));
  });

  const updateApproval = Effect.fn("SovereignStore.updateApproval")(function* (
    approval: ApprovalRequest,
  ) {
    yield* sql`
      UPDATE sovereign_approvals SET
        status = ${approval.status},
        decided_by = ${approval.decidedBy ?? null},
        decided_at = ${approval.decidedAt ?? null},
        decision_note = ${approval.decisionNote ?? null},
        preapproval_policy_id = ${approval.preapprovalPolicyId ?? null}
      WHERE id = ${approval.id}
    `.pipe(Effect.mapError(mapPersistenceError("update", "approval")));
  });

  const listPreapprovalPolicies = Effect.fn("SovereignStore.listPreapprovalPolicies")(
    function* (filter?: { readonly ventureId?: VentureId | null; readonly enabledOnly?: boolean }) {
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<PreapprovalPolicyRow>`
              SELECT * FROM sovereign_preapproval_policies
              WHERE venture_id = ${filter.ventureId} OR venture_id IS NULL
              ORDER BY updated_at DESC
            `
          : yield* sql<PreapprovalPolicyRow>`
              SELECT * FROM sovereign_preapproval_policies
              ORDER BY updated_at DESC
            `;
      const mapped = rows.map(mapPreapprovalPolicyRow);
      return filter?.enabledOnly ? mapped.filter((policy) => policy.enabled) : mapped;
    },
    Effect.mapError(mapPersistenceError("list", "preapproval_policies")),
  );

  const getPreapprovalPolicy = Effect.fn("SovereignStore.getPreapprovalPolicy")(function* (
    policyId: PreapprovalPolicyId,
  ) {
    const rows = yield* sql<PreapprovalPolicyRow>`
      SELECT * FROM sovereign_preapproval_policies WHERE id = ${policyId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "preapproval_policy")));
    return rows[0] === undefined ? Option.none() : Option.some(mapPreapprovalPolicyRow(rows[0]));
  });

  const upsertPreapprovalPolicy = Effect.fn("SovereignStore.upsertPreapprovalPolicy")(function* (
    policy: PreapprovalPolicy,
  ) {
    yield* sql`
      INSERT INTO sovereign_preapproval_policies (
        id, venture_id, category, label, enabled,
        max_single_action_minor, max_monthly_aggregate_minor, currency,
        allowed_targets_json, expires_at, created_by, created_at, updated_at
      ) VALUES (
        ${policy.id}, ${policy.ventureId}, ${policy.category}, ${policy.label},
        ${policy.enabled ? 1 : 0}, ${policy.maxSingleActionMinor},
        ${policy.maxMonthlyAggregateMinor}, ${policy.currency},
        ${encodeUnknownJson(policy.allowedTargets)}, ${policy.expiresAt},
        ${policy.createdBy}, ${policy.createdAt}, ${policy.updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        venture_id = excluded.venture_id,
        category = excluded.category,
        label = excluded.label,
        enabled = excluded.enabled,
        max_single_action_minor = excluded.max_single_action_minor,
        max_monthly_aggregate_minor = excluded.max_monthly_aggregate_minor,
        currency = excluded.currency,
        allowed_targets_json = excluded.allowed_targets_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(mapPersistenceError("upsert", "preapproval_policy")));
  });

  const deletePreapprovalPolicy = Effect.fn("SovereignStore.deletePreapprovalPolicy")(function* (
    policyId: PreapprovalPolicyId,
  ) {
    const rows = yield* sql<{ readonly id: string }>`
      DELETE FROM sovereign_preapproval_policies WHERE id = ${policyId} RETURNING id
    `.pipe(Effect.mapError(mapPersistenceError("delete", "preapproval_policy")));
    return rows.length > 0;
  });

  const listIntegrations = Effect.fn("SovereignStore.listIntegrations")(
    function* (filter?: { readonly ventureId?: VentureId | null }) {
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<IntegrationRow>`
              SELECT * FROM sovereign_integrations
              WHERE venture_id = ${filter.ventureId} OR venture_id IS NULL
              ORDER BY updated_at DESC
            `
          : yield* sql<IntegrationRow>`
              SELECT * FROM sovereign_integrations ORDER BY updated_at DESC
            `;
      return rows.map(mapIntegrationRow);
    },
    Effect.mapError(mapPersistenceError("list", "integrations")),
  );

  const getIntegration = Effect.fn("SovereignStore.getIntegration")(function* (
    integrationId: IntegrationId,
  ) {
    const rows = yield* sql<IntegrationRow>`
      SELECT * FROM sovereign_integrations WHERE id = ${integrationId}
    `.pipe(Effect.mapError(mapPersistenceError("get", "integration")));
    return rows[0] === undefined ? Option.none() : Option.some(mapIntegrationRow(rows[0]));
  });

  const upsertIntegration = Effect.fn("SovereignStore.upsertIntegration")(function* (
    integration: IntegrationConfig,
  ) {
    yield* sql`
      INSERT INTO sovereign_integrations (
        id, venture_id, category, provider_kind, display_name, status, enabled,
        sandbox_mode, endpoint_url, account_label, has_secret, secret_reference_json,
        settings_json, last_tested_at, last_error, created_at, updated_at
      ) VALUES (
        ${integration.id}, ${integration.ventureId}, ${integration.category},
        ${integration.providerKind}, ${integration.displayName}, ${integration.status},
        ${integration.enabled ? 1 : 0}, ${integration.sandboxMode ? 1 : 0},
        ${integration.endpointUrl}, ${integration.accountLabel},
        ${integration.hasSecret ? 1 : 0},
        ${
          integration.secretReference === undefined || integration.secretReference === null
            ? null
            : encodeUnknownJson(integration.secretReference)
        },
        ${encodeUnknownJson(integration.settings)},
        ${integration.lastTestedAt}, ${integration.lastError},
        ${integration.createdAt}, ${integration.updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        venture_id = excluded.venture_id,
        category = excluded.category,
        provider_kind = excluded.provider_kind,
        display_name = excluded.display_name,
        status = excluded.status,
        enabled = excluded.enabled,
        sandbox_mode = excluded.sandbox_mode,
        endpoint_url = excluded.endpoint_url,
        account_label = excluded.account_label,
        has_secret = excluded.has_secret,
        secret_reference_json = excluded.secret_reference_json,
        settings_json = excluded.settings_json,
        last_tested_at = excluded.last_tested_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(mapPersistenceError("upsert", "integration")));
  });

  const deleteIntegration = Effect.fn("SovereignStore.deleteIntegration")(function* (
    integrationId: IntegrationId,
  ) {
    const rows = yield* sql<{ readonly id: string }>`
      DELETE FROM sovereign_integrations WHERE id = ${integrationId} RETURNING id
    `.pipe(Effect.mapError(mapPersistenceError("delete", "integration")));
    return rows.length > 0;
  });

  const listAuditEvents = Effect.fn("SovereignStore.listAuditEvents")(
    function* (filter?: {
      readonly ventureId?: VentureId | null;
      readonly kind?: AuditEventKind;
      readonly limit?: number;
    }) {
      const limit = filter?.limit ?? 100;
      const rows =
        filter?.ventureId !== undefined && filter.ventureId !== null
          ? yield* sql<AuditEventRow>`
              SELECT * FROM sovereign_audit_events
              WHERE venture_id = ${filter.ventureId}
              ORDER BY created_at DESC
              LIMIT ${limit}
            `
          : yield* sql<AuditEventRow>`
              SELECT * FROM sovereign_audit_events
              ORDER BY created_at DESC
              LIMIT ${limit}
            `;
      const mapped = rows.map(mapAuditEventRow);
      return filter?.kind === undefined
        ? mapped
        : mapped.filter((event) => event.kind === filter.kind);
    },
    Effect.mapError(mapPersistenceError("list", "audit_events")),
  );

  const appendAuditEvent = Effect.fn("SovereignStore.appendAuditEvent")(function* (
    event: AuditEvent,
  ) {
    yield* sql`
      INSERT INTO sovereign_audit_events (
        id, kind, severity, venture_id, actor, summary, category,
        approval_id, task_id, provider_instance_id, integration_id,
        metadata_json, created_at
      ) VALUES (
        ${event.id}, ${event.kind}, ${event.severity}, ${event.ventureId},
        ${event.actor}, ${event.summary}, ${event.category ?? null},
        ${event.approvalId ?? null}, ${event.taskId ?? null},
        ${event.providerInstanceId ?? null}, ${event.integrationId ?? null},
        ${event.metadata === undefined ? null : encodeUnknownJson(event.metadata)},
        ${event.createdAt}
      )
    `.pipe(Effect.mapError(mapPersistenceError("insert", "audit_event")));
  });

  const claimWebhookReplayKey = Effect.fn("SovereignStore.claimWebhookReplayKey")(
    function* (input: {
      readonly integrationId: IntegrationId;
      readonly replayKey: string;
      readonly eventType: string;
      readonly receivedAt: string;
    }) {
      const rows = yield* sql<{ readonly replay_key: string }>`
      INSERT OR IGNORE INTO sovereign_webhook_replay_keys (
        integration_id, replay_key, event_type, received_at
      ) VALUES (
        ${input.integrationId}, ${input.replayKey}, ${input.eventType}, ${input.receivedAt}
      )
      RETURNING replay_key
    `.pipe(Effect.mapError(mapPersistenceError("insert", "webhook_replay_key")));
      return rows.length > 0;
    },
  );

  return SovereignStore.of({
    nowIso,
    withTransaction,
    getControlState: getControlState(),
    saveControlState,
    nextRevision: nextRevision(),
    publishEvent,
    subscribeEvents,
    listVentures: listVentures(),
    getVenture,
    getVentureBySlug,
    insertVenture,
    updateVenture,
    deleteVenture,
    listObjectives,
    getObjective,
    insertObjective,
    updateObjective,
    listOpportunities,
    getOpportunity,
    findOpportunityByExternalRef,
    insertOpportunity,
    updateOpportunity,
    listTasks,
    getTask,
    findTaskByIdempotencyKey,
    insertTask,
    updateTask,
    listInterruptedTasks: listInterruptedTasks(),
    pauseActiveTasksForEmergencyStop,
    listArtifacts,
    insertArtifact,
    listLeads,
    getLead,
    insertLead,
    listCustomers,
    getCustomer,
    insertCustomer,
    addCustomerCollectedMinor,
    listProposals,
    findProposalByApprovalId,
    insertProposal,
    updateProposalStatus,
    listOrders,
    insertOrder,
    listInvoices,
    getInvoice,
    insertInvoice,
    updateInvoicePayment,
    listPaymentLinks,
    listCommunications,
    insertCommunication,
    listSupportTickets,
    insertSupportTicket,
    listVoiceAgents,
    getVoiceAgent,
    upsertVoiceAgent,
    getProfitPeriods,
    listLedgerEntries,
    findLedgerEntryByExternalRef,
    insertLedgerEntry,
    sumVerifiedMonthlySpendGbpMinor,
    listApprovals,
    getApproval,
    findApprovalByIdempotencyKey,
    insertApproval,
    updateApproval,
    listPreapprovalPolicies,
    getPreapprovalPolicy,
    upsertPreapprovalPolicy,
    deletePreapprovalPolicy,
    listIntegrations,
    getIntegration,
    upsertIntegration,
    deleteIntegration,
    listAuditEvents,
    appendAuditEvent,
    claimWebhookReplayKey,
  });
});

export const layer = Layer.effect(SovereignStore, make);
