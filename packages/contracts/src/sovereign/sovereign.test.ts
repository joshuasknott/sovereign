import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import {
  AuthEnvironmentScope,
  AuthProvidersManageScope,
  AuthSovereignAdminScope,
  AuthSovereignApproveScope,
  AuthSovereignOperateScope,
  AuthSovereignReadScope,
  AuthStandardClientScopes,
  authScopeRequiredResponse,
} from "../auth.ts";
import { ProjectId, RunId, ScheduledTaskId, ThreadId } from "../baseSchemas.ts";
import { CLIENT_GUARDED_RPC_SCOPES, clientRpcRequiredScopes } from "../clientRpcPermissions.ts";
import {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
} from "../providerInstance.ts";
import { WS_METHODS, WsRpcGroup } from "../rpc.ts";
import { ClientSettingsPatch, ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "../settings.ts";
import {
  ApprovalRequest,
  ApprovalRequestId,
  ArtifactId,
  AuditEvent,
  AuditEventId,
  CommercialArtifact,
  CommercialObjective,
  CommercialTask,
  CommercialTaskId,
  CommunicationId,
  CommunicationRecord,
  ConsentRecord,
  Customer,
  CustomerId,
  DEFAULT_GLOBAL_CONTROL_STATE,
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_REPORTING_CURRENCY,
  DEFAULT_SALES_POLICY,
  DEFAULT_SECURITY_AUTHORISATION,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  FinancialPipelineMetrics,
  GlobalControlState,
  IntegrationConfig,
  IntegrationId,
  Invoice,
  InvoiceId,
  Lead,
  LeadId,
  LedgerEntry,
  LedgerEntryId,
  ObjectiveId,
  Opportunity,
  OpportunityId,
  Order,
  OrderId,
  PreapprovalPolicy,
  PreapprovalPolicyId,
  Proposal,
  ProposalId,
  ProviderPoolMetadata,
  ProviderPoolSnapshot,
  ProviderRoutingPolicy,
  SOVEREIGN_WS_METHODS,
  SalesPolicy,
  SecurityAuthorisation,
  SovereignEvent,
  SovereignOverviewSnapshot,
  SovereignVentureDetail,
  SupportTicket,
  SupportTicketId,
  Venture,
  VentureBudgetPolicy,
  VentureId,
  VenturePermissionPolicy,
  VoiceAgentConfig,
  VoiceAgentId,
} from "./index.ts";

const ISO_NOW = "2026-11-25T00:00:00.000Z";

const decodeGlobalControlState = Schema.decodeSync(GlobalControlState);
const decodeGlobalControlStateExit = Schema.decodeUnknownExit(GlobalControlState);
const decodeVentureBudgetPolicy = Schema.decodeSync(VentureBudgetPolicy);
const decodeSecurityAuthorisation = Schema.decodeSync(SecurityAuthorisation);
const decodeVenturePermissionPolicy = Schema.decodeSync(VenturePermissionPolicy);
const decodeProviderRoutingPolicy = Schema.decodeSync(ProviderRoutingPolicy);
const decodeSalesPolicy = Schema.decodeSync(SalesPolicy);
const decodeProviderPoolMetadata = Schema.decodeSync(ProviderPoolMetadata);
const decodeProviderInstance = Schema.decodeUnknownSync(ProviderInstanceConfig);
const encodeProviderInstance = Schema.encodeSync(ProviderInstanceConfig);
const encodeOverview = Schema.encodeSync(SovereignOverviewSnapshot);
const decodeOverview = Schema.decodeUnknownSync(SovereignOverviewSnapshot);
const encodeDetail = Schema.encodeSync(SovereignVentureDetail);
const decodeDetail = Schema.decodeUnknownSync(SovereignVentureDetail);
const encodeEvent = Schema.encodeSync(SovereignEvent);
const decodeEvent = Schema.decodeUnknownSync(SovereignEvent);
const decodeVenture = Schema.decodeSync(Venture);
const decodeApprovalRequest = Schema.decodeSync(ApprovalRequest);
const decodeAuditEvent = Schema.decodeSync(AuditEvent);
const decodeCommercialArtifact = Schema.decodeSync(CommercialArtifact);
const decodeLedgerEntry = Schema.decodeSync(LedgerEntry);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);

describe("Sovereign foundation defaults and safety guardrails", () => {
  it("enforces GBP default, zero discretionary spend, deny paid fallback, and prompt injection guard", () => {
    const decoded = decodeGlobalControlState({});
    expect(decoded).toEqual(DEFAULT_GLOBAL_CONTROL_STATE);
    expect(decoded.reportingCurrency).toBe(DEFAULT_REPORTING_CURRENCY);
    expect(decoded.reportingCurrency).toBe("GBP");
    expect(decoded.globalMonthlyBudgetMinor).toBe(0);
    expect(decoded.defaultPaidFallbackMode).toBe("deny");
    expect(decoded.promptInjectionGuardEnabled).toBe(true);
    expect(decoded.emergencyStopActive).toBe(false);
    expect(decoded.fxRatesToGbp).toEqual({ GBP: 1 });
  });

  it("defaults venture budgets to GBP with zero cap and no discretionary spend", () => {
    const budget = decodeVentureBudgetPolicy({});
    expect(budget).toEqual(DEFAULT_VENTURE_BUDGET_POLICY);
    expect(budget.currency).toBe("GBP");
    expect(budget.monthlyCapMinor).toBe(0);
    expect(budget.discretionarySpendAllowed).toBe(false);
    expect(budget.alertThresholdPct).toBe(80);
  });

  it("keeps security testing unauthorised and denied, and paid fallback denied by default", () => {
    const security = decodeSecurityAuthorisation({});
    expect(security).toEqual(DEFAULT_SECURITY_AUTHORISATION);
    expect(security.authorised).toBe(false);
    expect(security.targetScope).toEqual([]);
    expect(security.permittedMethods).toEqual([]);

    const policy = decodeVenturePermissionPolicy({});
    expect(policy).toEqual(DEFAULT_VENTURE_PERMISSION_POLICY);
    expect(policy.securityAuthorisation.authorised).toBe(false);
    expect(policy.actionModes.security_testing).toBe("deny");
    expect(policy.actionModes.paid_provider_fallback).toBe("deny");
    expect(policy.actionModes.customer_communication).toBe("require_approval");
    expect(policy.actionModes.financial_expenditure).toBe("require_approval");
    expect(policy.maxAutonomousQuoteMinor).toBe(0);
    expect(policy.maxDiscountPct).toBe(0);

    // Partial overrides preserve safe defaults for all unspecified action categories.
    const partial = decodeVenturePermissionPolicy({
      actionModes: { customer_communication: "preapproved" },
    });
    expect(partial.actionModes.customer_communication).toBe("preapproved");
    expect(partial.actionModes.security_testing).toBe("deny");
    expect(partial.actionModes.paid_provider_fallback).toBe("deny");
  });

  it("defaults provider routing to non-metered classes and never-silent-paid-fallback", () => {
    const routing = decodeProviderRoutingPolicy({});
    expect(routing).toEqual(DEFAULT_PROVIDER_ROUTING_POLICY);
    expect(routing.allowedBillingClasses).toEqual(["subscription", "local", "free"]);
    expect(routing.paidFallbackMode).toBe("deny");
    expect(routing.preferredTier).toBe("balanced");
    expect(routing.requireTools).toBe(true);
    expect(routing.currency).toBe("GBP");
  });

  it("defaults sales policy to strict UK PECR/GDPR consent and AI disclosure", () => {
    const sales = decodeSalesPolicy({});
    expect(sales).toEqual(DEFAULT_SALES_POLICY);
    expect(sales.requireExplicitConsentForOutbound).toBe(true);
    expect(sales.requireAiIdentityDisclosure).toBe(true);
    expect(sales.requireRecordingDisclosure).toBe(true);
    expect(sales.honourOptOutImmediately).toBe(true);
    expect(sales.maxAutonomousQuoteMinor).toBe(0);
    expect(sales.currency).toBe("GBP");
  });
});

describe("ProviderInstanceConfig backwards compatibility and pool metadata", () => {
  it("preserves legacy provider instance configs without pool metadata", () => {
    const legacy = decodeProviderInstance({ driver: "codex", enabled: true });
    expect(legacy).toEqual({ driver: "codex", enabled: true });
    expect("pool" in encodeProviderInstance(legacy)).toBe(false);
  });

  it("round-trips provider instances carrying pool metadata", () => {
    const pool = decodeProviderPoolMetadata({
      billingClass: "subscription",
      subscriptionPlanLabel: "Pro",
      monthlySubscriptionCostMinor: 1600,
      subscriptionCurrency: "GBP",
      poolEnabled: true,
      poolPriority: 10,
      maxConcurrentRuns: 3,
      preferredTiers: ["reasoning", "frontier"],
      poolTags: ["primary", "coding"],
    });
    const config = decodeProviderInstance({
      driver: "claudeAgent",
      displayName: "Claude Pro",
      enabled: true,
      pool,
    });
    expect(config.pool).toEqual(pool);
    expect(decodeProviderInstance(encodeProviderInstance(config))).toEqual(config);
  });
});

describe("Sovereign domain contract round-trips", () => {
  const ventureId = VentureId.make("venture-web-agency");
  const objectiveId = ObjectiveId.make("objective-q1");
  const opportunityId = OpportunityId.make("opp-1");
  const taskId = CommercialTaskId.make("task-1");
  const leadId = LeadId.make("lead-1");
  const customerId = CustomerId.make("customer-1");
  const proposalId = ProposalId.make("proposal-1");
  const orderId = OrderId.make("order-1");
  const invoiceId = InvoiceId.make("invoice-1");
  const ledgerEntryId = LedgerEntryId.make("ledger-1");
  const approvalId = ApprovalRequestId.make("approval-1");
  const policyId = PreapprovalPolicyId.make("policy-1");
  const integrationId = IntegrationId.make("integration-stripe");
  const artifactId = ArtifactId.make("artifact-1");
  const auditId = AuditEventId.make("audit-1");
  const communicationId = CommunicationId.make("comm-1");
  const ticketId = SupportTicketId.make("ticket-1");
  const voiceAgentId = VoiceAgentId.make("voice-1");

  const venture: Venture = {
    id: ventureId,
    slug: "meridian-web",
    name: "Meridian Web Studio",
    kind: "web_agency",
    templateKey: "web_agency",
    status: "active",
    summary: "Bespoke landing pages and conversion rebuilds.",
    uiModules: ["operations", "prospects_sales", "finances", "approvals", "artifacts"],
    budgetPolicy: DEFAULT_VENTURE_BUDGET_POLICY,
    permissionPolicy: DEFAULT_VENTURE_PERMISSION_POLICY,
    routingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
    linkedProjectIds: [ProjectId.make("proj-1")],
    linkedThreadIds: [ThreadId.make("thread-1")],
    linkedScheduledTaskIds: [ScheduledTaskId.make("sched-1")],
    tags: ["agency"],
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
  };

  const metrics: FinancialPipelineMetrics = {
    reportingCurrency: "GBP",
    discoveredOpportunityValueMinor: 500_000,
    proposedQuotationsMinor: 250_000,
    acceptedOrdersMinor: 120_000,
    outstandingInvoicesMinor: 40_000,
    collectedRevenueMinor: 80_000,
    confirmedExpensesMinor: 5_000,
    paymentFeesMinor: 1_200,
    refundsMinor: 0,
    netProfitMinor: 73_800,
    monthlyRecurringRevenueMinor: 20_000,
    pendingReconciliationRevenueMinor: 0,
    pendingReconciliationExpensesMinor: 0,
    simulatedRevenueMinor: 999_000,
    simulatedExpensesMinor: 10_000,
    asOf: ISO_NOW,
  };

  const providerPool: ProviderPoolSnapshot = {
    updatedAt: ISO_NOW,
    defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
    members: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex Subscription",
        enabled: true,
        poolEnabled: true,
        poolPriority: 10,
        billingClass: "subscription",
        billingClassInferred: false,
        healthStatus: "healthy",
        activeRunCount: 1,
        maxConcurrentRuns: 4,
        quotaAvailability: "unavailable",
        quotaRemainingPct: null,
        quotaResetAt: null,
        cooldownUntil: null,
        reliabilityScore: 0.98,
        preferredTiers: ["balanced", "reasoning"],
        poolTags: ["coding"],
        availableModels: [{ slug: "gpt-5.3-codex", name: "GPT-5.3 Codex", tier: "reasoning" }],
        checkedAt: ISO_NOW,
      },
    ],
    healthyCount: 1,
    activeRunCount: 1,
    paidInstancesCount: 0,
  };

  const consent: ConsentRecord = {
    channel: "email",
    status: "granted",
    lawfulBasis: "consent",
    optedOut: false,
    optedOutAt: null,
    consentCapturedAt: ISO_NOW,
    consentSource: "inbound_form",
    aiDisclosureGiven: true,
    recordingDisclosureGiven: false,
    jurisdiction: "UK",
  };

  it("round-trips SovereignOverviewSnapshot, SovereignVentureDetail, and SovereignEvent", () => {
    const objective: CommercialObjective = {
      id: objectiveId,
      ventureId,
      title: "Generate initial GBP 1,000 net profit",
      description: "Close two web agency engagements.",
      status: "active",
      horizon: "monthly",
      targetRevenueMinor: 100_000,
      maxSpendMinor: 0,
      currency: "GBP",
      targetDeadlineAt: null,
      strategyPlan: null,
      constraints: ["Zero paid API fallback"],
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const opportunity: Opportunity = {
      id: opportunityId,
      ventureId,
      objectiveId,
      title: "Local clinic site modernisation",
      summary: "Rebuild static brochure site with booking integration.",
      source: "inbound",
      sourceUrl: null,
      externalRef: null,
      stage: "qualified",
      eligibilityStatus: "eligible",
      automationMode: "assisted",
      aiPermissionStatus: "permitted",
      estimatedValueMinor: 150_000,
      currency: "GBP",
      score: {
        overall: 84,
        expectedValueMinor: 90_000,
        currency: "GBP",
        winProbability: 0.6,
        effortHoursEstimate: 12,
        complianceFit: 1,
        rationale: "Inbound enquiry with clear requirements.",
      },
      tags: ["uk-smb"],
      deadlineAt: null,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const task: CommercialTask = {
      id: taskId,
      ventureId,
      objectiveId,
      opportunityId,
      title: "Draft technical scope",
      description: "Prepare fixed-price deliverables table.",
      status: "in_progress",
      complexity: "medium",
      priority: 80,
      assignedProviderInstanceId: ProviderInstanceId.make("codex"),
      assignedModel: "gpt-5.3-codex",
      linkedThreadId: ThreadId.make("thread-1"),
      linkedRunId: RunId.make("run-1"),
      pendingApprovalId: null,
      artifactIds: [artifactId],
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
      completedAt: null,
    };

    const approval: ApprovalRequest = {
      id: approvalId,
      ventureId,
      objectiveId,
      taskId,
      category: "customer_communication",
      status: "pending",
      riskLevel: "medium",
      title: "Send proposal email",
      summary: "Send fixed-price GBP 1,500 quotation to prospect.",
      requestedAction: "email.send",
      targetLabel: "client@example.co.uk",
      estimatedCostMinor: 0,
      currency: "GBP",
      requestedBy: "agent:sales",
      requestedAt: ISO_NOW,
    };

    const policy: PreapprovalPolicy = {
      id: policyId,
      ventureId,
      category: "customer_communication",
      label: "Follow-up replies",
      enabled: true,
      maxSingleActionMinor: 0,
      maxMonthlyAggregateMinor: 0,
      currency: "GBP",
      allowedTargets: ["example.co.uk"],
      expiresAt: null,
      createdBy: "owner",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const integration: IntegrationConfig = {
      id: integrationId,
      ventureId: null,
      category: "payments",
      providerKind: "stripe",
      displayName: "Stripe UK",
      status: "configured",
      enabled: true,
      sandboxMode: true,
      endpointUrl: null,
      accountLabel: "acct_test",
      hasSecret: true,
      settings: { webhookConfigured: true },
      lastTestedAt: ISO_NOW,
      lastError: null,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const ledgerEntry: LedgerEntry = {
      id: ledgerEntryId,
      ventureId,
      orderId,
      invoiceId,
      entryType: "collected_revenue",
      verificationState: "verified",
      amountMinor: 80_000,
      currency: "GBP",
      reportingAmountGbpMinor: 80_000,
      fxRateToGbp: 1,
      description: "Deposit invoice settled",
      externalRef: "pi_test_123",
      recordedBy: "stripe_webhook",
      occurredAt: ISO_NOW,
      recordedAt: ISO_NOW,
    };

    const auditEvent: AuditEvent = {
      id: auditId,
      kind: "ledger_recorded",
      severity: "info",
      ventureId,
      actor: "stripe_webhook",
      summary: "Recorded verified GBP 800.00 deposit",
      integrationId,
      createdAt: ISO_NOW,
    };

    const overview: SovereignOverviewSnapshot = {
      revision: 1,
      generatedAt: ISO_NOW,
      controlState: DEFAULT_GLOBAL_CONTROL_STATE,
      financialSummary: metrics,
      ventures: [
        {
          venture,
          activeObjectivesCount: 1,
          openOpportunitiesCount: 1,
          activeTasksCount: 1,
          pendingApprovalsCount: 1,
          collectedRevenueMinor: 80_000,
          confirmedExpensesMinor: 5_000,
          netProfitMinor: 73_800,
          pipelineValueMinor: 250_000,
          currency: "GBP",
          lastActivityAt: ISO_NOW,
        },
      ],
      blueprints: [],
      activeObjectives: [objective],
      pendingApprovals: [approval],
      activeTasks: [task],
      recentAuditEvents: [auditEvent],
      providerPool,
      integrationsSummary: {
        totalCount: 1,
        connectedCount: 0,
        configuredCount: 1,
        errorCount: 0,
        unconfiguredCount: 0,
        integrations: [integration],
      },
      recommendations: [],
    };

    const lead: Lead = {
      id: leadId,
      ventureId,
      name: "Alex Taylor",
      company: "Harbour Clinic",
      email: "alex@example.co.uk",
      phone: null,
      websiteUrl: "https://example.co.uk",
      source: "inbound",
      stage: "qualified",
      consents: [consent],
      notes: "Requested site quote",
      tags: ["uk"],
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const customer: Customer = {
      id: customerId,
      ventureId,
      leadId,
      name: "Alex Taylor",
      company: "Harbour Clinic",
      email: "alex@example.co.uk",
      phone: null,
      status: "active",
      consents: [consent],
      billingCurrency: "GBP",
      lifetimeCollectedMinor: 80_000,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const proposal: Proposal = {
      id: proposalId,
      ventureId,
      leadId,
      customerId,
      opportunityId,
      title: "Clinic Website Rebuild",
      summary: "Fixed-scope delivery",
      lineItems: [{ description: "Design and build", quantity: 1, unitAmountMinor: 150_000 }],
      subtotalMinor: 150_000,
      discountPct: 0,
      totalMinor: 150_000,
      currency: "GBP",
      status: "sent",
      approvalId,
      validUntil: null,
      sentAt: ISO_NOW,
      decidedAt: null,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const order: Order = {
      id: orderId,
      ventureId,
      customerId,
      proposalId,
      title: "Clinic Website Rebuild",
      amountMinor: 150_000,
      currency: "GBP",
      status: "in_delivery",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const invoice: Invoice = {
      id: invoiceId,
      ventureId,
      customerId,
      orderId,
      invoiceNumber: "INV-2026-0001",
      amountMinor: 80_000,
      paidAmountMinor: 80_000,
      currency: "GBP",
      status: "paid",
      paymentLinkUrl: null,
      externalInvoiceId: "in_test_1",
      issuedAt: ISO_NOW,
      dueAt: ISO_NOW,
      paidAt: ISO_NOW,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const communication: CommunicationRecord = {
      id: communicationId,
      ventureId,
      leadId,
      customerId,
      channel: "email",
      direction: "outbound",
      senderType: "ai_agent",
      aiDisclosed: true,
      consentVerified: true,
      subject: "Your website proposal",
      bodyPreview: "Hello Alex, this message was prepared by Sovereign AI assistant.",
      status: "sent",
      approvalId,
      sentAt: ISO_NOW,
      createdAt: ISO_NOW,
    };

    const ticket: SupportTicket = {
      id: ticketId,
      ventureId,
      customerId,
      orderId,
      subject: "Domain DNS update",
      summary: "Customer requested staging preview link.",
      status: "open",
      priority: "normal",
      handledBy: "ai_agent",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
      resolvedAt: null,
    };

    const voiceAgent: VoiceAgentConfig = {
      id: voiceAgentId,
      ventureId,
      name: "Reception Desk",
      providerIntegrationId: null,
      direction: "inbound",
      status: "draft",
      phoneNumberLabel: null,
      aiDisclosureGreeting: "Hello, you are speaking with an automated AI assistant.",
      recordingDisclosureEnabled: true,
      optOutPhraseEnabled: true,
      escalationNumberLabel: null,
      scriptSummary: "Qualify inbound enquiries and book callbacks.",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    };

    const artifact: CommercialArtifact = {
      id: artifactId,
      ventureId,
      taskId,
      opportunityId,
      kind: "proposal_document",
      title: "Scope PDF",
      summary: "Deliverables and milestones.",
      uri: null,
      createdAt: ISO_NOW,
    };

    const detail: SovereignVentureDetail = {
      venture,
      objectives: [objective],
      opportunities: [opportunity],
      tasks: [task],
      leads: [lead],
      customers: [customer],
      proposals: [proposal],
      orders: [order],
      invoices: [invoice],
      paymentLinks: [],
      communications: [communication],
      supportTickets: [ticket],
      voiceAgents: [voiceAgent],
      financialSummary: metrics,
      recentLedgerEntries: [ledgerEntry],
      approvals: [approval],
      preapprovalPolicies: [policy],
      artifacts: [artifact],
      auditEvents: [auditEvent],
      integrations: [integration],
    };

    expect(decodeOverview(encodeOverview(overview))).toEqual(overview);
    expect(overview.providerPool.members[0]?.quotaAvailability).toBe("unavailable");
    expect(overview.providerPool.members[0]?.quotaRemainingPct).toBeNull();
    expect(overview.financialSummary.collectedRevenueMinor).toBe(80_000);
    expect(overview.financialSummary.simulatedRevenueMinor).toBe(999_000);

    expect(decodeDetail(encodeDetail(detail))).toEqual(detail);

    const event: SovereignEvent = {
      version: 1,
      revision: 1,
      type: "snapshot",
      payload: overview,
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);

    expect(decodeVenture(venture)).toEqual(venture);
    expect(decodeApprovalRequest(approval)).toEqual(approval);
    expect(decodeAuditEvent(auditEvent)).toEqual(auditEvent);
    expect(decodeCommercialArtifact(artifact)).toEqual(artifact);
    expect(decodeLedgerEntry(ledgerEntry)).toEqual(ledgerEntry);
  });

  it("rejects malformed currency codes", () => {
    expect(Exit.isFailure(decodeGlobalControlStateExit({ reportingCurrency: "gbp" }))).toBe(true);
    expect(Exit.isFailure(decodeGlobalControlStateExit({ reportingCurrency: "POUNDS" }))).toBe(
      true,
    );
  });
});

describe("Sovereign RPC registration, permissions, and settings", () => {
  it("registers every Sovereign and provider-instance RPC in WsRpcGroup and CLIENT_GUARDED_RPC_SCOPES", () => {
    const sovereignMethods = Object.values(SOVEREIGN_WS_METHODS);
    const allNewMethods = [
      ...sovereignMethods,
      WS_METHODS.serverUpsertProviderInstance,
      WS_METHODS.serverRemoveProviderInstance,
    ];

    for (const method of allNewMethods) {
      expect(WsRpcGroup.requests.has(method), `${method} missing from WsRpcGroup`).toBe(true);
      expect(
        Object.hasOwn(CLIENT_GUARDED_RPC_SCOPES, method),
        `${method} missing from CLIENT_GUARDED_RPC_SCOPES`,
      ).toBe(true);
      expect(clientRpcRequiredScopes(method, undefined).length).toBeGreaterThan(0);
    }

    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.sovereignGetOverview]).toBe(AuthSovereignReadScope);
    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.sovereignCreateVenture]).toBe(
      AuthSovereignOperateScope,
    );
    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.sovereignDecideApproval]).toBe(
      AuthSovereignApproveScope,
    );
    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.sovereignTriggerEmergencyStop]).toBe(
      AuthSovereignAdminScope,
    );
    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.serverUpsertProviderInstance]).toBe(
      AuthProvidersManageScope,
    );
    expect(CLIENT_GUARDED_RPC_SCOPES[WS_METHODS.serverRemoveProviderInstance]).toBe(
      AuthProvidersManageScope,
    );

    expect(
      clientRpcRequiredScopes(WS_METHODS.sovereignUpsertIntegration, {
        category: "payments",
        providerKind: "stripe",
        displayName: "Stripe",
        secretValue: { provider: "onepassword", reference: "op://Vault/Stripe/key" },
      }),
    ).toEqual([AuthSovereignAdminScope, AuthProvidersManageScope]);
  });

  it("includes Sovereign scopes in standard owner grants with legacy fallback compatibility", () => {
    for (const scope of [
      AuthSovereignReadScope,
      AuthSovereignOperateScope,
      AuthSovereignApproveScope,
      AuthSovereignAdminScope,
    ] as const) {
      expect(AuthEnvironmentScope.literals).toContain(scope);
      expect(AuthStandardClientScopes).toContain(scope);
      expect(authScopeRequiredResponse(scope).requiredPermission).toBe(scope);
    }
  });

  it("defaults ClientSettings.sovereignAtmosphere to ambient and accepts valid patches", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sovereignAtmosphere).toBe("ambient");
    expect(decodeClientSettings({}).sovereignAtmosphere).toBe("ambient");
    expect(decodeClientSettings({ sovereignAtmosphere: "subtle" }).sovereignAtmosphere).toBe(
      "subtle",
    );
    expect(decodeClientSettingsPatch({ sovereignAtmosphere: "off" })).toEqual({
      sovereignAtmosphere: "off",
    });
  });
});
