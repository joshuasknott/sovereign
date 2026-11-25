import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderAvailabilityLedger from "../provider/ProviderAvailabilityLedger.ts";
import * as ProviderPoolRouter from "../provider/ProviderPoolRouter.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as UsageLimitRecoveryWorker from "./UsageLimitRecoveryWorker.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

it.effect("idle sweeps skip SQL until the next wake time or a relevant event", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const startMs = Date.parse("2026-07-01T09:00:00.000Z");
    const queries = yield* Queue.unbounded<number>();
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const layer = UsageLimitRecoveryWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getLimitRecoveryCandidates: () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((nowMs) => Queue.offer(queries, nowMs - startMs)),
                Effect.as([]),
              ),
            // One armed thread resets at 60s.
            getLimitRecoveryWakeAt: (now) =>
              Effect.succeed(
                DateTime.toEpochMillis(now) < startMs + 60_000 ? startMs + 60_000 : null,
              ),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromQueue(events),
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              autoResumeLimitedThreads: true,
              snoozeLimitedThreads: false,
            } as never),
            streamChanges: Stream.never,
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      assert.equal(yield* Queue.take(queries), 0);
      // Eleven idle ticks before the recorded wake time, then the wake tick itself.
      yield* TestClock.adjust("60 seconds");
      assert.equal(yield* Queue.take(queries), 60_000);
      yield* Queue.offer(events, {
        type: "turn-item.updated",
        payload: { type: "assistant_message" },
      } as never);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(events, { type: "run.updated", payload: { status: "failed" } } as never);
      yield* TestClock.adjust("5 seconds");
      // A streaming item at 90s does not wake it; the failed run does on the 95s tick.
      assert.equal(yield* Queue.take(queries), 95_000);
    }).pipe(Effect.provide(layer));
  }),
);

const HOUR_MS = 60 * 60 * 1000;
const nowMs = Date.parse("2026-10-19T12:00:00.000Z");

const failedThread = (failedAgoMs: number, resetAgoMs: number) => {
  const failedAt = DateTime.makeUnsafe(nowMs - failedAgoMs);
  const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
    id: ThreadId.make("thread:limited"),
    status: "failed",
    lastErrorClass: "usage_limit",
    usageLimitResetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs - resetAgoMs)),
    latestRunId: RunId.make("run:limited"),
    latestRunCompletedAt: failedAt,
    updatedAt: failedAt,
    archivedAt: null,
    settledOverride: null,
    pendingRuntimeRequest: null,
    limitRecovery: null,
    snoozedUntil: null,
  };
  return candidate;
};

describe("limitRecoveryCommand arming", () => {
  it("does not freshly arm a failure whose reset passed days ago", () => {
    const thread = failedThread(5 * 24 * HOUR_MS, 4 * 24 * HOUR_MS);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
    assert.isNull(limitRecoveryCommand(thread, true, nowMs, true));
  });

  it("still arms a failure whose reset only just passed", () => {
    const thread = failedThread(6 * HOUR_MS, HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("arms a reset that is exactly 24 hours overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("does not arm a reset that is 24 hours and 1ms overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS + 1);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
  });
});

function makeProvider(
  instanceId: string,
  driver: string,
  auth: ServerProvider["auth"],
  modelSlug: string,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth,
    checkedAt: "2026-10-19T12:00:00.000Z",
    models: [
      { slug: modelSlug, name: modelSlug, isCustom: false, isDefault: true, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  };
}

describe("UsageLimitRecoveryWorker pool cooldown and reassignment", () => {
  it.effect(
    "records cooldown in ProviderAvailabilityLedger and reassigns to a healthy same-tier peer",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMs);
        const codex1Id = ProviderInstanceId.make("codex-sub-1");
        const codex2Id = ProviderInstanceId.make("codex-sub-2");
        const resetAtIso = DateTime.formatIso(DateTime.makeUnsafe(nowMs + 30 * 60_000));
        const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
          id: ThreadId.make("thread:reassign"),
          status: "failed",
          lastErrorClass: "usage_limit",
          usageLimitResetAt: resetAtIso,
          latestRunId: RunId.make("run:limited-1"),
          latestRunCompletedAt: DateTime.makeUnsafe(nowMs - 5_000),
          updatedAt: DateTime.makeUnsafe(nowMs - 5_000),
          archivedAt: null,
          settledOverride: null,
          pendingRuntimeRequest: null,
          limitRecovery: null,
          snoozedUntil: null,
        };
        const dispatched = yield* Queue.unbounded<OrchestrationV2Command>();

        const settingsLayer = ServerSettings.layerTest({
          autoResumeLimitedThreads: true,
          snoozeLimitedThreads: true,
          providerInstances: {
            [codex1Id]: {
              driver: ProviderDriverKind.make("codex"),
              config: { setupMode: "managed" },
            },
            [codex2Id]: {
              driver: ProviderDriverKind.make("codex"),
              config: { setupMode: "managed" },
            },
          },
        });
        const registryLayer = Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([
            makeProvider(
              codex1Id,
              "codex",
              { status: "authenticated", type: "chatgpt", label: "ChatGPT Plus Subscription" },
              "gpt-6-astra",
            ),
            makeProvider(
              codex2Id,
              "codex",
              { status: "authenticated", type: "chatgpt", label: "ChatGPT Plus Subscription" },
              "gpt-6-astra",
            ),
          ]),
          streamChanges: Stream.empty,
        });
        const ledgerLayer = ProviderAvailabilityLedger.layer;
        const poolLayer = ProviderPoolRouter.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(registryLayer, settingsLayer, ledgerLayer)),
        );
        const workerLayer = UsageLimitRecoveryWorker.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Scheduler.layer,
              poolLayer,
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getLimitRecoveryCandidates: () => Effect.succeed([candidate]),
                getLimitRecoveryWakeAt: () => Effect.succeed(null),
                findThread: () =>
                  Effect.succeed({
                    id: candidate.id,
                    providerInstanceId: codex1Id,
                    modelSelection: { instanceId: codex1Id, model: "gpt-6-astra" },
                  } as never),
              }),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                dispatch: (command) =>
                  Queue.offer(dispatched, command as OrchestrationV2Command).pipe(
                    Effect.as({} as never),
                  ),
              }),
              Layer.mock(Orchestrator.OrchestratorV2)({
                streamDomainEvents: Stream.never,
              }),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const first = yield* Queue.take(dispatched);
          const second = yield* Queue.take(dispatched);
          assert.strictEqual(first.type, "provider.switch");
          if (first.type === "provider.switch") {
            assert.strictEqual(first.modelSelection.instanceId, codex2Id);
            assert.strictEqual(first.modelSelection.model, "gpt-6-astra");
          }
          assert.strictEqual(second.type, "message.dispatch");

          const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
          const failedState = yield* ledger.getState(codex1Id);
          assert.strictEqual(failedState.cooldownUntil, nowMs + 30 * 60_000);
          assert.strictEqual(failedState.consecutiveRateLimits, 1);
        }).pipe(Effect.provide(workerLayer));
      }),
  );

  it.effect(
    "falls back to arming snooze-until-reset instead of silently escalating to a metered API peer",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMs);
        const codexSubId = ProviderInstanceId.make("codex-sub-only");
        const meteredId = ProviderInstanceId.make("openai-metered-only");
        const resetAtIso = DateTime.formatIso(DateTime.makeUnsafe(nowMs + 30 * 60_000));
        const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
          id: ThreadId.make("thread:no-paid-escalation"),
          status: "failed",
          lastErrorClass: "usage_limit",
          usageLimitResetAt: resetAtIso,
          latestRunId: RunId.make("run:limited-2"),
          latestRunCompletedAt: DateTime.makeUnsafe(nowMs - 5_000),
          updatedAt: DateTime.makeUnsafe(nowMs - 5_000),
          archivedAt: null,
          settledOverride: null,
          pendingRuntimeRequest: null,
          limitRecovery: null,
          snoozedUntil: null,
        };
        const armed = yield* Queue.unbounded<ThreadId>();
        const dispatched: Array<OrchestrationV2Command> = [];

        const settingsLayer = ServerSettings.layerTest({
          autoResumeLimitedThreads: true,
          snoozeLimitedThreads: true,
          providerInstances: {
            [codexSubId]: {
              driver: ProviderDriverKind.make("codex"),
              config: { setupMode: "managed" },
            },
            [meteredId]: {
              driver: ProviderDriverKind.make("codex"),
              environment: [{ name: "OPENAI_API_KEY", value: "sk-metered", sensitive: true }],
            },
          },
        });
        const registryLayer = Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([
            makeProvider(
              codexSubId,
              "codex",
              { status: "authenticated", type: "chatgpt", label: "ChatGPT Plus Subscription" },
              "gpt-6-astra",
            ),
            makeProvider(
              meteredId,
              "codex",
              { status: "authenticated", type: "apiKey", label: "OpenAI API Key" },
              "gpt-6-astra",
            ),
          ]),
          streamChanges: Stream.empty,
        });
        const ledgerLayer = ProviderAvailabilityLedger.layer;
        const poolLayer = ProviderPoolRouter.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(registryLayer, settingsLayer, ledgerLayer)),
        );
        const workerLayer = UsageLimitRecoveryWorker.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Scheduler.layer,
              poolLayer,
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getLimitRecoveryCandidates: () => Effect.succeed([candidate]),
                getLimitRecoveryWakeAt: () => Effect.succeed(null),
                findThread: () =>
                  Effect.succeed({
                    id: candidate.id,
                    providerInstanceId: codexSubId,
                    modelSelection: { instanceId: codexSubId, model: "gpt-6-astra" },
                  } as never),
              }),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                dispatch: (command) =>
                  Effect.sync(() => {
                    dispatched.push(command as OrchestrationV2Command);
                    return {} as never;
                  }),
              }),
              Layer.mock(Orchestrator.OrchestratorV2)({
                streamDomainEvents: Stream.never,
                autoArmLimitRecovery: (input) =>
                  Queue.offer(armed, input.threadId).pipe(Effect.as({} as never)),
              }),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const armedThreadId = yield* Queue.take(armed);
          assert.strictEqual(armedThreadId, candidate.id);
          assert.lengthOf(dispatched, 0);

          const ledger = yield* ProviderAvailabilityLedger.ProviderAvailabilityLedger;
          assert.strictEqual(
            (yield* ledger.getState(codexSubId)).cooldownUntil,
            nowMs + 30 * 60_000,
          );
        }).pipe(Effect.provide(workerLayer));
      }),
  );
});
