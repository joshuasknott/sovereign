import { DEFAULT_REPORTING_CURRENCY, type FinancialPipelineMetrics } from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT } from "gt-react";

import { cn } from "../lib/utils";

export function SovereignFinancialStrip({
  metrics,
}: {
  readonly metrics: FinancialPipelineMetrics | null;
}) {
  const gt = useGT();
  const currency = metrics?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY;
  const collected = metrics?.collectedRevenueMinor ?? 0;
  const expenses = metrics?.confirmedExpensesMinor ?? 0;
  const netProfit = metrics?.netProfitMinor ?? 0;
  const outstanding = metrics?.outstandingInvoicesMinor ?? 0;
  const pipeline =
    (metrics?.discoveredOpportunityValueMinor ?? 0) +
    (metrics?.proposedQuotationsMinor ?? 0) +
    (metrics?.acceptedOrdersMinor ?? 0);
  const pendingRecon =
    (metrics?.pendingReconciliationRevenueMinor ?? 0) +
    (metrics?.pendingReconciliationExpensesMinor ?? 0);
  const simulated = (metrics?.simulatedRevenueMinor ?? 0) + (metrics?.simulatedExpensesMinor ?? 0);

  return (
    <section
      aria-label={gt("Verified financial position")}
      className="overflow-hidden rounded-xl border border-border/80 bg-card/80"
    >
      <div className="grid grid-cols-1 divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3.5">
          <p className="text-xs font-medium text-muted-foreground">
            <T>Collected Revenue</T>
          </p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-foreground tabular-nums">
            {formatMinorCurrency(collected, currency)}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs font-medium text-muted-foreground">
            <T>Confirmed Expenditure</T>
          </p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-foreground tabular-nums">
            {formatMinorCurrency(expenses, currency)}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs font-medium text-muted-foreground">
            <T>Net Profit</T>
          </p>
          <p
            className={cn(
              "mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums",
              netProfit > 0
                ? "text-success-foreground"
                : netProfit < 0
                  ? "text-destructive-foreground"
                  : "text-foreground",
            )}
          >
            {formatMinorCurrency(netProfit, currency, { signed: netProfit > 0 })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/25 px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span>
            <T>Outstanding Invoices (uncollected):</T>
          </span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {formatMinorCurrency(outstanding, currency)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span>
            <T>Pipeline Estimate (unverified):</T>
          </span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {formatMinorCurrency(pipeline, currency)}
          </span>
        </span>
        {pendingRecon !== 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span>
              <T>Pending Reconciliation:</T>
            </span>
            <span className="font-mono font-medium text-warning-foreground tabular-nums">
              {formatMinorCurrency(pendingRecon, currency)}
            </span>
          </span>
        ) : null}
        {simulated !== 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span>
              <T>Simulated Fixtures (excluded):</T>
            </span>
            <span className="font-mono font-medium tabular-nums">
              {formatMinorCurrency(simulated, currency)}
            </span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
