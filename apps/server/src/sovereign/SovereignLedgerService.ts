import {
  type CreateInvoiceInput,
  type CurrencyCode,
  DEFAULT_REPORTING_CURRENCY,
  type FinancialPipelineMetrics,
  type FxRatesToGbp,
  type Invoice,
  InvoiceId,
  type LedgerEntry,
  LedgerEntryId,
  type LedgerVerificationState,
  type RecordLedgerEntryInput,
  type VentureId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type SovereignDomainError,
  SovereignNotFoundError,
  type SovereignPersistenceError,
  SovereignValidationError,
} from "./SovereignErrors.ts";
import * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import * as SovereignStore from "./SovereignStore.ts";

export interface DetailedCostBreakdown {
  readonly reportingCurrency: CurrencyCode;
  readonly confirmedExpensesMinor: number;
  readonly paymentFeesMinor: number;
  readonly inferenceCostMinor: number;
  readonly hostingCostMinor: number;
  readonly deploymentCostMinor: number;
  readonly telephonyCostMinor: number;
  readonly subscriptionAllocationMinor: number;
  readonly refundsMinor: number;
}

function convertMinorAmount(input: {
  readonly amountMinor: number;
  readonly fromCurrency: CurrencyCode;
  readonly toCurrency: CurrencyCode;
  readonly fxRatesToGbp: FxRatesToGbp;
}): Effect.Effect<
  { readonly convertedMinor: number; readonly fxRateToGbp: number },
  SovereignValidationError
> {
  const fromRate =
    input.fromCurrency === DEFAULT_REPORTING_CURRENCY ? 1 : input.fxRatesToGbp[input.fromCurrency];
  if (fromRate === undefined || !Number.isFinite(fromRate) || fromRate <= 0) {
    return Effect.fail(
      new SovereignValidationError({
        field: "currency",
        reason: `No FX rate to GBP is configured for ${input.fromCurrency}.`,
      }),
    );
  }
  const toRate =
    input.toCurrency === DEFAULT_REPORTING_CURRENCY ? 1 : input.fxRatesToGbp[input.toCurrency];
  if (toRate === undefined || !Number.isFinite(toRate) || toRate <= 0) {
    return Effect.fail(
      new SovereignValidationError({
        field: "reportingCurrency",
        reason: `No FX rate to GBP is configured for ${input.toCurrency}.`,
      }),
    );
  }
  const gbpMinor =
    input.fromCurrency === DEFAULT_REPORTING_CURRENCY
      ? input.amountMinor
      : Math.round(input.amountMinor * fromRate);
  const convertedMinor =
    input.toCurrency === DEFAULT_REPORTING_CURRENCY ? gbpMinor : Math.round(gbpMinor / toRate);
  return Effect.succeed({ convertedMinor, fxRateToGbp: fromRate });
}

const convertOrFallback = (
  amountMinor: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  fxRatesToGbp: FxRatesToGbp,
): number => {
  const fromRate =
    fromCurrency === DEFAULT_REPORTING_CURRENCY ? 1 : (fxRatesToGbp[fromCurrency] ?? 1);
  const toRate = toCurrency === DEFAULT_REPORTING_CURRENCY ? 1 : (fxRatesToGbp[toCurrency] ?? 1);
  const gbpMinor = Math.round(amountMinor * fromRate);
  return toCurrency === DEFAULT_REPORTING_CURRENCY ? gbpMinor : Math.round(gbpMinor / toRate);
};

const EXPENSE_ENTRY_TYPES: ReadonlySet<LedgerEntry["entryType"]> = new Set([
  "confirmed_expense",
  "inference_cost",
  "hosting_cost",
  "deployment_cost",
  "telephony_cost",
  "subscription_allocation",
]);

export class SovereignLedgerService extends Context.Service<
  SovereignLedgerService,
  {
    readonly recordEntry: (
      input: RecordLedgerEntryInput,
      options?: { readonly recordedBy?: string },
    ) => Effect.Effect<LedgerEntry, SovereignDomainError>;
    readonly computeFinancialMetrics: (
      ventureId?: VentureId | null,
    ) => Effect.Effect<FinancialPipelineMetrics, SovereignPersistenceError>;
    readonly computeDetailedCostBreakdown: (
      ventureId?: VentureId | null,
    ) => Effect.Effect<DetailedCostBreakdown, SovereignPersistenceError>;
    readonly listEntries: (filter?: {
      readonly ventureId?: VentureId | null;
      readonly verificationState?: LedgerVerificationState;
      readonly limit?: number;
    }) => Effect.Effect<
      {
        readonly entries: ReadonlyArray<LedgerEntry>;
        readonly financialSummary: FinancialPipelineMetrics;
      },
      SovereignPersistenceError
    >;
    readonly createInvoice: (
      input: CreateInvoiceInput,
    ) => Effect.Effect<Invoice, SovereignDomainError>;
  }
>()("t3/sovereign/SovereignLedgerService") {}

const make = Effect.gen(function* () {
  const store = yield* SovereignStore.SovereignStore;
  const governance = yield* SovereignGovernanceService.SovereignGovernanceService;
  const random = yield* SecureRandom.SecureRandom;

  const generateId = <Id extends string>(prefix: string, makeId: (value: string) => Id) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.map((uuid) => makeId(`${prefix}_${uuid.replace(/-/g, "")}`)),
    );

  const computeFinancialMetrics = Effect.fn("SovereignLedgerService.computeFinancialMetrics")(
    function* (ventureId?: VentureId | null) {
      const scopedVentureId = ventureId ?? undefined;
      const [{ controlState }, now, opportunities, proposals, orders, invoices, entries, ventures] =
        yield* Effect.all([
          store.getControlState,
          store.nowIso,
          store.listOpportunities(
            scopedVentureId === undefined ? undefined : { ventureId: scopedVentureId },
          ),
          store.listProposals(scopedVentureId),
          store.listOrders(scopedVentureId),
          store.listInvoices(scopedVentureId),
          store.listLedgerEntries({
            ...(scopedVentureId === undefined ? {} : { ventureId: scopedVentureId }),
            limit: 10_000,
          }),
          store.listVentures,
        ]);

      const reportingCurrency = controlState.reportingCurrency;
      const fx = controlState.fxRatesToGbp;
      const toReporting = (amountMinor: number, currency: CurrencyCode) =>
        convertOrFallback(amountMinor, currency, reportingCurrency, fx);

      let discoveredOpportunityValueMinor = 0;
      for (const opportunity of opportunities) {
        if (
          opportunity.estimatedValueMinor !== null &&
          opportunity.stage !== "won" &&
          opportunity.stage !== "lost" &&
          opportunity.stage !== "disqualified"
        ) {
          discoveredOpportunityValueMinor += toReporting(
            opportunity.estimatedValueMinor,
            opportunity.currency,
          );
        }
      }

      let proposedQuotationsMinor = 0;
      for (const proposal of proposals) {
        if (
          proposal.status === "draft" ||
          proposal.status === "pending_approval" ||
          proposal.status === "sent"
        ) {
          proposedQuotationsMinor += toReporting(proposal.totalMinor, proposal.currency);
        }
      }

      let acceptedOrdersMinor = 0;
      for (const order of orders) {
        if (
          order.status === "accepted" ||
          order.status === "in_delivery" ||
          order.status === "delivered" ||
          order.status === "completed"
        ) {
          acceptedOrdersMinor += toReporting(order.amountMinor, order.currency);
        }
      }

      let outstandingInvoicesMinor = 0;
      for (const invoice of invoices) {
        if (
          invoice.status === "issued" ||
          invoice.status === "partially_paid" ||
          invoice.status === "overdue"
        ) {
          const remaining = Math.max(0, invoice.amountMinor - invoice.paidAmountMinor);
          outstandingInvoicesMinor += toReporting(remaining, invoice.currency);
        }
      }

      let collectedRevenueMinor = 0;
      let confirmedExpensesMinor = 0;
      let paymentFeesMinor = 0;
      let refundsMinor = 0;
      let monthlyRecurringRevenueMinor = 0;
      let pendingReconciliationRevenueMinor = 0;
      let pendingReconciliationExpensesMinor = 0;
      let simulatedRevenueMinor = 0;
      let simulatedExpensesMinor = 0;

      const recurringVentureIds = new Set(
        ventures
          .filter((venture) => venture.kind === "micro_saas" || venture.kind === "voice_ai")
          .map((venture) => venture.id),
      );
      const thirtyDaysAgoMs = Date.parse(now) - 30 * 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        const reportingMinor =
          reportingCurrency === DEFAULT_REPORTING_CURRENCY
            ? entry.reportingAmountGbpMinor
            : convertOrFallback(
                entry.reportingAmountGbpMinor,
                DEFAULT_REPORTING_CURRENCY,
                reportingCurrency,
                fx,
              );
        const absReportingMinor = Math.abs(reportingMinor);

        if (entry.verificationState === "simulated_fixture") {
          if (entry.entryType === "collected_revenue") {
            simulatedRevenueMinor += absReportingMinor;
          } else if (
            EXPENSE_ENTRY_TYPES.has(entry.entryType) ||
            entry.entryType === "payment_fee" ||
            entry.entryType === "refund"
          ) {
            simulatedExpensesMinor += absReportingMinor;
          }
          continue;
        }

        if (entry.verificationState === "pending_reconciliation") {
          if (entry.entryType === "collected_revenue") {
            pendingReconciliationRevenueMinor += absReportingMinor;
          } else if (
            EXPENSE_ENTRY_TYPES.has(entry.entryType) ||
            entry.entryType === "payment_fee" ||
            entry.entryType === "refund"
          ) {
            pendingReconciliationExpensesMinor += absReportingMinor;
          }
          continue;
        }

        // Only verified non-simulated entries contribute to real collected revenue and profit.
        if (entry.entryType === "collected_revenue") {
          collectedRevenueMinor += absReportingMinor;
          if (
            entry.ventureId !== null &&
            recurringVentureIds.has(entry.ventureId) &&
            Date.parse(entry.occurredAt) >= thirtyDaysAgoMs
          ) {
            monthlyRecurringRevenueMinor += absReportingMinor;
          }
        } else if (entry.entryType === "payment_fee") {
          paymentFeesMinor += absReportingMinor;
        } else if (entry.entryType === "refund") {
          refundsMinor += absReportingMinor;
        } else if (EXPENSE_ENTRY_TYPES.has(entry.entryType)) {
          confirmedExpensesMinor += absReportingMinor;
        } else if (entry.entryType === "adjustment") {
          if (reportingMinor >= 0) {
            collectedRevenueMinor += reportingMinor;
          } else {
            confirmedExpensesMinor += absReportingMinor;
          }
        }
      }

      const netProfitMinor =
        collectedRevenueMinor - confirmedExpensesMinor - paymentFeesMinor - refundsMinor;

      return {
        reportingCurrency,
        discoveredOpportunityValueMinor,
        proposedQuotationsMinor,
        acceptedOrdersMinor,
        outstandingInvoicesMinor,
        collectedRevenueMinor,
        confirmedExpensesMinor,
        paymentFeesMinor,
        refundsMinor,
        netProfitMinor,
        monthlyRecurringRevenueMinor,
        pendingReconciliationRevenueMinor,
        pendingReconciliationExpensesMinor,
        simulatedRevenueMinor,
        simulatedExpensesMinor,
        asOf: now,
      } satisfies FinancialPipelineMetrics;
    },
  );

  const computeDetailedCostBreakdown = Effect.fn(
    "SovereignLedgerService.computeDetailedCostBreakdown",
  )(function* (ventureId?: VentureId | null) {
    const [{ controlState }, entries] = yield* Effect.all([
      store.getControlState,
      store.listLedgerEntries({
        ...(ventureId === undefined || ventureId === null ? {} : { ventureId }),
        verificationState: "verified",
        limit: 10_000,
      }),
    ]);
    const reportingCurrency = controlState.reportingCurrency;
    const fx = controlState.fxRatesToGbp;

    let confirmedExpensesMinor = 0;
    let paymentFeesMinor = 0;
    let inferenceCostMinor = 0;
    let hostingCostMinor = 0;
    let deploymentCostMinor = 0;
    let telephonyCostMinor = 0;
    let subscriptionAllocationMinor = 0;
    let refundsMinor = 0;

    for (const entry of entries) {
      const value = Math.abs(
        reportingCurrency === DEFAULT_REPORTING_CURRENCY
          ? entry.reportingAmountGbpMinor
          : convertOrFallback(
              entry.reportingAmountGbpMinor,
              DEFAULT_REPORTING_CURRENCY,
              reportingCurrency,
              fx,
            ),
      );
      switch (entry.entryType) {
        case "confirmed_expense":
          confirmedExpensesMinor += value;
          break;
        case "payment_fee":
          paymentFeesMinor += value;
          break;
        case "inference_cost":
          inferenceCostMinor += value;
          confirmedExpensesMinor += value;
          break;
        case "hosting_cost":
          hostingCostMinor += value;
          confirmedExpensesMinor += value;
          break;
        case "deployment_cost":
          deploymentCostMinor += value;
          confirmedExpensesMinor += value;
          break;
        case "telephony_cost":
          telephonyCostMinor += value;
          confirmedExpensesMinor += value;
          break;
        case "subscription_allocation":
          subscriptionAllocationMinor += value;
          confirmedExpensesMinor += value;
          break;
        case "refund":
          refundsMinor += value;
          break;
        case "collected_revenue":
        case "adjustment":
          break;
      }
    }

    return {
      reportingCurrency,
      confirmedExpensesMinor,
      paymentFeesMinor,
      inferenceCostMinor,
      hostingCostMinor,
      deploymentCostMinor,
      telephonyCostMinor,
      subscriptionAllocationMinor,
      refundsMinor,
    } satisfies DetailedCostBreakdown;
  });

  const recordEntry = Effect.fn("SovereignLedgerService.recordEntry")(function* (
    input: RecordLedgerEntryInput,
    options?: { readonly recordedBy?: string },
  ) {
    if (input.externalRef !== undefined && input.externalRef !== null) {
      const existing = yield* store.findLedgerEntryByExternalRef(input.externalRef);
      if (Option.isSome(existing)) {
        return existing.value;
      }
    }

    if (input.ventureId !== undefined && input.ventureId !== null) {
      const ventureOpt = yield* store.getVenture(input.ventureId);
      if (Option.isNone(ventureOpt)) {
        return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
      }
    }

    const { controlState } = yield* store.getControlState;
    const currency = input.currency ?? controlState.reportingCurrency;
    const { convertedMinor: reportingAmountGbpMinor, fxRateToGbp } = yield* convertMinorAmount({
      amountMinor: input.amountMinor,
      fromCurrency: currency,
      toCurrency: DEFAULT_REPORTING_CURRENCY,
      fxRatesToGbp: controlState.fxRatesToGbp,
    });

    const now = yield* store.nowIso;
    const verificationState: LedgerVerificationState =
      input.verificationState ?? "pending_reconciliation";
    const entry: LedgerEntry = {
      id: yield* generateId("led", LedgerEntryId.make),
      ventureId: input.ventureId ?? null,
      ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
      ...(input.invoiceId === undefined ? {} : { invoiceId: input.invoiceId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
      entryType: input.entryType,
      verificationState,
      amountMinor: input.amountMinor,
      currency,
      reportingAmountGbpMinor,
      fxRateToGbp,
      description: input.description,
      externalRef: input.externalRef ?? null,
      recordedBy: options?.recordedBy ?? "owner",
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
    };

    yield* store.withTransaction(
      Effect.gen(function* () {
        yield* store.insertLedgerEntry(entry);

        if (
          entry.invoiceId !== undefined &&
          entry.invoiceId !== null &&
          entry.entryType === "collected_revenue" &&
          entry.verificationState === "verified"
        ) {
          const invoiceOpt = yield* store.getInvoice(entry.invoiceId);
          if (Option.isSome(invoiceOpt)) {
            const invoice = invoiceOpt.value;
            const nextPaid = invoice.paidAmountMinor + Math.abs(entry.amountMinor);
            const nextStatus: Invoice["status"] =
              nextPaid >= invoice.amountMinor ? "paid" : "partially_paid";
            yield* store.updateInvoicePayment({
              invoiceId: invoice.id,
              paidAmountMinor: nextPaid,
              status: nextStatus,
              paidAt: nextStatus === "paid" ? now : invoice.paidAt,
              updatedAt: now,
            });
            yield* store.addCustomerCollectedMinor(
              invoice.customerId,
              Math.abs(entry.reportingAmountGbpMinor),
              now,
            );
          }
        }
      }),
    );

    const financialSummary = yield* computeFinancialMetrics(null);
    yield* governance.recordAuditEvent({
      kind: "ledger_recorded",
      severity: "info",
      ventureId: entry.ventureId,
      actor: entry.recordedBy,
      summary: `Recorded ${entry.verificationState} ${entry.entryType}: ${entry.description}`,
      ...(entry.integrationId === undefined ? {} : { integrationId: entry.integrationId }),
      metadata: {
        ledgerEntryId: entry.id,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        reportingAmountGbpMinor: entry.reportingAmountGbpMinor,
      },
    });
    yield* store.publishEvent({
      type: "ledgerEntryRecorded",
      payload: { entry, financialSummary },
    });
    return entry;
  });

  const listEntries = Effect.fn("SovereignLedgerService.listEntries")(function* (filter?: {
    readonly ventureId?: VentureId | null;
    readonly verificationState?: LedgerVerificationState;
    readonly limit?: number;
  }) {
    const [entries, financialSummary] = yield* Effect.all([
      store.listLedgerEntries(filter),
      computeFinancialMetrics(filter?.ventureId),
    ]);
    return { entries, financialSummary };
  });

  const createInvoice = Effect.fn("SovereignLedgerService.createInvoice")(function* (
    input: CreateInvoiceInput,
  ) {
    const ventureOpt = yield* store.getVenture(input.ventureId);
    if (Option.isNone(ventureOpt)) {
      return yield* new SovereignNotFoundError({ entity: "venture", id: input.ventureId });
    }
    const customerOpt = yield* store.getCustomer(input.customerId);
    if (Option.isNone(customerOpt)) {
      return yield* new SovereignNotFoundError({ entity: "customer", id: input.customerId });
    }
    const { controlState } = yield* store.getControlState;
    const now = yield* store.nowIso;
    const id = yield* generateId("inv", InvoiceId.make);
    const invoice: Invoice = {
      id,
      ventureId: input.ventureId,
      customerId: input.customerId,
      orderId: input.orderId ?? null,
      invoiceNumber: input.invoiceNumber ?? `INV-${id.slice(-8).toUpperCase()}`,
      amountMinor: input.amountMinor,
      paidAmountMinor: 0,
      currency:
        input.currency ?? customerOpt.value.billingCurrency ?? controlState.reportingCurrency,
      status: "issued",
      paymentLinkUrl: null,
      externalInvoiceId: null,
      issuedAt: now,
      dueAt: input.dueAt ?? null,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insertInvoice(invoice);
    return invoice;
  });

  return SovereignLedgerService.of({
    recordEntry,
    computeFinancialMetrics,
    computeDetailedCostBreakdown,
    listEntries,
    createInvoice,
  });
});

export const layer = Layer.effect(SovereignLedgerService, make);
