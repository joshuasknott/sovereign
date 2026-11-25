# Sovereign Quickstart

This guide covers installing Sovereign from source, running it locally on Windows, macOS, or Linux, isolating its state directory, connecting existing AI subscriptions, and creating your first venture and commercial objective.

> **Upstream attribution:** Sovereign is built on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) core (`Copyright (c) 2026 T3 Tools Inc.`). Sovereign is an independent project and is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

## Prerequisites

- **Git** (on Windows, enable long paths: `git config --global core.longpaths true`)
- **[Vite+](https://viteplus.dev/guide/) (`vp`)**, which installs and pins the Node.js runtime specified in `package.json`:

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows (PowerShell)
irm https://vite.plus/ps1 | iex
```

- **At least one AI provider CLI or agent** installed and authenticated on the host machine (for example, Claude Code, Codex CLI, Cursor CLI, Antigravity, OpenCode, or an ACP agent). For zero-cost local evaluation without an AI subscription, the development server automatically registers `Replay (dev)`.
- **Optional:** Rust toolchain (`rustup`) if you want process telemetry via `native/resource-monitor` or to package native desktop builds.

## 1. Install dependencies and configure state isolation

```bash
vp i
```

Copy `.env.example` to `.env` if you want local overrides:

```bash
cp .env.example .env
```

### State directory (`SOVEREIGN_HOME`)

Sovereign resolves its home directory in [`apps/server/src/config.ts`](../../apps/server/src/config.ts) via `resolveConfiguredHomeDir`:

1. `SOVEREIGN_HOME` (preferred for Sovereign deployments so data stays separate from any existing T3 Code installation)
2. `T3CODE_HOME` (legacy fallback)
3. Default development state directory (`~/.t3/dev` for standard checkouts, or `<worktree>/.t3/userdata` inside linked git worktrees)

To keep Sovereign state completely isolated from any other local install:

```bash
# macOS / Linux
export SOVEREIGN_HOME="$HOME/.sovereign"
```

```powershell
# Windows (PowerShell)
$env:SOVEREIGN_HOME = "$HOME\.sovereign"
```

> **Safety rule:** Never point a development server at `~/.t3/userdata` if you run a separate live T3 Code instance on the same machine.

## 2. Launch locally

### Web + Server (recommended first run)

```bash
vp run dev
```

The dev runner starts the Sovereign Node/Effect server (SQLite `statev2.sqlite` with the Sovereign schema migration) and the Vite web client on a single origin (default port `3773`, offset automatically if occupied). Look for the printed `pairingUrl:` in terminal output and open it in your browser. Opening the bare origin without the pairing URL will not authenticate a new browser session.

### Desktop app (Electron)

```bash
vp run dev:desktop
```

### Headless server / production build

```bash
vp run build
node apps/server/dist/bin.mjs serve
```

When running headless, run `node apps/server/dist/bin.mjs pair` (or `t3 pair` if the CLI shim is installed) to generate a one-time pairing URL.

## 3. Add your AI subscriptions

Sovereign routes work through your existing AI subscriptions, local models, or free/dev providers rather than forcing a single metered API.

1. Authenticate your provider CLIs on the machine running the Sovereign server:
   - **Claude Code:** `claude auth login`
   - **Codex CLI:** `codex login` (or Connect with ChatGPT in Settings)
   - **Cursor CLI:** `agent login`
   - **Antigravity (Google):** Sign in from **Settings → Providers**
   - **Grok Build:** `grok login`
   - **OpenCode:** `opencode auth login`
   - **Kiro:** `kiro-cli login`
   - **Pi / Muse Code / fx / ACP Registry (Devin, GitHub Copilot CLI, local ACP commands):** See [Providers and Resource Pool](./providers-and-pool.md) and [Provider guides](../user/install.md#providers).
2. Open **Settings → Providers** in Sovereign.
3. Enable each provider instance and expand its **Provider Pool** configuration (`SovereignProviderPoolSection`):
   - Confirm or set its **Billing Class** (`subscription`, `local`, `free`, `metered_api`, `manual_only`, `unknown`).
   - Set **Pool Priority**, **Max Concurrent Runs**, and optional monthly subscription cost (for accurate fixed-cost visibility in GBP).
   - Leave **Paid Fallback Mode** on `deny` (the default) unless you want Sovereign to request approval (`ask_approval`) or allow metered API calls (`allow`).

## 4. Create your first venture and commercial objective

Sovereign starts with a clean database: **zero fabricated ventures, zero simulated revenue, £0 monthly discretionary spend budget, and all external actions gated by approval or denied by default.**

1. Open **Overview** (`/`).
2. Click **New venture** beside the Ventures heading, choose one of the 7 built-in blueprints (or **Custom Venture**), and create it.
3. Open the venture's workspace (`/ventures/<id>`) and inspect its default guardrails via the configuration drawer (`VentureConfigSheet`):
   - **Budget Policy:** Default `£0.00/month`, discretionary spend disabled.
   - **Action Permissions:** External communications, submissions, deployments, and refunds default to `require_approval`; `security_testing` and `paid_provider_fallback` default to `deny`.
4. Return to **Overview** and enter a commercial objective in the **Command Composer** (`SovereignCommandComposer`) — for example:
   > _"Focus on TypeScript and Effect open-source dev bounties this month with £0 upfront spend and require approval before any external PR submission."_
5. Sovereign decomposes the objective into bounded, idempotent tasks, routes work across eligible subscription/local providers, surfaces deliverables in the venture's **Operations** tab, and queues any external action in **Pending Approvals** for your explicit sign-off.

A venture card opens a linked active conversation when one is available. The matching sidebar project always opens venture management. **Needs you** indicates pending approvals. Portfolio-wide objectives and approvals appear below the cards when present.

Choose **Today**, **7d**, **30d** or **All time** in the profit control. Today starts at midnight UTC. The other dated periods cover the preceding 7 or 30 days up to the snapshot time. Verified receipts, costs, refunds, payment fees and signed adjustments contribute in the reporting currency. Hover or focus **Providers** for subscription usage and select it for full settings.

The Overview composer accepts an objective without a target or deadline. Use its microphone to dictate. Selecting a model or attaching files opens a standard thread draft on submission, where you can review the model and attachments before sending.

## 5. Next steps

- [Architecture](./architecture.md) — Modular Sovereign layer, the Sovereign schema migration, Effect services, WebSocket RPC, and MCP toolkit.
- [Providers and Resource Pool](./providers-and-pool.md) — Billing classification, honest quota reporting, never-silent-paid-fallback policy, and rate-limit failover.
- [Ventures](./ventures.md) — Detailed workflows for all 7 initial ventures and dynamic custom venture creation.
- [Integrations](./integrations.md) — Configuring Stripe, Paddle, Lemon Squeezy, Resend, SMTP, Vapi, Retell, ElevenLabs, Twilio, GitHub, Vercel, Cloudflare, Gumroad, and webhooks.
- [Governance and Finance](./governance-and-finance.md) — Emergency stop, approval policies, security bounty scope lock, UK PECR/GDPR controls, and GBP financial ledger.
- [Operations and Reliability](./operations-and-reliability.md) — Always-on daemon service, remote access, crash recovery, testing, and known limitations.
