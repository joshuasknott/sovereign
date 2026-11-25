# Sovereign

Sovereign is an open-source, provider-agnostic Commercial Operating System built as a modular layer on top of the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) core runtime (`Copyright (c) 2026 T3 Tools Inc.`). A Node/Effect WebSocket server wraps coding-agent providers (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx, and ACP Registry agents), adds commercial orchestration, provider-pool routing, application-enforced governance, integrations, and a GBP-default financial ledger, and serves web, desktop, and mobile clients.

> **Independent project notice:** Sovereign is an independent project and is not affiliated with, endorsed by, or maintained by T3 Tools, Inc. Keep user-facing branding strictly Sovereign; never introduce T3 Code logos, wordmarks, `t3.codes` URLs, or T3 Tools credentials/identifiers. See [TRADEMARK.md](TRADEMARK.md).

## Core Principles

1. **Application-enforced governance, never prompt-only safety.** Emergency stop, £0 default spend caps, never-silent-paid-fallback, security bounty scope locks, UK PECR/GDPR consent checks, and AI identity disclosure must be enforced in server Effect services — never trusted to prompts or client UI alone.
2. **Honesty over fake metrics.** Never fabricate provider quota percentages, simulated revenue in verified financial totals, or fake "connected" integration states without real verification.
3. **Performance without compromise.** Avoid sending unbounded payloads over WebSockets, continuously repainting CSS animations, or unnecessary re-renders.
4. **Remote ready & multi-surface.** Support web, desktop (Electron), and mobile (React Native) via shared logic in `packages/client-runtime` and contracts in `packages/contracts`.
5. **Modular separation from upstream core.** Keep Sovereign commercial domain code inside `packages/contracts/src/sovereign/`, `packages/client-runtime/src/sovereign/`, `apps/server/src/sovereign/`, `apps/web/src/sovereign/`, and Sovereign pool files in `apps/server/src/provider/`. Preserve internal T3 Code runtime compatibility (`@t3tools/*` workspace scopes, `statev2.sqlite` core migrations, `WS_METHODS`, `t3` CLI compatibility) so upstream maintenance stays clean.

## Terminology

- **you** = the agent reading this file. **user / owner** = the operator running Sovereign. **agent** = coding or commercial agent running inside Sovereign.
- Sovereign domain terms: [docs/sovereign/architecture.md](docs/sovereign/architecture.md), [docs/sovereign/governance-and-finance.md](docs/sovereign/governance-and-finance.md).
- Core runtime terms (environment, project, thread, turn, provider, checkpoint): [docs/internals/00_glossary.md](docs/internals/00_glossary.md).

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine may run several dev servers at once. Kill only a PID you captured at spawn, or the verified owner of your own port.
2. **Writing to live userdata.** `~/.t3/userdata` (or an active `SOVEREIGN_HOME` live directory) may hold a real database in use while you work. Reading or copying from it is fine. Never start a dev server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks remote browsers.

## Hit every surface

Before calling frontend or cross-stack work done, walk this list and verify which entries apply:

- **Entry points.** Overview, Venture workspaces, Settings, command palette (`Cmd+K`), and keybindings.
- **Clients.** Web, desktop (Electron shell/IPC), and mobile (React Native). Shared logic lives in `packages/client-runtime`.
- **Providers.** Every provider adapter needs a decision (including billing classification and `usage_limit` detection where applicable), even if the decision is "not supported here".
- **Agents.** Capabilities a user triggers should be Effect service methods reachable by MCP tools (within least-privilege boundaries) and scheduled tasks, not inline handler code.
- **Contracts.** Wire changes go in `packages/contracts` so server, web, mobile, and desktop stay in lockstep.
- **Reverse states.** Every way in needs a way out and a way to see it (emergency stop on/off, venture pause/resume, snooze/unsnooze).
- **Connection modes.** Local, LAN/Tailscale, and self-hosted relay; multi-device and multi-environment.
- **Languages.** Translate user-facing copy in `apps/{web,desktop,mobile}/src/i18n/translations` (`vp run --filter <app> i18n:generate` / `vp run i18n:check`) and `apps/marketing/src/i18n`. See [14_i18n.md](docs/internals/14_i18n.md).
- **Docs.** Update [docs/sovereign/](docs/sovereign/) or `docs/internals/` if a documented invariant or path changes.

## Dev servers and test data

See [00_development.md](docs/operations/00_development.md) and [docs/sovereign/quickstart.md](docs/sovereign/quickstart.md) for setup, ports, `SOVEREIGN_HOME`, seeding (`vp run migrate-dev-db`), and reusable dev auth. Agent-specific rules:

- **Worktree setup:** Wait while `.t3/setup-running` names a live PID; do not run `vp i` concurrently. If no `.t3/setup-*` marker exists, run `vp i` yourself.
- **Process lifecycle:** Start dev servers, Metro, and builds from your own shell so they exit with your session—never detach with `systemd-run`, `nohup`, `setsid`, or `tmux` unless asked. Stop background tasks cleanly (`vp` does not always forward SIGTERM to child Vite/server processes).
- **Sharing (`vp run dev --share`):** Wait for `pairingUrl:` and hand the full URL to the user. Never wire `tailscale serve` by hand or consume the user's one-time pairing link. Mint another with `node apps/server/src/bin.ts pair` if needed.
- **Test data:** Always copy in (never symlink) and refresh `statev2.sqlite`, not `state.sqlite`.
- **Extra checkouts:** Put `git worktree add` next to this worktree, not in `/tmp`, and remove it when done.

## Verifying

- Before you push, run `vp run check:changed`. **Do not run repo-wide checks** (`vp check`, `vp run -r test`, `vp run -r typecheck`) unless asked—CI owns the full suite.
- Iterate with `vp test run <files>` (add `-t "<name>"` for large files), `vp lint <files>`, `vp fmt --check <files>`, and `vp run --filter <pkg> typecheck` (`effect-tsgo tsrs --noEmit`). Run `node -e` snippets from the owning package (`effect` does not resolve from repo root).
- Follow [15_testing.md](docs/internals/15_testing.md) for deterministic tests, draining async work (no sleeps/polling/real wall-clock waits; use `TestClock`), web browser tests (`await using screen = await render(...)`), and real-app scenarios.
- Give user-visible frontend changes an integrated pass in a real client using the free `Replay (dev)` provider unless the change depends on a real provider.

## Evals

`evals/` checks how real models behave with model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before changing that text, read [evals/README.md](evals/README.md) and run the relevant evals. Note also `apps/server/src/provider/AgentContextBudget.test.ts` when adding or editing MCP tools.

## Pull requests

- Never open a PR unless the user explicitly asks you to do so.
- Check `git remote get-url origin` before running forge commands.
- Use conventional commit titles in plain language: `fix(sovereign): enforce budget cap before proposal dispatch`.
- UI changes need before/after screenshots (uploaded to the PR, never committed as PR-only assets).

## Documentation

- `docs/sovereign/` holds Sovereign user, architectural, provider-pool, venture, integration, governance/finance, and operations documentation. Keep every documented path, command, and limitation verified against actual source files.
- `docs/internals/` preserves core runtime architectural decisions, trust boundaries, and cross-cutting traps. Avoid duplicating code catalogs that drift.
- `docs/operations/` holds maintainer setup, release, and debugging runbooks.
- Do not commit implementation plans, research notes, or agent scratch files inside the worktree.

## Where code lives

- `packages/contracts/src/sovereign/` — Sovereign Effect/Schema wire contracts, 36 `sovereign.*` RPCs, and auth scopes (`@t3tools/contracts/sovereign`).
- `packages/client-runtime/src/sovereign/` — Shared Sovereign query atoms, permission-gated commands, and Hermes-safe formatters.
- `apps/server/src/sovereign/` — Sovereign SQLite store (the Sovereign schema migration), Effect services (`Governance`, `Ledger`, `Sales`, `Integration`, `Orchestrator`), HTTP webhook routes, WS handlers, 13 built-in integration drivers (`integrations/`), and 7+ venture workflow engines (`ventures/`).
- `apps/server/src/provider/` — Provider adapters plus Sovereign `billingClassifier.ts`, `ProviderAvailabilityLedger.ts`, and `ProviderPoolRouter.ts`.
- `apps/server/src/mcp/toolkits/sovereign.ts` — Least-privilege 6-tool Sovereign MCP toolkit.
- `apps/web/src/sovereign/` — 3-area Sovereign web UI (Overview, Venture Workspaces, Settings panels) and Obsidian/Alabaster Meridian atmosphere.
- `apps/desktop` — Electron wrapper (`com.sovereign.app`); `apps/mobile` — React Native app; `apps/marketing` — Astro site.
- `packages/shared` — Shared runtime utils and theme palettes (including `SOVEREIGN_THEME`), subpath exports, no barrel.
- `.repos/` — Vendored read-only references. Never edit or import from them.

### Documentation by area

| Area                                       | Read first                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sovereign Commercial OS                    | [docs/sovereign/architecture.md](docs/sovereign/architecture.md), [docs/sovereign/governance-and-finance.md](docs/sovereign/governance-and-finance.md)                                                   |
| Sovereign Provider Pool & Ventures         | [docs/sovereign/providers-and-pool.md](docs/sovereign/providers-and-pool.md), [docs/sovereign/ventures.md](docs/sovereign/ventures.md), [docs/sovereign/integrations.md](docs/sovereign/integrations.md) |
| Core architecture & orchestration          | [00_glossary.md](docs/internals/00_glossary.md), [01_architecture.md](docs/internals/01_architecture.md)                                                                                                 |
| Server Effect services & errors            | [02_effect-services.md](docs/internals/02_effect-services.md)                                                                                                                                            |
| Providers & ACP                            | [03_providers.md](docs/internals/03_providers.md)                                                                                                                                                        |
| Auth, MCP, guest links, assets, security   | [04_environment-auth.md](docs/internals/04_environment-auth.md), [SECURITY.md](SECURITY.md)                                                                                                              |
| Remote routes, peer links, previews        | [05_remote.md](docs/internals/05_remote.md)                                                                                                                                                              |
| Relay & cloud link                         | [06_t3-connect.md](docs/internals/06_t3-connect.md)                                                                                                                                                      |
| Server updates & crash recovery            | [07_server-updates.md](docs/internals/07_server-updates.md)                                                                                                                                              |
| Telemetry & analytics                      | [08_product-analytics.md](docs/internals/08_product-analytics.md)                                                                                                                                        |
| Client connection & sync runtime           | [09_connection-runtime.md](docs/internals/09_connection-runtime.md)                                                                                                                                      |
| Web UI primitives, styles & React Compiler | [10_web-ui.md](docs/internals/10_web-ui.md)                                                                                                                                                              |
| Mobile layout, navigation & dev lifecycle  | [11_mobile-layout.md](docs/internals/11_mobile-layout.md), [12_mobile-navigation.md](docs/internals/12_mobile-navigation.md), [13_mobile-development.md](docs/internals/13_mobile-development.md)        |
| Translations & UI copy                     | [14_i18n.md](docs/internals/14_i18n.md)                                                                                                                                                                  |
| Writing & reviewing tests                  | [15_testing.md](docs/internals/15_testing.md)                                                                                                                                                            |
| Wire budgets, server metrics & perf        | [16_performance-regressions.md](docs/internals/16_performance-regressions.md)                                                                                                                            |
| Repo & package scripts                     | [17_scripts.md](docs/internals/17_scripts.md)                                                                                                                                                            |

## Taste & Lint Constraints

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`, declare protected methods in `CLIENT_GUARDED_RPC_SCOPES`, and gate UI with `permissionAtom` (server stays authoritative). Keep raw RPC clients inside `rpc/`.
- Server features are Effect services using `Effect.fn("Service.operation")` with thin transport handlers and subpath imports (`effect/Effect`, `effect/Schema`, etc.); see [02_effect-services.md](docs/internals/02_effect-services.md).
- `apps/web/src/components/ui` exports own their look (`shadcn/no-restyle` enforces this); see [10_web-ui.md](docs/internals/10_web-ui.md).
- Custom `t3code/*` lint rules are active across the monorepo (including `no-untranslated-copy`, `no-em-dash-copy` in `apps/*/src` and `packages/*/src`, `no-manual-memo`, `no-low-value-comments`, `no-unreasoned-state-sync`, `prefer-effect-fn`, `prefer-catch-tags`, `namespace-node-imports`, and deterministic test rules).
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, external quirk, or invariant the code can't show (1–4 lines max).
- React effects are only for synchronizing with external systems; every remaining effect states its reason via `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- No continuously repainting animations; they peg the GPU on high-refresh displays.
- Read [SECURITY.md](SECURITY.md) before auditing or triaging security reports.
- Never edit `LICENSE` or third-party license files. Keep upstream T3 Code MIT attribution intact.
