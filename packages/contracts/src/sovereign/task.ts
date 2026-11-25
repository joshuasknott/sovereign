import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../baseSchemas.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import {
  ApprovalRequestId,
  ArtifactId,
  CommercialTaskId,
  ObjectiveId,
  OpportunityId,
  SovereignMetadata,
  VentureId,
} from "./ids.ts";
import { ProviderRoutingPolicy } from "./providerPool.ts";

export const CommercialTaskStatus = Schema.Literals([
  "queued",
  "ready",
  "in_progress",
  "waiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
export type CommercialTaskStatus = typeof CommercialTaskStatus.Type;

export const TaskComplexity = Schema.Literals(["trivial", "low", "medium", "high", "frontier"]);
export type TaskComplexity = typeof TaskComplexity.Type;

export const CommercialTaskPriority = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);
export type CommercialTaskPriority = typeof CommercialTaskPriority.Type;

export const CommercialArtifactKind = Schema.Literals([
  "code_patch",
  "pull_request",
  "security_report",
  "proposal_document",
  "website_preview",
  "voice_script",
  "digital_asset",
  "invoice_pdf",
  "research_brief",
  "audit_bundle",
  "other",
]);
export type CommercialArtifactKind = typeof CommercialArtifactKind.Type;

export const CommercialArtifact = Schema.Struct({
  id: ArtifactId,
  ventureId: VentureId,
  taskId: Schema.NullOr(CommercialTaskId),
  opportunityId: Schema.optionalKey(Schema.NullOr(OpportunityId)),
  kind: CommercialArtifactKind,
  title: TrimmedNonEmptyString,
  summary: TrimmedString,
  uri: Schema.NullOr(TrimmedNonEmptyString),
  mimeType: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  sha256: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optionalKey(SovereignMetadata),
  createdAt: IsoDateTime,
});
export type CommercialArtifact = typeof CommercialArtifact.Type;

export const CreateCommercialArtifactInput = Schema.Struct({
  ventureId: VentureId,
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  opportunityId: Schema.optionalKey(Schema.NullOr(OpportunityId)),
  kind: CommercialArtifactKind,
  title: TrimmedNonEmptyString,
  summary: Schema.optionalKey(TrimmedString),
  uri: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  mimeType: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  sha256: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optionalKey(SovereignMetadata),
});
export type CreateCommercialArtifactInput = typeof CreateCommercialArtifactInput.Type;

export const CommercialTask = Schema.Struct({
  id: CommercialTaskId,
  ventureId: VentureId,
  objectiveId: Schema.NullOr(ObjectiveId),
  opportunityId: Schema.NullOr(OpportunityId),
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  status: CommercialTaskStatus,
  complexity: TaskComplexity,
  priority: CommercialTaskPriority,
  assignedProviderInstanceId: Schema.NullOr(ProviderInstanceId),
  assignedModel: Schema.NullOr(TrimmedNonEmptyString),
  linkedThreadId: Schema.NullOr(ThreadId),
  linkedRunId: Schema.NullOr(RunId),
  pendingApprovalId: Schema.NullOr(ApprovalRequestId),
  routingPolicyOverride: Schema.optionalKey(Schema.NullOr(ProviderRoutingPolicy)),
  blockedReason: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  artifactIds: Schema.Array(ArtifactId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type CommercialTask = typeof CommercialTask.Type;

export const CreateCommercialTaskInput = Schema.Struct({
  ventureId: VentureId,
  objectiveId: Schema.optionalKey(Schema.NullOr(ObjectiveId)),
  opportunityId: Schema.optionalKey(Schema.NullOr(OpportunityId)),
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedString),
  status: Schema.optionalKey(CommercialTaskStatus),
  complexity: Schema.optionalKey(TaskComplexity),
  priority: Schema.optionalKey(CommercialTaskPriority),
  assignedProviderInstanceId: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
  assignedModel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  linkedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  routingPolicyOverride: Schema.optionalKey(Schema.NullOr(ProviderRoutingPolicy)),
});
export type CreateCommercialTaskInput = typeof CreateCommercialTaskInput.Type;

export const UpdateCommercialTaskInput = Schema.Struct({
  taskId: CommercialTaskId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(TrimmedString),
  status: Schema.optionalKey(CommercialTaskStatus),
  complexity: Schema.optionalKey(TaskComplexity),
  priority: Schema.optionalKey(CommercialTaskPriority),
  assignedProviderInstanceId: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
  assignedModel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  linkedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  linkedRunId: Schema.optionalKey(Schema.NullOr(RunId)),
  pendingApprovalId: Schema.optionalKey(Schema.NullOr(ApprovalRequestId)),
  routingPolicyOverride: Schema.optionalKey(Schema.NullOr(ProviderRoutingPolicy)),
  blockedReason: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type UpdateCommercialTaskInput = typeof UpdateCommercialTaskInput.Type;
