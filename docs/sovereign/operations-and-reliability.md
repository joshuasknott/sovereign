# Operations, Reliability, and Known Limitations

This guide covers running Sovereign as an always-on background service, remote access, crash/restart recovery, troubleshooting, verification tests, and an honest record of current limitations.

## 1. Always-On Background Service

Sovereign inherits T3 Code's OS-level user service management (`systemd` user units on Linux with lingering, `launchd` on macOS, and Windows Task Scheduler on Windows). See [`docs/user/background-service.md`](../user/background-service.md) for platform-specific flags.

With the `t3` CLI built/installed from this repository (or invoking `node apps/server/dist/bin.mjs`):

| Task                                             | Command                |
| ------------------------------------------------ | ---------------------- |
| Start interactively with web UI                  | `t3`                   |
| Start headless server                            | `t3 serve`             |
| Install and start user background service        | `t3 service install`   |
| Inspect service status and log path              | `t3 service status`    |
| Restart service (picks up `service.env` changes) | `t3 service restart`   |
| Stop and remove startup service                  | `t3 service uninstall` |
| Protect server from Linux OOM killer             | `t3 service protect`   |
| Reclaim SQLite space                             | `t3 doctor`            |

### Service environment (`service.env`)

Place persistent environment variables in `service.env` inside your Sovereign home directory (e.g. `$SOVEREIGN_HOME/service.env` or `~/.t3/service.env`) and restrict permissions (`chmod 600` on POSIX):

```dotenv
SOVEREIGN_HOME=/home/user/.sovereign
T3CODE_PORT=3773
T3CODE_HOST=127.0.0.1
```

Restart the service (`t3 service restart`) after editing `service.env`.

> **Unattended host note:** On macOS and Windows, user services run while the user account is signed in — lock the screen and disable sleep rather than signing out. On Linux, `t3 service install` enables `systemd` lingering so the service survives logout and restarts on boot.

## 2. Remote Connectivity

- **Loopback default:** By default the server binds to `127.0.0.1:3773` and requires a valid paired session (`Authorization: Bearer ...` / DPoP) for all RPCs.
- **LAN / Tailscale:** Use `t3 up --lan` (or bind to your Tailscale interface via `T3CODE_HOST` / `vp run dev --share` in development) and pair clients using a one-time pairing URL (`t3 pair`).
- **Self-hosted relay (optional):** Sovereign does **not** connect to T3 Tools' hosted `relay.t3.codes` or `app.t3.codes` infrastructure. `.env.example` ships with all Clerk/Relay variables unset. If you operate your own relay (`infra/relay/`) and Clerk instance, configure `T3CODE_RELAY_URL`, `T3CODE_CLERK_PUBLISHABLE_KEY`, and related env vars explicitly.
- **Webhook ingress:** Inbound payment/voice/GitHub webhooks hit `POST /api/sovereign/webhooks/:integrationId` and require an HTTPS reverse proxy or tunnel when hosting behind NAT.

## 3. Crash & Restart Recovery

Sovereign persists all commercial state to SQLite (`statev2.sqlite` in WAL mode):

- **Boot-time task recovery:** [`SovereignRuntimeLayer.layerStartupRecovery`](../../apps/server/src/sovereign/SovereignRuntimeLayer.ts) calls `SovereignOrchestratorService.recoverInterruptedWork` automatically on every server startup.
  - Any `CommercialTask` left in `running` or `queued` state from an unexpected crash or power loss is inspected against its `retry_count` / `max_retries` budget.
  - Recoverable tasks are reset to `ready` with preserved `checkpoint_json` and `handoff_summary`, incrementing `retry_count`; tasks that exhausted retries are marked `failed` with an explanatory `blocked_reason`.
- **Emergency stop durability:** `sovereign_control_state.emergency_stop_active` is persisted in SQLite. If the server crashes or restarts while Emergency Stop is active, the stop remains active on boot.
- **Idempotency across restarts:** Tasks (`idempotency_key`), opportunities (`(venture_id, external_id)`), approvals (`idempotency_key`), ledger entries (`external_ref`), and webhooks (`sovereign_webhook_replay_keys`) all enforce SQLite unique constraints so retries after a crash do not duplicate commercial records or double-book revenue.

## 4. Troubleshooting

| Symptom                                                           | Likely cause                                                                                           | Resolution                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser opens bare URL and shows unauthenticated / pairing prompt | Opened `http://localhost:3773` instead of the one-time pairing URL                                     | Open the `pairingUrl:` printed by `vp run dev`, or run `node apps/server/src/bin.mjs pair`.                                                             |
| Provider shows `Unavailable` quota                                | Provider CLI does not expose live usage windows                                                        | Expected honest behavior — Sovereign never fabricates quota percentages.                                                                                |
| Task paused with `paid_fallback_denied`                           | All subscription/local/free instances are unavailable or in cooldown, and `paidFallbackMode` is `deny` | Wait for cooldown reset, add another subscription/local instance, or change `paidFallbackMode` to `ask_approval` / `allow` in **Settings → Providers**. |
| Provider probe times out on slow machine                          | Default readiness probe deadline exceeded                                                              | Set `T3CODE_<PROVIDER>_PROBE_TIMEOUT_MS=60000` (see [`docs/user/install.md#provider-check-timeouts`](../user/install.md#provider-check-timeouts)).      |
| Expenditure or outreach blocked immediately                       | Default `£0.00` budget cap, `discretionarySpendAllowed: false`, or missing UK PECR/GDPR consent        | Configure venture budget cap / discretionary spend in `VentureConfigSheet`, or record valid channel consent on the lead/customer.                       |
| Security bounty assessment returns `security_unauthorised`        | Security authorisation lock is closed, expired, or target/method is out of scope                       | Record explicit programme authorisation, `targetScope`, `permittedMethods`, and future `expiresAt` in the venture's permission policy.                  |
| Webhook returns `401 invalid_signature`                           | Mismatched signing secret or middleware altered raw body                                               | Re-save the provider's webhook signing secret on the integration and ensure your reverse proxy forwards raw bytes without modifying the body.           |

## 5. Verification & Testing

Run targeted Sovereign test suites (deterministic, offline, zero paid API calls):

```bash
# Contracts & theme palettes
vp test run packages/contracts/src/sovereign/sovereign.test.ts packages/shared/src/themePalettes.test.ts

# Shared client-runtime atoms, commands & formatters
vp test run packages/client-runtime/src/sovereign/sovereign.test.ts

# Provider pool billing classifier, router, cooldown & reassignment
vp test run apps/server/src/provider/billingClassifier.test.ts apps/server/src/provider/ProviderPoolRouter.test.ts apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.test.ts

# Sovereign server core (Migration 117, governance, ledger, sales, orchestrator, webhooks, MCP)
vp test run apps/server/src/sovereign/SovereignCore.test.ts

# Integration drivers (Stripe, Paddle, Lemon Squeezy, Resend, SMTP, Voice, GitHub, Deploy, SSRF)
vp test run apps/server/src/sovereign/integrations/IntegrationsHub.test.ts

# All 7 ventures + custom ventures + sandbox fixtures
vp test run apps/server/src/sovereign/ventures/VentureWorkflowEngine.test.ts

# Web UI logic & React Compiler coverage
vp test run apps/web/src/sovereign/sovereignUi.test.ts apps/web/src/branding.logic.test.ts apps/web/src/reactCompilerCoverage.test.ts
```

Before pushing changes, run the branch gate:

```bash
vp run check:changed
```

## 6. Known Limitations (Honest Record)

1. **External credentials required for live commercial operations:** Payment links, live webhook reconciliation, outbound emails, voice calls, GitHub bounty discovery, and cloud deployments require your own accounts and API keys. Offline tests verify protocol/signature/compliance behavior against deterministic mocks, not your live vendor accounts.
2. **Web-only AI subscriptions cannot be automated:** Consumer web interfaces without an official CLI, SDK, or ACP transport cannot be routed automatically and must be marked `manual_only`.
3. **Quota visibility depends on provider telemetry:** Several CLI and ACP providers do not publish remaining quota windows; Sovereign reports `Unavailable` rather than guessing.
4. **No built-in hosted cloud relay or public app store binaries:** Sovereign ships as source-buildable software. Official T3 Tools relays (`relay.t3.codes`), hosted web (`app.t3.codes`), and T3 Code App Store / Google Play listings belong solely to T3 Tools, Inc. and are not used by Sovereign.
5. **Voice AI and cloud hosting carry real external costs:** Unlike subscription-backed coding agents, telephony minutes, realtime voice synthesis, domains, and cloud hosting incur marginal third-party vendor charges. Keep venture budgets at `£0` until you are ready to fund and monitor those lines.
6. **Windows-specific test/script caveats:** A few upstream POSIX symlink/PATH tests (`DesktopCliCommand.test.ts`) and `scripts/i18n-check.ts` (spawning `gt` without `.cmd`) have known Windows shell quirks; run `vp run --filter <app> i18n:generate` directly when updating translations on Windows.
7. **Not legal or tax advice:** UK PECR/GDPR consent gates, AI disclosure enforcement, and the GBP financial ledger are technical safeguards, not a substitute for qualified legal, compliance, or accounting review for your jurisdiction.
