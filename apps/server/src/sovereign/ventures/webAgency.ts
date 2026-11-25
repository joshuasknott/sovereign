// @effect-diagnostics-next-line nodeBuiltinImport:off -- SHA-256 content checksum for persisted commercial artifacts.
import * as NodeCrypto from "node:crypto";
import {
  type CommercialArtifact,
  type CommercialTask,
  type CommercialTaskId,
  type CommunicationRecord,
  type ConsentChannel,
  type ConsentRecord,
  type CurrencyCode,
  type Customer,
  DEFAULT_REPORTING_CURRENCY,
  type Invoice,
  type Lead,
  type LeadId,
  type ObjectiveId,
  type Opportunity,
  type OpportunityId,
  type Order,
  type Proposal,
  type ProposalId,
  type ProposalLineItem,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  SovereignConflictError,
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignLedgerService from "../SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignSalesService from "../SovereignSalesService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface WebAgencyDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly ledger: SovereignLedgerService.SovereignLedgerService["Service"];
  readonly sales: SovereignSalesService.SovereignSalesService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface ProspectAuditInput {
  readonly name: string;
  readonly company?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly websiteUrl: string;
  readonly rawHtml?: string;
  readonly loadTimeMs?: number;
  readonly hasBookingFlow?: boolean;
  readonly source?: string;
  readonly objectiveId?: ObjectiveId | null;
  readonly estimatedProjectValueMinor?: number;
  readonly currency?: CurrencyCode;
}

export interface WebsiteGap {
  readonly code:
    | "missing_https"
    | "missing_mobile_viewport"
    | "weak_seo_metadata"
    | "slow_page_load"
    | "outdated_ux_markup"
    | "missing_conversion_booking";
  readonly severity: "low" | "medium" | "high";
  readonly detail: string;
}

export interface AuditProspectResult {
  readonly lead: Lead;
  readonly opportunity: Opportunity;
  readonly gaps: ReadonlyArray<WebsiteGap>;
  readonly qualificationScore: number;
  readonly quarantined: boolean;
}

export interface DemoAndProposalScopeInput {
  readonly title: string;
  readonly summary?: string;
  readonly demoSections: ReadonlyArray<string>;
  readonly lineItems: ReadonlyArray<ProposalLineItem>;
  readonly discountPct?: number;
  readonly currency?: CurrencyCode;
  readonly opportunityId?: OpportunityId | null;
  readonly validUntil?: string | null;
}

export interface CreateDemoAndProposalResult {
  readonly demoArtifact: CommercialArtifact;
  readonly proposal: Proposal;
}

export interface OutreachMessageInput {
  readonly subject?: string;
  readonly body: string;
  readonly senderType?: CommunicationRecord["senderType"];
  readonly aiDisclosed?: boolean;
  readonly consentVerified?: boolean;
}

export interface SendPermittedOutreachResult {
  readonly communication: CommunicationRecord;
  readonly campaignGate: SovereignGovernanceService.GateExternalActionResult | null;
}

export interface OnboardAndFulfilOrderResult {
  readonly customer: Customer;
  readonly order: Order;
  readonly invoice: Invoice;
  readonly tasks: ReadonlyArray<CommercialTask>;
  readonly deploymentGate: SovereignGovernanceService.GateExternalActionResult;
  readonly retainerProposal: Proposal;
}

const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sha256Json = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(encodeJsonUnknown(value), "utf8").digest("hex");

const buildUnverifiedConsentRecord = (channel: ConsentChannel): ConsentRecord => ({
  channel,
  status: "unknown",
  lawfulBasis: "not_established",
  optedOut: false,
  optedOutAt: null,
  consentCapturedAt: null,
  aiDisclosureGiven: false,
  recordingDisclosureGiven: false,
  jurisdiction: "UK",
});

const inspectWebsiteGaps = (input: {
  readonly websiteUrl: string;
  readonly html: string;
  readonly loadTimeMs?: number;
  readonly hasBookingFlow?: boolean;
}): ReadonlyArray<WebsiteGap> => {
  const gaps: Array<WebsiteGap> = [];
  if (!input.websiteUrl.trim().toLowerCase().startsWith("https://")) {
    gaps.push({
      code: "missing_https",
      severity: "high",
      detail: "Website does not enforce HTTPS encryption.",
    });
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(input.html)) {
    gaps.push({
      code: "missing_mobile_viewport",
      severity: "high",
      detail: "Missing responsive viewport meta tag for mobile browsers.",
    });
  }
  const hasTitle = /<title>[^<]{5,}<\/title>/i.test(input.html);
  const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}["']/i.test(
    input.html,
  );
  if (!hasTitle || !hasMetaDesc) {
    gaps.push({
      code: "weak_seo_metadata",
      severity: "medium",
      detail: "Missing or insufficient HTML title or meta description for search visibility.",
    });
  }
  if (input.loadTimeMs !== undefined && input.loadTimeMs > 2500) {
    gaps.push({
      code: "slow_page_load",
      severity: "high",
      detail: `Measured page load time (${input.loadTimeMs}ms) exceeds 2500ms performance threshold.`,
    });
  }
  if (/<(?:table\b[^>]*width=|font\b|marquee\b|frameset\b)/i.test(input.html)) {
    gaps.push({
      code: "outdated_ux_markup",
      severity: "medium",
      detail: "Detected legacy layout markup suggesting an outdated user interface.",
    });
  }
  const detectedConversionCta =
    input.hasBookingFlow === true ||
    /\b(?:book\s+now|schedule\s+a?\s*call|request\s+a?\s*quote|online\s+booking|contact\s+form)\b/i.test(
      input.html,
    );
  if (!detectedConversionCta) {
    gaps.push({
      code: "missing_conversion_booking",
      severity: "medium",
      detail: "No clear booking, quote request, or structured enquiry conversion flow detected.",
    });
  }
  return gaps;
};

export const auditProspectAndQualify = Effect.fn(
  "VentureWorkflow.webAgency.auditProspectAndQualify",
)(function* (
  deps: WebAgencyDeps,
  ventureId: VentureId,
  prospect: ProspectAuditInput,
): Effect.fn.Return<AuditProspectResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }

  const rawHtml = prospect.rawHtml ?? "";
  const sanitized = yield* deps.governance.sanitizeUntrustedContent({
    source: "web_agency_prospect_html",
    rawText: `${prospect.websiteUrl}\n${rawHtml}`,
    ventureId,
    actor: "web_agency_workflow",
  });

  const gaps = inspectWebsiteGaps({
    websiteUrl: prospect.websiteUrl,
    html: rawHtml,
    ...(prospect.loadTimeMs === undefined ? {} : { loadTimeMs: prospect.loadTimeMs }),
    ...(prospect.hasBookingFlow === undefined ? {} : { hasBookingFlow: prospect.hasBookingFlow }),
  });

  const rawScore = gaps.reduce(
    (sum, gap) => sum + (gap.severity === "high" ? 24 : gap.severity === "medium" ? 15 : 8),
    20,
  );
  const qualificationScore = Math.min(100, rawScore);

  // Explicit UK PECR/GDPR defaults: non-consented until verified.
  const defaultConsents: Array<ConsentRecord> = [];
  if (prospect.email !== undefined && prospect.email !== null && prospect.email.trim().length > 0) {
    defaultConsents.push(buildUnverifiedConsentRecord("email"));
  }
  if (prospect.phone !== undefined && prospect.phone !== null && prospect.phone.trim().length > 0) {
    defaultConsents.push(buildUnverifiedConsentRecord("phone"));
  }
  if (defaultConsents.length === 0) {
    defaultConsents.push(buildUnverifiedConsentRecord("email"));
  }

  const lead = yield* deps.sales.createLead({
    ventureId,
    name: prospect.name.trim(),
    ...(prospect.company === undefined ? {} : { company: prospect.company }),
    ...(prospect.email === undefined ? {} : { email: prospect.email }),
    ...(prospect.phone === undefined ? {} : { phone: prospect.phone }),
    websiteUrl: prospect.websiteUrl.trim(),
    source: prospect.source ?? "website_audit",
    stage: qualificationScore >= 55 ? "qualified" : "researched",
    consents: defaultConsents,
    notes: `Website audit detected ${gaps.length} gap(s): ${gaps.map((g) => g.code).join(", ") || "none"}. Consent remains unverified.`,
    tags: ["web_agency_audit", ...gaps.map((g) => g.code)],
  });

  const currency =
    prospect.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
  const estimatedValueMinor =
    prospect.estimatedProjectValueMinor ?? Math.max(75_000, gaps.length * 45_000);

  const opportunity = yield* deps.orchestrator.createOpportunity({
    ventureId,
    ...(prospect.objectiveId === undefined ? {} : { objectiveId: prospect.objectiveId }),
    title: `Website redesign and conversion upgrade for ${prospect.company ?? prospect.name}`,
    summary: `Identified ${gaps.length} website gap(s) on ${prospect.websiteUrl} with qualification score ${qualificationScore}/100.`,
    source: prospect.source ?? "website_audit",
    sourceUrl: prospect.websiteUrl.trim(),
    externalRef: `web-audit:${prospect.websiteUrl.trim().toLowerCase()}`,
    stage: qualificationScore >= 55 ? "qualified" : "evaluating",
    eligibilityStatus: "eligible",
    automationMode: "assisted",
    aiPermissionStatus: "permitted",
    estimatedValueMinor,
    currency,
    score: {
      overall: qualificationScore,
      expectedValueMinor: Math.round(estimatedValueMinor * (qualificationScore / 200)),
      currency,
      winProbability: Math.round((qualificationScore / 200) * 100) / 100,
      effortHoursEstimate: 16,
      complianceFit: 1,
      rationale: `Detected ${gaps.length} concrete website gaps; UK PECR/GDPR outreach consent must be verified before contact.`,
    },
    tags: ["web_agency", ...gaps.map((g) => g.code)],
    metadata: {
      leadId: lead.id,
      gaps: gaps.map((g) => g.code),
      qualificationScore,
      quarantined: sanitized.quarantined,
    },
  });

  return {
    lead,
    opportunity,
    gaps,
    qualificationScore,
    quarantined: sanitized.quarantined,
  };
});

export const createPersonalisedDemoAndProposal = Effect.fn(
  "VentureWorkflow.webAgency.createPersonalisedDemoAndProposal",
)(function* (
  deps: WebAgencyDeps,
  ventureId: VentureId,
  leadId: LeadId,
  scope: DemoAndProposalScopeInput,
): Effect.fn.Return<CreateDemoAndProposalResult, SovereignDomainError> {
  const leadOpt = yield* deps.store.getLead(leadId);
  if (Option.isNone(leadOpt) || leadOpt.value.ventureId !== ventureId) {
    return yield* new SovereignNotFoundError({ entity: "lead", id: leadId });
  }
  if (scope.demoSections.length === 0) {
    return yield* new SovereignValidationError({
      field: "demoSections",
      reason: "Personalised demo requires at least one section.",
    });
  }

  const demoSpec = {
    leadId,
    company: leadOpt.value.company ?? leadOpt.value.name,
    websiteUrl: leadOpt.value.websiteUrl,
    title: scope.title,
    sections: scope.demoSections,
  };

  const demoArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    ...(scope.opportunityId === undefined ? {} : { opportunityId: scope.opportunityId }),
    kind: "website_preview",
    title: `Personalised website demo: ${scope.title}`,
    summary: `Tailored preview covering ${scope.demoSections.join(", ")} for ${leadOpt.value.company ?? leadOpt.value.name}.`,
    mimeType: "application/json",
    sha256: sha256Json(demoSpec),
    metadata: {
      leadId,
      sectionCount: scope.demoSections.length,
      sections: scope.demoSections,
    },
  });

  const proposal = yield* deps.sales.createProposal({
    ventureId,
    leadId,
    ...(scope.opportunityId === undefined ? {} : { opportunityId: scope.opportunityId }),
    title: scope.title,
    summary:
      scope.summary ??
      `Commercial quotation accompanying personalised demo artifact ${demoArtifact.id}.`,
    lineItems: scope.lineItems,
    ...(scope.discountPct === undefined ? {} : { discountPct: scope.discountPct }),
    ...(scope.currency === undefined ? {} : { currency: scope.currency }),
    ...(scope.validUntil === undefined ? {} : { validUntil: scope.validUntil }),
  });

  return { demoArtifact, proposal };
});

export const sendPermittedOutreach = Effect.fn("VentureWorkflow.webAgency.sendPermittedOutreach")(
  function* (
    deps: WebAgencyDeps,
    ventureId: VentureId,
    leadId: LeadId,
    channel: ConsentChannel,
    message: OutreachMessageInput,
    isCampaign: boolean,
  ): Effect.fn.Return<SendPermittedOutreachResult, SovereignDomainError> {
    const leadOpt = yield* deps.store.getLead(leadId);
    if (Option.isNone(leadOpt) || leadOpt.value.ventureId !== ventureId) {
      return yield* new SovereignNotFoundError({ entity: "lead", id: leadId });
    }
    const lead = leadOpt.value;

    const campaignGate = isCampaign
      ? yield* deps.governance.assertAndGateExternalAction({
          ventureId,
          category: "marketing_campaign",
          title: `Approve ${channel} marketing outreach to ${lead.company ?? lead.name}`,
          summary: message.subject ?? `Outbound ${channel} campaign message`,
          requestedAction: `send_campaign_${channel}`,
          targetLabel: lead.email ?? lead.phone ?? lead.name,
          channel,
          riskLevel: "medium",
          payload: {
            leadId,
            channel,
            isCampaign: true,
          },
          requestedBy: "web_agency_workflow",
        })
      : null;

    const communication = yield* deps.sales.createCommunication({
      ventureId,
      leadId,
      channel,
      direction: "outbound",
      senderType: message.senderType ?? "ai_agent",
      aiDisclosed: message.aiDisclosed ?? true,
      consentVerified: message.consentVerified ?? false,
      ...(message.subject === undefined ? {} : { subject: message.subject }),
      bodyPreview: message.body,
    });

    return { communication, campaignGate };
  },
);

export const onboardAndFulfilOrder = Effect.fn("VentureWorkflow.webAgency.onboardAndFulfilOrder")(
  function* (
    deps: WebAgencyDeps,
    ventureId: VentureId,
    proposalId: ProposalId,
  ): Effect.fn.Return<OnboardAndFulfilOrderResult, SovereignDomainError> {
    const proposals = yield* deps.store.listProposals(ventureId);
    const proposal = proposals.find((item) => item.id === proposalId);
    if (proposal === undefined) {
      return yield* new SovereignNotFoundError({ entity: "proposal", id: proposalId });
    }
    if (
      proposal.status === "pending_approval" ||
      proposal.status === "rejected" ||
      proposal.status === "expired"
    ) {
      return yield* new SovereignConflictError({
        entity: "proposal",
        id: proposalId,
        reason: `Proposal cannot be onboarded while in status "${proposal.status}".`,
      });
    }

    const now = yield* deps.store.nowIso;
    if (proposal.status !== "accepted") {
      yield* deps.store.updateProposalStatus({
        proposalId: proposal.id,
        status: "accepted",
        decidedAt: now,
        updatedAt: now,
      });
    }

    let customer: Customer | undefined;
    if (proposal.customerId !== null) {
      customer = Option.getOrUndefined(yield* deps.store.getCustomer(proposal.customerId));
    }
    if (customer === undefined) {
      const lead =
        proposal.leadId !== null
          ? Option.getOrUndefined(yield* deps.store.getLead(proposal.leadId))
          : undefined;
      customer = yield* deps.sales.createCustomer({
        ventureId,
        leadId: lead?.id ?? null,
        name: lead?.name ?? proposal.title,
        company: lead?.company ?? null,
        email: lead?.email ?? null,
        phone: lead?.phone ?? null,
        consents: lead?.consents ?? [],
        billingCurrency: proposal.currency,
      });
    }

    const order = yield* deps.sales.createOrder({
      ventureId,
      customerId: customer.id,
      proposalId: proposal.id,
      title: proposal.title,
      amountMinor: proposal.totalMinor,
      currency: proposal.currency,
    });

    const invoice = yield* deps.ledger.createInvoice({
      ventureId,
      customerId: customer.id,
      orderId: order.id,
      amountMinor: order.amountMinor,
      currency: order.currency,
    });

    const fulfilmentSpecs: ReadonlyArray<{
      readonly key: string;
      readonly title: string;
      readonly description: string;
      readonly complexity: CommercialTask["complexity"];
    }> = [
      {
        key: "build",
        title: `Build website deliverables: ${order.title}`,
        description:
          "Implement agreed responsive pages, accessibility fixes, and conversion flows.",
        complexity: "high",
      },
      {
        key: "test",
        title: `Run QA, performance, and cross-device tests: ${order.title}`,
        description:
          "Verify mobile layout, HTTPS headers, Lighthouse performance, and form workflows.",
        complexity: "medium",
      },
      {
        key: "deploy",
        title: `Deploy production website release: ${order.title}`,
        description:
          "Publish approved build to client production environment after owner sign-off.",
        complexity: "high",
      },
    ];

    const tasks: Array<CommercialTask> = [];
    let prevTaskId: CommercialTaskId | undefined;
    for (const step of fulfilmentSpecs) {
      const task = yield* deps.orchestrator.createTask({
        ventureId,
        ...(proposal.opportunityId === null ? {} : { opportunityId: proposal.opportunityId }),
        title: step.title,
        description: step.description,
        status: prevTaskId === undefined ? "ready" : "queued",
        complexity: step.complexity,
        priority: 80,
        idempotencyKey: `agency-order:${order.id}:${step.key}`,
        dependsOn: prevTaskId === undefined ? [] : [prevTaskId],
      });
      tasks.push(task);
      prevTaskId = task.id;
    }

    const deployTask = tasks[tasks.length - 1]!;
    const deploymentGate = yield* deps.governance.assertAndGateExternalAction({
      ventureId,
      taskId: deployTask.id,
      category: "production_deployment",
      title: `Approve production deployment for ${customer.company ?? customer.name}`,
      summary: `Owner approval required before publishing order ${order.id} to production.`,
      requestedAction: "deploy_client_website_production",
      targetLabel: customer.company ?? customer.name,
      riskLevel: "critical",
      payload: {
        orderId: order.id,
        customerId: customer.id,
      },
      requestedBy: "web_agency_workflow",
      idempotencyKey: `agency-deploy-gate:${order.id}`,
    });

    const monthlyRetainerMinor = Math.max(9_900, Math.round(order.amountMinor * 0.15));
    const retainerProposal = yield* deps.sales.createProposal({
      ventureId,
      customerId: customer.id,
      leadId: customer.leadId,
      ...(proposal.opportunityId === null ? {} : { opportunityId: proposal.opportunityId }),
      title: `Monthly website care and maintenance retainer: ${customer.company ?? customer.name}`,
      summary:
        "Optional recurring hosting monitoring, security updates, uptime checks, and minor monthly edits.",
      lineItems: [
        {
          description: "Monthly website maintenance, updates, and uptime monitoring retainer",
          quantity: 1,
          unitAmountMinor: monthlyRetainerMinor,
        },
      ],
      currency: order.currency,
    });

    return {
      customer,
      order,
      invoice,
      tasks,
      deploymentGate,
      retainerProposal,
    };
  },
);
