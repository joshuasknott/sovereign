import {
  type EnvironmentId,
  type SovereignEvent,
  type SovereignListApprovalsInput,
  type SovereignListAuditEventsInput,
  type SovereignListIntegrationsInput,
  type SovereignListLedgerEntriesInput,
  type VentureId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { EnvironmentRpcInput, EnvironmentUnaryRpcTag } from "../rpc/client.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export type SovereignQueryDomain =
  | "overview"
  | "ventures"
  | "blueprints"
  | "providerPool"
  | "integrations"
  | "approvals"
  | "ledger"
  | "auditEvents";

interface SovereignInvalidationState {
  readonly overview: number;
  readonly ventures: number;
  readonly ventureById: Readonly<Record<string, number>>;
  readonly blueprints: number;
  readonly providerPool: number;
  readonly integrations: number;
  readonly approvals: number;
  readonly ledger: number;
  readonly auditEvents: number;
}

const INITIAL_INVALIDATION_STATE: SovereignInvalidationState = {
  overview: 0,
  ventures: 0,
  ventureById: {},
  blueprints: 0,
  providerPool: 0,
  integrations: 0,
  approvals: 0,
  ledger: 0,
  auditEvents: 0,
};

const ALL_SOVEREIGN_DOMAINS: ReadonlyArray<SovereignQueryDomain> = [
  "overview",
  "ventures",
  "blueprints",
  "providerPool",
  "integrations",
  "approvals",
  "ledger",
  "auditEvents",
];

const VENTURE_SCOPED_DEFAULT_DOMAINS: ReadonlyArray<SovereignQueryDomain> = [
  "overview",
  "ventures",
  "approvals",
  "ledger",
  "providerPool",
  "integrations",
  "auditEvents",
];

// Kept alive per registry so idle queries with TTL still detect invalidations when remounted.
const sovereignInvalidationAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make<SovereignInvalidationState>(INITIAL_INVALIDATION_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:sovereign:invalidation:${environmentId}`),
  ),
);

function bumpDomains(
  current: SovereignInvalidationState,
  domains: ReadonlyArray<SovereignQueryDomain>,
  ventureId: VentureId | null | undefined,
): SovereignInvalidationState {
  let overview = current.overview;
  let ventures = current.ventures;
  let bumpSpecificVenture = false;
  let blueprints = current.blueprints;
  let providerPool = current.providerPool;
  let integrations = current.integrations;
  let approvals = current.approvals;
  let ledger = current.ledger;
  let auditEvents = current.auditEvents;

  for (const domain of domains) {
    switch (domain) {
      case "overview":
        overview += 1;
        break;
      case "ventures":
        if (ventureId !== undefined && ventureId !== null) {
          bumpSpecificVenture = true;
        } else {
          ventures += 1;
        }
        break;
      case "blueprints":
        blueprints += 1;
        break;
      case "providerPool":
        providerPool += 1;
        break;
      case "integrations":
        integrations += 1;
        break;
      case "approvals":
        approvals += 1;
        break;
      case "ledger":
        ledger += 1;
        break;
      case "auditEvents":
        auditEvents += 1;
        break;
    }
  }

  const ventureById =
    bumpSpecificVenture && ventureId !== undefined && ventureId !== null
      ? {
          ...current.ventureById,
          [ventureId]: (current.ventureById[ventureId] ?? 0) + 1,
        }
      : current.ventureById;

  return {
    overview,
    ventures,
    ventureById,
    blueprints,
    providerPool,
    integrations,
    approvals,
    ledger,
    auditEvents,
  };
}

function applySovereignEventInvalidation(
  current: SovereignInvalidationState,
  event: SovereignEvent,
): SovereignInvalidationState {
  switch (event.type) {
    case "snapshot":
      return bumpDomains(current, ALL_SOVEREIGN_DOMAINS, null);
    case "controlStateUpdated":
      return bumpDomains(current, ["overview", "auditEvents"], null);
    case "ventureUpdated":
      return bumpDomains(current, ["overview", "ventures"], event.payload.venture.id);
    case "ventureRemoved":
      return bumpDomains(
        current,
        ["overview", "ventures", "approvals", "ledger", "integrations", "auditEvents"],
        event.payload.ventureId,
      );
    case "approvalUpdated":
      return bumpDomains(
        current,
        event.payload.ventureId === null
          ? ["overview", "approvals", "auditEvents"]
          : ["overview", "ventures", "approvals", "auditEvents"],
        event.payload.ventureId,
      );
    case "taskUpdated":
      return bumpDomains(current, ["overview", "ventures"], event.payload.ventureId);
    case "ledgerEntryRecorded":
      return bumpDomains(
        current,
        event.payload.entry.ventureId === null
          ? ["overview", "ledger", "auditEvents"]
          : ["overview", "ventures", "ledger", "auditEvents"],
        event.payload.entry.ventureId,
      );
    case "providerPoolUpdated":
      return bumpDomains(current, ["overview", "providerPool"], null);
    case "integrationUpdated":
      return bumpDomains(
        current,
        event.payload.ventureId === null
          ? ["overview", "integrations"]
          : ["overview", "ventures", "integrations"],
        event.payload.ventureId,
      );
    case "auditEventAppended":
      return bumpDomains(
        current,
        event.payload.ventureId === null
          ? ["overview", "auditEvents"]
          : ["overview", "ventures", "auditEvents"],
        event.payload.ventureId,
      );
  }
}

export function invalidateSovereignQueries(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  ventureId?: VentureId | null,
  domains?: ReadonlyArray<SovereignQueryDomain>,
): void {
  const atom = sovereignInvalidationAtom(environmentId);
  const resolvedDomains =
    domains ??
    (ventureId !== undefined && ventureId !== null
      ? VENTURE_SCOPED_DEFAULT_DOMAINS
      : ALL_SOVEREIGN_DOMAINS);
  registry.update(atom, (current) => bumpDomains(current, resolvedDomains, ventureId));
}

function createGuardedSovereignQueryAtomFamily<R, ER, TTag extends EnvironmentUnaryRpcTag>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly staleTimeMs?: number;
    readonly idleTtlMs?: number;
    readonly refreshTrigger?: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: EnvironmentRpcInput<TTag>;
    }) => Atom.Atom<unknown> | undefined;
  },
) {
  // Sovereign reads are client-guarded (`sovereign:read`), so delegate through a guarded RPC command.
  const readCommand = createEnvironmentRpcCommand(runtime, {
    label: options.label,
    tag: options.tag,
  });
  return createEnvironmentQueryAtomFamily(runtime, {
    label: options.label,
    ...(options.staleTimeMs === undefined ? {} : { staleTimeMs: options.staleTimeMs }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    ...(options.refreshTrigger === undefined ? {} : { refreshTrigger: options.refreshTrigger }),
    execute: Effect.fnUntraced(function* (input: EnvironmentRpcInput<TTag>) {
      const registry = yield* AtomRegistry.AtomRegistry;
      const {
        target: { environmentId },
      } = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      return yield* readCommand.run(registry, { environmentId, input });
    }),
  });
}

export function createSovereignAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
) {
  const readPermissions = createCommandPermissions(runtime, WS_METHODS.sovereignGetOverview);

  const overviewQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:overview",
    tag: WS_METHODS.sovereignGetOverview,
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).overview),
  });

  const ventureDetailQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:venture-detail",
    tag: WS_METHODS.sovereignGetVentureDetail,
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId, input }) =>
      Atom.make((get) => {
        const state = get(sovereignInvalidationAtom(environmentId));
        return `${state.ventures}:${state.ventureById[input.ventureId] ?? 0}`;
      }),
  });

  const blueprintsQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:blueprints",
    tag: WS_METHODS.sovereignListBlueprints,
    staleTimeMs: 5 * 60_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).blueprints),
  });

  const providerPoolQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:provider-pool",
    tag: WS_METHODS.sovereignGetProviderPool,
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).providerPool),
  });

  const integrationsQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:integrations",
    tag: WS_METHODS.sovereignListIntegrations,
    staleTimeMs: 30_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).integrations),
  });

  const approvalsQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:approvals",
    tag: WS_METHODS.sovereignListApprovals,
    staleTimeMs: 10_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).approvals),
  });

  const ledgerQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:ledger",
    tag: WS_METHODS.sovereignListLedgerEntries,
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).ledger),
  });

  const auditEventsQuery = createGuardedSovereignQueryAtomFamily(runtime, {
    label: "environment-data:sovereign:audit-events",
    tag: WS_METHODS.sovereignListAuditEvents,
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId }) =>
      Atom.make((get) => get(sovereignInvalidationAtom(environmentId)).auditEvents),
  });

  const eventsStreamFamily = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:sovereign:events",
    tag: WS_METHODS.sovereignSubscribe,
    idleTtlMs: 30_000,
  });

  const handledByRegistry = new WeakMap<
    AtomRegistry.AtomRegistry,
    Map<EnvironmentId, { readonly event: SovereignEvent; readonly revision: number }>
  >();

  const sovereignEventsSubscriptionAtomFamily = Atom.family((environmentId: EnvironmentId) => {
    const stream = eventsStreamFamily({ environmentId, input: {} });
    return Atom.readable(
      (get) => {
        const live = get(stream);
        if (AsyncResult.isSuccess(live)) {
          let perEnvironment = handledByRegistry.get(get.registry);
          if (perEnvironment === undefined) {
            perEnvironment = new Map();
            handledByRegistry.set(get.registry, perEnvironment);
          }
          const previous = perEnvironment.get(environmentId);
          if (previous?.event !== live.value) {
            perEnvironment.set(environmentId, {
              event: live.value,
              revision: live.value.revision,
            });
            const shouldInvalidate =
              live.value.type !== "snapshot" ||
              (previous !== undefined && previous.revision !== live.value.revision);
            if (shouldInvalidate) {
              const invalidation = sovereignInvalidationAtom(environmentId);
              get.set(
                invalidation,
                applySovereignEventInvalidation(get.once(invalidation), live.value),
              );
            }
          }
        }
        return live;
      },
      (refresh) => refresh(stream),
    ).pipe(
      Atom.setIdleTTL(30_000),
      Atom.withLabel(`environment-data:sovereign:events-live:${environmentId}`),
    );
  });

  return {
    readPermissionAtom: readPermissions.permissionAtom,
    sovereignOverviewAtomFamily: (environmentId: EnvironmentId, mountScope?: string) =>
      overviewQuery({ environmentId, input: {} }, mountScope),
    sovereignVentureDetailAtomFamily: (
      environmentId: EnvironmentId,
      ventureId: VentureId,
      mountScope?: string,
    ) => ventureDetailQuery({ environmentId, input: { ventureId } }, mountScope),
    sovereignBlueprintsAtomFamily: (environmentId: EnvironmentId, mountScope?: string) =>
      blueprintsQuery({ environmentId, input: {} }, mountScope),
    sovereignProviderPoolAtomFamily: (environmentId: EnvironmentId, mountScope?: string) =>
      providerPoolQuery({ environmentId, input: {} }, mountScope),
    sovereignIntegrationsAtomFamily: (
      environmentId: EnvironmentId,
      input: SovereignListIntegrationsInput = {},
      mountScope?: string,
    ) => integrationsQuery({ environmentId, input }, mountScope),
    sovereignApprovalsAtomFamily: (
      environmentId: EnvironmentId,
      input: SovereignListApprovalsInput = {},
      mountScope?: string,
    ) => approvalsQuery({ environmentId, input }, mountScope),
    sovereignLedgerAtomFamily: (
      environmentId: EnvironmentId,
      input: SovereignListLedgerEntriesInput = {},
      mountScope?: string,
    ) => ledgerQuery({ environmentId, input }, mountScope),
    sovereignAuditEventsAtomFamily: (
      environmentId: EnvironmentId,
      input: SovereignListAuditEventsInput = {},
      mountScope?: string,
    ) => auditEventsQuery({ environmentId, input }, mountScope),
    sovereignEventsSubscriptionAtomFamily,
    invalidateSovereignQueries,
  };
}

export type SovereignAtoms<R = never, ER = never> = ReturnType<typeof createSovereignAtoms<R, ER>>;
