import { type EnvironmentId, type VentureId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { invalidateSovereignQueries, type SovereignQueryDomain } from "./atoms.ts";

export interface SovereignInvalidationEvent {
  readonly environmentId: EnvironmentId;
  readonly ventureId?: VentureId | null;
  readonly domains: ReadonlyArray<SovereignQueryDomain>;
}

export interface SovereignCommandsOptions {
  readonly onInvalidate?: (event: SovereignInvalidationEvent) => void;
}

export function createSovereignCommands<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: SovereignCommandsOptions = {},
) {
  const controlScheduler = createAtomCommandScheduler();
  const poolScheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
  };

  const invalidate = (
    registry: AtomRegistry.AtomRegistry,
    environmentId: EnvironmentId,
    domains: ReadonlyArray<SovereignQueryDomain>,
    ventureId?: VentureId | null,
  ) =>
    Effect.sync(() => {
      invalidateSovereignQueries(registry, environmentId, ventureId, domains);
      options.onInvalidate?.({
        environmentId,
        ...(ventureId === undefined ? {} : { ventureId }),
        domains,
      });
    });

  return {
    invalidateSovereignQueries,

    createVentureCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-venture",
      tag: WS_METHODS.sovereignCreateVenture,
      onSuccess: ({ environmentId }, registry, venture) =>
        invalidate(registry, environmentId, ["overview", "ventures", "auditEvents"], venture.id),
    }),
    updateVentureCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-venture",
      tag: WS_METHODS.sovereignUpdateVenture,
      onSuccess: ({ environmentId, input }, registry) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          input.ventureId,
        ),
    }),
    deleteVentureCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:delete-venture",
      tag: WS_METHODS.sovereignDeleteVenture,
      onSuccess: ({ environmentId, input }, registry) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "approvals", "ledger", "integrations", "auditEvents"],
          input.ventureId,
        ),
    }),

    createObjectiveCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-objective",
      tag: WS_METHODS.sovereignCreateObjective,
      onSuccess: ({ environmentId }, registry, objective) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          objective.ventureId,
        ),
    }),
    updateObjectiveCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-objective",
      tag: WS_METHODS.sovereignUpdateObjective,
      onSuccess: ({ environmentId }, registry, objective) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          objective.ventureId,
        ),
    }),

    createOpportunityCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-opportunity",
      tag: WS_METHODS.sovereignCreateOpportunity,
      onSuccess: ({ environmentId }, registry, opportunity) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "ledger", "auditEvents"],
          opportunity.ventureId,
        ),
    }),
    updateOpportunityCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-opportunity",
      tag: WS_METHODS.sovereignUpdateOpportunity,
      onSuccess: ({ environmentId }, registry, opportunity) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "ledger", "auditEvents"],
          opportunity.ventureId,
        ),
    }),

    createTaskCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-task",
      tag: WS_METHODS.sovereignCreateTask,
      onSuccess: ({ environmentId }, registry, task) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          task.ventureId,
        ),
    }),
    updateTaskCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-task",
      tag: WS_METHODS.sovereignUpdateTask,
      onSuccess: ({ environmentId }, registry, task) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          task.ventureId,
        ),
    }),
    createArtifactCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-artifact",
      tag: WS_METHODS.sovereignCreateArtifact,
      onSuccess: ({ environmentId }, registry, artifact) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          artifact.ventureId,
        ),
    }),

    createLeadCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-lead",
      tag: WS_METHODS.sovereignCreateLead,
      onSuccess: ({ environmentId }, registry, lead) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          lead.ventureId,
        ),
    }),
    createProposalCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-proposal",
      tag: WS_METHODS.sovereignCreateProposal,
      onSuccess: ({ environmentId }, registry, proposal) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "ledger", "approvals", "auditEvents"],
          proposal.ventureId,
        ),
    }),
    createCommunicationCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-communication",
      tag: WS_METHODS.sovereignCreateCommunication,
      onSuccess: ({ environmentId }, registry, communication) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "approvals", "auditEvents"],
          communication.ventureId,
        ),
    }),
    upsertVoiceAgentCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:upsert-voice-agent",
      tag: WS_METHODS.sovereignUpsertVoiceAgent,
      onSuccess: ({ environmentId }, registry, voiceAgent) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "auditEvents"],
          voiceAgent.ventureId,
        ),
    }),

    createInvoiceCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:create-invoice",
      tag: WS_METHODS.sovereignCreateInvoice,
      onSuccess: ({ environmentId }, registry, invoice) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "ventures", "ledger", "auditEvents"],
          invoice.ventureId,
        ),
    }),
    recordLedgerEntryCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:record-ledger-entry",
      tag: WS_METHODS.sovereignRecordLedgerEntry,
      onSuccess: ({ environmentId }, registry, entry) =>
        invalidate(
          registry,
          environmentId,
          entry.ventureId === null
            ? ["overview", "ledger", "auditEvents"]
            : ["overview", "ventures", "ledger", "auditEvents"],
          entry.ventureId,
        ),
    }),

    requestApprovalCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:request-approval",
      tag: WS_METHODS.sovereignRequestApproval,
      onSuccess: ({ environmentId }, registry, approval) =>
        invalidate(
          registry,
          environmentId,
          approval.ventureId === null
            ? ["overview", "approvals", "auditEvents"]
            : ["overview", "ventures", "approvals", "auditEvents"],
          approval.ventureId,
        ),
    }),
    decideApprovalCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:decide-approval",
      tag: WS_METHODS.sovereignDecideApproval,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.approvalId]),
      },
      onSuccess: ({ environmentId }, registry, approval) =>
        invalidate(
          registry,
          environmentId,
          approval.ventureId === null
            ? ["overview", "approvals", "auditEvents"]
            : ["overview", "ventures", "approvals", "auditEvents"],
          approval.ventureId,
        ),
    }),
    upsertPreapprovalPolicyCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:upsert-preapproval-policy",
      tag: WS_METHODS.sovereignUpsertPreapprovalPolicy,
      onSuccess: ({ environmentId }, registry, policy) =>
        invalidate(
          registry,
          environmentId,
          policy.ventureId === null
            ? ["overview", "approvals", "auditEvents"]
            : ["overview", "ventures", "approvals", "auditEvents"],
          policy.ventureId,
        ),
    }),
    deletePreapprovalPolicyCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:delete-preapproval-policy",
      tag: WS_METHODS.sovereignDeletePreapprovalPolicy,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "ventures", "approvals", "auditEvents"]),
    }),
    updateControlStateCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-control-state",
      tag: WS_METHODS.sovereignUpdateControlState,
      scheduler: controlScheduler,
      concurrency: serialPerEnvironment,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "auditEvents"]),
    }),
    triggerEmergencyStopCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:trigger-emergency-stop",
      tag: WS_METHODS.sovereignTriggerEmergencyStop,
      scheduler: controlScheduler,
      concurrency: serialPerEnvironment,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "ventures", "approvals", "auditEvents"]),
    }),

    upsertIntegrationCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:upsert-integration",
      tag: WS_METHODS.sovereignUpsertIntegration,
      onSuccess: ({ environmentId }, registry, integration) =>
        invalidate(
          registry,
          environmentId,
          integration.ventureId === null
            ? ["overview", "integrations", "auditEvents"]
            : ["overview", "ventures", "integrations", "auditEvents"],
          integration.ventureId,
        ),
    }),
    deleteIntegrationCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:delete-integration",
      tag: WS_METHODS.sovereignDeleteIntegration,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, [
          "overview",
          "ventures",
          "integrations",
          "auditEvents",
        ]),
    }),
    testIntegrationCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:test-integration",
      tag: WS_METHODS.sovereignTestIntegration,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.integrationId]),
      },
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "integrations", "auditEvents"]),
    }),

    updateProviderPoolConfigCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:update-provider-pool-config",
      tag: WS_METHODS.sovereignUpdateProviderPoolConfig,
      scheduler: poolScheduler,
      concurrency: serialPerEnvironment,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "providerPool", "auditEvents"]),
    }),
    routeProviderCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:route-provider",
      tag: WS_METHODS.sovereignRouteProvider,
      onSuccess: ({ environmentId, input }, registry) =>
        invalidate(
          registry,
          environmentId,
          ["overview", "providerPool", "approvals", "auditEvents"],
          input.ventureId,
        ),
    }),
    upsertProviderInstanceCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:upsert-provider-instance",
      tag: WS_METHODS.serverUpsertProviderInstance,
      scheduler: poolScheduler,
      concurrency: serialPerEnvironment,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "providerPool", "auditEvents"]),
    }),
    removeProviderInstanceCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sovereign:remove-provider-instance",
      tag: WS_METHODS.serverRemoveProviderInstance,
      scheduler: poolScheduler,
      concurrency: serialPerEnvironment,
      onSuccess: ({ environmentId }, registry) =>
        invalidate(registry, environmentId, ["overview", "providerPool", "auditEvents"]),
    }),
  };
}

export type SovereignCommands<R = never, ER = never> = ReturnType<
  typeof createSovereignCommands<R, ER>
>;
