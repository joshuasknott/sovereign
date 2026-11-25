import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_PROVIDER_ROUTING_POLICY,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ProviderInstanceConfig,
  type ProviderRoutingPolicy,
  type ServerProvider,
  type ServerProviderModel,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "../usage/UsageLimitSources.ts";
import { resolveModelManifestUrl } from "./ModelManifest.ts";
import * as ProviderAvailabilityLedger from "./ProviderAvailabilityLedger.ts";
import { isInstanceCoolingDown } from "./ProviderAvailabilityLedger.ts";
import * as ProviderPoolRouter from "./ProviderPoolRouter.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const START_TIME_MS = Date.parse("2026-10-20T10:00:00.000Z");
const START_ISO = "2026-10-20T10:00:00.000Z";
const RESET_LATER_ISO = "2026-10-20T12:00:00.000Z";

function makeModel(slug: string, name = slug, isDefault = false): ServerProviderModel {
  return {
    slug,
    name,
    isCustom: false,
    ...(isDefault ? { isDefault: true } : {}),
    capabilities: null,
  };
}

function makeProviderSnapshot(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName?: string;
  readonly enabled?: boolean;
  readonly status?: ServerProvider["status"];
  readonly auth?: ServerProvider["auth"];
  readonly models?: ReadonlyArray<ServerProviderModel>;
  readonly usageLimits?: ServerProvider["usageLimits"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: input.status ?? "ready",
    auth: input.auth ?? { status: "authenticated" },
    checkedAt: START_ISO,
    models: input.models ?? [],
    slashCommands: [],
    skills: [],
    ...(input.usageLimits === undefined ? {} : { usageLimits: input.usageLimits }),
  };
}

function makePoolHarness(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly providerInstances: Readonly<Record<string, ProviderInstanceConfig>>;
  readonly usageLimitSources?: ReadonlyArray<UsageLimitSourceSnapshot>;
}) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(START_TIME_MS);
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(input.providers);
    const registryLayer = Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Ref.get(providersRef),
      streamChanges: Stream.empty,
    });
    const settingsLayer = ServerSettings.layerTest({
      providerInstances: input.providerInstances as Record<
        ProviderInstanceId,
        ProviderInstanceConfig
      >,
    });
    const ledgerLayer = ProviderAvailabilityLedger.layer;
    const baseLayer = Layer.mergeAll(
      registryLayer,
      settingsLayer,
      ledgerLayer,
      ...(input.usageLimitSources === undefined
        ? []
        : [
            Layer.mock(UsageLimitSources.UsageLimitSources)({
              current: Effect.succeed(input.usageLimitSources),
              streamChanges: Stream.empty,
            }),
          ]),
    );
    const fullLayer = ProviderPoolRouter.layer.pipe(Layer.provideMerge(baseLayer));
    return { providersRef, layer: fullLayer } as const;
  });
}

describe("ProviderAvailabilityLedger", () => {
  it.effect(
    "tracks active runs with acquireRelease, bounded exponential backoff, and moving reliability",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(START_TIME_MS);
        const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
        const instanceId = ProviderInstanceId.make("codex-sub-1");

        const slotResult = yield* ledger.withRunSlot(
          instanceId,
          Effect.gen(function* () {
            const during = yield* ledger.getState(instanceId);
            assert.strictEqual(during.activeRuns, 1);
            return "ok";
          }),
        );
        assert.strictEqual(slotResult, "ok");
        assert.strictEqual((yield* ledger.getState(instanceId)).activeRuns, 0);

        const failedRun = yield* ledger
          .withRunSlot(instanceId, Effect.fail("boom"))
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(failedRun));
        assert.strictEqual((yield* ledger.getState(instanceId)).activeRuns, 0);

        const firstLimit = yield* ledger.recordRateLimit(instanceId);
        assert.strictEqual(firstLimit.consecutiveRateLimits, 1);
        assert.strictEqual(firstLimit.cooldownUntil, START_TIME_MS + 30_000);
        assert.isTrue(isInstanceCoolingDown(firstLimit, START_TIME_MS));

        yield* TestClock.adjust("30 seconds");
        assert.isFalse(isInstanceCoolingDown(firstLimit, START_TIME_MS + 30_000));

        const secondLimit = yield* ledger.recordRateLimit(instanceId);
        assert.strictEqual(secondLimit.consecutiveRateLimits, 2);
        assert.strictEqual(secondLimit.cooldownUntil, START_TIME_MS + 30_000 + 60_000);

        const explicitReset = START_TIME_MS + 10 * 60_000;
        const thirdLimit = yield* ledger.recordRateLimit(instanceId, explicitReset, "Quota hit");
        assert.strictEqual(thirdLimit.cooldownUntil, explicitReset);
        assert.strictEqual(thirdLimit.cooldownReason, "Quota hit");

        const afterFailure = yield* ledger.recordFailure(instanceId, "Transient error");
        assert.strictEqual(afterFailure.failureCount, 1);
        assert.isBelow(afterFailure.reliabilityScore, 1);

        const afterSuccess = yield* ledger.recordSuccess(instanceId);
        assert.strictEqual(afterSuccess.successCount, 1);
        assert.strictEqual(afterSuccess.consecutiveRateLimits, 0);
        assert.isNull(afterSuccess.cooldownUntil);
        assert.isAbove(afterSuccess.reliabilityScore, afterFailure.reliabilityScore);
      }).pipe(Effect.provide(ProviderAvailabilityLedger.layer)),
  );
});

describe("ProviderPoolRouter", () => {
  const multiProviderFixtures = () => {
    const codex1Id = ProviderInstanceId.make("codex-sub-1");
    const codex2Id = ProviderInstanceId.make("codex-sub-2");
    const googleProId = ProviderInstanceId.make("google-ai-pro");
    const localOllamaId = ProviderInstanceId.make("local-ollama");
    const meteredApiId = ProviderInstanceId.make("openai-metered");
    const unknownPiId = ProviderInstanceId.make("pi-aggregator");

    const providers: ReadonlyArray<ServerProvider> = [
      makeProviderSnapshot({
        instanceId: codex1Id,
        driver: "codex",
        displayName: "Codex Account 1",
        auth: { status: "authenticated", type: "chatgpt", label: "ChatGPT Pro 200 Subscription" },
        models: [
          makeModel("gpt-6-astra", "GPT-6 Astra", true),
          makeModel("gpt-5-mini", "GPT-5 Mini"),
        ],
        usageLimits: {
          checkedAt: START_ISO,
          windows: [
            {
              id: "session",
              kind: "session",
              label: "5-hour window",
              usedPercent: 15,
              resetsAt: RESET_LATER_ISO,
            },
          ],
        },
      }),
      makeProviderSnapshot({
        instanceId: codex2Id,
        driver: "codex",
        displayName: "Codex Account 2",
        auth: { status: "authenticated", type: "chatgpt", label: "ChatGPT Plus Subscription" },
        models: [makeModel("gpt-6-astra", "GPT-6 Astra", true)],
        usageLimits: {
          checkedAt: START_ISO,
          windows: [
            {
              id: "session",
              kind: "session",
              label: "5-hour window",
              usedPercent: 75,
              resetsAt: RESET_LATER_ISO,
            },
          ],
        },
      }),
      makeProviderSnapshot({
        instanceId: googleProId,
        driver: "antigravity",
        displayName: "Google AI Pro",
        auth: { status: "authenticated", type: "oauth-personal", label: "Google account" },
        models: [
          makeModel("gemini-2.5-pro", "Gemini 2.5 Pro", true),
          makeModel("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ],
        usageLimits: {
          checkedAt: START_ISO,
          windows: [
            {
              id: "session",
              kind: "session",
              label: "Session",
              usedPercent: 20,
              resetsAt: RESET_LATER_ISO,
            },
          ],
        },
      }),
      makeProviderSnapshot({
        instanceId: localOllamaId,
        driver: "opencode",
        displayName: "Local Ollama",
        models: [makeModel("qwen2.5-coder-7b", "Qwen 2.5 Coder 7B", true)],
      }),
      makeProviderSnapshot({
        instanceId: meteredApiId,
        driver: "codex",
        displayName: "OpenAI Metered API",
        auth: { status: "authenticated", type: "apiKey", label: "OpenAI API Key" },
        models: [makeModel("gpt-6-astra", "GPT-6 Astra", true)],
      }),
      makeProviderSnapshot({
        instanceId: unknownPiId,
        driver: "pi",
        displayName: "Pi Aggregator",
        models: [makeModel("default", "Default", true)],
      }),
    ];

    const providerInstances: Record<string, ProviderInstanceConfig> = {
      [codex1Id]: {
        driver: ProviderDriverKind.make("codex"),
        config: { setupMode: "managed" },
        pool: { maxConcurrentRuns: 2, poolTags: ["coding", "primary"] },
      },
      [codex2Id]: {
        driver: ProviderDriverKind.make("codex"),
        config: { setupMode: "managed" },
        pool: { maxConcurrentRuns: 2, poolTags: ["coding"] },
      },
      [googleProId]: {
        driver: ProviderDriverKind.make("antigravity"),
        config: { authMethod: "oauth-personal" },
        pool: { maxConcurrentRuns: 2, poolTags: ["coding", "research"] },
      },
      [localOllamaId]: {
        driver: ProviderDriverKind.make("opencode"),
        environment: [{ name: "OLLAMA_HOST", value: "http://127.0.0.1:11434", sensitive: false }],
        pool: { maxConcurrentRuns: 1, preferredTiers: ["fast"], poolTags: ["local"] },
      },
      [meteredApiId]: {
        driver: ProviderDriverKind.make("codex"),
        environment: [{ name: "OPENAI_API_KEY", value: "sk-metered", sensitive: true }],
        pool: { maxConcurrentRuns: 4 },
      },
      [unknownPiId]: {
        driver: ProviderDriverKind.make("pi"),
      },
    };

    return {
      ids: { codex1Id, codex2Id, googleProId, localOllamaId, meteredApiId, unknownPiId },
      providers,
      providerInstances,
    };
  };

  it.effect(
    "reports honest quota availability without fabricating percentages or reset times",
    () =>
      Effect.gen(function* () {
        const fixture = multiProviderFixtures();
        const externalQuotaSource: UsageLimitSourceSnapshot = {
          id: UsageLimitSourceId.make("local-http-quota"),
          kind: "http",
          label: "Custom Quota",
          checkedAt: START_ISO,
          accounts: [],
          quotaAccounts: [
            {
              id: "acct-1",
              label: "External",
              providerInstanceId: fixture.ids.unknownPiId,
              windows: [
                {
                  id: "daily",
                  kind: "session",
                  label: "Daily",
                  usedPercent: 40,
                  resetsAt: RESET_LATER_ISO,
                },
              ],
            },
          ],
        };
        const harness = yield* makePoolHarness({
          providers: fixture.providers,
          providerInstances: fixture.providerInstances,
          usageLimitSources: [externalQuotaSource],
        });

        yield* Effect.gen(function* () {
          const router = yield* ProviderPoolRouter.ProviderPoolRouter;
          const snapshot = yield* router.getSnapshot();

          const codex1 = snapshot.members.find((m) => m.instanceId === fixture.ids.codex1Id);
          assert.strictEqual(codex1?.quotaAvailability, "available");
          assert.strictEqual(codex1?.quotaRemainingPct, 85);
          assert.strictEqual(codex1?.quotaResetAt, RESET_LATER_ISO);
          assert.strictEqual(codex1?.billingClass, "subscription");

          const local = snapshot.members.find((m) => m.instanceId === fixture.ids.localOllamaId);
          assert.strictEqual(local?.quotaAvailability, "unavailable");
          assert.isNull(local?.quotaRemainingPct);
          assert.isNull(local?.quotaResetAt);
          assert.strictEqual(local?.billingClass, "local");

          const metered = snapshot.members.find((m) => m.instanceId === fixture.ids.meteredApiId);
          assert.strictEqual(metered?.quotaAvailability, "unavailable");
          assert.isNull(metered?.quotaRemainingPct);
          assert.isNull(metered?.quotaResetAt);
          assert.strictEqual(metered?.billingClass, "metered_api");

          const pi = snapshot.members.find((m) => m.instanceId === fixture.ids.unknownPiId);
          assert.strictEqual(pi?.billingClass, "unknown");
          assert.strictEqual(pi?.quotaAvailability, "available");
          assert.strictEqual(pi?.quotaRemainingPct, 60);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect(
    "routes multiple instances by requested tier, quota headroom, concurrency cap, and tags",
    () =>
      Effect.gen(function* () {
        const fixture = multiProviderFixtures();
        const harness = yield* makePoolHarness({
          providers: fixture.providers,
          providerInstances: fixture.providerInstances,
        });

        yield* Effect.gen(function* () {
          const router = yield* ProviderPoolRouter.ProviderPoolRouter;
          const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;

          const fastDecision = yield* router.route({ requestedTier: "fast" });
          assert.strictEqual(fastDecision.status, "routed");
          assert.strictEqual(fastDecision.selectedInstanceId, fixture.ids.localOllamaId);
          assert.strictEqual(fastDecision.billingClass, "local");

          const frontierDecision = yield* router.route({ requestedTier: "frontier" });
          assert.strictEqual(frontierDecision.status, "routed");
          assert.strictEqual(frontierDecision.selectedInstanceId, fixture.ids.codex1Id);
          assert.strictEqual(frontierDecision.selectedModel, "gpt-6-astra");
          assert.strictEqual(frontierDecision.billingClass, "subscription");

          // Saturate codex-sub-1 up to its maxConcurrentRuns (2) so traffic moves to the peer.
          yield* ledger.acquireRun(fixture.ids.codex1Id);
          yield* ledger.acquireRun(fixture.ids.codex1Id);
          const overflowDecision = yield* router.route({ requestedTier: "frontier" });
          assert.strictEqual(overflowDecision.selectedInstanceId, fixture.ids.googleProId);

          const researchDecision = yield* router.route({
            requestedTier: "frontier",
            requiredTags: ["research"],
          });
          assert.strictEqual(researchDecision.selectedInstanceId, fixture.ids.googleProId);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect(
    "strictly enforces never-silent-paid-fallback for deny, ask_approval, and allow modes",
    () =>
      Effect.gen(function* () {
        const fixture = multiProviderFixtures();
        const harness = yield* makePoolHarness({
          providers: fixture.providers,
          providerInstances: fixture.providerInstances,
        });

        yield* Effect.gen(function* () {
          const router = yield* ProviderPoolRouter.ProviderPoolRouter;
          const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
          const settings = yield* ServerSettings.ServerSettingsService;

          // Rate-limit every subscription instance and disable the local instance.
          yield* ledger.recordRateLimit(fixture.ids.codex1Id, START_TIME_MS + 60_000);
          yield* ledger.recordRateLimit(fixture.ids.codex2Id, START_TIME_MS + 60_000);
          yield* ledger.recordRateLimit(fixture.ids.googleProId, START_TIME_MS + 60_000);
          yield* settings.updateProviderInstance({
            operation: "upsert",
            instanceId: fixture.ids.localOllamaId,
            instance: {
              ...fixture.providerInstances[fixture.ids.localOllamaId]!,
              enabled: false,
            },
          });

          // 1. Default policy (paidFallbackMode: "deny") MUST fail with paid_fallback_denied.
          const denied = yield* router.route({ requestedTier: "frontier" }).pipe(Effect.flip);
          assert.strictEqual(denied._tag, "ProviderPoolRoutingError");
          assert.strictEqual(denied.code, "paid_fallback_denied");
          assert.strictEqual(denied.candidateBillingClass, "metered_api");

          // 2. paidFallbackMode: "ask_approval" MUST signal approval_required, never silently dispatch.
          const askPolicy: ProviderRoutingPolicy = {
            ...DEFAULT_PROVIDER_ROUTING_POLICY,
            paidFallbackMode: "ask_approval",
          };
          const approvalDecision = yield* router.route({
            routingPolicy: askPolicy,
            requestedTier: "frontier",
          });
          assert.strictEqual(approvalDecision.status, "approval_required");
          assert.strictEqual(approvalDecision.requiresApproval, true);
          assert.strictEqual(approvalDecision.approvalCategory, "paid_provider_fallback");
          assert.strictEqual(approvalDecision.selectedInstanceId, fixture.ids.meteredApiId);

          // 3. paidFallbackMode: "allow" WITHOUT "metered_api" in allowedBillingClasses STILL denies.
          const allowWithoutClass: ProviderRoutingPolicy = {
            ...DEFAULT_PROVIDER_ROUTING_POLICY,
            paidFallbackMode: "allow",
          };
          const deniedMissingClass = yield* router
            .route({ routingPolicy: allowWithoutClass, requestedTier: "frontier" })
            .pipe(Effect.flip);
          assert.strictEqual(deniedMissingClass.code, "paid_fallback_denied");

          // 4. paidFallbackMode: "allow" WITH "metered_api" respects maxEstimatedCostMinor cap.
          const allowZeroCap: ProviderRoutingPolicy = {
            ...DEFAULT_PROVIDER_ROUTING_POLICY,
            allowedBillingClasses: ["subscription", "local", "free", "metered_api"],
            paidFallbackMode: "allow",
            maxEstimatedCostMinor: 0,
          };
          const overBudget = yield* router
            .route({
              routingPolicy: allowZeroCap,
              requestedTier: "frontier",
              estimatedTokens: 100_000,
            })
            .pipe(Effect.flip);
          assert.strictEqual(overBudget.code, "cost_limit_exceeded");

          // 5. Explicit allow + allowedBillingClasses + budget permits metered routing.
          const allowWithinCap: ProviderRoutingPolicy = {
            ...allowZeroCap,
            maxEstimatedCostMinor: 500,
          };
          const permitted = yield* router.route({
            routingPolicy: allowWithinCap,
            requestedTier: "frontier",
            estimatedTokens: 100_000,
          });
          assert.strictEqual(permitted.status, "routed");
          assert.strictEqual(permitted.selectedInstanceId, fixture.ids.meteredApiId);
          assert.strictEqual(permitted.billingClass, "metered_api");
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect(
    "reacts immediately to dynamic add, disable, remove, cooldown backoff, and same-tier reassignment",
    () =>
      Effect.gen(function* () {
        const fixture = multiProviderFixtures();
        const harness = yield* makePoolHarness({
          providers: [fixture.providers[0]!, fixture.providers[1]!, fixture.providers[4]!],
          providerInstances: {
            [fixture.ids.codex1Id]: fixture.providerInstances[fixture.ids.codex1Id]!,
            [fixture.ids.codex2Id]: fixture.providerInstances[fixture.ids.codex2Id]!,
            [fixture.ids.meteredApiId]: fixture.providerInstances[fixture.ids.meteredApiId]!,
          },
        });

        yield* Effect.gen(function* () {
          const router = yield* ProviderPoolRouter.ProviderPoolRouter;
          const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
          const settings = yield* ServerSettings.ServerSettingsService;

          // Rate-limit codex-sub-1 and verify automatic same-tier reassignment to codex-sub-2.
          yield* ledger.recordRateLimit(fixture.ids.codex1Id, START_TIME_MS + 60_000);
          const peer = yield* router.selectReassignmentTarget(fixture.ids.codex1Id);
          assert.isNotNull(peer);
          assert.strictEqual(peer?.instanceId, fixture.ids.codex2Id);
          assert.strictEqual(peer?.billingClass, "subscription");

          // Rate-limit codex-sub-2 as well: only metered API remains, so reassignment returns null!
          yield* ledger.recordRateLimit(fixture.ids.codex2Id, START_TIME_MS + 60_000);
          const noPaidEscalation = yield* router.selectReassignmentTarget(fixture.ids.codex1Id);
          assert.isNull(noPaidEscalation);

          // Dynamically add a new Claude subscription instance and verify it becomes routable immediately.
          const claudeNewId = ProviderInstanceId.make("claude-sub-new");
          yield* settings.updateProviderInstance({
            operation: "upsert",
            instanceId: claudeNewId,
            instance: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              pool: { billingClass: "subscription", maxConcurrentRuns: 2 },
            },
          });
          yield* Ref.update(harness.providersRef, (current) => [
            ...current,
            makeProviderSnapshot({
              instanceId: claudeNewId,
              driver: "claudeAgent",
              models: [makeModel("claude-opus-5-5", "Claude Opus 5.5", true)],
            }),
          ]);

          const routedToNew = yield* router.route({ requestedTier: "frontier" });
          assert.strictEqual(routedToNew.selectedInstanceId, claudeNewId);

          // Dynamically remove the new instance and advance TestClock past codex-sub-1 cooldown.
          yield* settings.updateProviderInstance({
            operation: "remove",
            instanceId: claudeNewId,
          });
          yield* Ref.update(harness.providersRef, (current) =>
            current.filter((provider) => provider.instanceId !== claudeNewId),
          );
          yield* TestClock.adjust("61 seconds");

          const recovered = yield* router.route({ requestedTier: "frontier" });
          assert.strictEqual(recovered.selectedInstanceId, fixture.ids.codex1Id);

          // Verify snapshot reflects recovery timestamp from TestClock.
          const snap = yield* router.getSnapshot();
          assert.strictEqual(
            DateTime.toEpochMillis(DateTime.makeUnsafe(snap.updatedAt)),
            START_TIME_MS + 61_000,
          );
        }).pipe(Effect.provide(harness.layer));
      }),
  );
});

describe("resolveModelManifestUrl", () => {
  it("prefers SOVEREIGN_MODEL_MANIFEST_URL, then T3CODE_MODEL_MANIFEST_URL, then default", () => {
    assert.strictEqual(
      resolveModelManifestUrl({
        SOVEREIGN_MODEL_MANIFEST_URL: "https://sovereign.example/manifest.json",
        T3CODE_MODEL_MANIFEST_URL: "https://t3.example/manifest.json",
      }),
      "https://sovereign.example/manifest.json",
    );
    assert.strictEqual(
      resolveModelManifestUrl({
        T3CODE_MODEL_MANIFEST_URL: "https://t3.example/manifest.json",
      }),
      "https://t3.example/manifest.json",
    );
    assert.isTrue(resolveModelManifestUrl({}).startsWith("https://"));
  });
});
