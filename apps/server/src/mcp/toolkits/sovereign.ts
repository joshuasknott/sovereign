import {
  ApprovalRequest,
  CommercialArtifact,
  CreateApprovalRequestInput,
  CreateCommercialArtifactInput,
  CreateOpportunityInput,
  Opportunity,
  OrchestratorMcpFailure,
  SovereignOverviewSnapshot,
  SovereignVentureDetail,
  VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import type { SovereignDomainError } from "../../sovereign/SovereignErrors.ts";
import * as SovereignGovernanceService from "../../sovereign/SovereignGovernanceService.ts";
import * as SovereignOrchestratorService from "../../sovereign/SovereignOrchestratorService.ts";
import * as McpInvocationContext from "../McpInvocationContext.ts";
import * as McpToolAccess from "../McpToolAccess.ts";

const toMcpFailure = (error: SovereignDomainError): OrchestratorMcpFailure =>
  new OrchestratorMcpFailure({
    code:
      error._tag === "SovereignPermissionError"
        ? "capability_denied"
        : error._tag === "SovereignPersistenceError"
          ? "orchestration_error"
          : "invalid_request",
    message: error.message,
  });

const readDependencies = [
  McpInvocationContext.McpInvocationContext,
  SovereignOrchestratorService.SovereignOrchestratorService,
] as const;

const writeDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  SovereignOrchestratorService.SovereignOrchestratorService,
  SovereignGovernanceService.SovereignGovernanceService,
] as const;

const SovereignGetOverviewTool = Tool.make("sovereign_get_overview", {
  description:
    "Read the current Sovereign Commercial OS overview: ventures, verified financial summary, active objectives, pending approvals, provider pool health, and recommendations.",
  success: SovereignOverviewSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...readDependencies],
})
  .annotate(Tool.Title, "Sovereign overview")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const SovereignGetVentureTool = Tool.make("sovereign_get_venture", {
  description:
    "Read full detail for one Sovereign venture including objectives, opportunities, tasks, leads, invoices, financial summary, approvals, and artifacts.",
  parameters: Schema.Struct({
    ventureId: VentureId,
  }),
  success: SovereignVentureDetail,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...readDependencies],
})
  .annotate(Tool.Title, "Sovereign venture detail")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const SovereignListOpportunitiesTool = Tool.make("sovereign_list_opportunities", {
  description:
    "List Sovereign commercial opportunities across the portfolio or filtered to one venture.",
  parameters: Schema.Struct({
    ventureId: Schema.optionalKey(VentureId),
  }),
  success: Schema.Struct({
    opportunities: Schema.Array(Opportunity),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...readDependencies],
})
  .annotate(Tool.Title, "Sovereign opportunities")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const SovereignRecordOpportunityTool = Tool.make("sovereign_record_opportunity", {
  description:
    "Record a newly discovered commercial opportunity for a Sovereign venture with automatic scoring and deduplication.",
  parameters: CreateOpportunityInput,
  success: Opportunity,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...writeDependencies],
})
  .annotate(Tool.Title, "Record Sovereign opportunity")
  .annotate(Tool.Destructive, false);

const SovereignCreateArtifactTool = Tool.make("sovereign_create_artifact", {
  description:
    "Register a completed deliverable or research artifact linked to a Sovereign venture and optional task or opportunity.",
  parameters: CreateCommercialArtifactInput,
  success: CommercialArtifact,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...writeDependencies],
})
  .annotate(Tool.Title, "Create Sovereign artifact")
  .annotate(Tool.Destructive, false);

const SovereignRequestApprovalTool = Tool.make("sovereign_request_approval", {
  description:
    "Submit an external action for explicit owner approval. Never bypasses governance or emergency stop policies.",
  parameters: CreateApprovalRequestInput,
  success: ApprovalRequest,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [...writeDependencies],
})
  .annotate(Tool.Title, "Request Sovereign approval")
  .annotate(Tool.Destructive, false);

export const SovereignToolkit = Toolkit.make(
  SovereignGetOverviewTool,
  SovereignGetVentureTool,
  SovereignListOpportunitiesTool,
  SovereignRecordOpportunityTool,
  SovereignCreateArtifactTool,
  SovereignRequestApprovalTool,
);

export const layer = McpToolAccess.toLayer(SovereignToolkit, {
  sovereign_get_overview: McpToolAccess.reads(() =>
    Effect.flatMap(SovereignOrchestratorService.SovereignOrchestratorService, (orchestrator) =>
      orchestrator.getOverview.pipe(Effect.mapError(toMcpFailure)),
    ),
  ),
  sovereign_get_venture: McpToolAccess.reads((input) =>
    Effect.flatMap(SovereignOrchestratorService.SovereignOrchestratorService, (orchestrator) =>
      orchestrator.getVentureDetail(input.ventureId).pipe(Effect.mapError(toMcpFailure)),
    ),
  ),
  sovereign_list_opportunities: McpToolAccess.reads((input) =>
    Effect.flatMap(SovereignOrchestratorService.SovereignOrchestratorService, (orchestrator) =>
      orchestrator
        .listOpportunities(
          input.ventureId === undefined ? undefined : { ventureId: input.ventureId },
        )
        .pipe(
          Effect.map((opportunities) => ({ opportunities })),
          Effect.mapError(toMcpFailure),
        ),
    ),
  ),
  sovereign_record_opportunity: McpToolAccess.writes((input) =>
    Effect.flatMap(SovereignOrchestratorService.SovereignOrchestratorService, (orchestrator) =>
      orchestrator.createOpportunity(input).pipe(Effect.mapError(toMcpFailure)),
    ),
  ),
  sovereign_create_artifact: McpToolAccess.writes((input) =>
    Effect.flatMap(SovereignOrchestratorService.SovereignOrchestratorService, (orchestrator) =>
      orchestrator.createArtifact(input).pipe(Effect.mapError(toMcpFailure)),
    ),
  ),
  sovereign_request_approval: McpToolAccess.writes((input) =>
    Effect.flatMap(SovereignGovernanceService.SovereignGovernanceService, (governance) =>
      governance.requestApproval(input).pipe(Effect.mapError(toMcpFailure)),
    ),
  ),
});
