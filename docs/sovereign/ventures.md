# Sovereign Ventures

Sovereign ships with **7 built-in venture blueprints** plus a **dynamic Custom Venture engine** so you can expand into new business models without restructuring the application or editing source code.

Key implementation files:

- Blueprints: [`apps/server/src/sovereign/SovereignBlueprints.ts`](../../apps/server/src/sovereign/SovereignBlueprints.ts)
- Workflow engine: [`apps/server/src/sovereign/ventures/VentureWorkflowEngine.ts`](../../apps/server/src/sovereign/ventures/VentureWorkflowEngine.ts)
- Venture modules: [`apps/server/src/sovereign/ventures/`](../../apps/server/src/sovereign/ventures/)
- UI workspaces: [`apps/web/src/sovereign/SovereignVenturePage.tsx`](../../apps/web/src/sovereign/SovereignVenturePage.tsx), [`VentureCommercialPanel.tsx`](../../apps/web/src/sovereign/VentureCommercialPanel.tsx), [`NewVentureDialog.tsx`](../../apps/web/src/sovereign/NewVentureDialog.tsx)

Every venture starts conservatively:

- **Monthly budget cap:** `£0.00` (`discretionarySpendAllowed: false`)
- **Paid provider fallback:** `deny`
- **External actions:** `require_approval` (and `deny` for `security_testing` and `paid_provider_fallback`)
- **Ledger isolation:** Pipeline estimates never inflate verified collected revenue.

---

## The 7 Initial Ventures

### 1. Development Bounties (`dev_bounties`)

- **Implementation:** [`apps/server/src/sovereign/ventures/devBounties.ts`](../../apps/server/src/sovereign/ventures/devBounties.ts) + [`integrations/githubDriver.ts`](../../apps/server/src/sovereign/integrations/githubDriver.ts)
- **Purpose:** Discover funded open-source/repository issues, verify contribution rules and AI-assistance policies, implement test-verified patches in isolated worktrees, and prepare pull requests for owner approval.
- **Key workflow methods:**
  - `evaluateBountyIssue` — Sanitizes untrusted issue/repo text via prompt-injection quarantine, checks `CONTRIBUTING.md` / repo policy (automatically disqualifying repos with `prohibited` AI policy), checks competing open PRs, scores expected value deterministically, and deduplicates via `(venture_id, external_id)`.
  - `planBountyExecution` — Creates a bounded dependent task pipeline (worktree analysis → implementation & tests → independent review → compliant PR draft) and gates external PR submission under `external_submission`.
  - `reconcileBountyPayout` — Records verified `collected_revenue` in the ledger and transitions the opportunity to `won`.
- **Default routing tier:** `reasoning` (tools required). **Typical integrations:** GitHub (`source_control`), Payments (`payments`).

### 2. Authorised Security Bug Bounties (`security_bounties`)

- **Implementation:** [`apps/server/src/sovereign/ventures/securityBounties.ts`](../../apps/server/src/sovereign/ventures/securityBounties.ts)
- **Purpose:** Strictly scope-bound vulnerability research on explicitly authorised bug bounty programmes, completely separate from Development Bounties.
- **Hard application-level scope lock:**
  - `security_testing` defaults to **`deny`** and `securityAuthorisation.authorised` defaults to **`false`**.
  - Before any assessment can proceed, the owner must explicitly record written programme authorisation, `targetScope` hosts/patterns, `permittedMethods`, and an active (non-expired) `expiresAt` timestamp in the venture's permission policy.
  - Out-of-scope targets, unpermitted methods, or expired authorisations are hard-denied in `SovereignGovernanceService.assertAndGateExternalAction` and logged to `sovereign_audit_events`. Prompt content cannot bypass this lock.
- **Key workflow methods:**
  - `registerSecurityProgramme` — Sanitizes programme policy text, detects automation bans, and persists scope, out-of-scope targets, permitted methods, and disclosure rules.
  - `executeAuthorisedSecurityAssessment` — Enforces the security authorisation lock before executing bounded in-scope work and recording evidence artifacts.
- **Default routing tier:** `frontier` (tools required).

### 3. Website & Software Agency (`web_agency`)

- **Implementation:** [`apps/server/src/sovereign/ventures/webAgency.ts`](../../apps/server/src/sovereign/ventures/webAgency.ts) + [`integrations/webResearchDriver.ts`](../../apps/server/src/sovereign/integrations/webResearchDriver.ts)
- **Purpose:** Manage inbound enquiries, lawful outreach, deterministic website audits, personalised demo/proposal drafting, staging previews, production deployments, and client invoicing.
- **Key workflow methods:**
  - `auditProspectAndQualify` — Evaluates prospect website signals (HTTPS, viewport, metadata, headings, asset weight) through the SSRF-protected and prompt-injection-sanitized web research pipeline, creating a qualified lead/opportunity.
  - `createPersonalisedDemoAndProposal` — Drafts line-item quotations and enforces `maxAutonomousQuoteMinor` (`£0` default) and `maxDiscountPct` (`0%` default), routing over-limit proposals to owner approval.
  - `sendPermittedOutreach` — Enforces UK PECR/GDPR lawful basis and opt-out checks, mandatory AI identity disclosure on AI-authored messages, and `customer_communication` / `marketing_campaign` approval gating.
  - `onboardAndFulfilOrder` — Converts an approved proposal into an order, bounded delivery tasks, staging review, approval-gated `production_deployment`, and client invoice.
- **Default routing tier:** `balanced`. **Typical integrations:** Email (`resend` / `smtp`), Payments (`stripe` / `paddle`), Hosting (`vercel` / `cloudflare`), GitHub.

### 4. Voice AI & Customer Support (`voice_ai`)

- **Implementation:** [`apps/server/src/sovereign/ventures/voiceAi.ts`](../../apps/server/src/sovereign/ventures/voiceAi.ts) + [`integrations/voiceDrivers.ts`](../../apps/server/src/sovereign/integrations/voiceDrivers.ts)
- **Purpose:** Configure and operate transparent AI receptionists and customer support voice agents across vendor-agnostic telephony/voice providers (**Vapi**, **Retell AI**, **ElevenLabs**, **Twilio**).
- **Mandatory compliance & cost controls:**
  - Active voice agents must configure a non-empty `aiDisclosureGreeting`, honour `recordingDisclosureEnabled`, support `optOutPhraseEnabled`, and define a human escalation path (`escalationNumberLabel`).
  - Live voice calls incur **per-minute external marginal costs** (telephony + voice synthesis/realtime inference + LLM minutes). Sovereign explicitly estimates and logs these as `telephony_cost` entries in the ledger rather than hiding them.
- **Key workflow methods:**
  - `configureVoiceAgent` — Validates disclosure/opt-out/escalation compliance and persists the voice agent configuration.
  - `handleVoiceInteraction` — Logs inbound/outbound call events, handles caller opt-out or human escalation into support tickets, and records per-minute cost accounting.
- **Default routing tier:** `fast`. **Typical integrations:** Telephony/Voice (`vapi`, `retell`, `elevenlabs`, `twilio`), Payments, Email.

### 5. Paid Tasks & Online Work (`paid_tasks`)

- **Implementation:** [`apps/server/src/sovereign/ventures/paidTasks.ts`](../../apps/server/src/sovereign/ventures/paidTasks.ts)
- **Purpose:** Screen freelance and online micro/specialist work while strictly enforcing platform Terms of Service and forbidding human impersonation.
- **Key workflow methods:**
  - `classifyAndIngestOnlineWork` — Classifies every task offer by `aiPermissionStatus` (`permitted`, `disclosure_required`, `prohibited`, `unknown`) and `automationMode` (`autonomous_within_policy`, `assisted`, `human_required`). Tasks prohibiting AI assistance or requiring human identity verification/CAPTCHAs are automatically marked `ineligible` or routed to the human-only queue — never impersonated or bypassed.
  - `partitionWorkQueues` — Separates work into `automatedPermitted`, `assistedReview`, `humanRequired`, and `ineligible` queues and tracks net hourly return.
- **Default routing tier:** `fast`. `account_modification` and `financial_expenditure` default to `deny`.

### 6. Digital Products (`digital_products`)

- **Implementation:** [`apps/server/src/sovereign/ventures/digitalProducts.ts`](../../apps/server/src/sovereign/ventures/digitalProducts.ts)
- **Purpose:** Validate buyer demand _before_ investing engineering time, package templates/tools/guides, and publish to connected storefronts (**Gumroad**, **Lemon Squeezy**, **Stripe**, **Paddle**) after owner approval.
- **Key workflow methods:**
  - `validateProductDemand` — Gates production on structured demand evidence before creating build tasks.
  - `buildAndPackageProduct` — Creates bounded asset-production, documentation, and licensing-check tasks plus deliverable artifacts.
  - `prepareStorefrontListing` — Drafts pricing and listing metadata and gates publication under `external_submission` / `production_deployment`. Storefront and payment processor fees are tracked separately in the ledger.
- **Default routing tier:** `balanced`.

### 7. Micro-SaaS Studio (`micro_saas`)

- **Implementation:** [`apps/server/src/sovereign/ventures/microSaas.ts`](../../apps/server/src/sovereign/ventures/microSaas.ts)
- **Purpose:** Validate willingness to pay before building, ship lean subscription web applications, track verified MRR, hosting/email costs, and churn, and gate production deployments and billing plan changes.
- **Key workflow methods:**
  - `validateWillingnessToPay` — Enforces willingness-to-pay validation before entering full engineering.
  - `launchMicroSaasPipeline` — Sets up engineering, staging, approval-gated `production_deployment`, and `payment_processing` webhook reconciliation tasks.
  - `evaluateProductPortfolioHealth` — Computes verified MRR, unit-economics margin (verified revenue minus hosting/deployment/email/payment fees), and support ticket load.
- **Default routing tier:** `reasoning`.

---

## Dynamic Custom Ventures (No App Restructuring Required)

Sovereign is not locked to the 7 initial blueprints. Any new commercial model can be created dynamically at runtime:

- **Via UI:** Open **New Venture** (`NewVentureDialog`) and choose **Custom Venture** (`kind: "custom"`), configuring any combination of UI modules (`operations`, `prospects_sales`, `finances`, `workspace_conversations`, `approvals`, `artifacts`, etc.), routing policy, budget cap, and permission policy.
- **Via Objective Discovery Engine ([`customVenture.ts`](../../apps/server/src/sovereign/ventures/customVenture.ts)):**
  - `proposeNewVenturesFromObjective(directive, availablePoolSnapshot?)` evaluates your commercial objective and available provider pool capacity (e.g. zero-upfront-cost audit packs, API integration retainers, compliance playbooks) and returns scored `DynamicVentureProposal` candidates with recommended UI modules, workflow stages, and conservative default guardrails.
  - `instantiateDynamicVenture(proposal)` gates creation through `SovereignGovernanceService.assertAndGateExternalAction({ category: "new_venture_creation" })`, persists the venture with its `templateKey` and modules, and creates initial bounded validation tasks — immediately rendering a full workspace in the sidebar and Overview with zero code changes.

## Opt-In Sandbox Commercial Fixtures

Sovereign's default database starts completely empty. For offline demonstrations or testing the UI without connecting real accounts, [`apps/server/src/sovereign/ventures/sandboxFixtures.ts`](../../apps/server/src/sovereign/ventures/sandboxFixtures.ts) provides an explicit opt-in `loadSandboxCommercialFixture()` method. Every seeded record is clearly tagged `[Simulated]` and every seeded ledger entry uses `verificationState: "simulated_fixture"` so simulated figures **never** mix into verified real GBP revenue or net profit totals.
