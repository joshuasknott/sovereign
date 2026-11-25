# Governance, Compliance, and Financial Controls

Sovereign treats AI agents as untrusted actors operating inside **application-enforced boundaries**, never relying on prompt instructions alone to prevent unauthorised spend, outreach, deployments, or security testing.

Key implementation files:

- Contracts: [`packages/contracts/src/sovereign/governance.ts`](../../packages/contracts/src/sovereign/governance.ts), [`packages/contracts/src/sovereign/ledger.ts`](../../packages/contracts/src/sovereign/ledger.ts), [`packages/contracts/src/sovereign/sales.ts`](../../packages/contracts/src/sovereign/sales.ts)
- Server services: [`apps/server/src/sovereign/SovereignGovernanceService.ts`](../../apps/server/src/sovereign/SovereignGovernanceService.ts), [`SovereignLedgerService.ts`](../../apps/server/src/sovereign/SovereignLedgerService.ts), [`SovereignSalesService.ts`](../../apps/server/src/sovereign/SovereignSalesService.ts)

---

## 1. Application-Enforced Permission Boundaries

Every side-effecting commercial operation passes through `SovereignGovernanceService.assertAndGateExternalAction`. Sovereign classifies external actions into **13 explicit categories** (`ExternalActionCategory`), each set to `deny`, `require_approval`, or `preapproved`:

| Category                 | Default mode       | Risk level |
| ------------------------ | ------------------ | ---------- |
| `security_testing`       | **`deny`**         | `critical` |
| `paid_provider_fallback` | **`deny`**         | `high`     |
| `production_deployment`  | `require_approval` | `critical` |
| `account_modification`   | `require_approval` | `critical` |
| `financial_expenditure`  | `require_approval` | `high`     |
| `payment_processing`     | `require_approval` | `high`     |
| `contractual_commitment` | `require_approval` | `high`     |
| `refund`                 | `require_approval` | `high`     |
| `customer_communication` | `require_approval` | `medium`   |
| `marketing_campaign`     | `require_approval` | `medium`   |
| `external_submission`    | `require_approval` | `medium`   |
| `personal_data`          | `require_approval` | `medium`   |
| `new_venture_creation`   | `require_approval` | `medium`   |

When an action requires approval, Sovereign creates an idempotent `ApprovalRequest`, transitions the linked `CommercialTask` to `waiting_approval`, records an `approval_requested` audit event, and pauses execution until an authorised user with `sovereign:approve` calls `sovereign.decideApproval`. Approving atomically moves the task back to `ready` (and can optionally create a bounded `PreapprovalPolicy` with single-action cap, monthly aggregate cap, allowed targets, and expiration timestamp); rejecting moves the task to `blocked`.

## 2. Global Emergency Stop & Venture Pause

- **Global Emergency Stop (`sovereign.triggerEmergencyStop`, requires `sovereign:admin`):**
  - Persists `emergency_stop_active = 1` in `sovereign_control_state` (survives server restarts).
  - Immediately pauses all active tasks across every venture in a single SQLite transaction.
  - Blocks all calls to `assertAndGateExternalAction` and rejects approval approvals (`emergency_stop_active`) until the owner explicitly clears the stop.
  - Visible in the sidebar status indicator, emergency stop banner, and **Settings → Governance**.
- **Venture Pause (`status: "paused"` or `"archived"`):**
  - Halts all external actions for that single venture without affecting other ventures.

## 3. Security Bounty Explicit Scope Authorisation Lock

For `security_testing` actions, Sovereign enforces an application-level lock independent of venture action modes:

1. `venture.permissionPolicy.securityAuthorisation.authorised` must be `true` (defaults to `false`).
2. `expiresAt` (if set) must be in the future.
3. The target host/URL must match an explicit entry in `targetScope` (exact host, `*.domain` wildcard, or URL prefix).
4. The testing `method` must appear in `permittedMethods`.

Failure on any check throws `SovereignPermissionError` (`code: "security_unauthorised"`) and appends a `permission_denied` event to `sovereign_audit_events`.

## 4. Prompt-Injection Quarantine

Untrusted external text (GitHub issues, `CONTRIBUTING.md`, scraped prospect websites, security programme descriptions) passes through `SovereignGovernanceService.sanitizeUntrustedContent` (enabled by default via `promptInjectionGuardEnabled: true`):

- Detects six rule classes: `instruction_override`, `policy_bypass`, `secret_exfiltration`, `unauthorised_financial_action`, `unauthorised_execution`, and `control_delimiter` (`<|system|>`, `### SYSTEM`, `[SYSTEM]`, control chars).
- Strips control delimiters, marks the content `quarantined: true`, and appends a `prompt_injection_quarantined` audit event.
- Even if adversarial text slips past text heuristics, agents still cannot self-approve actions, bypass budget caps, unlock security scope, or read server secrets because those controls live in server-side Effect services, not prompts.

## 5. UK PECR / GDPR Consent & AI Transparency Disclosure

Implemented across `SovereignSalesService`, `emailDrivers.ts`, and `voiceDrivers.ts`:

- **Opt-out & consent:** Outbound communications check `ConsentRecord` entries per channel (`email`, `phone`, `sms`, `messaging`, `voice_recording`). Any opted-out or withdrawn record immediately fails with `consent_required`; missing granted consent with a valid lawful basis blocks outbound sending.
- **Mandatory AI identity disclosure:** Any `ai_agent` communication must carry `aiDisclosed: true`. Resend and SMTP drivers enforce disclosure headers/footers and an explicit unsubscribe/opt-out instruction. Active voice agents must configure `aiDisclosureGreeting`, support recording disclosure, and honour caller opt-out or human escalation.
- **No human impersonation:** Paid task workflows automatically disqualify opportunities whose platform rules forbid AI assistance or require human verification.

## 6. Financial Ledger, GBP Default & Budget Caps

- **Reporting currency:** Defaults to **GBP (`£`)**, stored in integer minor units (`pence`) to prevent floating-point rounding drift. Multi-currency entries convert to GBP using `fxRatesToGbp` (`{ GBP: 1, USD: 0.79, EUR: 0.86 }` seeded defaults, configurable via `sovereign.updateControlState`).
- **£0.00 default spend budget:** Both `globalMonthlyBudgetMinor` and every venture's `budgetPolicy.monthlyCapMinor` default to **`0`** (`£0.00`), and `discretionarySpendAllowed` defaults to **`false`**. Any non-zero expenditure is blocked (`budget_exceeded`) until the owner explicitly enables discretionary spend and raises both the venture cap and global monthly cap.
- **Append-only & idempotent:** `sovereign_ledger_entries` records `collected_revenue`, `confirmed_expense`, `payment_fee`, `inference_cost`, `hosting_cost`, `deployment_cost`, `telephony_cost`, `subscription_allocation`, `refund`, and `adjustment`. Unique `external_ref` prevents duplicate booking from retried webhooks.
- **Strict verification separation (`FinancialPipelineMetrics`):**
  - **Verified real totals (`verificationState: "verified"`):** `collectedRevenueMinor`, `confirmedExpensesMinor`, `paymentFeesMinor`, `refundsMinor`, `netProfitMinor`, `monthlyRecurringRevenueMinor`.
  - **Pipeline estimates (never added to verified revenue):** `discoveredOpportunityValueMinor`, `proposedQuotationsMinor`, `acceptedOrdersMinor`, `outstandingInvoicesMinor`.
  - **Pending reconciliation (`pending_reconciliation`):** Tracked in separate pending fields until confirmed.
  - **Simulated fixtures (`simulated_fixture`):** Tracked strictly in `simulatedRevenueMinor` and `simulatedExpensesMinor`; excluded from verified commercial totals and net profit.
