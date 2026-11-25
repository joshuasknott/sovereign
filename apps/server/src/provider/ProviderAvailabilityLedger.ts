import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";

const INITIAL_RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
const RELIABILITY_EWMA_ALPHA = 0.2;
const MAX_FAILURE_MESSAGE_LENGTH = 500;

export interface ProviderInstanceAvailabilityState {
  readonly instanceId: ProviderInstanceId;
  readonly activeRuns: number;
  readonly cooldownUntil: number | null;
  readonly cooldownReason: string | null;
  readonly consecutiveRateLimits: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastFailureMessage: string | null;
  readonly reliabilityScore: number;
}

export function isInstanceCoolingDown(
  state: Pick<ProviderInstanceAvailabilityState, "cooldownUntil"> | undefined,
  nowMs: number,
): boolean {
  return state !== undefined && state.cooldownUntil !== null && state.cooldownUntil > nowMs;
}

function initialAvailabilityState(
  instanceId: ProviderInstanceId,
): ProviderInstanceAvailabilityState {
  return {
    instanceId,
    activeRuns: 0,
    cooldownUntil: null,
    cooldownReason: null,
    consecutiveRateLimits: 0,
    successCount: 0,
    failureCount: 0,
    lastFailureMessage: null,
    reliabilityScore: 1,
  };
}

function boundedExponentialBackoffMs(consecutiveRateLimits: number): number {
  const exponent = Math.max(0, Math.min(consecutiveRateLimits - 1, 10));
  return Math.min(INITIAL_RATE_LIMIT_BACKOFF_MS * 2 ** exponent, MAX_RATE_LIMIT_BACKOFF_MS);
}

function nextReliabilityScore(current: number, succeeded: boolean): number {
  const sample = succeeded ? 1 : 0;
  const updated = current * (1 - RELIABILITY_EWMA_ALPHA) + sample * RELIABILITY_EWMA_ALPHA;
  return Math.max(0, Math.min(1, Math.round(updated * 10_000) / 10_000));
}

function normalizeMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null;
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= MAX_FAILURE_MESSAGE_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export class ProviderAvailabilityLedger extends Context.Service<
  ProviderAvailabilityLedger,
  {
    readonly getState: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<ProviderInstanceAvailabilityState>;
    readonly getSnapshot: Effect.Effect<
      ReadonlyMap<ProviderInstanceId, ProviderInstanceAvailabilityState>
    >;
    readonly acquireRun: (instanceId: ProviderInstanceId) => Effect.Effect<number>;
    readonly releaseRun: (instanceId: ProviderInstanceId) => Effect.Effect<number>;
    readonly acquireRunScoped: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<number, never, Scope.Scope>;
    readonly withRunSlot: <A, E, R>(
      instanceId: ProviderInstanceId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly recordRateLimit: (
      instanceId: ProviderInstanceId,
      resetAtMs?: number | null,
      reason?: string | null,
    ) => Effect.Effect<ProviderInstanceAvailabilityState>;
    readonly clearCooldown: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
    readonly recordSuccess: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<ProviderInstanceAvailabilityState>;
    readonly recordFailure: (
      instanceId: ProviderInstanceId,
      message?: string | null,
    ) => Effect.Effect<ProviderInstanceAvailabilityState>;
  }
>()("t3/provider/ProviderAvailabilityLedger") {}

const make = Effect.gen(function* () {
  const entriesRef = yield* Ref.make<
    ReadonlyMap<ProviderInstanceId, ProviderInstanceAvailabilityState>
  >(new Map());

  const updateEntry = (
    instanceId: ProviderInstanceId,
    transform: (current: ProviderInstanceAvailabilityState) => ProviderInstanceAvailabilityState,
  ) =>
    Ref.modify(entriesRef, (entries) => {
      const current = entries.get(instanceId) ?? initialAvailabilityState(instanceId);
      const updated = transform(current);
      const next = new Map(entries);
      next.set(instanceId, updated);
      return [updated, next] as const;
    });

  const getState = Effect.fn("ProviderAvailabilityLedger.getState")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const entries = yield* Ref.get(entriesRef);
    return entries.get(instanceId) ?? initialAvailabilityState(instanceId);
  });

  const acquireRun = Effect.fn("ProviderAvailabilityLedger.acquireRun")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const updated = yield* updateEntry(instanceId, (current) => ({
      ...current,
      activeRuns: current.activeRuns + 1,
    }));
    return updated.activeRuns;
  });

  const releaseRun = Effect.fn("ProviderAvailabilityLedger.releaseRun")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const updated = yield* updateEntry(instanceId, (current) => ({
      ...current,
      activeRuns: Math.max(0, current.activeRuns - 1),
    }));
    return updated.activeRuns;
  });

  const acquireRunScoped = Effect.fn("ProviderAvailabilityLedger.acquireRunScoped")(function* (
    instanceId: ProviderInstanceId,
  ) {
    return yield* Effect.acquireRelease(acquireRun(instanceId), () =>
      releaseRun(instanceId).pipe(Effect.asVoid),
    );
  });

  const withRunSlot = <A, E, R>(
    instanceId: ProviderInstanceId,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      acquireRun(instanceId),
      () => effect,
      () => releaseRun(instanceId).pipe(Effect.asVoid),
    );

  const recordRateLimit = Effect.fn("ProviderAvailabilityLedger.recordRateLimit")(function* (
    instanceId: ProviderInstanceId,
    resetAtMs?: number | null,
    reason?: string | null,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    return yield* updateEntry(instanceId, (current) => {
      const consecutiveRateLimits = current.consecutiveRateLimits + 1;
      const computedCooldownUntil =
        resetAtMs !== null &&
        resetAtMs !== undefined &&
        Number.isFinite(resetAtMs) &&
        resetAtMs > nowMs
          ? Math.trunc(resetAtMs)
          : nowMs + boundedExponentialBackoffMs(consecutiveRateLimits);
      const cooldownUntil =
        current.cooldownUntil !== null && current.cooldownUntil > computedCooldownUntil
          ? current.cooldownUntil
          : computedCooldownUntil;
      return {
        ...current,
        cooldownUntil,
        cooldownReason: normalizeMessage(reason) ?? "Rate limit or quota reached",
        consecutiveRateLimits,
      };
    });
  });

  const clearCooldown = Effect.fn("ProviderAvailabilityLedger.clearCooldown")(function* (
    instanceId: ProviderInstanceId,
  ) {
    yield* updateEntry(instanceId, (current) => ({
      ...current,
      cooldownUntil: null,
      cooldownReason: null,
      consecutiveRateLimits: 0,
    }));
  });

  const recordSuccess = Effect.fn("ProviderAvailabilityLedger.recordSuccess")(function* (
    instanceId: ProviderInstanceId,
  ) {
    return yield* updateEntry(instanceId, (current) => ({
      ...current,
      cooldownUntil: null,
      cooldownReason: null,
      consecutiveRateLimits: 0,
      successCount: current.successCount + 1,
      reliabilityScore: nextReliabilityScore(current.reliabilityScore, true),
    }));
  });

  const recordFailure = Effect.fn("ProviderAvailabilityLedger.recordFailure")(function* (
    instanceId: ProviderInstanceId,
    message?: string | null,
  ) {
    const normalized = normalizeMessage(message);
    return yield* updateEntry(instanceId, (current) => ({
      ...current,
      failureCount: current.failureCount + 1,
      lastFailureMessage: normalized ?? current.lastFailureMessage,
      reliabilityScore: nextReliabilityScore(current.reliabilityScore, false),
    }));
  });

  return ProviderAvailabilityLedger.of({
    getState,
    getSnapshot: Ref.get(entriesRef),
    acquireRun,
    releaseRun,
    acquireRunScoped,
    withRunSlot,
    recordRateLimit,
    clearCooldown,
    recordSuccess,
    recordFailure,
  });
});

export const layer = Layer.effect(ProviderAvailabilityLedger, make);
