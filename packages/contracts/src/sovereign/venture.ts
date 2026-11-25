import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../baseSchemas.ts";
import { DEFAULT_VENTURE_PERMISSION_POLICY, VenturePermissionPolicy } from "./governance.ts";
import {
  CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  MinorCurrencyAmount,
  NonNegativeMinorAmount,
  Percentage,
  SovereignMetadata,
  VentureId,
} from "./ids.ts";
import { DEFAULT_PROVIDER_ROUTING_POLICY, ProviderRoutingPolicy } from "./providerPool.ts";

export const VentureKind = Schema.Literals([
  "dev_bounties",
  "security_bounties",
  "web_agency",
  "voice_ai",
  "paid_tasks",
  "digital_products",
  "micro_saas",
  "custom",
]);
export type VentureKind = typeof VentureKind.Type;

export const VentureUiModule = Schema.Literals([
  "operations",
  "bounties",
  "security_programmes",
  "prospects_sales",
  "voice_agents",
  "paid_tasks",
  "digital_products",
  "micro_saas",
  "finances",
  "workspace_conversations",
  "approvals",
  "artifacts",
]);
export type VentureUiModule = typeof VentureUiModule.Type;

export const VentureStatus = Schema.Literals(["active", "paused", "draft", "archived"]);
export type VentureStatus = typeof VentureStatus.Type;

export const VentureBudgetPolicy = Schema.Struct({
  currency: CurrencyCode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_REPORTING_CURRENCY)),
  ),
  monthlyCapMinor: NonNegativeMinorAmount.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  discretionarySpendAllowed: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  alertThresholdPct: Percentage.pipe(Schema.withDecodingDefault(Effect.succeed(80))),
});
export type VentureBudgetPolicy = typeof VentureBudgetPolicy.Type;

export const DEFAULT_VENTURE_BUDGET_POLICY: VentureBudgetPolicy = Schema.decodeSync(
  VentureBudgetPolicy,
)({});

export const VentureBlueprint = Schema.Struct({
  templateKey: TrimmedNonEmptyString,
  kind: VentureKind,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  uiModules: Schema.Array(VentureUiModule),
  defaultPermissionPolicy: VenturePermissionPolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_PERMISSION_POLICY)),
  ),
  defaultBudgetPolicy: VentureBudgetPolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_VENTURE_BUDGET_POLICY)),
  ),
  defaultRoutingPolicy: ProviderRoutingPolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_ROUTING_POLICY)),
  ),
  requiredIntegrationCategories: Schema.Array(TrimmedNonEmptyString),
  defaultWorkflowTags: Schema.Array(TrimmedNonEmptyString),
});
export type VentureBlueprint = typeof VentureBlueprint.Type;

export const Venture = Schema.Struct({
  id: VentureId,
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: VentureKind,
  templateKey: TrimmedNonEmptyString,
  status: VentureStatus,
  summary: TrimmedString,
  uiModules: Schema.Array(VentureUiModule),
  budgetPolicy: VentureBudgetPolicy,
  permissionPolicy: VenturePermissionPolicy,
  routingPolicy: ProviderRoutingPolicy,
  linkedProjectIds: Schema.Array(ProjectId),
  linkedThreadIds: Schema.Array(ThreadId),
  linkedScheduledTaskIds: Schema.Array(ScheduledTaskId),
  tags: Schema.Array(TrimmedNonEmptyString),
  config: Schema.optionalKey(SovereignMetadata),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Venture = typeof Venture.Type;

export const CreateVentureInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  slug: Schema.optionalKey(TrimmedNonEmptyString),
  kind: VentureKind,
  templateKey: Schema.optionalKey(TrimmedNonEmptyString),
  status: Schema.optionalKey(VentureStatus),
  summary: Schema.optionalKey(TrimmedString),
  uiModules: Schema.optionalKey(Schema.Array(VentureUiModule)),
  budgetPolicy: Schema.optionalKey(VentureBudgetPolicy),
  permissionPolicy: Schema.optionalKey(VenturePermissionPolicy),
  routingPolicy: Schema.optionalKey(ProviderRoutingPolicy),
  linkedProjectIds: Schema.optionalKey(Schema.Array(ProjectId)),
  tags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  config: Schema.optionalKey(SovereignMetadata),
});
export type CreateVentureInput = typeof CreateVentureInput.Type;

export const UpdateVentureInput = Schema.Struct({
  ventureId: VentureId,
  name: Schema.optionalKey(TrimmedNonEmptyString),
  status: Schema.optionalKey(VentureStatus),
  summary: Schema.optionalKey(TrimmedString),
  uiModules: Schema.optionalKey(Schema.Array(VentureUiModule)),
  budgetPolicy: Schema.optionalKey(VentureBudgetPolicy),
  permissionPolicy: Schema.optionalKey(VenturePermissionPolicy),
  routingPolicy: Schema.optionalKey(ProviderRoutingPolicy),
  linkedProjectIds: Schema.optionalKey(Schema.Array(ProjectId)),
  linkedThreadIds: Schema.optionalKey(Schema.Array(ThreadId)),
  linkedScheduledTaskIds: Schema.optionalKey(Schema.Array(ScheduledTaskId)),
  tags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  config: Schema.optionalKey(SovereignMetadata),
});
export type UpdateVentureInput = typeof UpdateVentureInput.Type;

export const DeleteVentureInput = Schema.Struct({
  ventureId: VentureId,
});
export type DeleteVentureInput = typeof DeleteVentureInput.Type;

export const VentureOverviewRow = Schema.Struct({
  venture: Venture,
  activeObjectivesCount: NonNegativeInt,
  openOpportunitiesCount: NonNegativeInt,
  activeTasksCount: NonNegativeInt,
  pendingApprovalsCount: NonNegativeInt,
  collectedRevenueMinor: MinorCurrencyAmount,
  confirmedExpensesMinor: MinorCurrencyAmount,
  netProfitMinor: MinorCurrencyAmount,
  pipelineValueMinor: MinorCurrencyAmount,
  currency: CurrencyCode,
  lastActivityAt: Schema.NullOr(IsoDateTime),
});
export type VentureOverviewRow = typeof VentureOverviewRow.Type;
