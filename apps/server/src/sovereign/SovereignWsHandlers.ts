import {
  SOVEREIGN_WS_METHODS,
  type ServerRemoveProviderInstanceInput,
  type ServerUpsertProviderInstanceInput,
  SovereignError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { rpcInitialItems } from "../rpcInitialItems.ts";
import * as ServerSettings from "../serverSettings.ts";
import { type SovereignDomainError, toSovereignRpcError } from "./SovereignErrors.ts";
import type * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import type * as SovereignIntegrationService from "./SovereignIntegrationService.ts";
import type * as SovereignLedgerService from "./SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "./SovereignOrchestratorService.ts";
import type * as SovereignSalesService from "./SovereignSalesService.ts";

export interface OptionalSovereignServices {
  readonly orchestrator: Option.Option<
    SovereignOrchestratorService.SovereignOrchestratorService["Service"]
  >;
  readonly governance: Option.Option<
    SovereignGovernanceService.SovereignGovernanceService["Service"]
  >;
  readonly ledger: Option.Option<SovereignLedgerService.SovereignLedgerService["Service"]>;
  readonly sales: Option.Option<SovereignSalesService.SovereignSalesService["Service"]>;
  readonly integrations: Option.Option<
    SovereignIntegrationService.SovereignIntegrationService["Service"]
  >;
}

const runtimeUnavailableError = new SovereignError({
  code: "internal",
  message: "Sovereign runtime is not configured on this server.",
});

const requireService = <Service, A>(
  serviceOption: Option.Option<Service>,
  call: (service: Service) => Effect.Effect<A, SovereignDomainError>,
): Effect.Effect<A, SovereignError> =>
  Option.isNone(serviceOption)
    ? Effect.fail(runtimeUnavailableError)
    : call(serviceOption.value).pipe(Effect.mapError(toSovereignRpcError));

export const handleUpsertProviderInstance = (
  serverSettings: ServerSettings.ServerSettingsService["Service"],
  settingsClient: ServerSettings.SettingsClient,
  input: ServerUpsertProviderInstanceInput,
) =>
  serverSettings
    .updateProviderInstance({
      operation: "upsert",
      instanceId: input.instanceId,
      instance: input.instance,
    })
    .pipe(
      Effect.map((settings) =>
        ServerSettings.redactServerSettingsForClient(settings, settingsClient),
      ),
    );

export const handleRemoveProviderInstance = (
  serverSettings: ServerSettings.ServerSettingsService["Service"],
  settingsClient: ServerSettings.SettingsClient,
  input: ServerRemoveProviderInstanceInput,
) =>
  serverSettings
    .updateProviderInstance({
      operation: "remove",
      instanceId: input.instanceId,
    })
    .pipe(
      Effect.map((settings) =>
        ServerSettings.redactServerSettingsForClient(settings, settingsClient),
      ),
    );

export const makeSovereignRpcHandlers = (services: OptionalSovereignServices) => ({
  [SOVEREIGN_WS_METHODS.sovereignSubscribe]: (_input: {}) => {
    if (Option.isNone(services.orchestrator)) {
      return Stream.fail(runtimeUnavailableError);
    }
    const orchestrator = services.orchestrator.value;
    return Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading the initial snapshot so concurrent updates are never missed.
        const liveEvents = yield* orchestrator.subscribeEvents;
        const initialSnapshot = yield* orchestrator.getOverview.pipe(
          Effect.mapError(toSovereignRpcError),
        );
        return Stream.concat(
          rpcInitialItems([
            {
              version: 1 as const,
              revision: initialSnapshot.revision,
              type: "snapshot" as const,
              payload: initialSnapshot,
            },
          ]),
          liveEvents,
        );
      }),
    );
  },

  [SOVEREIGN_WS_METHODS.sovereignGetOverview]: (_input: {}) =>
    requireService(services.orchestrator, (orchestrator) => orchestrator.getOverview),

  [SOVEREIGN_WS_METHODS.sovereignGetVentureDetail]: (input: {
    readonly ventureId: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["getVentureDetail"]
    >[0];
  }) =>
    requireService(services.orchestrator, (orchestrator) =>
      orchestrator.getVentureDetail(input.ventureId),
    ),

  [SOVEREIGN_WS_METHODS.sovereignListBlueprints]: (_input: {}) =>
    requireService(services.orchestrator, (orchestrator) => orchestrator.listBlueprints),

  [SOVEREIGN_WS_METHODS.sovereignListLedgerEntries]: (
    input: Parameters<SovereignLedgerService.SovereignLedgerService["Service"]["listEntries"]>[0],
  ) => requireService(services.ledger, (ledger) => ledger.listEntries(input)),

  [SOVEREIGN_WS_METHODS.sovereignListApprovals]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["listApprovals"]
    >[0],
  ) => requireService(services.governance, (governance) => governance.listApprovals(input)),

  [SOVEREIGN_WS_METHODS.sovereignListAuditEvents]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["listAuditEvents"]
    >[0],
  ) =>
    requireService(services.governance, (governance) =>
      governance.listAuditEvents(input).pipe(Effect.map((events) => ({ events }))),
    ),

  [SOVEREIGN_WS_METHODS.sovereignGetProviderPool]: (_input: {}) =>
    requireService(services.orchestrator, (orchestrator) => orchestrator.getProviderPool),

  [SOVEREIGN_WS_METHODS.sovereignListIntegrations]: (
    input: Parameters<
      SovereignIntegrationService.SovereignIntegrationService["Service"]["listIntegrations"]
    >[0],
  ) =>
    requireService(services.integrations, (integrations) => integrations.listIntegrations(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateVenture]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["createVenture"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.createVenture(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpdateVenture]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["updateVenture"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.updateVenture(input)),

  [SOVEREIGN_WS_METHODS.sovereignDeleteVenture]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["deleteVenture"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.deleteVenture(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateObjective]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["createObjective"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.createObjective(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpdateObjective]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["updateObjective"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.updateObjective(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateOpportunity]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["createOpportunity"]
    >[0],
  ) =>
    requireService(services.orchestrator, (orchestrator) => orchestrator.createOpportunity(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpdateOpportunity]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["updateOpportunity"]
    >[0],
  ) =>
    requireService(services.orchestrator, (orchestrator) => orchestrator.updateOpportunity(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateTask]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["createTask"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.createTask(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpdateTask]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["updateTask"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.updateTask(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateArtifact]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["createArtifact"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.createArtifact(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateLead]: (
    input: Parameters<SovereignSalesService.SovereignSalesService["Service"]["createLead"]>[0],
  ) => requireService(services.sales, (sales) => sales.createLead(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateProposal]: (
    input: Parameters<SovereignSalesService.SovereignSalesService["Service"]["createProposal"]>[0],
  ) => requireService(services.sales, (sales) => sales.createProposal(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateCommunication]: (
    input: Parameters<
      SovereignSalesService.SovereignSalesService["Service"]["createCommunication"]
    >[0],
  ) => requireService(services.sales, (sales) => sales.createCommunication(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpsertVoiceAgent]: (
    input: Parameters<
      SovereignSalesService.SovereignSalesService["Service"]["upsertVoiceAgent"]
    >[0],
  ) => requireService(services.sales, (sales) => sales.upsertVoiceAgent(input)),

  [SOVEREIGN_WS_METHODS.sovereignCreateInvoice]: (
    input: Parameters<SovereignLedgerService.SovereignLedgerService["Service"]["createInvoice"]>[0],
  ) => requireService(services.ledger, (ledger) => ledger.createInvoice(input)),

  [SOVEREIGN_WS_METHODS.sovereignRecordLedgerEntry]: (
    input: Parameters<SovereignLedgerService.SovereignLedgerService["Service"]["recordEntry"]>[0],
  ) => requireService(services.ledger, (ledger) => ledger.recordEntry(input)),

  [SOVEREIGN_WS_METHODS.sovereignRequestApproval]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["requestApproval"]
    >[0],
  ) => requireService(services.governance, (governance) => governance.requestApproval(input)),

  [SOVEREIGN_WS_METHODS.sovereignRouteProvider]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["routeProvider"]
    >[0],
  ) => requireService(services.orchestrator, (orchestrator) => orchestrator.routeProvider(input)),

  [SOVEREIGN_WS_METHODS.sovereignDecideApproval]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["decideApproval"]
    >[0],
  ) => requireService(services.governance, (governance) => governance.decideApproval(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpsertPreapprovalPolicy]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["upsertPreapprovalPolicy"]
    >[0],
  ) =>
    requireService(services.governance, (governance) => governance.upsertPreapprovalPolicy(input)),

  [SOVEREIGN_WS_METHODS.sovereignDeletePreapprovalPolicy]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["deletePreapprovalPolicy"]
    >[0],
  ) =>
    requireService(services.governance, (governance) => governance.deletePreapprovalPolicy(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpdateControlState]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["updateControlState"]
    >[0],
  ) => requireService(services.governance, (governance) => governance.updateControlState(input)),

  [SOVEREIGN_WS_METHODS.sovereignTriggerEmergencyStop]: (
    input: Parameters<
      SovereignGovernanceService.SovereignGovernanceService["Service"]["triggerEmergencyStop"]
    >[0],
  ) => requireService(services.governance, (governance) => governance.triggerEmergencyStop(input)),

  [SOVEREIGN_WS_METHODS.sovereignUpsertIntegration]: (
    input: Parameters<
      SovereignIntegrationService.SovereignIntegrationService["Service"]["upsertIntegration"]
    >[0],
  ) =>
    requireService(services.integrations, (integrations) => integrations.upsertIntegration(input)),

  [SOVEREIGN_WS_METHODS.sovereignDeleteIntegration]: (input: {
    readonly integrationId: Parameters<
      SovereignIntegrationService.SovereignIntegrationService["Service"]["deleteIntegration"]
    >[0];
  }) =>
    requireService(services.integrations, (integrations) =>
      integrations.deleteIntegration(input.integrationId),
    ),

  [SOVEREIGN_WS_METHODS.sovereignTestIntegration]: (input: {
    readonly integrationId: Parameters<
      SovereignIntegrationService.SovereignIntegrationService["Service"]["testIntegration"]
    >[0];
  }) =>
    requireService(services.integrations, (integrations) =>
      integrations.testIntegration(input.integrationId),
    ),

  [SOVEREIGN_WS_METHODS.sovereignUpdateProviderPoolConfig]: (
    input: Parameters<
      SovereignOrchestratorService.SovereignOrchestratorService["Service"]["updateProviderPoolConfig"]
    >[0],
  ) =>
    requireService(services.orchestrator, (orchestrator) =>
      orchestrator.updateProviderPoolConfig(input),
    ),
});
