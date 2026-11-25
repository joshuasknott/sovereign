import type {
  ConsentChannel,
  CurrencyCode,
  LeadId,
  OpportunityId,
  ProposalId,
  ProviderPoolSnapshot,
  VentureId,
  VoiceAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SovereignDomainError, SovereignPersistenceError } from "../SovereignErrors.ts";
import * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import * as SovereignLedgerService from "../SovereignLedgerService.ts";
import * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import * as SovereignSalesService from "../SovereignSalesService.ts";
import * as SovereignStore from "../SovereignStore.ts";
import * as CustomVenture from "./customVenture.ts";
import * as DevBounties from "./devBounties.ts";
import * as DigitalProducts from "./digitalProducts.ts";
import * as MicroSaas from "./microSaas.ts";
import * as PaidTasks from "./paidTasks.ts";
import * as SandboxFixtures from "./sandboxFixtures.ts";
import * as SecurityBounties from "./securityBounties.ts";
import * as VoiceAi from "./voiceAi.ts";
import * as WebAgency from "./webAgency.ts";

export class VentureWorkflowEngine extends Context.Service<
  VentureWorkflowEngine,
  {
    // Venture 1: Development Bounties
    readonly evaluateBountyIssue: (
      ventureId: VentureId,
      rawIssue: DevBounties.RawBountyIssueInput,
    ) => Effect.Effect<DevBounties.EvaluateBountyIssueResult, SovereignDomainError>;
    readonly planBountyExecution: (
      ventureId: VentureId,
      opportunityId: OpportunityId,
    ) => Effect.Effect<DevBounties.PlanBountyExecutionResult, SovereignDomainError>;
    readonly reconcileBountyPayout: (
      ventureId: VentureId,
      opportunityId: OpportunityId,
      amountMinor: number,
      currency: CurrencyCode,
      externalRef: string,
    ) => Effect.Effect<DevBounties.ReconcileBountyPayoutResult, SovereignDomainError>;

    // Venture 2: Authorised Security Bug Bounties
    readonly registerSecurityProgramme: (
      ventureId: VentureId,
      programme: SecurityBounties.RegisterSecurityProgrammeInput,
    ) => Effect.Effect<SecurityBounties.RegisterSecurityProgrammeResult, SovereignDomainError>;
    readonly executeAuthorisedSecurityAssessment: (
      ventureId: VentureId,
      target: string,
      method: string,
      options?: SecurityBounties.ExecuteSecurityAssessmentOptions,
    ) => Effect.Effect<SecurityBounties.ExecuteSecurityAssessmentResult, SovereignDomainError>;
    // Venture 3: Website & Software Agency
    readonly auditProspectAndQualify: (
      ventureId: VentureId,
      prospect: WebAgency.ProspectAuditInput,
    ) => Effect.Effect<WebAgency.AuditProspectResult, SovereignDomainError>;
    readonly createPersonalisedDemoAndProposal: (
      ventureId: VentureId,
      leadId: LeadId,
      scope: WebAgency.DemoAndProposalScopeInput,
    ) => Effect.Effect<WebAgency.CreateDemoAndProposalResult, SovereignDomainError>;
    readonly sendPermittedOutreach: (
      ventureId: VentureId,
      leadId: LeadId,
      channel: ConsentChannel,
      message: WebAgency.OutreachMessageInput,
      isCampaign: boolean,
    ) => Effect.Effect<WebAgency.SendPermittedOutreachResult, SovereignDomainError>;
    readonly onboardAndFulfilOrder: (
      ventureId: VentureId,
      proposalId: ProposalId,
    ) => Effect.Effect<WebAgency.OnboardAndFulfilOrderResult, SovereignDomainError>;

    // Venture 4: Voice AI & Customer Support
    readonly configureVoiceAgent: (
      ventureId: VentureId,
      config: VoiceAi.ConfigureVoiceAgentInput,
    ) => Effect.Effect<VoiceAi.ConfigureVoiceAgentResult, SovereignDomainError>;
    readonly handleVoiceInteraction: (
      ventureId: VentureId,
      voiceAgentId: VoiceAgentId,
      callEvent: VoiceAi.VoiceCallEventInput,
    ) => Effect.Effect<VoiceAi.HandleVoiceInteractionResult, SovereignDomainError>;

    // Venture 5: Paid Tasks & Online Work
    readonly classifyAndIngestOnlineWork: (
      ventureId: VentureId,
      taskOffer: PaidTasks.OnlineWorkOfferInput,
    ) => Effect.Effect<PaidTasks.ClassifyOnlineWorkResult, SovereignDomainError>;
    readonly partitionWorkQueues: (
      ventureId: VentureId,
    ) => Effect.Effect<PaidTasks.PartitionedWorkQueues, SovereignPersistenceError>;

    // Venture 6: Digital Products
    readonly validateProductDemand: (
      ventureId: VentureId,
      concept: DigitalProducts.ProductDemandConceptInput,
    ) => Effect.Effect<DigitalProducts.ValidateProductDemandResult, SovereignDomainError>;
    readonly buildAndPackageProduct: (
      ventureId: VentureId,
      opportunityId: OpportunityId,
      spec: DigitalProducts.BuildProductSpecInput,
    ) => Effect.Effect<DigitalProducts.BuildAndPackageProductResult, SovereignDomainError>;
    readonly prepareStorefrontListing: (
      ventureId: VentureId,
      opportunityId: OpportunityId,
      listing: DigitalProducts.StorefrontListingInput,
    ) => Effect.Effect<DigitalProducts.PrepareStorefrontListingResult, SovereignDomainError>;

    // Venture 7: Micro-SaaS Studio
    readonly validateWillingnessToPay: (
      ventureId: VentureId,
      problem: MicroSaas.MicroSaasProblemInput,
    ) => Effect.Effect<MicroSaas.ValidateWillingnessToPayResult, SovereignDomainError>;
    readonly launchMicroSaasPipeline: (
      ventureId: VentureId,
      opportunityId: OpportunityId,
      spec: MicroSaas.MicroSaasLaunchSpec,
    ) => Effect.Effect<MicroSaas.LaunchMicroSaasPipelineResult, SovereignDomainError>;
    readonly evaluateProductPortfolioHealth: (
      ventureId: VentureId,
    ) => Effect.Effect<MicroSaas.ProductPortfolioHealthResult, SovereignDomainError>;

    // Dynamic Custom Ventures
    readonly proposeNewVenturesFromObjective: (
      directive: CustomVenture.VentureObjectiveDirectiveInput,
      availablePoolSnapshot?: ProviderPoolSnapshot,
    ) => Effect.Effect<CustomVenture.ProposeNewVenturesResult, SovereignDomainError>;
    readonly instantiateDynamicVenture: (
      proposal: CustomVenture.DynamicVentureProposal,
      options?: CustomVenture.InstantiateDynamicVentureOptions,
    ) => Effect.Effect<CustomVenture.InstantiateDynamicVentureResult, SovereignDomainError>;

    // Opt-in Sandbox Commercial Fixture
    readonly loadSandboxCommercialFixture: () => Effect.Effect<
      SandboxFixtures.LoadSandboxFixtureResult,
      SovereignDomainError
    >;
  }
>()("t3/sovereign/ventures/VentureWorkflowEngine") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const governance = yield* SovereignGovernanceService.SovereignGovernanceService;
  const ledger = yield* SovereignLedgerService.SovereignLedgerService;
  const sales = yield* SovereignSalesService.SovereignSalesService;
  const orchestrator = yield* SovereignOrchestratorService.SovereignOrchestratorService;

  const deps = { store, governance, ledger, sales, orchestrator };

  return VentureWorkflowEngine.of({
    evaluateBountyIssue: Effect.fn("VentureWorkflowEngine.evaluateBountyIssue")(
      (ventureId, rawIssue) => DevBounties.evaluateBountyIssue(deps, ventureId, rawIssue),
    ),
    planBountyExecution: Effect.fn("VentureWorkflowEngine.planBountyExecution")(
      (ventureId, opportunityId) => DevBounties.planBountyExecution(deps, ventureId, opportunityId),
    ),
    reconcileBountyPayout: Effect.fn("VentureWorkflowEngine.reconcileBountyPayout")(
      (ventureId, opportunityId, amountMinor, currency, externalRef) =>
        DevBounties.reconcileBountyPayout(
          deps,
          ventureId,
          opportunityId,
          amountMinor,
          currency,
          externalRef,
        ),
    ),

    registerSecurityProgramme: Effect.fn("VentureWorkflowEngine.registerSecurityProgramme")(
      (ventureId, programme) =>
        SecurityBounties.registerSecurityProgramme(deps, ventureId, programme),
    ),
    executeAuthorisedSecurityAssessment: Effect.fn(
      "VentureWorkflowEngine.executeAuthorisedSecurityAssessment",
    )((ventureId, target, method, options) =>
      SecurityBounties.executeAuthorisedSecurityAssessment(
        deps,
        ventureId,
        target,
        method,
        options,
      ),
    ),
    auditProspectAndQualify: Effect.fn("VentureWorkflowEngine.auditProspectAndQualify")(
      (ventureId, prospect) => WebAgency.auditProspectAndQualify(deps, ventureId, prospect),
    ),
    createPersonalisedDemoAndProposal: Effect.fn(
      "VentureWorkflowEngine.createPersonalisedDemoAndProposal",
    )((ventureId, leadId, scope) =>
      WebAgency.createPersonalisedDemoAndProposal(deps, ventureId, leadId, scope),
    ),
    sendPermittedOutreach: Effect.fn("VentureWorkflowEngine.sendPermittedOutreach")(
      (ventureId, leadId, channel, message, isCampaign) =>
        WebAgency.sendPermittedOutreach(deps, ventureId, leadId, channel, message, isCampaign),
    ),
    onboardAndFulfilOrder: Effect.fn("VentureWorkflowEngine.onboardAndFulfilOrder")(
      (ventureId, proposalId) => WebAgency.onboardAndFulfilOrder(deps, ventureId, proposalId),
    ),

    configureVoiceAgent: Effect.fn("VentureWorkflowEngine.configureVoiceAgent")(
      (ventureId, config) => VoiceAi.configureVoiceAgent(deps, ventureId, config),
    ),
    handleVoiceInteraction: Effect.fn("VentureWorkflowEngine.handleVoiceInteraction")(
      (ventureId, voiceAgentId, callEvent) =>
        VoiceAi.handleVoiceInteraction(deps, ventureId, voiceAgentId, callEvent),
    ),

    classifyAndIngestOnlineWork: Effect.fn("VentureWorkflowEngine.classifyAndIngestOnlineWork")(
      (ventureId, taskOffer) => PaidTasks.classifyAndIngestOnlineWork(deps, ventureId, taskOffer),
    ),
    partitionWorkQueues: Effect.fn("VentureWorkflowEngine.partitionWorkQueues")((ventureId) =>
      PaidTasks.partitionWorkQueues(deps, ventureId),
    ),

    validateProductDemand: Effect.fn("VentureWorkflowEngine.validateProductDemand")(
      (ventureId, concept) => DigitalProducts.validateProductDemand(deps, ventureId, concept),
    ),
    buildAndPackageProduct: Effect.fn("VentureWorkflowEngine.buildAndPackageProduct")(
      (ventureId, opportunityId, spec) =>
        DigitalProducts.buildAndPackageProduct(deps, ventureId, opportunityId, spec),
    ),
    prepareStorefrontListing: Effect.fn("VentureWorkflowEngine.prepareStorefrontListing")(
      (ventureId, opportunityId, listing) =>
        DigitalProducts.prepareStorefrontListing(deps, ventureId, opportunityId, listing),
    ),

    validateWillingnessToPay: Effect.fn("VentureWorkflowEngine.validateWillingnessToPay")(
      (ventureId, problem) => MicroSaas.validateWillingnessToPay(deps, ventureId, problem),
    ),
    launchMicroSaasPipeline: Effect.fn("VentureWorkflowEngine.launchMicroSaasPipeline")(
      (ventureId, opportunityId, spec) =>
        MicroSaas.launchMicroSaasPipeline(deps, ventureId, opportunityId, spec),
    ),
    evaluateProductPortfolioHealth: Effect.fn(
      "VentureWorkflowEngine.evaluateProductPortfolioHealth",
    )((ventureId) => MicroSaas.evaluateProductPortfolioHealth(deps, ventureId)),

    proposeNewVenturesFromObjective: Effect.fn(
      "VentureWorkflowEngine.proposeNewVenturesFromObjective",
    )((directive, availablePoolSnapshot) =>
      CustomVenture.proposeNewVenturesFromObjective(deps, directive, availablePoolSnapshot),
    ),
    instantiateDynamicVenture: Effect.fn("VentureWorkflowEngine.instantiateDynamicVenture")(
      (proposal, options) => CustomVenture.instantiateDynamicVenture(deps, proposal, options),
    ),

    loadSandboxCommercialFixture: Effect.fn("VentureWorkflowEngine.loadSandboxCommercialFixture")(
      () => SandboxFixtures.loadSandboxCommercialFixture(deps),
    ),
  });
});

export const layer = Layer.effect(VentureWorkflowEngine, make);
