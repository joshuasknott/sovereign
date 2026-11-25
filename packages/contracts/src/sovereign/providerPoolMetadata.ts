import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { CurrencyCode, NonNegativeMinorAmount } from "./ids.ts";

export const ProviderBillingClass = Schema.Literals([
  "subscription",
  "metered_api",
  "local",
  "free",
  "manual_only",
  "unknown",
]);
export type ProviderBillingClass = typeof ProviderBillingClass.Type;

export const ProviderModelTier = Schema.Literals(["fast", "balanced", "reasoning", "frontier"]);
export type ProviderModelTier = typeof ProviderModelTier.Type;

export const PaidFallbackMode = Schema.Literals(["deny", "ask_approval", "allow"]);
export type PaidFallbackMode = typeof PaidFallbackMode.Type;
export const DEFAULT_PAID_FALLBACK_MODE: PaidFallbackMode = "deny";

export const ProviderPoolPriority = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 1000 }),
);
export type ProviderPoolPriority = typeof ProviderPoolPriority.Type;

/** Optional per-instance pool metadata stored inside `ProviderInstanceConfig`. */
export const ProviderPoolMetadata = Schema.Struct({
  billingClass: Schema.optionalKey(ProviderBillingClass),
  subscriptionPlanLabel: Schema.optionalKey(TrimmedNonEmptyString),
  monthlySubscriptionCostMinor: Schema.optionalKey(NonNegativeMinorAmount),
  subscriptionCurrency: Schema.optionalKey(CurrencyCode),
  poolEnabled: Schema.optionalKey(Schema.Boolean),
  poolPriority: Schema.optionalKey(ProviderPoolPriority),
  maxConcurrentRuns: Schema.optionalKey(PositiveInt),
  preferredTiers: Schema.optionalKey(Schema.Array(ProviderModelTier)),
  poolTags: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type ProviderPoolMetadata = typeof ProviderPoolMetadata.Type;
