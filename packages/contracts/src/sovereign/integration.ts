import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { SecretReference } from "../secretReference.ts";
import { SettingsSecretValue } from "../settingsSecretValue.ts";
import { IntegrationId, VentureId } from "./ids.ts";

export const IntegrationCategory = Schema.Literals([
  "payments",
  "email",
  "telephony_voice",
  "source_control",
  "hosting_deployment",
  "commerce",
  "webhook",
  "custom",
]);
export type IntegrationCategory = typeof IntegrationCategory.Type;

export const IntegrationProviderKind = Schema.Literals([
  "stripe",
  "paddle",
  "lemonsqueezy",
  "resend",
  "smtp",
  "twilio",
  "vapi",
  "retell",
  "elevenlabs",
  "github",
  "vercel",
  "cloudflare",
  "gumroad",
  "webhook",
  "custom",
]);
export type IntegrationProviderKind = typeof IntegrationProviderKind.Type;

export const IntegrationStatus = Schema.Literals([
  "unconfigured",
  "configured",
  "connected",
  "error",
  "disabled",
]);
export type IntegrationStatus = typeof IntegrationStatus.Type;

export const IntegrationSettingScalar = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type IntegrationSettingScalar = typeof IntegrationSettingScalar.Type;

export const IntegrationSettingsMap = Schema.Record(
  TrimmedNonEmptyString,
  IntegrationSettingScalar,
);
export type IntegrationSettingsMap = typeof IntegrationSettingsMap.Type;

/** Never carries plaintext secrets; credentials stay in server secret storage or a vault reference. */
export const IntegrationConfig = Schema.Struct({
  id: IntegrationId,
  ventureId: Schema.NullOr(VentureId),
  category: IntegrationCategory,
  providerKind: IntegrationProviderKind,
  displayName: TrimmedNonEmptyString,
  status: IntegrationStatus,
  enabled: Schema.Boolean,
  sandboxMode: Schema.Boolean,
  endpointUrl: Schema.NullOr(TrimmedNonEmptyString),
  accountLabel: Schema.NullOr(TrimmedNonEmptyString),
  hasSecret: Schema.Boolean,
  secretReference: Schema.optionalKey(Schema.NullOr(SecretReference)),
  settings: IntegrationSettingsMap,
  lastTestedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IntegrationConfig = typeof IntegrationConfig.Type;

export const IntegrationTestResult = Schema.Struct({
  integrationId: IntegrationId,
  ok: Schema.Boolean,
  status: IntegrationStatus,
  latencyMs: Schema.NullOr(NonNegativeInt),
  message: TrimmedNonEmptyString,
  checkedAt: IsoDateTime,
});
export type IntegrationTestResult = typeof IntegrationTestResult.Type;

export const UpsertIntegrationInput = Schema.Struct({
  id: Schema.optionalKey(IntegrationId),
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  category: IntegrationCategory,
  providerKind: IntegrationProviderKind,
  displayName: TrimmedNonEmptyString,
  enabled: Schema.optionalKey(Schema.Boolean),
  sandboxMode: Schema.optionalKey(Schema.Boolean),
  endpointUrl: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  accountLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  secretValue: Schema.optionalKey(Schema.NullOr(SettingsSecretValue)),
  settings: Schema.optionalKey(IntegrationSettingsMap),
});
export type UpsertIntegrationInput = typeof UpsertIntegrationInput.Type;

export const IntegrationSummary = Schema.Struct({
  totalCount: NonNegativeInt,
  connectedCount: NonNegativeInt,
  configuredCount: NonNegativeInt,
  errorCount: NonNegativeInt,
  unconfiguredCount: NonNegativeInt,
  integrations: Schema.Array(IntegrationConfig),
});
export type IntegrationSummary = typeof IntegrationSummary.Type;
