# Integrations Hub & External Credentials

Sovereign connects to commercial services (payments, email, voice/telephony, GitHub, hosting/deployment, storefronts, and custom webhooks) through pluggable drivers registered in [`apps/server/src/sovereign/integrations/registerBuiltInDrivers.ts`](../../apps/server/src/sovereign/integrations/registerBuiltInDrivers.ts).

> **Honest verification notice:** All 13 built-in integration drivers, HMAC webhook verifiers, SSRF guards, and compliance checks are verified offline in [`apps/server/src/sovereign/integrations/IntegrationsHub.test.ts`](../../apps/server/src/sovereign/integrations/IntegrationsHub.test.ts) using deterministic mock HTTP transports. **Live API connections require your own accounts, API keys, and webhook signing secrets** — Sovereign does not ship with pre-configured credentials and does not claim live third-party connectivity until you supply and test your own keys.

## 1. Credential Isolation & Secret Storage

- Secrets are persisted exclusively on the server host via `ServerSecretStore` under key `sovereign-integration-<integrationId>` (encrypted/restricted mode `0o600` files in the server secrets directory) or via an external vault `SecretReference` (for example, 1Password).
- The `sovereign_integrations` SQLite table and all `IntegrationConfig` RPC responses **never** include plaintext secrets — only `hasSecret: boolean` and optional `secretReference`.
- Updating an integration requires `sovereign:admin`; attaching a `SecretReference` additionally requires `providers:manage`.
- Agents cannot read integration secrets through MCP tools.

## 2. Built-In Integration Drivers

Configure integrations in **Settings → Integrations** (`/settings/sovereign-integrations`) or via `sovereign.upsertIntegration`, then run **Test Connection** (`sovereign.testIntegration`).

### Payments & Merchant-of-Record ([`paymentDrivers.ts`](../../apps/server/src/sovereign/integrations/paymentDrivers.ts))

| Provider (`providerKind`)          | Connection probe                                                                  | Webhook signature & events reconciled                                                                                                                                                                                                                                                     | External account / cost                            |
| ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Stripe** (`stripe`)              | `GET https://api.stripe.com/v1/balance`                                           | `stripe-signature` (`t=<ts>,v1=<hex>`, 300s timestamp skew check + constant-time HMAC-SHA256). Reconciles `checkout.session.completed`, `invoice.paid`, `charge.refunded` to verified `collected_revenue` / `refund` / `payment_fee` ledger entries. Includes `createPaymentLink` helper. | Stripe account; standard Stripe processing fees.   |
| **Paddle** (`paddle`)              | `GET /event-types` (`api.paddle.com` or `sandbox-api.paddle.com` in sandbox mode) | `paddle-signature` (`ts=...;h1=...` HMAC-SHA256 + timestamp skew check). Reconciles `transaction.completed` and `adjustment.created`.                                                                                                                                                     | Paddle merchant-of-record account; Paddle fees.    |
| **Lemon Squeezy** (`lemonsqueezy`) | `GET https://api.lemonsqueezy.com/v1/users/me`                                    | `x-signature` (HMAC-SHA256). Reconciles `order_created`, `order_refunded`, `subscription_payment_success`.                                                                                                                                                                                | Lemon Squeezy merchant-of-record account; LS fees. |

### Email & Messaging ([`emailDrivers.ts`](../../apps/server/src/sovereign/integrations/emailDrivers.ts))

| Provider (`providerKind`) | Connection probe                                          | Built-in compliance enforcement                                                                                                                                               | External account / cost                                           |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Resend** (`resend`)     | `GET https://api.resend.com/domains`                      | Rejects AI-authored emails unless `aiDisclosed: true`, appends transparency & opt-out footer/headers, and rejects opted-out or non-consented recipients (`consent_required`). | Resend account + verified sending domain; free tier or paid plan. |
| **SMTP** (`smtp`)         | Validates host/port/auth settings (supports sandbox mode) | Same AI identity disclosure and UK PECR/GDPR consent/opt-out enforcement as Resend.                                                                                           | Any SMTP relay (Postmark, SES, Fastmail, custom mail server).     |

### Voice & Telephony ([`voiceDrivers.ts`](../../apps/server/src/sovereign/integrations/voiceDrivers.ts))

All four providers implement a unified `VoiceProviderAdapter` (`syncVoiceAgent`, `estimateCallCostMinor`, `parseInboundCallWebhook`) so you are never locked to a single voice vendor:

| Provider (`providerKind`)     | API base                    | Compliance & cost tracking                                                                                                    | External account / cost                                          |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Vapi** (`vapi`)             | `https://api.vapi.ai`       | Enforces `aiDisclosureGreeting`, recording notice, opt-out phrase; tracks telephony + voice inference + LLM per-minute costs. | Vapi account; per-minute platform + telephony + model charges.   |
| **Retell AI** (`retell`)      | `https://api.retellai.com`  | Same unified disclosure/opt-out enforcement and per-minute cost breakdown.                                                    | Retell AI account; per-minute charges.                           |
| **ElevenLabs** (`elevenlabs`) | `https://api.elevenlabs.io` | Same unified disclosure/opt-out enforcement and voice synthesis/agent cost accounting.                                        | ElevenLabs account; per-minute / character charges.              |
| **Twilio** (`twilio`)         | `https://api.twilio.com`    | Direct telephony carrier webhook parsing and per-minute carrier cost logging.                                                 | Twilio account + phone number rental + per-minute carrier rates. |

### Source Control ([`githubDriver.ts`](../../apps/server/src/sovereign/integrations/githubDriver.ts))

- **GitHub (`github`):**
  - Connection probe: `GET https://api.github.com/user`
  - `discoverFundedIssues`: Queries GitHub Search API for funded/bounty issues, extracts estimated rewards, and passes untrusted issue titles/bodies through prompt-injection quarantine.
  - `inspectRepoContributionPolicy`: Inspects `CONTRIBUTING.md` and repository metadata to classify AI contribution policy (`permitted`, `disclosure_required`, `prohibited`, `unknown`).
  - `checkCompetingPullRequests`: Detects open competing pull requests to avoid duplicate spam submissions.
  - Webhook verification: Constant-time `x-hub-signature-256` HMAC-SHA256 verification.

### Hosting, Deployment & Storefronts ([`deploymentDrivers.ts`](../../apps/server/src/sovereign/integrations/deploymentDrivers.ts))

| Provider (`providerKind`)     | API base                     | Capabilities                                                                                 | External account / cost                                       |
| ----------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Vercel** (`vercel`)         | `https://api.vercel.com`     | Connection test, deployment status lookup (`getVercelDeploymentStatus`), sandbox simulation. | Vercel account; free hobby tier or Pro hosting charges.       |
| **Cloudflare** (`cloudflare`) | `https://api.cloudflare.com` | Connection test, Pages/Workers deployment status, sandbox simulation.                        | Cloudflare account; free tier or paid Workers/R2/DNS charges. |
| **Gumroad** (`gumroad`)       | `https://api.gumroad.com`    | Connection test, product listing summary, webhook sale/refund reconciliation.                | Gumroad account; platform + payment fees.                     |

### Generic Webhooks & Web Research

- **Generic Webhook (`webhook`) & Custom (`custom`):** Supports custom endpoints with constant-time HMAC-SHA256 (`x-sovereign-signature`, `stripe-signature`, `x-hub-signature-256`, `x-webhook-signature`).
- **Web Research Audit Driver ([`webResearchDriver.ts`](../../apps/server/src/sovereign/integrations/webResearchDriver.ts)):** `fetchAndAuditWebsite` enforces `http:`/`https:` schemes only, blocks SSRF to loopback, link-local metadata (`169.254.169.254`), and private RFC1918/IPv6 ranges (unless explicitly invoked with `allowLocalLab: true`), caps response size (256 KiB default) and redirects (3 hops), and quarantines prompt-injection patterns in page HTML.

## 3. Inbound Webhook Endpoint & HMAC Verification

Point external webhook senders at:

```text
POST https://<your-sovereign-host>/api/sovereign/webhooks/<integrationId>
```

Implemented in [`apps/server/src/sovereign/SovereignHttpRoutes.ts`](../../apps/server/src/sovereign/SovereignHttpRoutes.ts) and [`SovereignIntegrationService.ts`](../../apps/server/src/sovereign/SovereignIntegrationService.ts):

1. Enforces a hard **1 MiB** request body cap (`413` on overflow) and strips `Cookie` headers.
2. Verifies the provider's cryptographic HMAC signature over the **raw request bytes** using constant-time comparison before decoding JSON (`401` on invalid signature, logged as `permission_denied`).
3. Claims `(integration_id, replay_key)` atomically in `sovereign_webhook_replay_keys` so duplicate webhook deliveries return `200 { status: "duplicate" }` without double-booking revenue.
4. Writes verified payment/refund/fee events directly to `sovereign_ledger_entries` with `verificationState: "verified"` and unique `externalRef`.

> **Network note:** External services (Stripe, Paddle, GitHub, Twilio, etc.) require a publicly reachable HTTPS endpoint. When running Sovereign locally on `127.0.0.1:3773`, terminate HTTPS via a reverse proxy, Tailscale Funnel, or your own tunnel pointing only the `/api/sovereign/webhooks/*` path to the Sovereign server.

## 4. Sandbox Mode

Every integration has a `sandboxMode` flag:

- When `sandboxMode: true`, connection tests return deterministic sandbox pass results without contacting live third-party endpoints, and payment/deployment helpers avoid live charges.
- For Paddle, `sandboxMode: true` targets `https://sandbox-api.paddle.com`.
- Always test workflows in sandbox mode before enabling live credentials.
