# Providers and Resource Pool

Sovereign is **provider-agnostic**. Instead of hardcoding a single vendor or forcing metered API billing, it builds a unified routing and availability pool over all installed T3 Code provider drivers, multi-instance accounts, local models, and ACP agents.

Key implementation files:

- Contracts: [`packages/contracts/src/sovereign/providerPoolMetadata.ts`](../../packages/contracts/src/sovereign/providerPoolMetadata.ts), [`packages/contracts/src/sovereign/providerPool.ts`](../../packages/contracts/src/sovereign/providerPool.ts), [`packages/contracts/src/providerInstance.ts`](../../packages/contracts/src/providerInstance.ts)
- Server pool & routing: [`apps/server/src/provider/billingClassifier.ts`](../../apps/server/src/provider/billingClassifier.ts), [`apps/server/src/provider/ProviderAvailabilityLedger.ts`](../../apps/server/src/provider/ProviderAvailabilityLedger.ts), [`apps/server/src/provider/ProviderPoolRouter.ts`](../../apps/server/src/provider/ProviderPoolRouter.ts)
- Rate-limit recovery & reassignment: [`apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts`](../../apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts)
- Model manifest override: [`apps/server/src/provider/ModelManifest.ts`](../../apps/server/src/provider/ModelManifest.ts) (`SOVEREIGN_MODEL_MANIFEST_URL` / `T3CODE_MODEL_MANIFEST_URL`)

## 1. Supported Providers & Execution Mechanisms

Every provider runs on the host machine running the Sovereign server. Sovereign does **not** resell tokens or proxy your subscriptions through third-party billing.

| Driver                                   | Execution mechanism                                                                                                                                                                                 | Typical auth / subscription mode                                                                         | Default inferred billing class                                                                                                           | Notes & limitations                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex** (`codex`)                      | Local Codex CLI / ChatGPT-connected managed runtime                                                                                                                                                 | ChatGPT Plus/Pro/Team subscription (`codex login` or Connect with ChatGPT) or `OPENAI_API_KEY` / Bedrock | `subscription` (switches to `metered_api` if API key or Bedrock configured)                                                              | Supports multiple instances with isolated env/config.                                                                                     |
| **Claude Code** (`claudeAgent`)          | Local Claude Code CLI (`claude`)                                                                                                                                                                    | Claude Pro/Max/Team subscription (`claude auth login`) or `ANTHROPIC_API_KEY` / Bedrock / Vertex         | `subscription` (switches to `metered_api` if API key / Bedrock / Vertex configured)                                                      | Respects Claude Code permission modes and rate limits.                                                                                    |
| **Antigravity / Gemini** (`antigravity`) | Managed runtime with Google OAuth or Gemini API key                                                                                                                                                 | Google personal/business OAuth or `GEMINI_API_KEY` / `GOOGLE_API_KEY`                                    | `subscription` for OAuth (`oauth-personal` / `oauth-business`); `metered_api` for API key / Agent Platform                               | Configure directly in **Settings → Providers**.                                                                                           |
| **Cursor** (`cursor`)                    | Local Cursor CLI (`cursor-agent`, login via `agent login`)                                                                                                                                          | Cursor subscription or `CURSOR_API_KEY`                                                                  | `subscription` (or `metered_api` if `CURSOR_API_KEY` set)                                                                                | Binary is `cursor-agent` even though login command is `agent login`.                                                                      |
| **Grok Build** (`grok`)                  | Local Grok Build CLI (`grok login`)                                                                                                                                                                 | xAI subscription or `XAI_API_KEY`                                                                        | `subscription` (or `metered_api` if `XAI_API_KEY` set)                                                                                   | Supports `--device-auth` for headless hosts.                                                                                              |
| **Muse Code** (`muse`)                   | Local Muse Code CLI (`muse login`)                                                                                                                                                                  | Meta subscription or `META_API_KEY`                                                                      | `subscription` (or `metered_api` if `META_API_KEY` set)                                                                                  | Install on server host before enabling.                                                                                                   |
| **OpenCode** (`opencode`)                | Local OpenCode CLI/server (`opencode auth login`)                                                                                                                                                   | Aggregator supporting subscriptions, local models, and API keys                                          | `unknown` (or `local` if pointing at a loopback endpoint)                                                                                | Conservatively inferred as `unknown` until you label its billing class explicitly in Pool settings.                                       |
| **Kiro** (`kiro`)                        | Local Kiro CLI (`kiro-cli login`)                                                                                                                                                                   | AWS/Kiro account or metered credits                                                                      | `unknown`                                                                                                                                | Includes AWS `ThrottlingException` / 429 / credit exhaustion detection.                                                                   |
| **Pi** (`pi`)                            | Local Pi agent (`pi` + `/login`)                                                                                                                                                                    | Multi-provider aggregator                                                                                | `unknown` (or `local` for local endpoints)                                                                                               | Includes rate-limit detection across prompt and auto-retry events.                                                                        |
| **fx** (`fx`)                            | Local fx CLI (`fx login`)                                                                                                                                                                           | Multi-provider CLI                                                                                       | `unknown`                                                                                                                                | Includes rate-limit detection in adapter.                                                                                                 |
| **ACP Registry** (`acpRegistry`)         | Official [ACP Registry](https://agentclientprotocol.com/get-started/registry) agents (e.g. **GitHub Copilot CLI**, **Devin**) or **Local ACP commands** (e.g. DeepSeek Harness `dsh --profile acp`) | Agent-managed browser/terminal login or env API keys                                                     | `local` for local ACP commands without API keys; `metered_api` if generic API key env vars are set; `unknown` for remote registry agents | Registry agents run on the server host under `tools/<agent-id>/<version>/`. See [`docs/user/providers-acp.md`](../user/providers-acp.md). |
| **Local models**                         | Any driver configured with a loopback/local base URL (`localhost`, `127.0.0.1`, `::1`, `*.local`, `OLLAMA_HOST`, `LM_STUDIO_BASE_URL`, `VLLM_BASE_URL`)                                             | Local inference server (Ollama, LM Studio, vLLM)                                                         | `local`                                                                                                                                  | Zero marginal API cost; hardware-bound latency and capability.                                                                            |
| **Replay (dev)** (`devReplay`)           | Local deterministic ACP transcript replayer ([`apps/server/scripts/dev-replay-agent.ts`](../../apps/server/scripts/dev-replay-agent.ts))                                                            | None (dev only)                                                                                          | `free`                                                                                                                                   | Automatically registered in `vp run dev` for cost-free UI and workflow testing.                                                           |

### Manual-Only & Web-Only AI Subscriptions

Sovereign only executes providers that expose an official CLI, local runtime, SDK, or ACP interface. Consumer web-chat subscriptions that lack a supported CLI/ACP execution path (or forbid automated browser scraping under their Terms of Service) **cannot** be driven automatically. If you track such an account for planning purposes, classify it as `manual_only` (priority `0`) so the router never attempts automated execution against it.

## 2. Billing Classification & Priority Order

Every provider instance has a `ProviderBillingClass` (`packages/contracts/src/sovereign/providerPoolMetadata.ts`). Explicit per-instance configuration (`config.pool.billingClass`) always overrides automatic inference (`classifyProviderInstanceBilling`).

| Billing Class  | Cost Rank | Default Priority | Treated as Paid/Metered?                                                 |
| -------------- | --------- | ---------------- | ------------------------------------------------------------------------ |
| `free`         | 0         | 900              | No                                                                       |
| `local`        | 1         | 800              | No                                                                       |
| `subscription` | 2         | 600              | No (fixed monthly subscription; zero marginal per-call fee within quota) |
| `metered_api`  | 3         | 200              | **Yes**                                                                  |
| `unknown`      | 4         | 100              | **Yes (conservative fail-safe)**                                         |
| `manual_only`  | 5         | 0                | Excluded from automated routing                                          |

> **Why `unknown` is treated as metered:** Aggregators like OpenCode, Pi, Kiro, fx, or third-party ACP agents can back onto pay-per-token APIs. Treating `unknown` as metered (`isPaidMeteredClass`) guarantees Sovereign will never silently incur API spend on an unclassified instance. Once you confirm an instance is backed by an included subscription or local server, set its billing class explicitly in **Settings → Providers**.

## 3. Never-Silent-Paid-Fallback Policy

`DEFAULT_PAID_FALLBACK_MODE` is **`"deny"`** globally and on every venture. `DEFAULT_ALLOWED_BILLING_CLASSES` is `["subscription", "local", "free"]`.

When `ProviderPoolRouter.route()` runs:

1. If a `manualInstanceId` is pinned, the router checks that instance first and still enforces paid-fallback and cost limits.
2. Otherwise, it filters eligible instances (`enabled`, `poolEnabled`, not in cooldown, not `exhausted`, under `maxConcurrentRuns`, matching `requiredTags`) and ranks candidates by health, tier match (`fast` / `balanced` / `reasoning` / `frontier`), headroom, priority, and reliability score.
3. If an included (`free`, `local`, or `subscription`) candidate is eligible, it routes immediately and records a `provider_routed` audit event.
4. If **only** `metered_api` (or `unknown`) candidates remain:
   - **`deny` (default):** Fails with `paid_fallback_denied`, records a `permission_denied` audit event, and does **not** spend money.
   - **`ask_approval`:** Returns `status: "approval_required"`, creates a persisted high-risk `ApprovalRequest` (`category: "paid_provider_fallback"`) with an estimated cost in minor units, pauses the task, and waits for owner sign-off.
   - **`allow`:** Permits routing **only** if the instance's billing class is in `allowedBillingClasses` and the estimated cost does not exceed `maxEstimatedCostMinor` (otherwise fails with `cost_limit_exceeded`).

## 4. Multi-Instance Management

You can configure multiple instances of the same driver (for example, `claude-personal` and `claude-work`, or two Codex accounts) using `server.upsertProviderInstance` / `server.removeProviderInstance` or **Settings → Providers → Add provider**.

Each instance supports:

- Independent `displayName`, `enabled`, `environment` variables (sensitive values are redacted and stored securely), and binary/home overrides
- Pool metadata (`pool`):
  - `billingClass`
  - `subscriptionPlanLabel`, `monthlySubscriptionCostMinor`, `subscriptionCurrency`
  - `poolEnabled`, `poolPriority` (`0..1000`), `maxConcurrentRuns`
  - `preferredTiers` (`fast`, `balanced`, `reasoning`, `frontier`)
  - `poolTags` (e.g. `["code-review", "bounties"]`)

> **Account isolation caveat:** Built-in CLI providers isolate accounts via instance-specific home/config environment variables where supported. Generic ACP agents manage credentials in their own store and do not expose a standardized multi-account isolation protocol; verify separate CLI/config directories when running multiple instances of an ACP agent.

## 5. Honest Quota & Usage Reporting

Sovereign refuses to fabricate quota percentages or fake reset countdowns.

- `ProviderPoolMemberStatus` tracks `quotaAvailability` (`"available" | "exhausted" | "unavailable"`), `quotaRemainingPct` (`number | null`), and `quotaResetAt` (`IsoDateTime | null`).
- When a provider reports real usage windows via `UsageLimitSources`, Sovereign computes remaining capacity and reset timestamps from those live windows.
- When a provider does **not** expose live quota telemetry (or telemetry windows are expired/absent), Sovereign reports `quotaAvailability: "unavailable"` and `quotaRemainingPct: null`, and the UI renders an explicit **"Unavailable"** status (`formatQuotaStatus`).

## 6. Rate-Limit Cooldown & Automatic Reassignment

When a provider hits a rate or usage limit during execution:

1. Adapters emit a typed `usage_limit` failure (including `resetAt` when provided by the provider — supported across built-in providers plus `provider-acp`, `provider-kiro`, `provider-fx`, and `provider-pi`).
2. `ProviderAvailabilityLedger.recordRateLimit()` places that instance into cooldown until `resetAt` — or applies bounded exponential backoff (`30s` up to `15m`) if the provider did not report a reset timestamp — and updates its EWMA reliability score.
3. `UsageLimitRecoveryWorker` queries `ProviderPoolRouter.selectReassignmentTarget()`, which looks for a healthy peer instance in the **same or cheaper** billing tier (`billingClassCostRank`).
4. If a safe peer exists, the thread switches to that peer and resumes automatically (`provider.switch` + continuation). If no safe peer exists (for example, only a metered API remains), Sovereign **never** silently escalates to paid billing; instead, it snoozes the run until the cooldown or reset window clears.
