import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  ApprovalRequestId,
  AuthProvidersManageScope,
  AuthSovereignAdminScope,
  AuthSovereignApproveScope,
  AuthSovereignOperateScope,
  AuthSovereignReadScope,
  DEFAULT_GLOBAL_CONTROL_STATE,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  VentureId,
  WS_METHODS,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type FinancialPipelineMetrics,
  type IntegrationSummary,
  type ProviderPoolSnapshot,
  type SovereignEvent,
  type SovereignOverviewSnapshot,
  type SovereignVentureDetail,
  type Venture,
  type VentureOverviewRow,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE, BearerConnectionTarget } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createSovereignAtoms, invalidateSovereignQueries } from "./atoms.ts";
import { createSovereignCommands } from "./commands.ts";
import {
  actionCategoryLabel,
  formatCompositeScore,
  formatMinorCurrency,
  formatQuotaStatus,
  ventureKindLabel,
} from "./format.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));

const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);

const ENV_ID = EnvironmentId.make("sovereign-env");
const VENTURE_A = VentureId.make("ven_alpha");
const VENTURE_B = VentureId.make("ven_beta");
const ISO_NOW = "2026-11-25T00:00:00.000Z";

function sessionWith(scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState {
  return {
    authenticated: true,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    scopes: [...scopes],
    permissions: [...scopes],
  };
}

function sampleFinancialMetrics(): FinancialPipelineMetrics {
  return {
    reportingCurrency: "GBP",
    discoveredOpportunityValueMinor: 50_000,
    proposedQuotationsMinor: 25_000,
    acceptedOrdersMinor: 10_000,
    outstandingInvoicesMinor: 5_000,
    collectedRevenueMinor: 12_500,
    confirmedExpensesMinor: 2_500,
    paymentFeesMinor: 300,
    refundsMinor: 0,
    netProfitMinor: 9_700,
    monthlyRecurringRevenueMinor: 4_000,
    pendingReconciliationRevenueMinor: 0,
    pendingReconciliationExpensesMinor: 0,
    simulatedRevenueMinor: 0,
    simulatedExpensesMinor: 0,
    asOf: ISO_NOW,
  };
}

function sampleVenture(id: VentureId, name: string): Venture {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    kind: "dev_bounties",
    templateKey: "dev_bounties",
    status: "active",
    summary: "Autonomous bounty desk",
    uiModules: ["operations", "bounties", "finances"],
    budgetPolicy: DEFAULT_VENTURE_BUDGET_POLICY,
    permissionPolicy: DEFAULT_VENTURE_PERMISSION_POLICY,
    routingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
    linkedProjectIds: [],
    linkedThreadIds: [],
    linkedScheduledTaskIds: [],
    tags: [],
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
  };
}

function sampleOverview(
  revision: number,
  ventures: ReadonlyArray<VentureOverviewRow> = [],
): SovereignOverviewSnapshot {
  const providerPool: ProviderPoolSnapshot = {
    updatedAt: ISO_NOW,
    defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
    members: [],
    healthyCount: 0,
    activeRunCount: 0,
    paidInstancesCount: 0,
  };
  const integrationsSummary: IntegrationSummary = {
    totalCount: 0,
    connectedCount: 0,
    configuredCount: 0,
    errorCount: 0,
    unconfiguredCount: 0,
    integrations: [],
  };
  return {
    revision,
    generatedAt: ISO_NOW,
    controlState: DEFAULT_GLOBAL_CONTROL_STATE,
    financialSummary: sampleFinancialMetrics(),
    ventures: [...ventures],
    blueprints: [],
    activeObjectives: [],
    pendingApprovals: [],
    activeTasks: [],
    recentAuditEvents: [],
    providerPool,
    integrationsSummary,
    recommendations: [],
  };
}

function sampleVentureDetail(venture: Venture): SovereignVentureDetail {
  return {
    venture,
    objectives: [],
    opportunities: [],
    tasks: [],
    leads: [],
    customers: [],
    proposals: [],
    orders: [],
    invoices: [],
    paymentLinks: [],
    communications: [],
    supportTickets: [],
    voiceAgents: [],
    financialSummary: sampleFinancialMetrics(),
    recentLedgerEntries: [],
    approvals: [],
    preapprovalPolicies: [],
    artifacts: [],
    auditEvents: [],
    integrations: [],
  };
}

const makeHarness = Effect.fn("SovereignTest.makeHarness")(function* (
  client: Record<string, (...args: ReadonlyArray<any>) => unknown>,
) {
  const registry = AtomRegistry.make();
  registry.mount(sessions(ENV_ID));
  const sessionRef = yield* SubscriptionRef.make(Option.some({ client } as unknown as RpcSession));
  const stateRef = yield* SubscriptionRef.make({
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online" as const,
    phase: "connected" as const,
    attempt: 1,
    generation: 1,
  });
  const supervisor = {
    target: new BearerConnectionTarget({
      environmentId: ENV_ID,
      label: "Sovereign Host",
      connectionId: "sovereign-test",
    }),
    session: sessionRef,
    state: stateRef,
  } as unknown as EnvironmentSupervisor["Service"];
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry, {
      run: (id, effect) => {
        expect(id).toBe(ENV_ID);
        return Effect.provideService(effect, EnvironmentSupervisor, supervisor);
      },
      followStream: (id, stream) => {
        expect(id).toBe(ENV_ID);
        return Stream.provideService(stream, EnvironmentSupervisor, supervisor);
      },
    } as EnvironmentRegistry["Service"]),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return {
    registry,
    runtime,
    atoms: createSovereignAtoms(runtime),
    commands: createSovereignCommands(runtime),
  };
});

const readQuery = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) =>
  AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
    Effect.tap(() => Effect.yieldNow),
  );

const awaitEventRevision = (
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<SovereignEvent, unknown>>,
  revision: number,
) =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<SovereignEvent>();
    const unsubscribe = registry.subscribe(
      atom,
      (result) => {
        if (AsyncResult.isSuccess(result) && result.value.revision === revision) {
          Deferred.doneUnsafe(arrived, Exit.succeed(result.value));
        }
      },
      { immediate: true },
    );
    return yield* Deferred.await(arrived).pipe(
      Effect.ensuring(Effect.sync(() => unsubscribe())),
      Effect.tap(() => Effect.yieldNow),
    );
  });

describe("sovereign formatters", () => {
  it("formats minor currency deterministically for GBP, USD, EUR, negatives, zero, and signed mode", () => {
    expect(formatMinorCurrency(1250)).toBe("£12.50");
    expect(formatMinorCurrency(0)).toBe("£0.00");
    expect(formatMinorCurrency(-0)).toBe("£0.00");
    expect(formatMinorCurrency(-500)).toBe("-£5.00");
    expect(formatMinorCurrency(4000, "USD", { signed: true })).toBe("+$40.00");
    expect(formatMinorCurrency(0, "USD", { signed: true })).toBe("$0.00");
    expect(formatMinorCurrency(-125_000, "EUR")).toBe("-€1,250.00");
    expect(formatMinorCurrency(125_050, "GBP", { signed: true })).toBe("+£1,250.50");
    expect(formatMinorCurrency(500, "JPY")).toBe("¥500");
    expect(formatMinorCurrency(Number.NaN, "GBP")).toBe("£0.00");
  });

  it("formats quota status honestly without fabricating percentages when unavailable or null", () => {
    expect(formatQuotaStatus("available", 82)).toEqual({
      label: "82% remaining",
      tone: "healthy",
    });
    expect(formatQuotaStatus("available", 20)).toEqual({
      label: "20% remaining",
      tone: "warning",
    });
    expect(formatQuotaStatus("available", 8)).toEqual({
      label: "8% remaining",
      tone: "critical",
    });
    expect(formatQuotaStatus("exhausted", 0)).toEqual({
      label: "Exhausted",
      tone: "critical",
    });
    expect(formatQuotaStatus("unavailable", null)).toEqual({
      label: "Unavailable",
      tone: "neutral",
    });
    expect(formatQuotaStatus("unavailable", 75)).toEqual({
      label: "Unavailable",
      tone: "neutral",
    });
    expect(formatQuotaStatus("available", null)).toEqual({
      label: "Unavailable",
      tone: "neutral",
    });
  });

  it("formats composite scores and venture/action labels", () => {
    expect(formatCompositeScore(84.6)).toBe("85/100");
    expect(formatCompositeScore(-10)).toBe("0/100");
    expect(formatCompositeScore(130)).toBe("100/100");
    expect(formatCompositeScore(Number.NaN)).toBe("0/100");

    expect(ventureKindLabel("dev_bounties")).toBe("Dev Bounties");
    expect(ventureKindLabel("micro_saas")).toBe("Micro-SaaS");
    expect(ventureKindLabel("custom")).toBe("Custom");

    expect(actionCategoryLabel("paid_provider_fallback")).toBe("Paid provider fallback");
    expect(actionCategoryLabel("security_testing")).toBe("Security testing");
    expect(actionCategoryLabel("refund")).toBe("Refund");
  });
});

describe("sovereign command permissions", () => {
  it.effect("exposes requiredScopes and reactive permissionAtom across Sovereign scope tiers", () =>
    Effect.gen(function* () {
      const { registry, commands } = yield* makeHarness({});

      expect(commands.createVentureCommand.requiredScopes()).toEqual([AuthSovereignOperateScope]);
      expect(commands.decideApprovalCommand.requiredScopes()).toEqual([AuthSovereignApproveScope]);
      expect(commands.triggerEmergencyStopCommand.requiredScopes()).toEqual([
        AuthSovereignAdminScope,
      ]);
      expect(commands.updateProviderPoolConfigCommand.requiredScopes()).toEqual([
        AuthSovereignAdminScope,
      ]);
      expect(commands.upsertProviderInstanceCommand.requiredScopes()).toEqual([
        AuthProvidersManageScope,
      ]);
      expect(commands.removeProviderInstanceCommand.requiredScopes()).toEqual([
        AuthProvidersManageScope,
      ]);

      registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([AuthSovereignReadScope])));
      expect(registry.get(commands.createVentureCommand.permissionAtom(ENV_ID))).toBe(false);
      expect(registry.get(commands.decideApprovalCommand.permissionAtom(ENV_ID))).toBe(false);
      expect(registry.get(commands.triggerEmergencyStopCommand.permissionAtom(ENV_ID))).toBe(false);

      registry.set(
        sessions(ENV_ID),
        AsyncResult.success(sessionWith([AuthSovereignReadScope, AuthSovereignOperateScope])),
      );
      expect(registry.get(commands.createVentureCommand.permissionAtom(ENV_ID))).toBe(true);
      expect(registry.get(commands.decideApprovalCommand.permissionAtom(ENV_ID))).toBe(false);
      expect(registry.get(commands.triggerEmergencyStopCommand.permissionAtom(ENV_ID))).toBe(false);

      registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([AuthSovereignApproveScope])));
      expect(registry.get(commands.decideApprovalCommand.permissionAtom(ENV_ID))).toBe(true);
      expect(registry.get(commands.triggerEmergencyStopCommand.permissionAtom(ENV_ID))).toBe(false);

      registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([AuthProvidersManageScope])));
      expect(registry.get(commands.upsertProviderInstanceCommand.permissionAtom(ENV_ID))).toBe(
        true,
      );
      expect(registry.get(commands.removeProviderInstanceCommand.permissionAtom(ENV_ID))).toBe(
        true,
      );
    }),
  );

  it.effect(
    "elevates upsertIntegrationCommand to providers:manage when payload carries a SecretReference",
    () =>
      Effect.gen(function* () {
        const upsertSpy = vi.fn(() => Effect.die("should not run when denied"));
        const { registry, commands } = yield* makeHarness({
          [WS_METHODS.sovereignUpsertIntegration]: upsertSpy,
        });

        const plainInput = {
          category: "payments" as const,
          providerKind: "stripe" as const,
          displayName: "Stripe Live",
          secretValue: "sk_live_plain",
        };
        const secretRefInput = {
          category: "payments" as const,
          providerKind: "stripe" as const,
          displayName: "Stripe Vault",
          secretValue: {
            type: "secret" as const,
            provider: SecretProviderId.make("onepassword"),
            reference: "op://vault/stripe/api-key",
          },
        };

        expect(commands.upsertIntegrationCommand.requiredScopes(plainInput)).toEqual([
          AuthSovereignAdminScope,
        ]);
        expect(commands.upsertIntegrationCommand.requiredScopes(secretRefInput)).toEqual([
          AuthSovereignAdminScope,
          AuthProvidersManageScope,
        ]);

        registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([AuthSovereignAdminScope])));
        expect(
          registry.get(commands.upsertIntegrationCommand.permissionAtom(ENV_ID, plainInput)),
        ).toBe(true);
        expect(
          registry.get(commands.upsertIntegrationCommand.permissionAtom(ENV_ID, secretRefInput)),
        ).toBe(false);

        const denied = yield* Effect.exit(
          commands.upsertIntegrationCommand.run(registry, {
            environmentId: ENV_ID,
            input: secretRefInput,
          }),
        );
        expect(denied._tag).toBe("Failure");
        if (denied._tag === "Failure") {
          expect(Cause.squash(denied.cause)).toMatchObject({
            _tag: "EnvironmentAuthorizationError",
            requiredPermission: AuthProvidersManageScope,
          });
        }
        expect(upsertSpy).not.toHaveBeenCalled();

        registry.set(
          sessions(ENV_ID),
          AsyncResult.success(sessionWith([AuthSovereignAdminScope, AuthProvidersManageScope])),
        );
        expect(
          registry.get(commands.upsertIntegrationCommand.permissionAtom(ENV_ID, secretRefInput)),
        ).toBe(true);
      }),
  );
});

describe("sovereign reactive atoms, invalidation, and live stream", () => {
  it.effect(
    "enforces sovereign:read on queries and refreshes mounted overview & venture queries on commands and invalidation",
    () =>
      Effect.gen(function* () {
        let overviewRevision = 1;
        let alphaLoads = 0;
        let betaLoads = 0;
        const alphaVenture = sampleVenture(VENTURE_A, "Alpha Desk");
        const betaVenture = sampleVenture(VENTURE_B, "Beta Desk");

        const getOverview = vi.fn(() => Effect.sync(() => sampleOverview(overviewRevision)));
        const getVentureDetail = vi.fn((input: { readonly ventureId: VentureId }) =>
          Effect.sync(() => {
            if (input.ventureId === VENTURE_A) {
              alphaLoads += 1;
              return sampleVentureDetail(alphaVenture);
            }
            betaLoads += 1;
            return sampleVentureDetail(betaVenture);
          }),
        );
        const createVenture = vi.fn(() =>
          Effect.sync(() => {
            overviewRevision += 1;
            return alphaVenture;
          }),
        );

        const { registry, atoms, commands } = yield* makeHarness({
          [WS_METHODS.sovereignGetOverview]: getOverview,
          [WS_METHODS.sovereignGetVentureDetail]: getVentureDetail,
          [WS_METHODS.sovereignCreateVenture]: createVenture,
        });

        registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([])));
        expect(registry.get(atoms.readPermissionAtom(ENV_ID))).toBe(false);

        const overviewAtom = atoms.sovereignOverviewAtomFamily(ENV_ID);
        registry.mount(overviewAtom);
        const denied = yield* readQuery(registry, overviewAtom).pipe(Effect.flip);
        expect(denied).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: AuthSovereignReadScope,
        });
        expect(getOverview).not.toHaveBeenCalled();

        registry.set(
          sessions(ENV_ID),
          AsyncResult.success(sessionWith([AuthSovereignReadScope, AuthSovereignOperateScope])),
        );
        expect(registry.get(atoms.readPermissionAtom(ENV_ID))).toBe(true);
        registry.refresh(overviewAtom);
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(1);

        const alphaAtom = atoms.sovereignVentureDetailAtomFamily(ENV_ID, VENTURE_A);
        const betaAtom = atoms.sovereignVentureDetailAtomFamily(ENV_ID, VENTURE_B);
        registry.mount(alphaAtom);
        registry.mount(betaAtom);
        expect((yield* readQuery(registry, alphaAtom)).venture.id).toBe(VENTURE_A);
        expect((yield* readQuery(registry, betaAtom)).venture.id).toBe(VENTURE_B);
        expect(alphaLoads).toBe(1);
        expect(betaLoads).toBe(1);

        yield* commands.createVentureCommand.run(registry, {
          environmentId: ENV_ID,
          input: { name: "Alpha Desk", kind: "dev_bounties" },
        });
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(2);
        expect((yield* readQuery(registry, alphaAtom)).venture.id).toBe(VENTURE_A);
        expect(alphaLoads).toBe(2);
        expect(betaLoads).toBe(1);

        overviewRevision += 1;
        invalidateSovereignQueries(registry, ENV_ID, VENTURE_B);
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(3);
        expect((yield* readQuery(registry, betaAtom)).venture.id).toBe(VENTURE_B);
        expect(alphaLoads).toBe(2);
        expect(betaLoads).toBe(2);
      }),
  );

  it.effect(
    "refreshes affected queries automatically when sovereign.subscribe emits live events",
    () =>
      Effect.gen(function* () {
        const eventsQueue = yield* Queue.unbounded<SovereignEvent>();
        let overviewCalls = 0;
        let approvalsCalls = 0;
        let poolCalls = 0;

        const { registry, atoms } = yield* makeHarness({
          [WS_METHODS.sovereignSubscribe]: () => Stream.fromQueue(eventsQueue),
          [WS_METHODS.sovereignGetOverview]: () =>
            Effect.sync(() => {
              overviewCalls += 1;
              return sampleOverview(overviewCalls);
            }),
          [WS_METHODS.sovereignListApprovals]: () =>
            Effect.sync(() => {
              approvalsCalls += 1;
              return { approvals: [], preapprovalPolicies: [] };
            }),
          [WS_METHODS.sovereignGetProviderPool]: () =>
            Effect.sync(() => {
              poolCalls += 1;
              return {
                updatedAt: ISO_NOW,
                defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
                members: [],
                healthyCount: poolCalls,
                activeRunCount: 0,
                paidInstancesCount: 0,
              };
            }),
        });

        registry.set(sessions(ENV_ID), AsyncResult.success(sessionWith([AuthSovereignReadScope])));

        const overviewAtom = atoms.sovereignOverviewAtomFamily(ENV_ID);
        const approvalsAtom = atoms.sovereignApprovalsAtomFamily(ENV_ID);
        const poolAtom = atoms.sovereignProviderPoolAtomFamily(ENV_ID);
        const eventsAtom = atoms.sovereignEventsSubscriptionAtomFamily(ENV_ID);

        registry.mount(overviewAtom);
        registry.mount(approvalsAtom);
        registry.mount(poolAtom);
        registry.mount(eventsAtom);

        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(1);
        expect((yield* readQuery(registry, approvalsAtom)).approvals).toEqual([]);
        expect((yield* readQuery(registry, poolAtom)).healthyCount).toBe(1);

        // Initial snapshot records baseline revision without triggering redundant query refetches.
        yield* Queue.offer(eventsQueue, {
          version: 1,
          revision: 1,
          type: "snapshot",
          payload: sampleOverview(1),
        });
        yield* awaitEventRevision(registry, eventsAtom, 1);
        expect(overviewCalls).toBe(1);
        expect(approvalsCalls).toBe(1);
        expect(poolCalls).toBe(1);

        // Live approval event refreshes overview and approvals without touching provider pool.
        yield* Queue.offer(eventsQueue, {
          version: 1,
          revision: 2,
          type: "approvalUpdated",
          payload: {
            id: ApprovalRequestId.make("apr_1"),
            ventureId: null,
            category: "financial_expenditure",
            status: "pending",
            riskLevel: "medium",
            title: "Domain purchase",
            summary: "Register venture domain",
            requestedAction: "purchase_domain",
            requestedBy: "agent",
            requestedAt: ISO_NOW,
          },
        });
        yield* awaitEventRevision(registry, eventsAtom, 2);
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(2);
        yield* readQuery(registry, approvalsAtom);
        expect(approvalsCalls).toBe(2);
        expect(poolCalls).toBe(1);

        // Live providerPoolUpdated refreshes overview and providerPool without touching approvals.
        yield* Queue.offer(eventsQueue, {
          version: 1,
          revision: 3,
          type: "providerPoolUpdated",
          payload: {
            updatedAt: ISO_NOW,
            defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
            members: [],
            healthyCount: 2,
            activeRunCount: 0,
            paidInstancesCount: 0,
          },
        });
        yield* awaitEventRevision(registry, eventsAtom, 3);
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(3);
        expect((yield* readQuery(registry, poolAtom)).healthyCount).toBe(2);
        expect(approvalsCalls).toBe(2);

        // Reconnect snapshot with a higher revision resyncs all mounted domains.
        yield* Queue.offer(eventsQueue, {
          version: 1,
          revision: 4,
          type: "snapshot",
          payload: sampleOverview(4),
        });
        yield* awaitEventRevision(registry, eventsAtom, 4);
        expect((yield* readQuery(registry, overviewAtom)).revision).toBe(4);
        yield* readQuery(registry, approvalsAtom);
        expect((yield* readQuery(registry, poolAtom)).healthyCount).toBe(3);
        expect(approvalsCalls).toBe(3);
      }),
  );

  it("constructs all remaining Sovereign query families and provider-instance commands cleanly", () => {
    const runtime = Atom.runtime(
      Layer.succeed(EnvironmentRegistry, {} as EnvironmentRegistry["Service"]),
    );
    const atoms = createSovereignAtoms(runtime);
    const commands = createSovereignCommands(runtime);

    expect(atoms.sovereignBlueprintsAtomFamily(ENV_ID)).toBeDefined();
    expect(atoms.sovereignIntegrationsAtomFamily(ENV_ID)).toBeDefined();
    expect(atoms.sovereignLedgerAtomFamily(ENV_ID)).toBeDefined();
    expect(atoms.sovereignAuditEventsAtomFamily(ENV_ID)).toBeDefined();
    expect(
      commands.upsertProviderInstanceCommand.requiredScopes({
        instanceId: ProviderInstanceId.make("codex-primary"),
        instance: { driver: ProviderDriverKind.make("codex") },
      }),
    ).toEqual([AuthProvidersManageScope]);
  });
});
