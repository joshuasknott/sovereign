// @effect-diagnostics-next-line nodeBuiltinImport:off -- SHA-256 content checksum for persisted commercial artifacts.
import * as NodeCrypto from "node:crypto";
import {
  type CommercialArtifact,
  type CommercialTask,
  type CommercialTaskId,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type ObjectiveId,
  type Opportunity,
  type OpportunityId,
  type VentureId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface DigitalProductsDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export interface ProductDemandSignal {
  readonly source: string;
  readonly evidence: string;
  readonly strength: number;
}

export interface ProductDemandConceptInput {
  readonly externalId: string;
  readonly title: string;
  readonly summary: string;
  readonly targetAudience: string;
  readonly category: string;
  readonly priceMinor: number;
  readonly currency?: CurrencyCode;
  readonly demandSignals: ReadonlyArray<ProductDemandSignal>;
  readonly competitorGaps: ReadonlyArray<string>;
  readonly estimatedMonthlyUnitSales?: number;
  readonly objectiveId?: ObjectiveId | null;
}

export interface ValidateProductDemandResult {
  readonly opportunity: Opportunity;
  readonly briefArtifact: CommercialArtifact;
  readonly validationPassed: boolean;
  readonly demandScore: number;
  readonly rejectionReasons: ReadonlyArray<string>;
}

export interface BuildProductSpecInput {
  readonly version: string;
  readonly deliverableFiles: ReadonlyArray<string>;
  readonly licenseType: string;
  readonly docsOutline: ReadonlyArray<string>;
}

export interface BuildAndPackageProductResult {
  readonly opportunity: Opportunity;
  readonly tasks: ReadonlyArray<CommercialTask>;
  readonly packageArtifact: CommercialArtifact;
  readonly docsArtifact: CommercialArtifact;
}

export interface StorefrontListingInput {
  readonly platform: string;
  readonly title: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly currency?: CurrencyCode;
  readonly deliveryUrl?: string | null;
  readonly supportEmail?: string | null;
  readonly refundPolicyDays?: number;
  readonly selfHosted?: boolean;
}

export interface PrepareStorefrontListingResult {
  readonly opportunity: Opportunity;
  readonly listingArtifact: CommercialArtifact;
  readonly publicationGate: SovereignGovernanceService.GateExternalActionResult;
  readonly fulfilmentTasks: ReadonlyArray<CommercialTask>;
}

const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sha256Json = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(encodeJsonUnknown(value), "utf8").digest("hex");

export const validateProductDemand = Effect.fn(
  "VentureWorkflow.digitalProducts.validateProductDemand",
)(function* (
  deps: DigitalProductsDeps,
  ventureId: VentureId,
  concept: ProductDemandConceptInput,
): Effect.fn.Return<ValidateProductDemandResult, SovereignDomainError> {
  const ventureOpt = yield* deps.store.getVenture(ventureId);
  if (Option.isNone(ventureOpt)) {
    return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
  }
  if (!Number.isInteger(concept.priceMinor) || concept.priceMinor <= 0) {
    return yield* new SovereignValidationError({
      field: "priceMinor",
      reason: "Digital product priceMinor must be a positive integer.",
    });
  }

  const evidenceCombined = concept.demandSignals
    .map((signal) => `${signal.source}: ${signal.evidence}`)
    .join("\n");
  const sanitized = yield* deps.governance.sanitizeUntrustedContent({
    source: "digital_product_demand_research",
    rawText: `${concept.title}\n${concept.summary}\n${evidenceCombined}`,
    ventureId,
    actor: "digital_products_workflow",
  });

  const validSignals = concept.demandSignals.filter(
    (signal) => signal.evidence.trim().length >= 8 && Number.isFinite(signal.strength),
  );
  const validGaps = concept.competitorGaps.filter((gap) => gap.trim().length >= 5);

  const avgStrength =
    validSignals.length === 0
      ? 0
      : validSignals.reduce((sum, s) => sum + Math.min(1, Math.max(0, s.strength)), 0) /
        validSignals.length;
  const signalCountScore = Math.min(35, validSignals.length * 14);
  const strengthScore = Math.round(avgStrength * 40);
  const gapScore = Math.min(25, validGaps.length * 12);
  const demandScore = Math.min(100, signalCountScore + strengthScore + gapScore);

  const rejectionReasons: Array<string> = [];
  if (validSignals.length < 2) {
    rejectionReasons.push("Requires at least 2 concrete buyer demand signals before building.");
  }
  if (validGaps.length < 1) {
    rejectionReasons.push("Requires at least 1 documented competitor gap before building.");
  }
  if (demandScore < 60) {
    rejectionReasons.push(`Demand validation score ${demandScore}/100 is below 60/100 threshold.`);
  }
  if (sanitized.quarantined) {
    rejectionReasons.push("Research input triggered prompt-injection quarantine; review required.");
  }

  const validationPassed = rejectionReasons.length === 0;
  const currency =
    concept.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
  const estimatedMonthlySales = concept.estimatedMonthlyUnitSales ?? (validationPassed ? 20 : 2);
  const estimatedValueMinor = concept.priceMinor * estimatedMonthlySales;

  const opportunity = yield* deps.orchestrator.createOpportunity({
    ventureId,
    ...(concept.objectiveId === undefined ? {} : { objectiveId: concept.objectiveId }),
    title: concept.title.trim(),
    summary: concept.summary.trim(),
    source: "demand_validation_research",
    externalRef: concept.externalId.trim(),
    stage: validationPassed ? "qualified" : "evaluating",
    eligibilityStatus: validationPassed ? "eligible" : "needs_review",
    eligibilityNotes: validationPassed
      ? `Demand validation passed (${demandScore}/100) with ${validSignals.length} signal(s) and ${validGaps.length} competitor gap(s).`
      : rejectionReasons.join(" "),
    automationMode: "assisted",
    aiPermissionStatus: "permitted",
    estimatedValueMinor,
    currency,
    score: {
      overall: demandScore,
      expectedValueMinor: validationPassed ? Math.round(estimatedValueMinor * 0.6) : 0,
      currency,
      winProbability: validationPassed ? 0.6 : 0.15,
      effortHoursEstimate: 12,
      complianceFit: 1,
      rationale: validationPassed
        ? `Validated buyer demand (${demandScore}/100) for ${concept.targetAudience}.`
        : rejectionReasons.join(" "),
    },
    tags: ["digital_product", concept.category.toLowerCase()],
    metadata: {
      category: concept.category,
      targetAudience: concept.targetAudience,
      priceMinor: concept.priceMinor,
      demandScore,
      validationPassed,
      demandSignalCount: validSignals.length,
      competitorGapCount: validGaps.length,
      rejectionReasons,
    },
  });

  const briefArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    opportunityId: opportunity.id,
    kind: "research_brief",
    title: `Demand validation brief: ${concept.title.trim()}`,
    summary: validationPassed
      ? `Passed demand validation (${demandScore}/100) across ${validSignals.length} signals and ${validGaps.length} competitor gaps.`
      : `Held back from build (${demandScore}/100): ${rejectionReasons.join(" ")}`,
    mimeType: "application/json",
    sha256: sha256Json({
      concept: concept.title,
      demandScore,
      validationPassed,
      signals: validSignals,
      competitorGaps: validGaps,
    }),
    metadata: {
      demandScore,
      validationPassed,
      rejectionReasons,
    },
  });

  return {
    opportunity,
    briefArtifact,
    validationPassed,
    demandScore,
    rejectionReasons,
  };
});

export const buildAndPackageProduct = Effect.fn(
  "VentureWorkflow.digitalProducts.buildAndPackageProduct",
)(function* (
  deps: DigitalProductsDeps,
  ventureId: VentureId,
  opportunityId: OpportunityId,
  spec: BuildProductSpecInput,
): Effect.fn.Return<BuildAndPackageProductResult, SovereignDomainError> {
  const oppOpt = yield* deps.store.getOpportunity(opportunityId);
  if (Option.isNone(oppOpt) || oppOpt.value.ventureId !== ventureId) {
    return yield* new SovereignNotFoundError({ entity: "opportunity", id: opportunityId });
  }
  const opportunity = oppOpt.value;
  if (opportunity.metadata?.validationPassed !== true) {
    return yield* new SovereignValidationError({
      field: "opportunityId",
      reason: "Cannot build and package a digital product before demand validation has passed.",
    });
  }
  if (spec.deliverableFiles.length === 0) {
    return yield* new SovereignValidationError({
      field: "deliverableFiles",
      reason: "Digital product spec must declare at least one deliverable file.",
    });
  }

  const pipelineSpecs: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly complexity: CommercialTask["complexity"];
  }> = [
    {
      key: "build",
      title: `Build digital asset v${spec.version}: ${opportunity.title}`,
      description: `Produce deliverables (${spec.deliverableFiles.join(", ")}) with clean ${spec.licenseType} licensing.`,
      complexity: "high",
    },
    {
      key: "test",
      title: `Verify quality and licensing: ${opportunity.title}`,
      description:
        "Test templates/code assets end-to-end and verify all bundled files are licensed.",
      complexity: "medium",
    },
    {
      key: "docs",
      title: `Author buyer guide and documentation: ${opportunity.title}`,
      description: `Write onboarding guide covering: ${spec.docsOutline.join(", ") || "installation and usage"}.`,
      complexity: "low",
    },
    {
      key: "package",
      title: `Package release archive v${spec.version}: ${opportunity.title}`,
      description: "Generate versioned archive, checksum manifest, and release notes.",
      complexity: "low",
    },
  ];

  const tasks: Array<CommercialTask> = [];
  let prevTaskId: CommercialTaskId | undefined;
  for (const step of pipelineSpecs) {
    const task = yield* deps.orchestrator.createTask({
      ventureId,
      ...(opportunity.objectiveId === null ? {} : { objectiveId: opportunity.objectiveId }),
      opportunityId: opportunity.id,
      title: step.title,
      description: step.description,
      status: prevTaskId === undefined ? "ready" : "queued",
      complexity: step.complexity,
      priority: 75,
      idempotencyKey: `digital-product:${opportunity.id}:${spec.version}:${step.key}`,
      dependsOn: prevTaskId === undefined ? [] : [prevTaskId],
    });
    tasks.push(task);
    prevTaskId = task.id;
  }

  const packageTask = tasks[tasks.length - 1]!;
  const docsTask = tasks[2]!;
  const packageManifest = {
    opportunityId: opportunity.id,
    title: opportunity.title,
    version: spec.version,
    licenseType: spec.licenseType,
    deliverableFiles: spec.deliverableFiles,
  };

  const packageArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    taskId: packageTask.id,
    opportunityId: opportunity.id,
    kind: "digital_asset",
    title: `${opportunity.title} v${spec.version} release package`,
    summary: `Packaged ${spec.deliverableFiles.length} deliverable file(s) under ${spec.licenseType} license.`,
    mimeType: "application/zip",
    sha256: sha256Json(packageManifest),
    metadata: {
      version: spec.version,
      licenseType: spec.licenseType,
      deliverableFiles: spec.deliverableFiles,
    },
  });

  const docsArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    taskId: docsTask.id,
    opportunityId: opportunity.id,
    kind: "research_brief",
    title: `${opportunity.title} v${spec.version} buyer documentation`,
    summary: `Buyer quickstart and usage documentation covering ${spec.docsOutline.length} section(s).`,
    mimeType: "text/markdown",
    sha256: sha256Json({ title: opportunity.title, outline: spec.docsOutline }),
    metadata: {
      version: spec.version,
      docsOutline: spec.docsOutline,
    },
  });

  const updatedOpportunity = yield* deps.orchestrator.updateOpportunity({
    opportunityId: opportunity.id,
    stage: "in_progress",
    metadata: {
      ...opportunity.metadata,
      packagedVersion: spec.version,
      packageArtifactId: packageArtifact.id,
    },
  });

  return {
    opportunity: updatedOpportunity,
    tasks,
    packageArtifact,
    docsArtifact,
  };
});

export const prepareStorefrontListing = Effect.fn(
  "VentureWorkflow.digitalProducts.prepareStorefrontListing",
)(function* (
  deps: DigitalProductsDeps,
  ventureId: VentureId,
  opportunityId: OpportunityId,
  listing: StorefrontListingInput,
): Effect.fn.Return<PrepareStorefrontListingResult, SovereignDomainError> {
  const oppOpt = yield* deps.store.getOpportunity(opportunityId);
  if (Option.isNone(oppOpt) || oppOpt.value.ventureId !== ventureId) {
    return yield* new SovereignNotFoundError({ entity: "opportunity", id: opportunityId });
  }
  const opportunity = oppOpt.value;
  if (opportunity.metadata?.validationPassed !== true) {
    return yield* new SovereignValidationError({
      field: "opportunityId",
      reason: "Cannot prepare storefront listing for an unvalidated product.",
    });
  }

  const currency = listing.currency ?? opportunity.currency;
  const gateCategory =
    listing.selfHosted === true ? "production_deployment" : "external_submission";

  const listingArtifact = yield* deps.orchestrator.createArtifact({
    ventureId,
    opportunityId: opportunity.id,
    kind: "digital_asset",
    title: `Storefront listing draft (${listing.platform}): ${listing.title}`,
    summary: `Prepared listing at ${listing.priceMinor} ${currency} minor units with ${listing.refundPolicyDays ?? 14}-day refund policy.`,
    ...(listing.deliveryUrl === undefined ? {} : { uri: listing.deliveryUrl }),
    mimeType: "application/json",
    sha256: sha256Json(listing),
    metadata: {
      platform: listing.platform,
      priceMinor: listing.priceMinor,
      currency,
      supportEmail: listing.supportEmail ?? null,
      refundPolicyDays: listing.refundPolicyDays ?? 14,
    },
  });

  const publicationGate = yield* deps.governance.assertAndGateExternalAction({
    ventureId,
    ...(opportunity.objectiveId === null ? {} : { objectiveId: opportunity.objectiveId }),
    category: gateCategory,
    title: `Publish digital product listing on ${listing.platform}: ${listing.title}`,
    summary: `Owner approval required before publishing ${listing.title} (${listing.priceMinor} ${currency} minor) to ${listing.platform}.`,
    requestedAction: "publish_storefront_listing",
    targetLabel: listing.platform,
    riskLevel: gateCategory === "production_deployment" ? "critical" : "medium",
    payload: {
      opportunityId: opportunity.id,
      listingArtifactId: listingArtifact.id,
      platform: listing.platform,
      priceMinor: listing.priceMinor,
      currency,
    },
    requestedBy: "digital_products_workflow",
    idempotencyKey: `storefront-publish:${opportunity.id}:${listing.platform.toLowerCase()}`,
  });

  const fulfilmentTask = yield* deps.orchestrator.createTask({
    ventureId,
    opportunityId: opportunity.id,
    title: `Wire digital checkout fulfilment webhook (${listing.platform}): ${listing.title}`,
    description:
      "Connect verified checkout webhook to reconcile net revenue after merchant/processor fees and deliver asset download link.",
    status: publicationGate.outcome === "allowed" ? "ready" : "queued",
    complexity: "low",
    priority: 75,
    idempotencyKey: `digital-fulfilment:${opportunity.id}:${listing.platform.toLowerCase()}`,
  });

  const supportTask = yield* deps.orchestrator.createTask({
    ventureId,
    opportunityId: opportunity.id,
    title: `Configure buyer support and refund workflow: ${listing.title}`,
    description: `Route buyer enquiries (${listing.supportEmail ?? "owner support inbox"}) into Sovereign support tickets with approval-gated refunds.`,
    status: "queued",
    complexity: "low",
    priority: 65,
    idempotencyKey: `digital-support:${opportunity.id}:${listing.platform.toLowerCase()}`,
    dependsOn: [fulfilmentTask.id],
  });

  const updatedOpportunity = yield* deps.orchestrator.updateOpportunity({
    opportunityId: opportunity.id,
    stage: publicationGate.outcome === "allowed" ? "submitted" : "in_progress",
  });

  return {
    opportunity: updatedOpportunity,
    listingArtifact,
    publicationGate,
    fulfilmentTasks: [fulfilmentTask, supportTask],
  };
});
