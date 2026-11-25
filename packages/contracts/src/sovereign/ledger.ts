import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "../baseSchemas.ts";
import {
  CommercialTaskId,
  CurrencyCode,
  CustomerId,
  IntegrationId,
  InvoiceId,
  LedgerEntryId,
  MinorCurrencyAmount,
  NonNegativeMinorAmount,
  OrderId,
  VentureId,
} from "./ids.ts";

export const LedgerEntryType = Schema.Literals([
  "collected_revenue",
  "confirmed_expense",
  "payment_fee",
  "inference_cost",
  "hosting_cost",
  "deployment_cost",
  "telephony_cost",
  "subscription_allocation",
  "refund",
  "adjustment",
]);
export type LedgerEntryType = typeof LedgerEntryType.Type;

/** Simulated fixtures remain isolated from verified commercial totals. */
export const LedgerVerificationState = Schema.Literals([
  "verified",
  "pending_reconciliation",
  "simulated_fixture",
]);
export type LedgerVerificationState = typeof LedgerVerificationState.Type;

const PositiveFxRate = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0));

export const LedgerEntry = Schema.Struct({
  id: LedgerEntryId,
  ventureId: Schema.NullOr(VentureId),
  orderId: Schema.optionalKey(Schema.NullOr(OrderId)),
  invoiceId: Schema.optionalKey(Schema.NullOr(InvoiceId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  integrationId: Schema.optionalKey(Schema.NullOr(IntegrationId)),
  entryType: LedgerEntryType,
  verificationState: LedgerVerificationState,
  amountMinor: MinorCurrencyAmount,
  currency: CurrencyCode,
  reportingAmountGbpMinor: MinorCurrencyAmount,
  fxRateToGbp: PositiveFxRate,
  description: TrimmedNonEmptyString,
  externalRef: Schema.NullOr(TrimmedNonEmptyString),
  recordedBy: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
  recordedAt: IsoDateTime,
});
export type LedgerEntry = typeof LedgerEntry.Type;

export const RecordLedgerEntryInput = Schema.Struct({
  ventureId: Schema.optionalKey(Schema.NullOr(VentureId)),
  orderId: Schema.optionalKey(Schema.NullOr(OrderId)),
  invoiceId: Schema.optionalKey(Schema.NullOr(InvoiceId)),
  taskId: Schema.optionalKey(Schema.NullOr(CommercialTaskId)),
  integrationId: Schema.optionalKey(Schema.NullOr(IntegrationId)),
  entryType: LedgerEntryType,
  verificationState: Schema.optionalKey(LedgerVerificationState),
  amountMinor: MinorCurrencyAmount,
  currency: Schema.optionalKey(CurrencyCode),
  description: TrimmedNonEmptyString,
  externalRef: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  occurredAt: Schema.optionalKey(IsoDateTime),
});
export type RecordLedgerEntryInput = typeof RecordLedgerEntryInput.Type;

export const InvoiceStatus = Schema.Literals([
  "draft",
  "issued",
  "paid",
  "partially_paid",
  "overdue",
  "void",
  "refunded",
]);
export type InvoiceStatus = typeof InvoiceStatus.Type;

export const Invoice = Schema.Struct({
  id: InvoiceId,
  ventureId: VentureId,
  customerId: CustomerId,
  orderId: Schema.NullOr(OrderId),
  invoiceNumber: TrimmedNonEmptyString,
  amountMinor: NonNegativeMinorAmount,
  paidAmountMinor: NonNegativeMinorAmount,
  currency: CurrencyCode,
  status: InvoiceStatus,
  paymentLinkUrl: Schema.NullOr(TrimmedNonEmptyString),
  externalInvoiceId: Schema.NullOr(TrimmedNonEmptyString),
  issuedAt: Schema.NullOr(IsoDateTime),
  dueAt: Schema.NullOr(IsoDateTime),
  paidAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Invoice = typeof Invoice.Type;

export const CreateInvoiceInput = Schema.Struct({
  ventureId: VentureId,
  customerId: CustomerId,
  orderId: Schema.optionalKey(Schema.NullOr(OrderId)),
  invoiceNumber: Schema.optionalKey(TrimmedNonEmptyString),
  amountMinor: NonNegativeMinorAmount,
  currency: Schema.optionalKey(CurrencyCode),
  dueAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type CreateInvoiceInput = typeof CreateInvoiceInput.Type;

export const PaymentLink = Schema.Struct({
  id: TrimmedNonEmptyString,
  ventureId: VentureId,
  invoiceId: Schema.NullOr(InvoiceId),
  integrationId: Schema.NullOr(IntegrationId),
  label: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  amountMinor: NonNegativeMinorAmount,
  currency: CurrencyCode,
  active: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type PaymentLink = typeof PaymentLink.Type;

/** Keeps pipeline estimates, verified commercial totals, and simulated fixtures strictly separate. */
export const FinancialPipelineMetrics = Schema.Struct({
  reportingCurrency: CurrencyCode,
  discoveredOpportunityValueMinor: MinorCurrencyAmount,
  proposedQuotationsMinor: MinorCurrencyAmount,
  acceptedOrdersMinor: MinorCurrencyAmount,
  outstandingInvoicesMinor: MinorCurrencyAmount,
  collectedRevenueMinor: MinorCurrencyAmount,
  confirmedExpensesMinor: MinorCurrencyAmount,
  paymentFeesMinor: MinorCurrencyAmount,
  refundsMinor: MinorCurrencyAmount,
  netProfitMinor: MinorCurrencyAmount,
  monthlyRecurringRevenueMinor: MinorCurrencyAmount,
  pendingReconciliationRevenueMinor: MinorCurrencyAmount,
  pendingReconciliationExpensesMinor: MinorCurrencyAmount,
  simulatedRevenueMinor: MinorCurrencyAmount,
  simulatedExpensesMinor: MinorCurrencyAmount,
  asOf: IsoDateTime,
});
export type FinancialPipelineMetrics = typeof FinancialPipelineMetrics.Type;
