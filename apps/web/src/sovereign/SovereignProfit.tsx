import type { SovereignOverviewSnapshot, ProfitPeriods } from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT } from "gt-react";
import { useState } from "react";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

export function SovereignProfit({ overview }: { overview: SovereignOverviewSnapshot | null }) {
  const gt = useGT();
  const [period, setPeriod] = useState<keyof ProfitPeriods>("month");
  const labels = { today: gt("Today"), week: gt("7d"), month: gt("30d"), all: gt("All time") };
  const profit =
    overview?.profitPeriods?.[period] ??
    (period === "all" ? overview?.financialSummary.netProfitMinor : undefined);
  return (
    <div className="sv-profit">
      <span>
        <T>Net profit</T>
      </span>
      <strong>
        {profit !== undefined && overview
          ? formatMinorCurrency(profit, overview.financialSummary.reportingCurrency)
          : "—"}
      </strong>
      <Select<keyof ProfitPeriods>
        value={period}
        onValueChange={(value) => {
          if (value) setPeriod(value);
        }}
      >
        <SelectTrigger variant="ghost" size="sm" aria-label={gt("Profit period")}>
          <SelectValue>{labels[period]}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {(Object.keys(labels) as (keyof ProfitPeriods)[]).map((key) => (
            <SelectItem key={key} value={key}>
              {labels[key]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
