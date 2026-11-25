# Development

This runbook covers building, running, testing, and packaging **Sovereign** locally.

## First checkout

Install [Vite+](https://viteplus.dev/guide/) (`vp` provides the pinned Node.js version from `package.json`):

```sh
curl -fsSL https://vite.plus | bash
# Windows PowerShell: irm https://vite.plus/ps1 | iex
```

On Windows, clone with long paths enabled so `.repos/` checks out cleanly:

```powershell
git clone -c core.longpaths=true <your-sovereign-repo-url>
```

From the repository root:

```sh
vp i
vp run dev
```

Open the `pairingUrl:` printed by the dev runner (the bare origin does not authenticate a new browser). Prefer a container? See [Dev container](./01_devcontainer.md).

## Running dev servers

- `vp run dev` (server + web), `vp run dev:desktop` (Electron), `vp run dev:server`, `vp run dev:web`. See [apps/mobile/README.md](../../apps/mobile/README.md) for mobile.
- Pass flags directly after the task name (e.g. `vp run dev --home-dir /tmp/sovereign-dev`, `--browser`).
- **State and ports:** Set `SOVEREIGN_HOME` to keep Sovereign state isolated from any other local install (`resolveConfiguredHomeDir` checks `SOVEREIGN_HOME` first, then `T3CODE_HOME`). Linked worktrees default to `<worktree>/.t3/userdata` and plain clones default to `~/.t3/dev`. Never point a dev server at a live `~/.t3/userdata` database. Read actual ports from `[dev-runner]` output (`T3CODE_PORT_OFFSET` / `T3CODE_DEV_INSTANCE` override).
- **Resource monitor:** First start builds `native/resource-monitor` via Cargo when missing; without Rust, dev starts without process telemetry.
- **Sharing:** `vp run dev --share` exposes the web port over Tailscale and prints a pairing URL. Add `--built` to serve `apps/web/dist` via `vp build --watch` (no HMR, faster over slow links). Never set `VITE_HTTP_URL` or `VITE_WS_URL` in dev — Vite proxies `/api` and `/ws` single-origin.
- **Startup profiling:** `vp run profile:startup` captures the first 20 s of Node processes under `.t3/startup-profiles/<timestamp>`.

### Replay provider

`vp run dev` automatically registers `Replay (dev)` ([dev-replay-agent.ts](../../apps/server/scripts/dev-replay-agent.ts)), a local ACP agent classified as `free` in the Sovereign provider pool that streams recorded transcripts without calling a paid model. Add scenarios under `SCENARIOS` pointing at an ACP fixture (`registry_transcript.ndjson`) or a file in `apps/server/scripts/dev-replay`.

### Reusable dev credential

Only use this on a hostname where you trust every service (browsers share cookies across ports on the same hostname). Generate one secret once and put it in your gitignored `.env`:

```sh
openssl rand -hex 32
# Add to .env: T3CODE_DEV_AUTH_TOKEN=<value>
```

Restart `vp run dev --share` and open its printed pairing URL once per browser profile. Never commit or publish the token or startup URLs. Desktop and non-dev servers ignore it; see [environment auth](../internals/04_environment-auth.md#reusable-dev-credential).

## Checks & Sovereign Test Suites

- `vp run check:changed` — Fast branch gate (format, lint, knip, affected typechecks, nearby tests, and React Compiler coverage).
- Focused iteration:
  - `vp test run <files>`
  - `vp lint <files>`
  - `vp fmt --check <files>`
  - `vp run --filter <pkg> typecheck` (or `effect-tsgo tsrs -p <pkg>/tsconfig.json --noEmit`)
  - `vp run icons:check` (verifies all 36 exported Sovereign brand icons match SVG masters)
  - `vp run licenses:sync` (regenerates third-party license manifests including upstream T3 Code MIT notice)
  - `vp run knip:check`, `vp run lint:mobile`
- Core Sovereign offline test suites (zero paid API calls):
  - `packages/contracts/src/sovereign/sovereign.test.ts`
  - `packages/client-runtime/src/sovereign/sovereign.test.ts`
  - `apps/server/src/provider/billingClassifier.test.ts` & `ProviderPoolRouter.test.ts`
  - `apps/server/src/sovereign/SovereignCore.test.ts`
  - `apps/server/src/sovereign/integrations/IntegrationsHub.test.ts`
  - `apps/server/src/sovereign/ventures/VentureWorkflowEngine.test.ts`
  - `apps/web/src/sovereign/sovereignUi.test.ts`
- `apps/web` uses real Chromium (`*.browser.test.{ts,tsx}`) for DOM/React tests (no jsdom) and Node for `*.test.ts`.
- Typechecking uses `effect-tsgo tsrs --noEmit` (`@effect/tsgo`), not `typescript` (except `apps/marketing` for Astro). On Windows, open the workspace through WSL if using VS Code's `.vscode/tsdk/tsgo`.

## Desktop artifacts

Unsigned local builds write `Sovereign-${version}-${arch}.${ext}` to `release/`:

```sh
vp run dist:desktop:dmg
vp run dist:desktop:linux
vp run dist:desktop:win
# Linux ARM64: vp run dist:desktop:artifact --platform linux --target AppImage --arch arm64
```

Run `vp run dist:desktop:artifact --help` for `--arch`, `--signed`, and `--keep-stage`.

### Linux AppImage prerequisites

Build on Linux (the browser-secret helper links against `libsecret`). Install Rust stable (`rustup`), C/C++ build tools, `libsecret` dev headers, `pkg-config`, ImageMagick, and Electron runtime libs (`gtk3`, `nss`, `alsa`, `gbm`):

```sh
# Ubuntu 24.04 / Debian 13 (on 22.04/Debian 12 use libgtk-3-0 and libasound2)
sudo apt-get install build-essential libsecret-1-dev pkg-config imagemagick libgtk-3-0t64 libnss3 libasound2t64 libgbm1

# Fedora
sudo dnf install gcc gcc-c++ make libsecret-devel pkgconf-pkg-config ImageMagick gtk3 nss alsa-lib mesa-libgbm

# Arch
sudo pacman -S base-devel libsecret pkgconf imagemagick gtk3 nss alsa-lib mesa
```

### macOS DMG prerequisites

Install Xcode Command Line Tools (`xcode-select --install`) and Rust. For cross-arch/universal builds:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Windows installer prerequisites

Install Rust, Python 3, and Visual Studio Build Tools (**Desktop development with C++**, Windows SDK, MSVC build tools, Spectre-mitigated libraries), then add the Rust target:

```powershell
rustup target add x86_64-pc-windows-msvc   # or aarch64-pc-windows-msvc
```

WSL support also requires passing the Linux CLI archive via `--wsl-runtime`; see [release runbook](./03_release.md#windows-payload-topology-and-update-validation). For signing and macOS passkeys with your own Apple Developer team, see [release](./03_release.md) and [Connect setup](./02_connect-setup.md#desktop-passkeys).
