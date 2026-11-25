# Install Sovereign

Sovereign runs on your own machine and serves web, desktop (Electron), and mobile (React Native) clients over a local or remote WebSocket server. Set up the machine that will host your AI providers and Sovereign server first.

> For a step-by-step walkthrough including adding AI subscriptions and launching your first commercial venture, see [Sovereign Quickstart](../sovereign/quickstart.md).
>
> **Note:** Sovereign is an independent project derived from the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) core. Official T3 Tools installers, `t3.codes`, `app.t3.codes`, and T3 Code App Store / Google Play listings belong solely to T3 Tools, Inc. and do **not** distribute Sovereign.

## Requirements

- **Git** (on Windows, enable long paths with `git config --global core.longpaths true`)
- **[Vite+](https://viteplus.dev/guide/) (`vp`)**, which provides the pinned Node.js runtime from `package.json`:

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows (PowerShell)
irm https://vite.plus/ps1 | iex
```

- At least one installed, authenticated AI provider CLI or ACP agent before running real commercial tasks (you can launch Sovereign first and use `Replay (dev)` in development to explore the UI without an AI subscription).

## Install and Run from Source

```bash
vp i
vp run dev
```

Open the `pairingUrl:` printed in your terminal to authenticate your browser session.

### Dedicated State Directory (`SOVEREIGN_HOME`)

Set `SOVEREIGN_HOME` to isolate Sovereign's SQLite database (`statev2.sqlite`), secrets, and logs from any other local coding-agent installation:

```bash
export SOVEREIGN_HOME="$HOME/.sovereign"
```

```powershell
$env:SOVEREIGN_HOME = "$HOME\.sovereign"
```

When `SOVEREIGN_HOME` is unset, Sovereign falls back to `T3CODE_HOME` or the standard development state directory. Never point a dev checkout at a live `~/.t3/userdata` database.

### Production Server Build

```bash
vp run build
node apps/server/dist/bin.mjs serve
```

Generate a pairing URL for browsers or mobile clients with:

```bash
node apps/server/dist/bin.mjs pair
```

## Command-Line Interface (`t3` Compatibility)

Sovereign preserves the `t3` CLI entry point (`apps/server/dist/bin.mjs`) for compatibility with existing scripts and OS background service tooling:

| Task                                        | Command                                                   |
| ------------------------------------------- | --------------------------------------------------------- |
| Start the server and open the web app       | `t3`                                                      |
| Start the server without opening a browser  | `t3 serve`                                                |
| Print a one-time pairing URL                | `t3 pair`                                                 |
| Configure LAN / remote access               | `t3 up` ([details](./remote-access.md))                   |
| Install and run as an OS background service | `t3 service install` ([details](./background-service.md)) |
| Check service status and log path           | `t3 service status`                                       |
| Restart background service                  | `t3 service restart`                                      |
| Reclaim SQLite database space               | `t3 doctor`                                               |
| Remove background service                   | `t3 service uninstall`                                    |

Run `t3 --help` (or `node apps/server/dist/bin.mjs --help`) for the full command reference.

> If you self-host Sovereign release artifacts, `scripts/install.sh` and `scripts/install.ps1` support `SOVEREIGN_REPO`, `SOVEREIGN_HOME`, and `SOVEREIGN_RELEASE_BASE_URL` overrides.

## Desktop App (Electron)

Run the desktop app in development:

```bash
vp run dev:desktop
```

Or build unsigned local desktop installers into `release/` (`Sovereign-<version>-<arch>.<ext>`):

```bash
vp run dist:desktop:dmg    # macOS
vp run dist:desktop:linux  # Linux (AppImage / .deb)
vp run dist:desktop:win    # Windows (NSIS)
```

See [Development & Desktop Artifacts](../operations/00_development.md#desktop-artifacts) for platform build prerequisites (Rust, C++ build tools, `libsecret` on Linux, Xcode CLT on macOS, Visual Studio Build Tools on Windows).

### Windows Subsystem for Linux (WSL)

In the desktop app, choose a WSL distro in **Settings → Sharing & access** to run agents and projects inside WSL. Install provider CLIs inside that WSL distro.

## Mobile App (React Native)

Sovereign's mobile client lives in `apps/mobile` (`com.sovereign.app`) and builds from source via Expo / React Native. See [`apps/mobile/README.md`](../../apps/mobile/README.md) and [Mobile Development Lifecycle](../internals/13_mobile-development.md) for local iOS Simulator and Android Emulator builds, then pair with your Sovereign server over LAN, Tailscale, or your own self-hosted relay.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment, enable the providers you want, and review each instance's **Billing Class** and **Provider Pool** settings ([Providers and Resource Pool](../sovereign/providers-and-pool.md)). Installation and sign-in happen on the machine hosting the Sovereign server.

| Provider            | Install and authenticate                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex               | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude              | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor              | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build          | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro                | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode            | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity         | Install and sign in with Google from Sovereign's provider settings.                                                                                       |
| Pi                  | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code           | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx                  | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |
| ACP Registry agents | Add GitHub Copilot CLI, Devin, or other [ACP agents](./providers-acp.md#add-an-agent) from **Settings → Providers → Add provider → Show more**.           |

Provider CLIs must be on the server's `PATH`, or configured via **Binary path** in provider settings. Cursor's executable is `cursor-agent` even though its login command is `agent login`.

You can add multiple instances of the same provider (for example, separate accounts or configurations) with independent environment variables, sensitive secret storage, pool priorities, and concurrency limits.

For provider-specific guides, see [Codex](./providers-codex.md), [Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), [Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md), [Pi](./providers-pi.md), [Muse Code](./providers-muse.md), [fx](./providers-fx.md), and [ACP Registry agents](./providers-acp.md).

### Provider check timeouts

If a provider works in its CLI but Sovereign reports a readiness probe timeout, increase the probe deadline in the server's environment (whole milliseconds up to `2147483647`):

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 node apps/server/dist/bin.mjs serve
```

For background services, put overrides in `service.env` under your `SOVEREIGN_HOME` (or `~/.t3`) and restart the service.

| Provider            | Environment variable                   |
| ------------------- | -------------------------------------- |
| Codex               | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude              | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor              | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity         | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok                | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro                | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx                  | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi                  | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code           | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode            | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry agents | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

## Next steps

- [Sovereign Quickstart](../sovereign/quickstart.md): configure your provider pool, create a venture, and run an objective.
- [Integrations](../sovereign/integrations.md): connect Stripe, Paddle, Resend, Vapi/Twilio, GitHub, Vercel, or Cloudflare.
- [Governance & Finance](../sovereign/governance-and-finance.md): review emergency stop, approval gates, and £0 default budgets.
- [Operations & Reliability](../sovereign/operations-and-reliability.md): run Sovereign continuously in the background.
