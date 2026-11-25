// @effect-diagnostics-next-line nodeBuiltinImport:off -- SHA-256 content checksum for persisted commercial artifacts.
import * as NodeCrypto from "node:crypto";
import {
  type ApprovalRequest,
  type CommercialArtifact,
  type CommercialTask,
  type ConsentRecord,
  type CurrencyCode,
  type CustomerId,
  DEFAULT_REPORTING_CURRENCY,
  type IntegrationId,
  type LeadId,
  type LedgerEntry,
  type SupportTicket,
  type VentureId,
  type VoiceAgentConfig,
  type VoiceAgentDirection,
  type VoiceAgentId,
  type VoiceAgentStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignPermissionError,
  SovereignValidationError,
} from "../SovereignErrors.ts";
import type * as SovereignGovernanceService from "../SovereignGovernanceService.ts";
import type * as SovereignLedgerService from "../SovereignLedgerService.ts";
import type * as SovereignOrchestratorService from "../SovereignOrchestratorService.ts";
import type * as SovereignSalesService from "../SovereignSalesService.ts";
import type * as SovereignStore from "../SovereignStore.ts";

export interface VoiceAiDeps {
  readonly store: SovereignStore.SovereignStore["Service"];
  readonly governance: SovereignGovernanceService.SovereignGovernanceService["Service"];
  readonly ledger: SovereignLedgerService.SovereignLedgerService["Service"];
  readonly sales: SovereignSalesService.SovereignSalesService["Service"];
  readonly orchestrator: SovereignOrchestratorService.SovereignOrchestratorService["Service"];
}

export type VoiceAgentUsageMode = "internal_sovereign" | "client_retainer";

export interface ConfigureVoiceAgentInput {
  readonly id?: VoiceAgentId;
  readonly name: string;
  readonly providerIntegrationId?: IntegrationId | null;
  readonly direction: VoiceAgentDirection;
  readonly status?: VoiceAgentStatus;
  readonly phoneNumberLabel?: string | null;
  readonly aiDisclosureGreeting: string;
  readonly recordingDisclosureEnabled: boolean;
  readonly optOutPhraseEnabled?: boolean;
  readonly escalationNumberLabel?: string | null;
  readonly escalationRule: string;
  readonly estimatedCostPerMinuteMinor: number;
  readonly costCurrency?: CurrencyCode;
  readonly scriptSummary?: string;
  readonly usageMode?: VoiceAgentUsageMode;
  readonly clientMonthlyRetainerMinor?: number | null;
}

export interface ConfigureVoiceAgentResult {
  readonly voiceAgent: VoiceAgentConfig;
  readonly scriptArtifact: CommercialArtifact;
  readonly estimatedCostPerMinuteMinor: number;
  readonly costCurrency: CurrencyCode;
  readonly usageMode: VoiceAgentUsageMode;
}

export interface VoiceCallEventInput {
  readonly externalCallId: string;
  readonly direction: "inbound" | "callback";
  readonly callerName: string;
  readonly callerPhone?: string | null;
  readonly leadId?: LeadId | null;
  readonly customerId?: CustomerId | null;
  readonly intent:
    | "knowledge_qa"
    | "appointment_booking"
    | "enquiry_qualification"
    | "complex_escalation";
  readonly transcriptSummary: string;
  readonly durationSeconds: number;
  readonly costPerMinuteMinor: number;
  readonly currency?: CurrencyCode;
  readonly requestedAppointmentSlot?: string | null;
  readonly knowledgeBaseAnswer?: string | null;
  readonly escalationReason?: string | null;
}

export interface HandleVoiceInteractionResult {
  readonly voiceAgent: VoiceAgentConfig;
  readonly summaryArtifact: CommercialArtifact;
  readonly telephonyLedgerEntry: LedgerEntry;
  readonly supportTicket: SupportTicket | null;
  readonly escalationApproval: ApprovalRequest | null;
  readonly followUpTask: CommercialTask | null;
  readonly quarantined: boolean;
}

const AI_DISCLOSURE_RE = /\b(?:ai|artificial intelligence|automated|virtual assistant)\b/i;

const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sha256Json = (value: unknown): string =>
  NodeCrypto.createHash("sha256").update(encodeJsonUnknown(value), "utf8").digest("hex");

const hasPhoneCallbackConsent = (consents: ReadonlyArray<ConsentRecord>): boolean => {
  const optedOut = consents.some(
    (record) =>
      record.optedOut ||
      ((record.channel === "phone" || record.channel === "voice_ai") &&
        record.status === "withdrawn"),
  );
  if (optedOut) return false;
  return consents.some(
    (record) =>
      (record.channel === "phone" || record.channel === "voice_ai") &&
      !record.optedOut &&
      record.status === "granted" &&
      record.lawfulBasis !== "not_established",
  );
};

export const configureVoiceAgent = Effect.fn("VentureWorkflow.voiceAi.configureVoiceAgent")(
  function* (
    deps: VoiceAiDeps,
    ventureId: VentureId,
    config: ConfigureVoiceAgentInput,
  ): Effect.fn.Return<ConfigureVoiceAgentResult, SovereignDomainError> {
    const ventureOpt = yield* deps.store.getVenture(ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
    }

    if (!AI_DISCLOSURE_RE.test(config.aiDisclosureGreeting)) {
      return yield* new SovereignValidationError({
        field: "aiDisclosureGreeting",
        reason:
          "Voice agent greeting must explicitly disclose AI or automated assistant identity at call start.",
      });
    }
    if (config.escalationRule.trim().length === 0) {
      return yield* new SovereignValidationError({
        field: "escalationRule",
        reason: "Voice agent configuration must specify a clear human escalation rule.",
      });
    }
    if (
      config.status === "active" &&
      (config.escalationNumberLabel === undefined ||
        config.escalationNumberLabel === null ||
        config.escalationNumberLabel.trim().length === 0)
    ) {
      return yield* new SovereignValidationError({
        field: "escalationNumberLabel",
        reason: "Active voice agents must configure an escalationNumberLabel for human handoff.",
      });
    }
    if (
      !Number.isInteger(config.estimatedCostPerMinuteMinor) ||
      config.estimatedCostPerMinuteMinor <= 0
    ) {
      return yield* new SovereignValidationError({
        field: "estimatedCostPerMinuteMinor",
        reason:
          "Voice agents must declare a positive marginal telephony and inference cost per minute in minor units.",
      });
    }

    const usageMode: VoiceAgentUsageMode = config.usageMode ?? "internal_sovereign";
    const costCurrency =
      config.costCurrency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;
    const summaryText = [
      config.scriptSummary?.trim() || "Structured reception and customer support flow.",
      `Mode: ${usageMode}.`,
      `Escalation rule: ${config.escalationRule.trim()}.`,
      `Estimated marginal cost: ${config.estimatedCostPerMinuteMinor} ${costCurrency} minor/min.`,
      ...(config.clientMonthlyRetainerMinor !== undefined &&
      config.clientMonthlyRetainerMinor !== null
        ? [`Client monthly retainer: ${config.clientMonthlyRetainerMinor} ${costCurrency} minor.`]
        : []),
    ].join(" ");

    const voiceAgent = yield* deps.sales.upsertVoiceAgent({
      ...(config.id === undefined ? {} : { id: config.id }),
      ventureId,
      name: config.name.trim(),
      ...(config.providerIntegrationId === undefined
        ? {}
        : { providerIntegrationId: config.providerIntegrationId }),
      direction: config.direction,
      ...(config.status === undefined ? {} : { status: config.status }),
      ...(config.phoneNumberLabel === undefined
        ? {}
        : { phoneNumberLabel: config.phoneNumberLabel }),
      aiDisclosureGreeting: config.aiDisclosureGreeting.trim(),
      recordingDisclosureEnabled: config.recordingDisclosureEnabled,
      optOutPhraseEnabled: config.optOutPhraseEnabled ?? true,
      ...(config.escalationNumberLabel === undefined
        ? {}
        : { escalationNumberLabel: config.escalationNumberLabel }),
      scriptSummary: summaryText,
    });

    const scriptArtifact = yield* deps.orchestrator.createArtifact({
      ventureId,
      kind: "voice_script",
      title: `Voice agent configuration: ${voiceAgent.name}`,
      summary: summaryText,
      mimeType: "application/json",
      sha256: sha256Json({
        voiceAgentId: voiceAgent.id,
        aiDisclosureGreeting: voiceAgent.aiDisclosureGreeting,
        recordingDisclosureEnabled: voiceAgent.recordingDisclosureEnabled,
        escalationRule: config.escalationRule,
        estimatedCostPerMinuteMinor: config.estimatedCostPerMinuteMinor,
        costCurrency,
        usageMode,
      }),
      metadata: {
        voiceAgentId: voiceAgent.id,
        usageMode,
        estimatedCostPerMinuteMinor: config.estimatedCostPerMinuteMinor,
        costCurrency,
        clientMonthlyRetainerMinor: config.clientMonthlyRetainerMinor ?? null,
        recordingDisclosureEnabled: voiceAgent.recordingDisclosureEnabled,
      },
    });

    return {
      voiceAgent,
      scriptArtifact,
      estimatedCostPerMinuteMinor: config.estimatedCostPerMinuteMinor,
      costCurrency,
      usageMode,
    };
  },
);

export const handleVoiceInteraction = Effect.fn("VentureWorkflow.voiceAi.handleVoiceInteraction")(
  function* (
    deps: VoiceAiDeps,
    ventureId: VentureId,
    voiceAgentId: VoiceAgentId,
    callEvent: VoiceCallEventInput,
  ): Effect.fn.Return<HandleVoiceInteractionResult, SovereignDomainError> {
    const ventureOpt = yield* deps.store.getVenture(ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
    }
    const agentOpt = yield* deps.store.getVoiceAgent(voiceAgentId);
    if (Option.isNone(agentOpt) || agentOpt.value.ventureId !== ventureId) {
      return yield* new SovereignNotFoundError({ entity: "voice_agent", id: voiceAgentId });
    }
    if (!Number.isInteger(callEvent.costPerMinuteMinor) || callEvent.costPerMinuteMinor <= 0) {
      return yield* new SovereignValidationError({
        field: "costPerMinuteMinor",
        reason: "Voice interaction must report a positive marginal costPerMinuteMinor.",
      });
    }
    if (!Number.isFinite(callEvent.durationSeconds) || callEvent.durationSeconds <= 0) {
      return yield* new SovereignValidationError({
        field: "durationSeconds",
        reason: "Call durationSeconds must be positive.",
      });
    }

    const lead =
      callEvent.leadId !== undefined && callEvent.leadId !== null
        ? Option.getOrUndefined(yield* deps.store.getLead(callEvent.leadId))
        : undefined;
    const customer =
      callEvent.customerId !== undefined && callEvent.customerId !== null
        ? Option.getOrUndefined(yield* deps.store.getCustomer(callEvent.customerId))
        : undefined;

    if (callEvent.direction === "callback") {
      const consents = [...(lead?.consents ?? []), ...(customer?.consents ?? [])];
      if (lead?.stage === "unsubscribed" || !hasPhoneCallbackConsent(consents)) {
        const reason =
          "Voice callback blocked because recipient does not have verified non-opted-out phone consent.";
        yield* deps.governance.recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId,
          actor: "voice_ai_workflow",
          summary: reason,
          category: "customer_communication",
        });
        return yield* new SovereignPermissionError({
          code: "consent_required",
          reason,
          ventureId,
        });
      }
    }

    const sanitizedTranscript = yield* deps.governance.sanitizeUntrustedContent({
      source: "voice_call_transcript",
      rawText: callEvent.transcriptSummary,
      ventureId,
      actor: "voice_ai_workflow",
    });

    const billableMinutes = Math.max(1, Math.ceil(callEvent.durationSeconds / 60));
    const totalCostMinor = billableMinutes * callEvent.costPerMinuteMinor;
    const currency =
      callEvent.currency ?? ventureOpt.value.budgetPolicy.currency ?? DEFAULT_REPORTING_CURRENCY;

    const telephonyLedgerEntry = yield* deps.ledger.recordEntry(
      {
        ventureId,
        entryType: "telephony_cost",
        verificationState: "verified",
        amountMinor: totalCostMinor,
        currency,
        description: `Voice AI call ${callEvent.externalCallId} (${billableMinutes} min via ${agentOpt.value.name})`,
        externalRef: `voice-call:${callEvent.externalCallId.trim()}`,
      },
      { recordedBy: "voice_ai_workflow" },
    );

    let supportTicket: SupportTicket | null = null;
    let escalationApproval: ApprovalRequest | null = null;
    let followUpTask: CommercialTask | null = null;

    if (callEvent.intent === "complex_escalation") {
      const resolvedCustomer =
        customer ??
        (yield* deps.sales.createCustomer({
          ventureId,
          leadId: lead?.id ?? null,
          name: callEvent.callerName,
          phone: callEvent.callerPhone ?? null,
          consents: lead?.consents ?? [],
          billingCurrency: currency,
        }));

      supportTicket = yield* deps.sales.createSupportTicket({
        ventureId,
        customerId: resolvedCustomer.id,
        subject: `Voice escalation: ${callEvent.callerName}`,
        summary:
          callEvent.escalationReason ??
          `Escalated from voice agent ${agentOpt.value.name}: ${sanitizedTranscript.sanitizedText.slice(0, 300)}`,
        priority: "high",
        handledBy: "human",
      });

      escalationApproval = yield* deps.governance.requestApproval({
        ventureId,
        category: "customer_communication",
        riskLevel: "high",
        title: `Human voice escalation for ${callEvent.callerName}`,
        summary:
          callEvent.escalationReason ??
          `Complex customer call escalated to human operator (ticket ${supportTicket.id}).`,
        requestedAction: "human_voice_escalation_handoff",
        targetLabel: callEvent.callerPhone ?? callEvent.callerName,
        payload: {
          supportTicketId: supportTicket.id,
          voiceAgentId,
          externalCallId: callEvent.externalCallId,
        },
        requestedBy: "voice_ai_workflow",
        idempotencyKey: `voice-escalation:${callEvent.externalCallId}`,
      });
    } else if (
      callEvent.intent === "appointment_booking" ||
      callEvent.intent === "enquiry_qualification"
    ) {
      followUpTask = yield* deps.orchestrator.createTask({
        ventureId,
        title:
          callEvent.intent === "appointment_booking"
            ? `Confirm booked appointment for ${callEvent.callerName}`
            : `Follow up qualified voice enquiry from ${callEvent.callerName}`,
        description:
          callEvent.requestedAppointmentSlot !== undefined &&
          callEvent.requestedAppointmentSlot !== null
            ? `Requested slot: ${callEvent.requestedAppointmentSlot}. Transcript summary captured in call artifact.`
            : "Review qualified caller enquiry and prepare next commercial step.",
        status: "ready",
        complexity: "low",
        priority: 75,
        idempotencyKey: `voice-followup:${callEvent.externalCallId}`,
      });
    }

    const callSummaryPayload = {
      externalCallId: callEvent.externalCallId,
      voiceAgentId,
      direction: callEvent.direction,
      intent: callEvent.intent,
      callerName: callEvent.callerName,
      durationSeconds: callEvent.durationSeconds,
      billableMinutes,
      totalCostMinor,
      currency,
      aiDisclosed: true,
      recordingDisclosureEnabled: agentOpt.value.recordingDisclosureEnabled,
      knowledgeBaseAnswer: callEvent.knowledgeBaseAnswer ?? null,
      requestedAppointmentSlot: callEvent.requestedAppointmentSlot ?? null,
      supportTicketId: supportTicket?.id ?? null,
    };

    const summaryArtifact = yield* deps.orchestrator.createArtifact({
      ventureId,
      ...(followUpTask === null ? {} : { taskId: followUpTask.id }),
      kind: "voice_script",
      title: `Voice call summary: ${callEvent.callerName} (${callEvent.intent})`,
      summary: `Handled ${callEvent.direction} call (${billableMinutes} min, ${totalCostMinor} ${currency} minor cost) with AI disclosure active.`,
      mimeType: "application/json",
      sha256: sha256Json(callSummaryPayload),
      metadata: {
        externalCallId: callEvent.externalCallId,
        voiceAgentId,
        direction: callEvent.direction,
        intent: callEvent.intent,
        billableMinutes,
        totalCostMinor,
        currency,
        supportTicketId: supportTicket?.id ?? null,
        quarantined: sanitizedTranscript.quarantined,
      },
    });

    return {
      voiceAgent: agentOpt.value,
      summaryArtifact,
      telephonyLedgerEntry,
      supportTicket,
      escalationApproval,
      followUpTask,
      quarantined: sanitizedTranscript.quarantined,
    };
  },
);
