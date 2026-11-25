import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { PositiveInt } from "../baseSchemas.ts";
import {
  ApprovalDecisionInput,
  ApprovalRequest,
  ApprovalStatus,
  AuditEvent,
  AuditEventKind,
  CreateApprovalRequestInput,
  DeletePreapprovalPolicyInput,
  GlobalControlState,
  PreapprovalPolicy,
  TriggerEmergencyStopInput,
  UpdateGlobalControlStateInput,
  UpsertPreapprovalPolicyInput,
} from "./governance.ts";
import { IntegrationId, VentureId } from "./ids.ts";
import {
  IntegrationConfig,
  IntegrationSummary,
  IntegrationTestResult,
  UpsertIntegrationInput,
} from "./integration.ts";
import {
  CreateInvoiceInput,
  FinancialPipelineMetrics,
  Invoice,
  LedgerEntry,
  LedgerVerificationState,
  RecordLedgerEntryInput,
} from "./ledger.ts";
import { CommercialObjective, CreateObjectiveInput, UpdateObjectiveInput } from "./objective.ts";
import { CreateOpportunityInput, Opportunity, UpdateOpportunityInput } from "./opportunity.ts";
import {
  ProviderPoolSnapshot,
  ProviderRouteDecision,
  ProviderRouteRequest,
  UpdateProviderPoolConfigInput,
} from "./providerPool.ts";
import {
  CommunicationRecord,
  CreateCommunicationInput,
  CreateLeadInput,
  CreateProposalInput,
  Lead,
  Proposal,
  UpsertVoiceAgentInput,
  VoiceAgentConfig,
} from "./sales.ts";
import {
  SovereignError,
  SovereignEvent,
  SovereignOverviewSnapshot,
  SovereignVentureDetail,
} from "./snapshot.ts";
import {
  CommercialArtifact,
  CommercialTask,
  CreateCommercialArtifactInput,
  CreateCommercialTaskInput,
  UpdateCommercialTaskInput,
} from "./task.ts";
import {
  CreateVentureInput,
  DeleteVentureInput,
  UpdateVentureInput,
  Venture,
  VentureBlueprint,
} from "./venture.ts";

export const SOVEREIGN_WS_METHODS = {
  sovereignSubscribe: "sovereign.subscribe",
  sovereignGetOverview: "sovereign.getOverview",
  sovereignGetVentureDetail: "sovereign.getVentureDetail",
  sovereignListBlueprints: "sovereign.listBlueprints",
  sovereignListLedgerEntries: "sovereign.listLedgerEntries",
  sovereignListApprovals: "sovereign.listApprovals",
  sovereignListAuditEvents: "sovereign.listAuditEvents",
  sovereignGetProviderPool: "sovereign.getProviderPool",
  sovereignListIntegrations: "sovereign.listIntegrations",

  sovereignCreateVenture: "sovereign.createVenture",
  sovereignUpdateVenture: "sovereign.updateVenture",
  sovereignDeleteVenture: "sovereign.deleteVenture",
  sovereignCreateObjective: "sovereign.createObjective",
  sovereignUpdateObjective: "sovereign.updateObjective",
  sovereignCreateOpportunity: "sovereign.createOpportunity",
  sovereignUpdateOpportunity: "sovereign.updateOpportunity",
  sovereignCreateTask: "sovereign.createTask",
  sovereignUpdateTask: "sovereign.updateTask",
  sovereignCreateArtifact: "sovereign.createArtifact",
  sovereignCreateLead: "sovereign.createLead",
  sovereignCreateProposal: "sovereign.createProposal",
  sovereignCreateCommunication: "sovereign.createCommunication",
  sovereignUpsertVoiceAgent: "sovereign.upsertVoiceAgent",
  sovereignCreateInvoice: "sovereign.createInvoice",
  sovereignRecordLedgerEntry: "sovereign.recordLedgerEntry",
  sovereignRequestApproval: "sovereign.requestApproval",
  sovereignRouteProvider: "sovereign.routeProvider",

  sovereignDecideApproval: "sovereign.decideApproval",
  sovereignUpsertPreapprovalPolicy: "sovereign.upsertPreapprovalPolicy",
  sovereignDeletePreapprovalPolicy: "sovereign.deletePreapprovalPolicy",

  sovereignUpdateControlState: "sovereign.updateControlState",
  sovereignTriggerEmergencyStop: "sovereign.triggerEmergencyStop",
  sovereignUpsertIntegration: "sovereign.upsertIntegration",
  sovereignDeleteIntegration: "sovereign.deleteIntegration",
  sovereignTestIntegration: "sovereign.testIntegration",
  sovereignUpdateProviderPoolConfig: "sovereign.updateProviderPoolConfig",
} as const;

export const SovereignGetVentureDetailInput = Schema.Struct({
  ventureId: VentureId,
});
export type SovereignGetVentureDetailInput = typeof SovereignGetVentureDetailInput.Type;

export const SovereignListBlueprintsResult = Schema.Struct({
  blueprints: Schema.Array(VentureBlueprint),
});
export type SovereignListBlueprintsResult = typeof SovereignListBlueprintsResult.Type;

export const SovereignListLedgerEntriesInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  verificationState: Schema.optionalKey(LedgerVerificationState),
  limit: Schema.optionalKey(PositiveInt),
});
export type SovereignListLedgerEntriesInput = typeof SovereignListLedgerEntriesInput.Type;

export const SovereignListLedgerEntriesResult = Schema.Struct({
  entries: Schema.Array(LedgerEntry),
  financialSummary: FinancialPipelineMetrics,
});
export type SovereignListLedgerEntriesResult = typeof SovereignListLedgerEntriesResult.Type;

export const SovereignListApprovalsInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  status: Schema.optionalKey(ApprovalStatus),
});
export type SovereignListApprovalsInput = typeof SovereignListApprovalsInput.Type;

export const SovereignListApprovalsResult = Schema.Struct({
  approvals: Schema.Array(ApprovalRequest),
  preapprovalPolicies: Schema.Array(PreapprovalPolicy),
});
export type SovereignListApprovalsResult = typeof SovereignListApprovalsResult.Type;

export const SovereignListAuditEventsInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  kind: Schema.optionalKey(AuditEventKind),
  limit: Schema.optionalKey(PositiveInt),
});
export type SovereignListAuditEventsInput = typeof SovereignListAuditEventsInput.Type;

export const SovereignListAuditEventsResult = Schema.Struct({
  events: Schema.Array(AuditEvent),
});
export type SovereignListAuditEventsResult = typeof SovereignListAuditEventsResult.Type;

export const SovereignListIntegrationsInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
});
export type SovereignListIntegrationsInput = typeof SovereignListIntegrationsInput.Type;

export const SovereignIntegrationIdInput = Schema.Struct({
  integrationId: IntegrationId,
});
export type SovereignIntegrationIdInput = typeof SovereignIntegrationIdInput.Type;

export const SovereignDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type SovereignDeleteResult = typeof SovereignDeleteResult.Type;

const SovereignRpcError = Schema.Union([SovereignError, EnvironmentAuthorizationError]);

const WsSovereignSubscribeRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignSubscribe, {
  payload: Schema.Struct({}),
  success: SovereignEvent,
  error: SovereignRpcError,
  stream: true,
});

const WsSovereignGetOverviewRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignGetOverview, {
  payload: Schema.Struct({}),
  success: SovereignOverviewSnapshot,
  error: SovereignRpcError,
});

const WsSovereignGetVentureDetailRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignGetVentureDetail, {
  payload: SovereignGetVentureDetailInput,
  success: SovereignVentureDetail,
  error: SovereignRpcError,
});

const WsSovereignListBlueprintsRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignListBlueprints, {
  payload: Schema.Struct({}),
  success: SovereignListBlueprintsResult,
  error: SovereignRpcError,
});

const WsSovereignListLedgerEntriesRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignListLedgerEntries, {
  payload: SovereignListLedgerEntriesInput,
  success: SovereignListLedgerEntriesResult,
  error: SovereignRpcError,
});

const WsSovereignListApprovalsRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignListApprovals, {
  payload: SovereignListApprovalsInput,
  success: SovereignListApprovalsResult,
  error: SovereignRpcError,
});

const WsSovereignListAuditEventsRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignListAuditEvents, {
  payload: SovereignListAuditEventsInput,
  success: SovereignListAuditEventsResult,
  error: SovereignRpcError,
});

const WsSovereignGetProviderPoolRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignGetProviderPool, {
  payload: Schema.Struct({}),
  success: ProviderPoolSnapshot,
  error: SovereignRpcError,
});

const WsSovereignListIntegrationsRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignListIntegrations, {
  payload: SovereignListIntegrationsInput,
  success: IntegrationSummary,
  error: SovereignRpcError,
});

const WsSovereignCreateVentureRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateVenture, {
  payload: CreateVentureInput,
  success: Venture,
  error: SovereignRpcError,
});

const WsSovereignUpdateVentureRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpdateVenture, {
  payload: UpdateVentureInput,
  success: Venture,
  error: SovereignRpcError,
});

const WsSovereignDeleteVentureRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignDeleteVenture, {
  payload: DeleteVentureInput,
  success: SovereignDeleteResult,
  error: SovereignRpcError,
});

const WsSovereignCreateObjectiveRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateObjective, {
  payload: CreateObjectiveInput,
  success: CommercialObjective,
  error: SovereignRpcError,
});

const WsSovereignUpdateObjectiveRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpdateObjective, {
  payload: UpdateObjectiveInput,
  success: CommercialObjective,
  error: SovereignRpcError,
});

const WsSovereignCreateOpportunityRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateOpportunity, {
  payload: CreateOpportunityInput,
  success: Opportunity,
  error: SovereignRpcError,
});

const WsSovereignUpdateOpportunityRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpdateOpportunity, {
  payload: UpdateOpportunityInput,
  success: Opportunity,
  error: SovereignRpcError,
});

const WsSovereignCreateTaskRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateTask, {
  payload: CreateCommercialTaskInput,
  success: CommercialTask,
  error: SovereignRpcError,
});

const WsSovereignUpdateTaskRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpdateTask, {
  payload: UpdateCommercialTaskInput,
  success: CommercialTask,
  error: SovereignRpcError,
});

const WsSovereignCreateArtifactRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateArtifact, {
  payload: CreateCommercialArtifactInput,
  success: CommercialArtifact,
  error: SovereignRpcError,
});

const WsSovereignCreateLeadRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateLead, {
  payload: CreateLeadInput,
  success: Lead,
  error: SovereignRpcError,
});

const WsSovereignCreateProposalRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateProposal, {
  payload: CreateProposalInput,
  success: Proposal,
  error: SovereignRpcError,
});

const WsSovereignCreateCommunicationRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignCreateCommunication,
  {
    payload: CreateCommunicationInput,
    success: CommunicationRecord,
    error: SovereignRpcError,
  },
);

const WsSovereignUpsertVoiceAgentRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpsertVoiceAgent, {
  payload: UpsertVoiceAgentInput,
  success: VoiceAgentConfig,
  error: SovereignRpcError,
});

const WsSovereignCreateInvoiceRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignCreateInvoice, {
  payload: CreateInvoiceInput,
  success: Invoice,
  error: SovereignRpcError,
});

const WsSovereignRecordLedgerEntryRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignRecordLedgerEntry, {
  payload: RecordLedgerEntryInput,
  success: LedgerEntry,
  error: SovereignRpcError,
});

const WsSovereignRequestApprovalRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignRequestApproval, {
  payload: CreateApprovalRequestInput,
  success: ApprovalRequest,
  error: SovereignRpcError,
});

const WsSovereignRouteProviderRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignRouteProvider, {
  payload: ProviderRouteRequest,
  success: ProviderRouteDecision,
  error: SovereignRpcError,
});

const WsSovereignDecideApprovalRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignDecideApproval, {
  payload: ApprovalDecisionInput,
  success: ApprovalRequest,
  error: SovereignRpcError,
});

const WsSovereignUpsertPreapprovalPolicyRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignUpsertPreapprovalPolicy,
  {
    payload: UpsertPreapprovalPolicyInput,
    success: PreapprovalPolicy,
    error: SovereignRpcError,
  },
);

const WsSovereignDeletePreapprovalPolicyRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignDeletePreapprovalPolicy,
  {
    payload: DeletePreapprovalPolicyInput,
    success: SovereignDeleteResult,
    error: SovereignRpcError,
  },
);

const WsSovereignUpdateControlStateRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignUpdateControlState,
  {
    payload: UpdateGlobalControlStateInput,
    success: GlobalControlState,
    error: SovereignRpcError,
  },
);

const WsSovereignTriggerEmergencyStopRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignTriggerEmergencyStop,
  {
    payload: TriggerEmergencyStopInput,
    success: GlobalControlState,
    error: SovereignRpcError,
  },
);

const WsSovereignUpsertIntegrationRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignUpsertIntegration, {
  payload: UpsertIntegrationInput,
  success: IntegrationConfig,
  error: SovereignRpcError,
});

const WsSovereignDeleteIntegrationRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignDeleteIntegration, {
  payload: SovereignIntegrationIdInput,
  success: SovereignDeleteResult,
  error: SovereignRpcError,
});

const WsSovereignTestIntegrationRpc = Rpc.make(SOVEREIGN_WS_METHODS.sovereignTestIntegration, {
  payload: SovereignIntegrationIdInput,
  success: IntegrationTestResult,
  error: SovereignRpcError,
});

const WsSovereignUpdateProviderPoolConfigRpc = Rpc.make(
  SOVEREIGN_WS_METHODS.sovereignUpdateProviderPoolConfig,
  {
    payload: UpdateProviderPoolConfigInput,
    success: ProviderPoolSnapshot,
    error: SovereignRpcError,
  },
);

export const SOVEREIGN_RPCS = [
  WsSovereignSubscribeRpc,
  WsSovereignGetOverviewRpc,
  WsSovereignGetVentureDetailRpc,
  WsSovereignListBlueprintsRpc,
  WsSovereignListLedgerEntriesRpc,
  WsSovereignListApprovalsRpc,
  WsSovereignListAuditEventsRpc,
  WsSovereignGetProviderPoolRpc,
  WsSovereignListIntegrationsRpc,
  WsSovereignCreateVentureRpc,
  WsSovereignUpdateVentureRpc,
  WsSovereignDeleteVentureRpc,
  WsSovereignCreateObjectiveRpc,
  WsSovereignUpdateObjectiveRpc,
  WsSovereignCreateOpportunityRpc,
  WsSovereignUpdateOpportunityRpc,
  WsSovereignCreateTaskRpc,
  WsSovereignUpdateTaskRpc,
  WsSovereignCreateArtifactRpc,
  WsSovereignCreateLeadRpc,
  WsSovereignCreateProposalRpc,
  WsSovereignCreateCommunicationRpc,
  WsSovereignUpsertVoiceAgentRpc,
  WsSovereignCreateInvoiceRpc,
  WsSovereignRecordLedgerEntryRpc,
  WsSovereignRequestApprovalRpc,
  WsSovereignRouteProviderRpc,
  WsSovereignDecideApprovalRpc,
  WsSovereignUpsertPreapprovalPolicyRpc,
  WsSovereignDeletePreapprovalPolicyRpc,
  WsSovereignUpdateControlStateRpc,
  WsSovereignTriggerEmergencyStopRpc,
  WsSovereignUpsertIntegrationRpc,
  WsSovereignDeleteIntegrationRpc,
  WsSovereignTestIntegrationRpc,
  WsSovereignUpdateProviderPoolConfigRpc,
] as const;
