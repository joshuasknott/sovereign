import {
  DEFAULT_PROVIDER_ROUTING_POLICY,
  DEFAULT_SECURITY_AUTHORISATION,
  DEFAULT_VENTURE_ACTION_MODES,
  DEFAULT_VENTURE_BUDGET_POLICY,
  DEFAULT_VENTURE_PERMISSION_POLICY,
  type VentureBlueprint,
  type VentureKind,
} from "@t3tools/contracts";

export interface VentureBlueprintMetadata {
  readonly blueprint: VentureBlueprint;
  readonly workflowStages: ReadonlyArray<string>;
  readonly defaultCapabilities: ReadonlyArray<string>;
  readonly complianceNotice: string | null;
  readonly costNotice: string | null;
}

const SOVEREIGN_BLUEPRINT_CATALOG: ReadonlyArray<VentureBlueprintMetadata> = [
  {
    blueprint: {
      templateKey: "dev_bounties",
      kind: "dev_bounties",
      name: "Development Bounties",
      description:
        "Discover funded software issues, evaluate eligibility and payout probability, implement verified patches, and submit pull requests after owner approval.",
      uiModules: [
        "operations",
        "bounties",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          external_submission: "require_approval",
          financial_expenditure: "deny",
          security_testing: "deny",
        },
        securityAuthorisation: DEFAULT_SECURITY_AUTHORISATION,
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "reasoning",
        requireTools: true,
      },
      requiredIntegrationCategories: ["source_control", "payments"],
      defaultWorkflowTags: ["bounty-triage", "patch-verification", "pr-submission"],
    },
    workflowStages: [
      "Discover funded issues",
      "Check contribution policy and AI disclosure rules",
      "Reproduce and implement verified fix",
      "Review diff and submit pull request",
      "Reconcile payout in financial ledger",
    ],
    defaultCapabilities: [
      "Repository triage",
      "Test-verified code patches",
      "Pull request drafting",
      "Payout reconciliation",
    ],
    complianceNotice:
      "Confirm each repository allows AI-assisted contributions and follow all submission guidelines before opening external pull requests.",
    costNotice: null,
  },
  {
    blueprint: {
      templateKey: "security_bounties",
      kind: "security_bounties",
      name: "Authorised Security Bug Bounties",
      description:
        "Strict scope-bound vulnerability research on explicitly authorised bug bounty programmes with mandatory owner authorisation and disclosure review.",
      uiModules: [
        "operations",
        "security_programmes",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          security_testing: "deny",
          external_submission: "require_approval",
          financial_expenditure: "deny",
        },
        securityAuthorisation: {
          ...DEFAULT_SECURITY_AUTHORISATION,
          authorised: false,
          targetScope: [],
          permittedMethods: [],
        },
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "frontier",
        requireTools: true,
      },
      requiredIntegrationCategories: ["source_control", "payments"],
      defaultWorkflowTags: ["scope-verification", "passive-analysis", "coordinated-disclosure"],
    },
    workflowStages: [
      "Record explicit written programme authorisation and target scope",
      "Validate target and permitted testing methods",
      "Perform bounded in-scope analysis and proof-of-concept drafting",
      "Owner review of coordinated disclosure report",
      "Track triage and verified bounty payout",
    ],
    defaultCapabilities: [
      "Scope enforcement",
      "Static and authorised analysis",
      "Coordinated disclosure report drafting",
      "Evidence bundling",
    ],
    complianceNotice:
      "Security testing is denied by default until explicit target scope, permitted methods, and an active authorisation window are configured by the owner.",
    costNotice: null,
  },
  {
    blueprint: {
      templateKey: "web_agency",
      kind: "web_agency",
      name: "Website & Software Agency",
      description:
        "Manage inbound client enquiries, consent-compliant outreach, quotations, milestone delivery, production deployments, and client invoicing.",
      uiModules: [
        "operations",
        "prospects_sales",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          customer_communication: "require_approval",
          marketing_campaign: "require_approval",
          contractual_commitment: "require_approval",
          production_deployment: "require_approval",
          refund: "require_approval",
        },
        maxAutonomousQuoteMinor: 0,
        maxDiscountPct: 0,
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "balanced",
        requireTools: true,
      },
      requiredIntegrationCategories: ["email", "payments", "hosting_deployment", "source_control"],
      defaultWorkflowTags: [
        "lead-qualification",
        "proposal-drafting",
        "staging-preview",
        "invoicing",
      ],
    },
    workflowStages: [
      "Capture enquiry and verify channel consent",
      "Draft quotation within pricing policy",
      "Deliver staging preview and client review",
      "Approve production deployment",
      "Issue invoice and reconcile verified payment",
    ],
    defaultCapabilities: [
      "CRM and consent tracking",
      "Quotation and proposal drafting",
      "Staging website builds",
      "Invoicing and support ticketing",
    ],
    complianceNotice:
      "All outbound emails and messages require verified UK PECR and GDPR lawful basis and immediate opt-out handling.",
    costNotice:
      "Hosting, domains, and third-party email APIs incur external vendor charges and stay gated until budgeted.",
  },
  {
    blueprint: {
      templateKey: "voice_ai",
      kind: "voice_ai",
      name: "Voice AI & Customer Support",
      description:
        "Configure transparent AI receptionists and support voice agents with mandatory AI identity disclosure, recording notice, opt-out handling, and human escalation.",
      uiModules: [
        "operations",
        "voice_agents",
        "prospects_sales",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          customer_communication: "require_approval",
          marketing_campaign: "require_approval",
          financial_expenditure: "require_approval",
          personal_data: "require_approval",
        },
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "fast",
        requireTools: true,
      },
      requiredIntegrationCategories: ["telephony_voice", "payments", "email"],
      defaultWorkflowTags: ["voice-script-review", "disclosure-check", "telephony-cost-tracking"],
    },
    workflowStages: [
      "Configure telephony provider and AI disclosure greeting",
      "Verify recording consent and opt-out escalation flow",
      "Run sandbox call simulation",
      "Approve live deployment",
      "Monitor telephony spend and client retainers",
    ],
    defaultCapabilities: [
      "Inbound call routing",
      "AI disclosure enforcement",
      "Human escalation handoff",
      "Per-minute telephony cost logging",
    ],
    complianceNotice:
      "Every voice agent must announce AI identity at call start, disclose recording when active, and honour opt-out or human transfer immediately.",
    costNotice:
      "Live telephony minutes, speech synthesis, and realtime voice inference incur per-minute external costs tracked separately in the ledger.",
  },
  {
    blueprint: {
      templateKey: "paid_tasks",
      kind: "paid_tasks",
      name: "Paid Tasks & Online Work",
      description:
        "Screen legitimate online work and freelance tasks with strict separation between AI-permitted tasks and human-only work, with zero human impersonation.",
      uiModules: [
        "operations",
        "paid_tasks",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          external_submission: "require_approval",
          account_modification: "deny",
          financial_expenditure: "deny",
        },
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "fast",
        requireTools: false,
      },
      requiredIntegrationCategories: ["payments"],
      defaultWorkflowTags: ["ai-policy-check", "deliverable-drafting", "payout-verification"],
    },
    workflowStages: [
      "Evaluate platform terms and AI permission status",
      "Filter out human-only or prohibited tasks",
      "Draft deliverable for owner review",
      "Submit only permitted work with honest disclosure",
      "Record verified payout",
    ],
    defaultCapabilities: [
      "Platform AI-policy classification",
      "Manual versus assisted separation",
      "Deliverable preparation",
      "Net hourly return tracking",
    ],
    complianceNotice:
      "Tasks that prohibit automated or AI assistance are automatically marked ineligible. Impersonating a human or bypassing verification controls is prohibited.",
    costNotice: null,
  },
  {
    blueprint: {
      templateKey: "digital_products",
      kind: "digital_products",
      name: "Digital Products",
      description:
        "Validate buyer demand first, build high-leverage templates, tools, or guides, and publish to connected storefronts only after owner approval.",
      uiModules: [
        "operations",
        "digital_products",
        "prospects_sales",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          external_submission: "require_approval",
          marketing_campaign: "require_approval",
          production_deployment: "require_approval",
          refund: "require_approval",
        },
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "balanced",
        requireTools: true,
      },
      requiredIntegrationCategories: ["commerce", "payments", "email"],
      defaultWorkflowTags: ["demand-validation", "asset-production", "storefront-listing"],
    },
    workflowStages: [
      "Run demand validation brief before building",
      "Produce product package and documentation",
      "Approve pricing and storefront listing",
      "Monitor verified checkout webhooks",
      "Handle buyer support and updates",
    ],
    defaultCapabilities: [
      "Demand validation gating",
      "Digital asset packaging",
      "Storefront checkout tracking",
      "Refund and fee reconciliation",
    ],
    complianceNotice:
      "Do not publish listings or paid marketing campaigns without owner review and verified licensing for bundled assets.",
    costNotice:
      "Storefront merchant-of-record fees and payment processor fees are deducted automatically in net profit calculations.",
  },
  {
    blueprint: {
      templateKey: "micro_saas",
      kind: "micro_saas",
      name: "Micro-SaaS Studio",
      description:
        "Validate willingness to pay before engineering, ship lean subscription software, monitor MRR and churn, and gate all hosting and billing actions.",
      uiModules: [
        "operations",
        "micro_saas",
        "prospects_sales",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: {
        ...DEFAULT_VENTURE_PERMISSION_POLICY,
        actionModes: {
          ...DEFAULT_VENTURE_ACTION_MODES,
          production_deployment: "require_approval",
          payment_processing: "require_approval",
          financial_expenditure: "require_approval",
          refund: "require_approval",
        },
      },
      defaultBudgetPolicy: {
        ...DEFAULT_VENTURE_BUDGET_POLICY,
        monthlyCapMinor: 0,
        discretionarySpendAllowed: false,
      },
      defaultRoutingPolicy: {
        ...DEFAULT_PROVIDER_ROUTING_POLICY,
        preferredTier: "reasoning",
        requireTools: true,
      },
      requiredIntegrationCategories: ["source_control", "hosting_deployment", "payments", "email"],
      defaultWorkflowTags: ["wtp-validation", "mvp-build", "billing-webhooks", "mrr-monitoring"],
    },
    workflowStages: [
      "Validate willingness to pay with target users",
      "Build minimal production-ready service",
      "Approve deployment and billing configuration",
      "Track verified MRR, hosting costs, and churn",
      "Resolve customer support tickets",
    ],
    defaultCapabilities: [
      "Willingness-to-pay validation gate",
      "Full-stack engineering workflows",
      "Subscription billing reconciliation",
      "MRR and unit-economics monitoring",
    ],
    complianceNotice:
      "Production deployments, customer data changes, and billing plan updates require explicit owner approval.",
    costNotice:
      "Cloud hosting, database, and transactional email charges are logged against venture budgets before net profit is reported.",
  },
  {
    blueprint: {
      templateKey: "custom",
      kind: "custom",
      name: "Custom Venture",
      description:
        "Flexible commercial venture template for newly discovered or owner-designed business models with conservative default guardrails.",
      uiModules: [
        "operations",
        "prospects_sales",
        "finances",
        "workspace_conversations",
        "approvals",
        "artifacts",
      ],
      defaultPermissionPolicy: DEFAULT_VENTURE_PERMISSION_POLICY,
      defaultBudgetPolicy: DEFAULT_VENTURE_BUDGET_POLICY,
      defaultRoutingPolicy: DEFAULT_PROVIDER_ROUTING_POLICY,
      requiredIntegrationCategories: ["payments"],
      defaultWorkflowTags: ["research", "validation", "execution"],
    },
    workflowStages: [
      "Define commercial hypothesis and guardrails",
      "Validate demand and legal compliance",
      "Execute bounded tasks within policy",
      "Measure verified revenue and expenses",
    ],
    defaultCapabilities: [
      "Custom workflow configuration",
      "Policy-gated external actions",
      "Financial ledger tracking",
    ],
    complianceNotice:
      "All external actions start in approval-required or deny mode until explicitly configured by the owner.",
    costNotice: null,
  },
];

export const SOVEREIGN_BLUEPRINTS: ReadonlyArray<VentureBlueprint> =
  SOVEREIGN_BLUEPRINT_CATALOG.map((entry) => entry.blueprint);

export function getVentureBlueprint(kindOrTemplateKey: VentureKind | string): VentureBlueprint {
  const matched = SOVEREIGN_BLUEPRINTS.find(
    (blueprint) =>
      blueprint.templateKey === kindOrTemplateKey || blueprint.kind === kindOrTemplateKey,
  );
  return matched ?? SOVEREIGN_BLUEPRINTS[SOVEREIGN_BLUEPRINTS.length - 1]!;
}
