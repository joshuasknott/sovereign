import type {
  AiPermissionStatus,
  AutomationMode,
  CommercialArtifactKind,
  CommercialTaskStatus,
  ConsentChannel,
  EligibilityStatus,
  IntegrationCategory,
  IntegrationProviderKind,
  IntegrationStatus,
  LedgerEntryType,
  LedgerVerificationState,
  OpportunityStage,
  TaskComplexity,
  VentureStatus,
  VoiceAgentDirection,
} from "@t3tools/contracts";
import { msg } from "gt-react";

export const ARTIFACT_KIND_LABELS = {
  code_patch: msg("Code Patch"),
  pull_request: msg("Pull Request"),
  security_report: msg("Security Report"),
  proposal_document: msg("Proposal Document"),
  website_preview: msg("Website Preview"),
  voice_script: msg("Voice Script"),
  digital_asset: msg("Digital Asset"),
  invoice_pdf: msg("Invoice PDF"),
  research_brief: msg("Research Brief"),
  audit_bundle: msg("Audit Bundle"),
  other: msg("Other", { $context: "deliverable artifact kind" }),
} satisfies Record<CommercialArtifactKind, string>;

export const LEDGER_ENTRY_TYPE_LABELS = {
  collected_revenue: msg("Collected Revenue"),
  confirmed_expense: msg("Confirmed Expense"),
  payment_fee: msg("Payment Fee"),
  inference_cost: msg("Inference Cost"),
  hosting_cost: msg("Hosting Cost"),
  deployment_cost: msg("Deployment Cost"),
  telephony_cost: msg("Telephony Cost"),
  subscription_allocation: msg("Subscription Allocation"),
  refund: msg("Refund", { $context: "financial ledger entry type" }),
  adjustment: msg("Adjustment", { $context: "financial ledger entry type" }),
} satisfies Record<LedgerEntryType, string>;

export const LEDGER_VERIFICATION_STATE_LABELS = {
  verified: msg("Verified", { $context: "ledger verification state" }),
  pending_reconciliation: msg("Pending Reconciliation"),
  simulated_fixture: msg("Simulated Fixture"),
} satisfies Record<LedgerVerificationState, string>;

export const AI_PERMISSION_STATUS_LABELS = {
  permitted: msg("AI Permitted"),
  prohibited: msg("AI Prohibited"),
  unknown: msg("Unknown", { $context: "AI permission policy status" }),
} satisfies Record<AiPermissionStatus, string>;

export const INTEGRATION_PROVIDER_LABELS = {
  stripe: msg("Stripe"),
  paddle: msg("Paddle"),
  lemonsqueezy: msg("Lemon Squeezy"),
  resend: msg("Resend"),
  smtp: msg("SMTP"),
  twilio: msg("Twilio"),
  vapi: msg("Vapi"),
  retell: msg("Retell AI"),
  elevenlabs: msg("ElevenLabs"),
  github: msg("GitHub"),
  vercel: msg("Vercel"),
  cloudflare: msg("Cloudflare"),
  gumroad: msg("Gumroad"),
  webhook: msg("Webhook"),
  custom: msg("Custom", { $context: "integration provider" }),
} satisfies Record<IntegrationProviderKind, string>;

export const INTEGRATION_STATUS_LABELS = {
  unconfigured: msg("Unconfigured"),
  configured: msg("Configured"),
  connected: msg("Connected"),
  error: msg("Error", { $context: "integration connection status" }),
  disabled: msg("Disabled"),
} satisfies Record<IntegrationStatus, string>;

export const INTEGRATION_CATEGORY_LABELS = {
  payments: msg("Payments"),
  email: msg("Email"),
  telephony_voice: msg("Telephony & Voice"),
  source_control: msg("Source Control"),
  hosting_deployment: msg("Hosting & Deployment"),
  commerce: msg("Commerce"),
  webhook: msg("Webhook"),
  custom: msg("Custom", { $context: "integration category" }),
} satisfies Record<IntegrationCategory, string>;

export const TASK_COMPLEXITY_LABELS = {
  trivial: msg("Trivial"),
  low: msg("Low", { $context: "task complexity" }),
  medium: msg("Medium", { $context: "task complexity" }),
  high: msg("High", { $context: "task complexity" }),
  frontier: msg("Frontier"),
} satisfies Record<TaskComplexity, string>;

export const TASK_STATUS_LABELS = {
  queued: msg("Queued"),
  ready: msg("Ready"),
  in_progress: msg("In Progress"),
  waiting_approval: msg("Waiting Approval"),
  blocked: msg("Blocked"),
  completed: msg("Completed"),
  failed: msg("Failed"),
  cancelled: msg("Cancelled"),
} satisfies Record<CommercialTaskStatus, string>;

export const OPPORTUNITY_STAGE_LABELS = {
  discovered: msg("Discovered"),
  evaluating: msg("Evaluating"),
  qualified: msg("Qualified"),
  in_progress: msg("In Progress"),
  submitted: msg("Submitted"),
  negotiating: msg("Negotiating"),
  won: msg("Won"),
  lost: msg("Lost"),
  disqualified: msg("Disqualified"),
} satisfies Record<OpportunityStage, string>;

export const ELIGIBILITY_STATUS_LABELS = {
  eligible: msg("Eligible"),
  needs_review: msg("Needs Review"),
  ineligible: msg("Ineligible"),
  unknown: msg("Unknown", { $context: "opportunity eligibility status" }),
} satisfies Record<EligibilityStatus, string>;

export const AUTOMATION_MODE_LABELS = {
  manual: msg("Manual"),
  assisted: msg("Assisted"),
  autonomous_within_policy: msg("Autonomous (Policy)"),
} satisfies Record<AutomationMode, string>;

export const VOICE_AGENT_DIRECTION_LABELS = {
  inbound: msg("Inbound"),
  outbound: msg("Outbound"),
  both: msg("Inbound & Outbound"),
} satisfies Record<VoiceAgentDirection, string>;

export const CONSENT_CHANNEL_LABELS = {
  email: msg("Email"),
  phone: msg("Phone"),
  sms: msg("SMS"),
  web_chat: msg("Web Chat"),
  voice_ai: msg("Voice AI"),
  social: msg("Social"),
  in_app: msg("In-App"),
} satisfies Record<ConsentChannel, string>;

export const VENTURE_STATUS_LABELS = {
  active: msg("Active"),
  paused: msg("Paused"),
  draft: msg("Draft"),
  archived: msg("Archived"),
} satisfies Record<VentureStatus, string>;
