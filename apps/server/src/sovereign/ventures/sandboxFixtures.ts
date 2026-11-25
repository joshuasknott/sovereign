import {
  type CommercialTask,
  type FinancialPipelineMetrics,
  type Lead,
  type LedgerEntry,
  type Opportunity,
  type Venture,
  type VentureKind,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { SovereignDomainError } from "../SovereignErrors.ts";
import type * as SovereignLedgerService from "../SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignSalesService from "../SovereignSalesService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface SandboxFixturesDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly ledger: SovereignLedgerService.SovereignLedgerService["Service"];
  readonly sales: SovereignSalesService.SovereignSalesService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface LoadSandboxFixtureResult {
  readonly ventures: ReadonlyArray<Venture>;
  readonly opportunities: ReadonlyArray<Opportunity>;
  readonly tasks: ReadonlyArray<CommercialTask>;
  readonly leads: ReadonlyArray<Lead>;
  readonly ledgerEntries: ReadonlyArray<LedgerEntry>;
  readonly financialSummary: FinancialPipelineMetrics;
}

interface SandboxVentureSeed {
  readonly slug: string;
  readonly name: string;
  readonly kind: VentureKind;
  readonly opportunityExternalRef: string;
  readonly opportunityTitle: string;
  readonly estimatedValueMinor: number;
  readonly taskTitle: string;
  readonly simulatedRevenueMinor: number;
  readonly simulatedExpenseMinor: number;
}

const SANDBOX_SEEDS: ReadonlyArray<SandboxVentureSeed> = [
  {
    slug: "sandbox-dev-bounties",
    name: "Sandbox Dev Bounties",
    kind: "dev_bounties",
    opportunityExternalRef: "sandbox:dev:issue-101",
    opportunityTitle: "[Simulated] Fix streaming parser memory leak (£450 bounty)",
    estimatedValueMinor: 45_000,
    taskTitle: "[Simulated] Reproduce parser issue in isolated worktree",
    simulatedRevenueMinor: 45_000,
    simulatedExpenseMinor: 0,
  },
  {
    slug: "sandbox-security-bounties",
    name: "Sandbox Security Bounties",
    kind: "security_bounties",
    opportunityExternalRef: "sandbox:sec:prog-1",
    opportunityTitle: "[Simulated] Local Lab Responsible Disclosure Exercise",
    estimatedValueMinor: 75_000,
    taskTitle: "[Simulated] Review local lab evidence bundle",
    simulatedRevenueMinor: 0,
    simulatedExpenseMinor: 0,
  },
  {
    slug: "sandbox-web-agency",
    name: "Sandbox Web Agency",
    kind: "web_agency",
    opportunityExternalRef: "sandbox:agency:prospect-1",
    opportunityTitle: "[Simulated] Local Clinic Website Modernisation",
    estimatedValueMinor: 180_000,
    taskTitle: "[Simulated] Draft personalised website demo preview",
    simulatedRevenueMinor: 120_000,
    simulatedExpenseMinor: 4_500,
  },
  {
    slug: "sandbox-voice-ai",
    name: "Sandbox Voice AI Desk",
    kind: "voice_ai",
    opportunityExternalRef: "sandbox:voice:retainer-1",
    opportunityTitle: "[Simulated] Inbound Dental Receptionist Retainer",
    estimatedValueMinor: 60_000,
    taskTitle: "[Simulated] Verify AI greeting and recording disclosure script",
    simulatedRevenueMinor: 35_000,
    simulatedExpenseMinor: 2_800,
  },
  {
    slug: "sandbox-paid-tasks",
    name: "Sandbox Paid Tasks",
    kind: "paid_tasks",
    opportunityExternalRef: "sandbox:tasks:batch-1",
    opportunityTitle: "[Simulated] AI-Permitted Dataset Tagging Batch",
    estimatedValueMinor: 12_000,
    taskTitle: "[Simulated] Run automated structured tagging batch",
    simulatedRevenueMinor: 12_000,
    simulatedExpenseMinor: 0,
  },
  {
    slug: "sandbox-digital-products",
    name: "Sandbox Digital Products",
    kind: "digital_products",
    opportunityExternalRef: "sandbox:digital:kit-1",
    opportunityTitle: "[Simulated] Effect TS Server Starter Blueprint",
    estimatedValueMinor: 95_000,
    taskTitle: "[Simulated] Package documentation and release manifest",
    simulatedRevenueMinor: 29_000,
    simulatedExpenseMinor: 1_900,
  },
  {
    slug: "sandbox-micro-saas",
    name: "Sandbox Micro-SaaS Studio",
    kind: "micro_saas",
    opportunityExternalRef: "sandbox:saas:app-1",
    opportunityTitle: "[Simulated] Invoice Chaser Micro-SaaS",
    estimatedValueMinor: 140_000,
    taskTitle: "[Simulated] Verify subscription webhook reconciliation",
    simulatedRevenueMinor: 49_000,
    simulatedExpenseMinor: 6_500,
  },
];

export const loadSandboxCommercialFixture = Effect.fn(
  "VentureWorkflow.sandboxFixtures.loadSandboxCommercialFixture",
)(function* (
  deps: SandboxFixturesDeps,
): Effect.fn.Return<LoadSandboxFixtureResult, SovereignDomainError> {
  const ventures: Array<Venture> = [];
  const opportunities: Array<Opportunity> = [];
  const tasks: Array<CommercialTask> = [];
  const leads: Array<Lead> = [];
  const ledgerEntries: Array<LedgerEntry> = [];

  for (const seed of SANDBOX_SEEDS) {
    const existingOpt = yield* deps.store.getVentureBySlug(seed.slug);
    const venture = Option.isSome(existingOpt)
      ? existingOpt.value
      : yield* deps.orchestrator.createVenture({
          name: seed.name,
          slug: seed.slug,
          kind: seed.kind,
          status: "draft",
          summary: `Opt-in simulated sandbox fixture for ${seed.name}. Isolated from real revenue totals.`,
          tags: ["simulated_fixture", "sandbox"],
          config: {
            isSimulated: true,
            verificationState: "simulated_fixture",
          },
        });
    ventures.push(venture);

    const opportunity = yield* deps.orchestrator.createOpportunity({
      ventureId: venture.id,
      title: seed.opportunityTitle,
      summary:
        "Simulated sandbox fixture opportunity for visual inspection and development testing.",
      source: "sandbox_fixture",
      externalRef: seed.opportunityExternalRef,
      stage: "qualified",
      eligibilityStatus: "eligible",
      automationMode: "assisted",
      aiPermissionStatus: "permitted",
      estimatedValueMinor: seed.estimatedValueMinor,
      currency: "GBP",
      tags: ["simulated_fixture", "sandbox"],
      metadata: {
        isSimulated: true,
        verificationState: "simulated_fixture",
      },
    });
    opportunities.push(opportunity);

    const task = yield* deps.orchestrator.createTask({
      ventureId: venture.id,
      opportunityId: opportunity.id,
      title: seed.taskTitle,
      description: "Simulated sandbox task for UI and workflow verification.",
      status: "ready",
      complexity: "low",
      priority: 50,
      idempotencyKey: `sandbox-task:${seed.slug}`,
    });
    tasks.push(task);

    if (seed.kind === "web_agency" || seed.kind === "voice_ai") {
      const existingLeads = yield* deps.store.listLeads(venture.id);
      const alreadySeeded = existingLeads.find((item) => item.source === "sandbox_fixture");
      const lead =
        alreadySeeded ??
        (yield* deps.sales.createLead({
          ventureId: venture.id,
          name: `Simulated Prospect (${seed.kind})`,
          company: `${seed.name} Demo Co`,
          email: `sandbox-${seed.kind}@example.invalid`,
          websiteUrl: "https://sandbox-demo.example.invalid",
          source: "sandbox_fixture",
          stage: "qualified",
          consents: [
            {
              channel: "email",
              status: "unknown",
              lawfulBasis: "not_established",
              optedOut: false,
              optedOutAt: null,
              consentCapturedAt: null,
              aiDisclosureGiven: false,
              recordingDisclosureGiven: false,
              jurisdiction: "UK",
            },
          ],
          notes: "Simulated sandbox fixture lead (isSimulated: true).",
          tags: ["simulated_fixture", "sandbox"],
        }));
      leads.push(lead);
    }

    if (seed.simulatedRevenueMinor > 0) {
      const revEntry = yield* deps.ledger.recordEntry(
        {
          ventureId: venture.id,
          entryType: "collected_revenue",
          verificationState: "simulated_fixture",
          amountMinor: seed.simulatedRevenueMinor,
          currency: "GBP",
          description: `[Simulated] Fixture revenue for ${seed.name}`,
          externalRef: `sandbox-rev:${seed.slug}`,
        },
        { recordedBy: "sandbox_fixture" },
      );
      ledgerEntries.push(revEntry);
    }

    if (seed.simulatedExpenseMinor > 0) {
      const expEntry = yield* deps.ledger.recordEntry(
        {
          ventureId: venture.id,
          entryType: seed.kind === "voice_ai" ? "telephony_cost" : "hosting_cost",
          verificationState: "simulated_fixture",
          amountMinor: seed.simulatedExpenseMinor,
          currency: "GBP",
          description: `[Simulated] Fixture expense for ${seed.name}`,
          externalRef: `sandbox-exp:${seed.slug}`,
        },
        { recordedBy: "sandbox_fixture" },
      );
      ledgerEntries.push(expEntry);
    }
  }

  const financialSummary = yield* deps.ledger.computeFinancialMetrics(null);

  return {
    ventures,
    opportunities,
    tasks,
    leads,
    ledgerEntries,
    financialSummary,
  };
});
