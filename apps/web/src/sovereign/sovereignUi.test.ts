import {
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  LeadId,
  OpportunityId,
  VentureId,
  type Lead,
  type Opportunity,
  type Venture,
  type VentureBlueprint,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildVentureWorkspaceTabs,
  computeBudgetProgress,
  dedupeVentureBlueprints,
  formatCompactMinor,
  formatMinorToMajorInput,
  isSecurityAuthorised,
  parseMajorCurrencyToMinor,
  splitPaidTaskOpportunities,
  summarizeLeadConsent,
} from "./sovereignUi.logic";

describe("sovereignUi.logic", () => {
  it("parses major currency strings into integer minor units", () => {
    expect(parseMajorCurrencyToMinor("500")).toBe(50_000);
    expect(parseMajorCurrencyToMinor("£12.50")).toBe(1_250);
    expect(parseMajorCurrencyToMinor("0")).toBe(0);
    expect(parseMajorCurrencyToMinor("")).toBe(0);
    expect(parseMajorCurrencyToMinor("1,200.05")).toBe(120_005);
    expect(parseMajorCurrencyToMinor("-10")).toBeNull();
    expect(parseMajorCurrencyToMinor("abc")).toBeNull();
    expect(parseMajorCurrencyToMinor("12.345")).toBeNull();
  });

  it("formats minor units back to clean major input strings", () => {
    expect(formatMinorToMajorInput(0)).toBe("0");
    expect(formatMinorToMajorInput(50_000)).toBe("500");
    expect(formatMinorToMajorInput(1_250)).toBe("12.50");
    expect(formatMinorToMajorInput(105)).toBe("1.05");
  });

  it("formats compact minor amounts for sidebar rows", () => {
    expect(formatCompactMinor(0, "GBP")).toBe("£0.00");
    expect(formatCompactMinor(42_000, "GBP")).toBe("+£420.00");
    expect(formatCompactMinor(-1_500, "GBP")).toBe("-£15.00");
    expect(formatCompactMinor(150_000, "GBP")).toBe("+£1.5k");
  });

  it("computes budget progress states accurately", () => {
    expect(computeBudgetProgress(0, 0)).toEqual({ pct: 0, state: "none" });
    expect(computeBudgetProgress(500, 0)).toEqual({ pct: 100, state: "exceeded" });
    expect(computeBudgetProgress(2_000, 10_000, 80)).toEqual({ pct: 20, state: "healthy" });
    expect(computeBudgetProgress(8_500, 10_000, 80)).toEqual({ pct: 85, state: "warning" });
    expect(computeBudgetProgress(12_000, 10_000, 80)).toEqual({ pct: 100, state: "exceeded" });
  });

  it("builds venture workspace tabs from uiModules", () => {
    expect(
      buildVentureWorkspaceTabs(
        ["operations", "bounties", "finances", "workspace_conversations"],
        "dev_bounties",
      ),
    ).toEqual(["operations", "commercial", "finances", "workspace"]);
    expect(buildVentureWorkspaceTabs(["operations"], "custom")).toEqual([
      "operations",
      "commercial",
    ]);
  });

  it("splits paid task opportunities into automated-permitted vs human-required", () => {
    const baseOpp = {
      ventureId: VentureId.make("v1"),
      objectiveId: null,
      summary: "",
      source: "platform",
      sourceUrl: null,
      externalRef: null,
      stage: "discovered" as const,
      eligibilityStatus: "eligible" as const,
      estimatedValueMinor: 5_000,
      currency: "GBP",
      score: null,
      tags: [],
      deadlineAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const opportunities: Opportunity[] = [
      {
        ...baseOpp,
        id: OpportunityId.make("o1"),
        title: "API automation task",
        automationMode: "autonomous_within_policy",
        aiPermissionStatus: "permitted",
      },
      {
        ...baseOpp,
        id: OpportunityId.make("o2"),
        title: "Human-only interview",
        automationMode: "manual",
        aiPermissionStatus: "permitted",
      },
      {
        ...baseOpp,
        id: OpportunityId.make("o3"),
        title: "No-AI policy task",
        automationMode: "assisted",
        aiPermissionStatus: "prohibited",
      },
    ];
    const split = splitPaidTaskOpportunities(opportunities);
    expect(split.automatedPermitted.map((o) => o.id)).toEqual(["o1"]);
    expect(split.humanRequired.map((o) => o.id)).toEqual(["o2", "o3"]);
  });

  it("summarizes lead consent and opt-out states", () => {
    const baseLead: Lead = {
      id: LeadId.make("l1"),
      ventureId: VentureId.make("v1"),
      name: "Alex Smith",
      company: "Smith Plumbing",
      email: "alex@example.co.uk",
      phone: null,
      websiteUrl: null,
      source: "manual",
      stage: "new",
      consents: [],
      notes: "",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(summarizeLeadConsent(baseLead)).toEqual({ status: "missing", aiDisclosed: false });
    expect(
      summarizeLeadConsent({
        ...baseLead,
        consents: [
          {
            channel: "email",
            status: "granted",
            lawfulBasis: "consent",
            optedOut: false,
            optedOutAt: null,
            consentCapturedAt: "2026-01-01T00:00:00.000Z",
            aiDisclosureGiven: true,
            recordingDisclosureGiven: false,
            jurisdiction: "UK",
          },
        ],
      }),
    ).toEqual({ status: "granted", aiDisclosed: true });
    expect(
      summarizeLeadConsent({
        ...baseLead,
        stage: "unsubscribed",
      }),
    ).toEqual({ status: "opted_out", aiDisclosed: false });
  });

  it("keeps security testing locked until authorised with explicit scope and non-denied mode", () => {
    const baseVenture: Venture = {
      id: VentureId.make("v-sec"),
      slug: "sec",
      name: "Security",
      kind: "security_bounties",
      templateKey: "security-bounties",
      status: "active",
      summary: "",
      uiModules: ["operations", "security_programmes", "finances", "workspace_conversations"],
      budgetPolicy: DEFAULT_VENTURE_BUDGET_POLICY,
      permissionPolicy: DEFAULT_VENTURE_PERMISSION_POLICY,
      routingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
      linkedProjectIds: [],
      linkedThreadIds: [],
      linkedScheduledTaskIds: [],
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isSecurityAuthorised(baseVenture)).toBe(false);
    expect(
      isSecurityAuthorised({
        ...baseVenture,
        permissionPolicy: {
          ...baseVenture.permissionPolicy,
          actionModes: {
            ...baseVenture.permissionPolicy.actionModes,
            security_testing: "require_approval",
          },
          securityAuthorisation: {
            ...baseVenture.permissionPolicy.securityAuthorisation,
            authorised: true,
            targetScope: ["staging.example.com"],
          },
        },
      }),
    ).toBe(true);
  });

  it("deduplicates venture blueprints by templateKey while preserving order", () => {
    const baseBlueprint: VentureBlueprint = {
      templateKey: "dev_bounties",
      kind: "dev_bounties",
      name: "Dev Bounties",
      description: "Solve open-source bounties",
      uiModules: ["operations", "bounties", "finances", "workspace_conversations"],
      defaultPermissionPolicy: DEFAULT_VENTURE_PERMISSION_POLICY,
      defaultBudgetPolicy: DEFAULT_VENTURE_BUDGET_POLICY,
      defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
      requiredIntegrationCategories: [],
      defaultWorkflowTags: [],
    };
    const customBlueprint: VentureBlueprint = {
      ...baseBlueprint,
      templateKey: "custom",
      kind: "custom",
      name: "Custom Venture",
    };
    const deduped = dedupeVentureBlueprints([baseBlueprint, customBlueprint, customBlueprint]);
    expect(deduped.map((item) => item.templateKey)).toEqual(["dev_bounties", "custom"]);
  });
});
