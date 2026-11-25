import type {
  ProviderBillingClass,
  ProviderInstanceConfig,
  ProviderPoolPriority,
  ServerProvider,
} from "@t3tools/contracts";

const DEFAULT_PRIORITY_BY_BILLING_CLASS: Record<ProviderBillingClass, ProviderPoolPriority> = {
  free: 900,
  local: 800,
  subscription: 600,
  metered_api: 200,
  unknown: 100,
  manual_only: 0,
};

const BILLING_TIER_COST_RANK: Record<ProviderBillingClass, number> = {
  free: 0,
  local: 1,
  subscription: 2,
  metered_api: 3,
  unknown: 4,
  manual_only: 5,
};

const LOCAL_ENDPOINT_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
]);

const LOCAL_ENDPOINT_ENV_NAMES = [
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
  "LM_STUDIO_BASE_URL",
  "LM_STUDIO_URL",
  "VLLM_BASE_URL",
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
] as const;

const GENERIC_METERED_API_KEY_ENV_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CURSOR_API_KEY",
] as const;

const FALSY_ENV_FLAGS = new Set(["0", "false", "no", "off", ""]);

function asConfigRecord(config: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof config === "object" && config !== null && !Array.isArray(config)
    ? (config as Readonly<Record<string, unknown>>)
    : undefined;
}

function readConfigString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasConfigSecretOrString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean {
  const value = record?.[key];
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "object" && value !== null;
}

function findEnvEntry(config: ProviderInstanceConfig, name: string) {
  const normalized = name.toUpperCase();
  return config.environment?.find((entry) => entry.name.toUpperCase() === normalized);
}

function hasConfiguredEnvVar(
  config: ProviderInstanceConfig,
  names: ReadonlyArray<string>,
): boolean {
  for (const name of names) {
    const entry = findEnvEntry(config, name);
    if (entry === undefined) continue;
    if (entry.valueRedacted === true) return true;
    if (typeof entry.value === "string") {
      if (entry.value.trim().length > 0) return true;
    } else {
      return true;
    }
  }
  return false;
}

function hasTruthyEnvFlag(config: ProviderInstanceConfig, names: ReadonlyArray<string>): boolean {
  for (const name of names) {
    const entry = findEnvEntry(config, name);
    if (entry === undefined) continue;
    if (entry.valueRedacted === true) return true;
    if (typeof entry.value !== "string") return true;
    if (!FALSY_ENV_FLAGS.has(entry.value.trim().toLowerCase())) return true;
  }
  return false;
}

function readEnvString(config: ProviderInstanceConfig, name: string): string | undefined {
  const entry = findEnvEntry(config, name);
  if (entry === undefined || typeof entry.value !== "string") return undefined;
  const trimmed = entry.value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLocalEndpointUrl(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = URL.parse(withScheme);
  if (parsed === null) return false;
  const hostname = parsed.hostname.toLowerCase();
  return LOCAL_ENDPOINT_HOSTS.has(hostname) || hostname.endsWith(".local");
}

function hasLocalModelEndpoint(
  config: ProviderInstanceConfig,
  record: Readonly<Record<string, unknown>> | undefined,
  snapshot?: ServerProvider,
): boolean {
  const urlCandidates = [
    readConfigString(record, "baseUrl"),
    readConfigString(record, "apiBaseUrl"),
    readConfigString(record, "apiEndpoint"),
    readConfigString(record, "endpoint"),
    snapshot?.auth.endpoint,
    ...LOCAL_ENDPOINT_ENV_NAMES.map((name) => readEnvString(config, name)),
  ];
  return urlCandidates.some(isLocalEndpointUrl);
}

function isDevReplayInstance(
  config: ProviderInstanceConfig,
  record: Readonly<Record<string, unknown>> | undefined,
  snapshot?: ServerProvider,
): boolean {
  if ((config.driver as string) === "devReplay") return true;
  if ((snapshot?.instanceId as string | undefined) === "devReplay") return true;
  if ((config.driver as string) !== "acpRegistry") return false;
  if (readConfigString(record, "source") !== "local") return false;
  const commandArgs = record?.commandArgs;
  if (
    Array.isArray(commandArgs) &&
    commandArgs.some((arg) => typeof arg === "string" && /dev-replay-agent/i.test(arg))
  ) {
    return true;
  }
  const commandPath = readConfigString(record, "commandPath");
  return commandPath !== undefined && /dev-replay-agent/i.test(commandPath);
}

function normalizedAuthType(snapshot?: ServerProvider): string | undefined {
  const value = snapshot?.auth.type?.trim().toLowerCase();
  return value && value.length > 0 ? value : undefined;
}

function normalizedAuthLabel(snapshot?: ServerProvider): string | undefined {
  const value = snapshot?.auth.label?.trim().toLowerCase();
  return value && value.length > 0 ? value : undefined;
}

export function classifyProviderInstanceBilling(
  config: ProviderInstanceConfig,
  snapshot?: ServerProvider,
): ProviderBillingClass {
  if (config.pool?.billingClass !== undefined) {
    return config.pool.billingClass;
  }

  const record = asConfigRecord(config.config);
  const driver = config.driver as string;

  if (isDevReplayInstance(config, record, snapshot)) {
    return "free";
  }

  if (hasLocalModelEndpoint(config, record, snapshot)) {
    return "local";
  }

  const authType = normalizedAuthType(snapshot);
  const authLabel = normalizedAuthLabel(snapshot);

  switch (driver) {
    case "codex": {
      if (
        authType === "apikey" ||
        authType === "api_key" ||
        authType === "api-key" ||
        authType === "amazonbedrock" ||
        authType === "bedrock" ||
        readConfigString(record, "apiProvider")?.toLowerCase() === "bedrock" ||
        hasConfiguredEnvVar(config, ["OPENAI_API_KEY", "CODEX_API_KEY", "AWS_BEDROCK_API_KEY"]) ||
        authLabel?.includes("api key") === true ||
        authLabel?.includes("bedrock") === true
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "claudeAgent": {
      const apiProvider = readConfigString(record, "apiProvider")?.toLowerCase();
      if (
        authType === "apikey" ||
        authType === "api_key" ||
        authType === "api-key" ||
        authType === "bedrock" ||
        authType === "vertex" ||
        apiProvider === "bedrock" ||
        apiProvider === "vertex" ||
        hasConfiguredEnvVar(config, ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) ||
        hasTruthyEnvFlag(config, ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) ||
        authLabel?.includes("api key") === true ||
        authLabel?.includes("bedrock") === true ||
        authLabel?.includes("vertex") === true
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "antigravity": {
      const authMethod = (readConfigString(record, "authMethod") ?? authType)?.toLowerCase();
      if (authMethod === "oauth-personal" || authMethod === "oauth-business") {
        return "subscription";
      }
      if (
        authMethod === "gemini-api-key" ||
        authMethod === "agent-platform" ||
        hasConfigSecretOrString(record, "apiKey") ||
        hasConfiguredEnvVar(config, ["GEMINI_API_KEY", "GOOGLE_API_KEY"])
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "cursor": {
      if (
        authType === "api-key" ||
        authType === "api_key" ||
        authType === "apikey" ||
        hasConfiguredEnvVar(config, ["CURSOR_API_KEY"]) ||
        authLabel?.includes("api key") === true
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "grok": {
      if (
        authType === "api_key" ||
        authType === "api-key" ||
        authType === "apikey" ||
        hasConfiguredEnvVar(config, ["XAI_API_KEY"]) ||
        authLabel?.includes("api key") === true
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "muse": {
      if (
        authType === "api_key" ||
        authType === "api-key" ||
        authType === "apikey" ||
        hasConfiguredEnvVar(config, ["META_API_KEY"])
      ) {
        return "metered_api";
      }
      return "subscription";
    }

    case "acpRegistry": {
      if (readConfigString(record, "source") === "local") {
        if (hasConfiguredEnvVar(config, GENERIC_METERED_API_KEY_ENV_NAMES)) {
          return "metered_api";
        }
        return "local";
      }
      return "unknown";
    }

    case "opencode":
    case "pi":
    case "fx":
    case "kiro":
    default:
      return "unknown";
  }
}

/** Unknown billing classes are treated conservatively as metered to prevent silent spend. */
export function isPaidMeteredClass(billingClass: ProviderBillingClass): boolean {
  return billingClass === "metered_api" || billingClass === "unknown";
}

export function defaultRoutingPriorityForBillingClass(
  billingClass: ProviderBillingClass,
): ProviderPoolPriority {
  return DEFAULT_PRIORITY_BY_BILLING_CLASS[billingClass];
}

export function billingClassCostRank(billingClass: ProviderBillingClass): number {
  return BILLING_TIER_COST_RANK[billingClass];
}
