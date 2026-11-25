# Sovereign Documentation

Sovereign is an independent, provider-agnostic Commercial Operating System built on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) runtime (`Copyright (c) 2026 T3 Tools Inc.`). Sovereign is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

## Sovereign Guides

- [Quickstart](./sovereign/quickstart.md) — Install from source, configure `SOVEREIGN_HOME`, add AI subscriptions, and run your first venture objective
- [Architecture](./sovereign/architecture.md) — Modular Sovereign layer, the Sovereign schema migration, Effect services, WebSocket RPC, webhooks, MCP toolkit, and 3-area UI
- [Providers & Resource Pool](./sovereign/providers-and-pool.md) — Supported drivers & ACP agents, billing classification, honest quota reporting, never-silent-paid-fallback, and cooldown failover
- [Ventures](./sovereign/ventures.md) — All 7 initial ventures (Dev Bounties, Authorised Security Bounties, Web Agency, Voice AI, Paid Tasks, Digital Products, Micro-SaaS) plus dynamic custom ventures
- [Integrations](./sovereign/integrations.md) — Payments, Email, Voice/Telephony, GitHub, Hosting/Storefronts, HMAC webhooks, sandbox mode, and credential isolation
- [Governance & Finance](./sovereign/governance-and-finance.md) — Application-enforced permissions, global emergency stop, security scope lock, prompt-injection quarantine, UK PECR/GDPR compliance, and GBP ledger
- [Operations & Reliability](./sovereign/operations-and-reliability.md) — Background daemon service, remote connectivity, crash recovery, troubleshooting, testing, and known limitations

---

## Core Workspace & Provider Guides

These guides cover the underlying agent workspace, provider CLI setup, terminals, git worktrees, secrets, and remote pairing inherited from the T3 Code runtime:

- [Install & CLI setup](./user/install.md)
- [Messages and context](./user/composer.md)
- [Working with threads](./user/thread-sidebar.md)
- [Permission modes](./user/permission-modes.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Project settings](./user/project-settings.md)
- [Projects with several repositories](./user/multi-repo-projects.md)
- [Appearance and themes](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Voice input](./user/voice-input.md)
- [Text generation models](./user/text-generation.md)
- [SnapShots](./user/snap-shot.md)
- [Visual replies](./user/html-renders.md)
- [Import browser sessions](./user/browser-import.md)
- [Devices](./user/devices.md)
- [Usage and limits](./user/usage.md)
- [Secrets](./user/secrets.md)
- [Remote access](./user/remote-access.md)
- [Guest links](./user/guest-links.md)
- [Outside agents (MCP)](./user/outside-agents.md)
- [Running in the background](./user/background-service.md)
- [Provider guides](./user/install.md#providers): [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) · [OpenCode](./user/providers-opencode.md) · [Antigravity](./user/providers-antigravity.md) · [Kiro](./user/providers-kiro.md) · [Pi](./user/providers-pi.md) · [Muse Code](./user/providers-muse.md) · [fx](./user/providers-fx.md) · [ACP Registry](./user/providers-acp.md)

---

## Developing Sovereign

Start with the [development runbook](./operations/00_development.md), [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and [TRADEMARK.md](../TRADEMARK.md).

### Core Runtime Internals (in reading order)

These upstream technical internals document the runtime foundations Sovereign extends:

- [00 · Glossary](./internals/00_glossary.md)
- [01 · Architecture](./internals/01_architecture.md)
- [02 · Effect services](./internals/02_effect-services.md)
- [03 · Providers](./internals/03_providers.md)
- [04 · Environment auth](./internals/04_environment-auth.md)
- [05 · Remote environments](./internals/05_remote.md)
- [06 · Relay & cloud link](./internals/06_t3-connect.md)
- [07 · Server updates](./internals/07_server-updates.md)
- [08 · Product analytics](./internals/08_product-analytics.md)
- [09 · Connection runtime](./internals/09_connection-runtime.md)
- [10 · Web UI](./internals/10_web-ui.md)
- [11 · Mobile layout](./internals/11_mobile-layout.md)
- [12 · Mobile navigation](./internals/12_mobile-navigation.md)
- [13 · Mobile development lifecycle](./internals/13_mobile-development.md)
- [14 · Translating the UI (i18n)](./internals/14_i18n.md)
- [15 · Testing](./internals/15_testing.md)
- [16 · Performance regression checks](./internals/16_performance-regressions.md)
- [17 · Scripts](./internals/17_scripts.md)

### Operations Runbooks

- [00 · Development and local builds](./operations/00_development.md)
- [01 · Dev container](./operations/01_devcontainer.md)
- [02 · Relay & passkey setup](./operations/02_connect-setup.md)
- [03 · Release](./operations/03_release.md)
- [04 · Observability](./operations/04_observability.md)
- [05 · Relay observability](./operations/05_relay-observability.md)
