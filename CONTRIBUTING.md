# Contributing to Sovereign

Thank you for your interest in contributing to **Sovereign**.

Sovereign is an independent, open-source Commercial Operating System built on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) core runtime (`Copyright (c) 2026 T3 Tools Inc.`). Sovereign is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

## What makes a strong contribution

- **Focused bug fixes and reliability improvements:** Reproducible defects in Sovereign orchestration, provider-pool routing, webhook verification, ledger accounting, crash recovery, or UI ergonomics.
- **New integration drivers or venture capabilities:** Pluggable `SovereignIntegrationDriver` implementations (`apps/server/src/sovereign/integrations/`) or venture workflow improvements (`apps/server/src/sovereign/ventures/`) with deterministic offline test coverage.
- **Governance and security hardening:** Tighter boundary enforcement, SSRF/prompt-injection protections, or compliance checks (report vulnerabilities privately first — see [SECURITY.md](./SECURITY.md)).
- **Documentation accuracy:** Keeping [docs/sovereign/](./docs/sovereign/) and setup guides aligned with actual code.

## Before you open a pull request

1. **One problem per PR.** Keep changes scoped to a single cohesive fix or feature across contracts, server, client-runtime, UI, tests, and docs.
2. **Respect Sovereign's invariants:**
   - Never bypass application-enforced governance (`SovereignGovernanceService.assertAndGateExternalAction`), emergency stop, £0 default budgets, never-silent-paid-fallback, or security bounty scope locks.
   - Never fabricate quota telemetry, verified financial totals, or live third-party connectivity.
   - Never commit API keys, secrets, webhook signing secrets, or live user databases.
   - Never introduce T3 Code logos, wordmarks, `t3.codes` endpoints, or T3 Tools credentials; preserve upstream MIT license and plain-text attribution (see [TRADEMARK.md](./TRADEMARK.md)).
3. **Read [AGENTS.md](./AGENTS.md)** and the relevant internal doc before modifying core areas (Effect services, Web UI, i18n, testing).
4. **Show proof that it works:**
   - Add deterministic offline unit/integration tests using `TestClock` and mock HTTP transports (zero sleeps, zero paid API calls in CI).
   - Run `vp run check:changed` before pushing.
   - For UI changes, attach before/after screenshots to the PR description (do not commit PR-only screenshots into the repository).

## Local development setup

See [docs/sovereign/quickstart.md](./docs/sovereign/quickstart.md) and [docs/operations/00_development.md](./docs/operations/00_development.md) to install `vp`, configure an isolated `SOVEREIGN_HOME`, and run the local server and clients.

## Upstream contributions & branding

If you discover a bug that originates purely in the upstream T3 Code runtime and wish to contribute it upstream, follow upstream's own contribution policy at [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code).

If you fork or redistribute Sovereign, preserve the MIT [LICENSE](./LICENSE) (including the upstream `Copyright (c) 2026 T3 Tools Inc.` notice) and comply with [TRADEMARK.md](./TRADEMARK.md).
