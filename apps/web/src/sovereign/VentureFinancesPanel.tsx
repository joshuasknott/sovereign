import {
  LedgerEntryType,
  LedgerVerificationState,
  type CustomerId,
  type EnvironmentId,
  type SovereignVentureDetail,
} from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { PlusIcon, ReceiptIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { SovereignFinancialStrip } from "./SovereignFinancialStrip";
import { LEDGER_ENTRY_TYPE_LABELS, LEDGER_VERIFICATION_STATE_LABELS } from "./sovereignLabels";
import {
  computeBudgetProgress,
  formatShortTimestamp,
  parseMajorCurrencyToMinor,
} from "./sovereignUi.logic";

export function VentureFinancesPanel({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly detail: SovereignVentureDetail;
}) {
  const gt = useGT();
  const m = useMessages();
  const { venture, financialSummary } = detail;
  const currency = venture.budgetPolicy.currency;

  const [entryType, setEntryType] = useState<LedgerEntryType>("collected_revenue");
  const [verificationState, setVerificationState] = useState<LedgerVerificationState>("verified");
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const [recording, setRecording] = useState(false);

  const [invoiceCustomerId, setInvoiceCustomerId] = useState<string>(detail.customers[0]?.id ?? "");
  const [invoiceAmountInput, setInvoiceAmountInput] = useState("");
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const canRecord = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.recordLedgerEntryCommand,
  );
  const canCreateInvoice = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createInvoiceCommand,
  );
  const recordLedger = useAtomCommand(sovereignCommands.recordLedgerEntryCommand, {
    label: "sovereign-record-ledger-entry",
  });
  const createInvoice = useAtomCommand(sovereignCommands.createInvoiceCommand, {
    label: "sovereign-create-invoice",
  });

  const budget = computeBudgetProgress(
    financialSummary.confirmedExpensesMinor,
    venture.budgetPolicy.monthlyCapMinor,
    venture.budgetPolicy.alertThresholdPct,
  );

  const handleRecordEntry = async () => {
    const parsedMinor = parseMajorCurrencyToMinor(amountInput);
    if (
      environmentId === null ||
      !canRecord ||
      recording ||
      parsedMinor === null ||
      parsedMinor <= 0 ||
      description.trim().length === 0
    ) {
      return;
    }
    setRecording(true);
    const result = await recordLedger({
      environmentId,
      input: {
        ventureId: venture.id,
        entryType,
        verificationState,
        amountMinor: parsedMinor,
        currency,
        description: description.trim(),
      },
    });
    setRecording(false);
    if (result._tag === "Success") {
      setAmountInput("");
      setDescription("");
      toastManager.add({
        type: "success",
        title: gt("Ledger entry recorded"),
        description: result.value.description,
      });
    }
  };

  const handleCreateInvoice = async () => {
    const parsedMinor = parseMajorCurrencyToMinor(invoiceAmountInput);
    const customerId = invoiceCustomerId || detail.customers[0]?.id;
    if (
      environmentId === null ||
      !canCreateInvoice ||
      creatingInvoice ||
      !customerId ||
      parsedMinor === null ||
      parsedMinor <= 0
    ) {
      return;
    }
    setCreatingInvoice(true);
    const result = await createInvoice({
      environmentId,
      input: {
        ventureId: venture.id,
        customerId: customerId as CustomerId,
        amountMinor: parsedMinor,
        currency,
      },
    });
    setCreatingInvoice(false);
    if (result._tag === "Success") {
      setInvoiceAmountInput("");
      toastManager.add({
        type: "success",
        title: gt("Invoice created"),
        description: result.value.invoiceNumber,
      });
    }
  };

  return (
    <div className="space-y-6">
      <SovereignFinancialStrip metrics={financialSummary} />

      <section
        aria-label={gt("Monthly Budget Cap")}
        className="rounded-xl border border-border/80 bg-card/80 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">
              <T>Monthly Budget Guardrail</T>
            </h2>
            <p className="text-muted-foreground">
              {venture.budgetPolicy.discretionarySpendAllowed
                ? gt("Discretionary spend allowed up to the monthly cap.")
                : gt("Discretionary spend is locked to £0 unless explicitly pre-approved.")}
            </p>
          </div>
          <span className="font-mono text-sm font-medium text-foreground tabular-nums">
            {formatMinorCurrency(financialSummary.confirmedExpensesMinor, currency)} /{" "}
            {formatMinorCurrency(venture.budgetPolicy.monthlyCapMinor, currency)}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              budget.state === "exceeded"
                ? "bg-destructive"
                : budget.state === "warning"
                  ? "bg-warning"
                  : "bg-primary",
            )}
            style={{ width: `${budget.pct}%` }}
          />
        </div>
      </section>

      <section
        aria-label={gt("Ledger Entries")}
        className="rounded-xl border border-border/80 bg-card/80"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <ReceiptIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              <T>Financial Ledger</T>
            </h2>
          </div>
          <Badge size="sm" variant="secondary">
            {detail.recentLedgerEntries.length}
          </Badge>
        </div>

        <div className="space-y-2 border-b border-border/70 bg-muted/20 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select
              value={entryType}
              onValueChange={(value) => {
                if (value) setEntryType(value as LedgerEntryType);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Ledger entry type")}>
                <SelectValue>{m(LEDGER_ENTRY_TYPE_LABELS[entryType])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {LedgerEntryType.literals.map((type) => (
                  <SelectItem key={type} value={type}>
                    {m(LEDGER_ENTRY_TYPE_LABELS[type])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <Select
              value={verificationState}
              onValueChange={(value) => {
                if (value) setVerificationState(value as LedgerVerificationState);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Verification state")}>
                <SelectValue>{m(LEDGER_VERIFICATION_STATE_LABELS[verificationState])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {LedgerVerificationState.literals.map((state) => (
                  <SelectItem key={state} value={state}>
                    {m(LEDGER_VERIFICATION_STATE_LABELS[state])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <Input
              size="sm"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder={gt("Amount ({currency})", { currency })}
              aria-label={gt("Amount")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1">
              <Input
                size="sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={gt("Description (e.g. Stripe payout #1042)")}
                aria-label={gt("Ledger description")}
              />
            </div>

            <Button
              size="sm"
              disabled={
                !canRecord ||
                recording ||
                (parseMajorCurrencyToMinor(amountInput) ?? 0) <= 0 ||
                description.trim().length === 0
              }
              onClick={() => void handleRecordEntry()}
            >
              <PlusIcon className="size-3.5" />
              <T>Record</T>
            </Button>
          </div>
        </div>

        {detail.recentLedgerEntries.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            <T>
              No ledger entries recorded yet. Verified payouts and confirmed costs will appear here.
            </T>
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {detail.recentLedgerEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-medium text-foreground">{entry.description}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                    <span>{m(LEDGER_ENTRY_TYPE_LABELS[entry.entryType])}</span>
                    <Badge
                      size="sm"
                      variant={
                        entry.verificationState === "verified"
                          ? "success"
                          : entry.verificationState === "pending_reconciliation"
                            ? "warning"
                            : "outline"
                      }
                    >
                      {m(LEDGER_VERIFICATION_STATE_LABELS[entry.verificationState])}
                    </Badge>
                    <span className="tabular-nums">{formatShortTimestamp(entry.occurredAt)}</span>
                  </div>
                </div>
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {formatMinorCurrency(entry.amountMinor, entry.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        aria-label={gt("Invoices")}
        className="rounded-xl border border-border/80 bg-card/80"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            <T>Invoices</T>
          </h2>
          <Badge size="sm" variant="secondary">
            {detail.invoices.length}
          </Badge>
        </div>

        {detail.customers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 p-3">
            <div className="w-48">
              <Select
                value={invoiceCustomerId || detail.customers[0]!.id}
                onValueChange={(value) => {
                  if (value) setInvoiceCustomerId(value);
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Customer")}>
                  <SelectValue>
                    {detail.customers.find((c) => c.id === invoiceCustomerId)?.name ??
                      detail.customers[0]!.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="start">
                  {detail.customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="w-32">
              <Input
                size="sm"
                inputMode="decimal"
                value={invoiceAmountInput}
                onChange={(event) => setInvoiceAmountInput(event.target.value)}
                placeholder={gt("Amount ({currency})", { currency })}
                aria-label={gt("Invoice amount")}
              />
            </div>
            <Button
              size="sm"
              disabled={
                !canCreateInvoice ||
                creatingInvoice ||
                (parseMajorCurrencyToMinor(invoiceAmountInput) ?? 0) <= 0
              }
              onClick={() => void handleCreateInvoice()}
            >
              <PlusIcon className="size-3.5" />
              <T>Create invoice</T>
            </Button>
          </div>
        ) : null}

        {detail.invoices.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            <T>No invoices issued for this venture yet.</T>
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {detail.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="space-y-0.5">
                  <p className="font-mono font-medium text-foreground">{invoice.invoiceNumber}</p>
                  {invoice.dueAt ? (
                    <p className="text-2xs text-muted-foreground tabular-nums">
                      {gt("Due {date}", { date: formatShortTimestamp(invoice.dueAt) })}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium tabular-nums">
                    {formatMinorCurrency(invoice.amountMinor, invoice.currency)}
                  </span>
                  <Badge
                    size="sm"
                    variant={
                      invoice.status === "paid"
                        ? "success"
                        : invoice.status === "overdue"
                          ? "error"
                          : "outline"
                    }
                  >
                    {invoice.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
