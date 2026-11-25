import {
  type CommunicationRecord,
  CommunicationId,
  type ConsentChannel,
  type ConsentRecord,
  type CreateCommunicationInput,
  type CreateLeadInput,
  type CreateProposalInput,
  type CurrencyCode,
  type Customer,
  CustomerId,
  type Lead,
  LeadId,
  type Order,
  OrderId,
  type Proposal,
  ProposalId,
  type SupportTicket,
  SupportTicketId,
  type UpsertVoiceAgentInput,
  type VentureId,
  type VoiceAgentConfig,
  VoiceAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  SovereignPermissionError,
  SovereignValidationError,
} from "./SovereignErrors.ts";
import * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import * as SovereignStore from "./SovereignStore.ts";

export interface CreateCustomerInput {
  readonly ventureId: VentureId;
  readonly leadId?: LeadId | null;
  readonly name: string;
  readonly company?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly consents?: ReadonlyArray<ConsentRecord>;
  readonly billingCurrency?: CurrencyCode;
}

export interface CreateOrderInput {
  readonly ventureId: VentureId;
  readonly customerId: CustomerId;
  readonly proposalId?: ProposalId | null;
  readonly title: string;
  readonly amountMinor: number;
  readonly currency?: CurrencyCode;
}

export interface CreateSupportTicketInput {
  readonly ventureId: VentureId;
  readonly customerId: CustomerId;
  readonly orderId?: OrderId | null;
  readonly subject: string;
  readonly summary?: string;
  readonly priority?: SupportTicket["priority"];
  readonly handledBy?: SupportTicket["handledBy"];
}

const isOptedOutForChannel = (
  consents: ReadonlyArray<ConsentRecord>,
  channel: ConsentChannel,
): boolean =>
  consents.some(
    (record) =>
      (record.channel === channel || record.optedOut) &&
      (record.optedOut || record.status === "withdrawn"),
  );

const hasGrantedConsentForChannel = (
  consents: ReadonlyArray<ConsentRecord>,
  channel: ConsentChannel,
): boolean =>
  consents.some(
    (record) =>
      record.channel === channel &&
      !record.optedOut &&
      record.status === "granted" &&
      record.lawfulBasis !== "not_established",
  );

export class SovereignSalesService extends Context.Service<
  SovereignSalesService,
  {
    readonly createLead: (input: CreateLeadInput) => Effect.Effect<Lead, SovereignDomainError>;
    readonly createCustomer: (
      input: CreateCustomerInput,
    ) => Effect.Effect<Customer, SovereignDomainError>;
    readonly createProposal: (
      input: CreateProposalInput,
    ) => Effect.Effect<Proposal, SovereignDomainError>;
    readonly createOrder: (input: CreateOrderInput) => Effect.Effect<Order, SovereignDomainError>;
    readonly createCommunication: (
      input: CreateCommunicationInput,
    ) => Effect.Effect<CommunicationRecord, SovereignDomainError>;
    readonly createSupportTicket: (
      input: CreateSupportTicketInput,
    ) => Effect.Effect<SupportTicket, SovereignDomainError>;
    readonly upsertVoiceAgent: (
      input: UpsertVoiceAgentInput,
    ) => Effect.Effect<VoiceAgentConfig, SovereignDomainError>;
  }
>()("t3/sovereign/SovereignSalesService") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const governance = yield* SovereignGovernanceService.SovereignGovernanceService;
  const random = yield* SecureRandom.SecureRandom;

  const generateId = <Id extends string>(prefix: string, makeId: (value: string) => Id) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.map((uuid) => makeId(`${prefix}_${uuid.replace(/-/g, "")}`)),
    );

  const requireVenture = Effect.fnUntraced(function* (ventureId: VentureId) {
    const ventureOpt = yield* store.getVenture(ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: ventureId });
    }
    return ventureOpt.value;
  });

  const createLead = Effect.fn("SovereignSalesService.createLead")(function* (
    input: CreateLeadInput,
  ) {
    yield* requireVenture(input.ventureId);
    const now = yield* store.nowIso;
    const lead: Lead = {
      id: yield* generateId("lead", LeadId.make),
      ventureId: input.ventureId,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      websiteUrl: input.websiteUrl ?? null,
      source: input.source,
      stage: input.stage ?? "new",
      consents: input.consents ?? [],
      notes: input.notes ?? "",
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insertLead(lead);
    return lead;
  });

  const createCustomer = Effect.fn("SovereignSalesService.createCustomer")(function* (
    input: CreateCustomerInput,
  ) {
    yield* requireVenture(input.ventureId);
    const { controlState } = yield* store.getControlState;
    const now = yield* store.nowIso;
    const customer: Customer = {
      id: yield* generateId("cust", CustomerId.make),
      ventureId: input.ventureId,
      leadId: input.leadId ?? null,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: "active",
      consents: input.consents ?? [],
      billingCurrency: input.billingCurrency ?? controlState.reportingCurrency,
      lifetimeCollectedMinor: 0,
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insertCustomer(customer);
    return customer;
  });

  const createProposal = Effect.fn("SovereignSalesService.createProposal")(function* (
    input: CreateProposalInput,
  ) {
    const venture = yield* requireVenture(input.ventureId);
    if (input.lineItems.length === 0) {
      return yield* new SovereignValidationError({
        field: "lineItems",
        reason: "A proposal must contain at least one line item.",
      });
    }

    const subtotalMinor = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitAmountMinor,
      0,
    );
    const discountPct = input.discountPct ?? 0;
    const discountMinor = Math.round((subtotalMinor * discountPct) / 100);
    const totalMinor = Math.max(0, subtotalMinor - discountMinor);
    const currency = input.currency ?? venture.budgetPolicy.currency;

    const exceedsDiscountCeiling = discountPct > venture.permissionPolicy.maxDiscountPct;
    const exceedsAutonomousQuoteCeiling =
      totalMinor > venture.permissionPolicy.maxAutonomousQuoteMinor;
    const requiresApproval = exceedsDiscountCeiling || exceedsAutonomousQuoteCeiling;

    let approvalId: Proposal["approvalId"] = null;
    if (requiresApproval) {
      const reasons: Array<string> = [];
      if (exceedsDiscountCeiling) {
        reasons.push(
          `discount ${discountPct}% exceeds policy ceiling ${venture.permissionPolicy.maxDiscountPct}%`,
        );
      }
      if (exceedsAutonomousQuoteCeiling) {
        reasons.push(
          `quote total ${totalMinor} ${currency} exceeds autonomous ceiling ${venture.permissionPolicy.maxAutonomousQuoteMinor}`,
        );
      }
      const approval = yield* governance.requestApproval({
        ventureId: venture.id,
        category: "contractual_commitment",
        riskLevel: "high",
        title: `Approve proposal: ${input.title}`,
        summary: `Proposal requires owner sign-off because ${reasons.join(" and ")}.`,
        requestedAction: "send_proposal",
        estimatedCostMinor: totalMinor,
        currency,
        payload: {
          subtotalMinor,
          discountPct,
          totalMinor,
        },
        requestedBy: "sovereign_sales",
      });
      approvalId = approval.id;
    }

    const now = yield* store.nowIso;
    const proposal: Proposal = {
      id: yield* generateId("prop", ProposalId.make),
      ventureId: input.ventureId,
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      opportunityId: input.opportunityId ?? null,
      title: input.title,
      summary: input.summary ?? "",
      lineItems: input.lineItems,
      subtotalMinor,
      discountPct,
      totalMinor,
      currency,
      status: requiresApproval ? "pending_approval" : "draft",
      approvalId,
      validUntil: input.validUntil ?? null,
      sentAt: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insertProposal(proposal);
    return proposal;
  });

  const createOrder = Effect.fn("SovereignSalesService.createOrder")(function* (
    input: CreateOrderInput,
  ) {
    yield* requireVenture(input.ventureId);
    const customerOpt = yield* store.getCustomer(input.customerId);
    if (Option.isNone(customerOpt)) {
      return yield* new SovereignNotFoundError({ entity: "customer", id: input.customerId });
    }
    const now = yield* store.nowIso;
    const order: Order = {
      id: yield* generateId("ord", OrderId.make),
      ventureId: input.ventureId,
      customerId: input.customerId,
      proposalId: input.proposalId ?? null,
      title: input.title,
      amountMinor: input.amountMinor,
      currency: input.currency ?? customerOpt.value.billingCurrency,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insertOrder(order);
    return order;
  });

  const createCommunication = Effect.fn("SovereignSalesService.createCommunication")(function* (
    input: CreateCommunicationInput,
  ) {
    const venture = yield* requireVenture(input.ventureId);

    if (input.senderType === "ai_agent" && !input.aiDisclosed) {
      const reason =
        "AI-authored communications must disclose AI identity and cannot impersonate a human.";
      yield* governance.recordAuditEvent({
        kind: "permission_denied",
        severity: "warning",
        ventureId: venture.id,
        actor: "sovereign_sales",
        summary: reason,
        category: "customer_communication",
      });
      return yield* new SovereignPermissionError({
        code: "consent_required",
        reason,
        ventureId: venture.id,
      });
    }

    const lead =
      input.leadId !== undefined && input.leadId !== null
        ? yield* store.getLead(input.leadId).pipe(
            Effect.flatMap(
              Option.match({
                onSome: Effect.succeed,
                onNone: () =>
                  Effect.fail(new SovereignNotFoundError({ entity: "lead", id: input.leadId! })),
              }),
            ),
          )
        : undefined;

    const customer =
      input.customerId !== undefined && input.customerId !== null
        ? yield* store.getCustomer(input.customerId).pipe(
            Effect.flatMap(
              Option.match({
                onSome: Effect.succeed,
                onNone: () =>
                  Effect.fail(
                    new SovereignNotFoundError({ entity: "customer", id: input.customerId! }),
                  ),
              }),
            ),
          )
        : undefined;

    let status: CommunicationRecord["status"] = "received";
    let approvalId: CommunicationRecord["approvalId"] = null;
    let consentVerified = input.consentVerified;

    if (input.direction === "outbound") {
      const allConsents = [...(lead?.consents ?? []), ...(customer?.consents ?? [])];
      if (lead?.stage === "unsubscribed" || isOptedOutForChannel(allConsents, input.channel)) {
        const reason = `Outbound ${input.channel} blocked because recipient has opted out or unsubscribed.`;
        yield* governance.recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId: venture.id,
          actor: "sovereign_sales",
          summary: reason,
          category: "customer_communication",
        });
        return yield* new SovereignPermissionError({
          code: "consent_required",
          reason,
          ventureId: venture.id,
        });
      }

      const grantedInRecord = hasGrantedConsentForChannel(allConsents, input.channel);
      consentVerified = input.consentVerified || grantedInRecord;
      if (!consentVerified) {
        const reason = `Outbound ${input.channel} blocked because lawful consent is not verified for this recipient.`;
        yield* governance.recordAuditEvent({
          kind: "permission_denied",
          severity: "warning",
          ventureId: venture.id,
          actor: "sovereign_sales",
          summary: reason,
          category: "customer_communication",
        });
        return yield* new SovereignPermissionError({
          code: "consent_required",
          reason,
          ventureId: venture.id,
        });
      }

      const targetLabel =
        lead?.email ?? lead?.phone ?? customer?.email ?? customer?.phone ?? input.channel;
      const gate = yield* governance.assertAndGateExternalAction({
        ventureId: venture.id,
        category: "customer_communication",
        title: `Outbound ${input.channel} communication`,
        summary: input.subject ?? `Send ${input.channel} message to ${targetLabel}`,
        requestedAction: `send_${input.channel}`,
        targetLabel,
        channel: input.channel,
        requestedBy: input.senderType === "ai_agent" ? "ai_agent" : "owner",
      });

      if (gate.outcome === "approval_required") {
        status = "pending_approval";
        approvalId = gate.approval.id;
      } else {
        status = "queued";
      }
    }

    const now = yield* store.nowIso;
    const record: CommunicationRecord = {
      id: yield* generateId("comm", CommunicationId.make),
      ventureId: input.ventureId,
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      channel: input.channel,
      direction: input.direction,
      senderType: input.senderType,
      aiDisclosed: input.aiDisclosed,
      consentVerified,
      subject: input.subject ?? null,
      bodyPreview: input.bodyPreview,
      status,
      approvalId,
      sentAt: null,
      createdAt: now,
    };
    yield* store.insertCommunication(record);
    return record;
  });

  const createSupportTicket = Effect.fn("SovereignSalesService.createSupportTicket")(function* (
    input: CreateSupportTicketInput,
  ) {
    yield* requireVenture(input.ventureId);
    const customerOpt = yield* store.getCustomer(input.customerId);
    if (Option.isNone(customerOpt)) {
      return yield* new SovereignNotFoundError({ entity: "customer", id: input.customerId });
    }
    const now = yield* store.nowIso;
    const ticket: SupportTicket = {
      id: yield* generateId("tkt", SupportTicketId.make),
      ventureId: input.ventureId,
      customerId: input.customerId,
      orderId: input.orderId ?? null,
      subject: input.subject,
      summary: input.summary ?? "",
      status: "open",
      priority: input.priority ?? "normal",
      handledBy: input.handledBy ?? "ai_agent",
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    yield* store.insertSupportTicket(ticket);
    return ticket;
  });

  const upsertVoiceAgent = Effect.fn("SovereignSalesService.upsertVoiceAgent")(function* (
    input: UpsertVoiceAgentInput,
  ) {
    yield* requireVenture(input.ventureId);
    const status = input.status ?? "draft";
    if (
      status === "active" &&
      !/\b(?:ai|artificial intelligence|automated|virtual assistant)\b/i.test(
        input.aiDisclosureGreeting,
      )
    ) {
      return yield* new SovereignValidationError({
        field: "aiDisclosureGreeting",
        reason:
          "Active voice agents must clearly disclose AI or automated assistant identity in the greeting.",
      });
    }
    const now = yield* store.nowIso;
    const existing = input.id === undefined ? Option.none() : yield* store.getVoiceAgent(input.id);
    const id = input.id ?? (yield* generateId("va", VoiceAgentId.make));
    const agent: VoiceAgentConfig = {
      id,
      ventureId: input.ventureId,
      name: input.name,
      providerIntegrationId: input.providerIntegrationId ?? null,
      direction: input.direction,
      status,
      phoneNumberLabel: input.phoneNumberLabel ?? null,
      aiDisclosureGreeting: input.aiDisclosureGreeting,
      recordingDisclosureEnabled: input.recordingDisclosureEnabled ?? true,
      optOutPhraseEnabled: input.optOutPhraseEnabled ?? true,
      escalationNumberLabel: input.escalationNumberLabel ?? null,
      scriptSummary: input.scriptSummary ?? "",
      createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
      updatedAt: now,
    };
    yield* store.upsertVoiceAgent(agent);
    return agent;
  });

  return SovereignSalesService.of({
    createLead,
    createCustomer,
    createProposal,
    createOrder,
    createCommunication,
    createSupportTicket,
    upsertVoiceAgent,
  });
});

export const layer = Layer.effect(SovereignSalesService, make);
