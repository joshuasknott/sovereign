import { DEFAULT_REPORTING_CURRENCY } from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { SaveIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SovereignFinancialStrip } from "../../sovereign/SovereignFinancialStrip";
import {
  LEDGER_ENTRY_TYPE_LABELS,
  LEDGER_VERIFICATION_STATE_LABELS,
} from "../../sovereign/sovereignLabels";
import {
  formatMinorToMajorInput,
  formatShortTimestamp,
  parseMajorCurrencyToMinor,
} from "../../sovereign/sovereignUi.logic";
import {
  sovereignCommands,
  useSovereignCommandPermission,
  useSovereignEnvironmentId,
  useSovereignLedger,
  useSovereignOverview,
} from "../../state/sovereign";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const REPORTING_CURRENCIES = ["GBP", "USD", "EUR", "CAD", "AUD", "CHF"] as const;

export function SovereignBudgetsSettingsPanel() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const environmentId = useSovereignEnvironmentId();
  const overviewQuery = useSovereignOverview(environmentId, "settings-budgets");
  const ledgerQuery = useSovereignLedger(environmentId, { limit: 40 }, "settings-budgets");
  const canUpdateControl = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateControlStateCommand,
  );
  const updateControlState = useAtomCommand(sovereignCommands.updateControlStateCommand, {
    label: "sovereign-update-budgets",
  });

  const controlState = overviewQuery.data?.controlState;
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [budgetOverride, setBudgetOverride] = useState<string | null>(null);
  const [usdRateOverride, setUsdRateOverride] = useState<string | null>(null);
  const [eurRateOverride, setEurRateOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reportingCurrency =
    currencyOverride ?? controlState?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY;
  const budgetInput =
    budgetOverride ?? formatMinorToMajorInput(controlState?.globalMonthlyBudgetMinor ?? 0);
  const usdRateInput = usdRateOverride ?? String(controlState?.fxRatesToGbp["USD"] ?? 0.79);
  const eurRateInput = eurRateOverride ?? String(controlState?.fxRatesToGbp["EUR"] ?? 0.85);

  const parsedBudgetMinor = parseMajorCurrencyToMinor(budgetInput);

  const handleSave = async () => {
    if (environmentId === null || !canUpdateControl || saving || parsedBudgetMinor === null) return;
    const usdRate = Number.parseFloat(usdRateInput);
    const eurRate = Number.parseFloat(eurRateInput);
    const nextFx: Record<string, number> = {
      ...controlState?.fxRatesToGbp,
      GBP: 1,
      ...(Number.isFinite(usdRate) && usdRate > 0 ? { USD: usdRate } : {}),
      ...(Number.isFinite(eurRate) && eurRate > 0 ? { EUR: eurRate } : {}),
    };
    setSaving(true);
    const result = await updateControlState({
      environmentId,
      input: {
        reportingCurrency,
        globalMonthlyBudgetMinor: parsedBudgetMinor,
        fxRatesToGbp: nextFx,
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setCurrencyOverride(null);
      setBudgetOverride(null);
      setUsdRateOverride(null);
      setEurRateOverride(null);
      toastManager.add({
        type: "success",
        title: gt("Budget and currency settings saved"),
      });
    }
  };

  const entries = ledgerQuery.data?.entries ?? [];
  const metrics =
    ledgerQuery.data?.financialSummary ?? overviewQuery.data?.financialSummary ?? null;

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("sovereign-budgets")}
        title={gt("Reporting Currency & Spend Ceiling")}
      >
        <SettingsRow
          title={gt("Default reporting currency")}
          description={gt("Primary currency used across Global Overview and venture ledgers.")}
          control={
            <div className="w-full sm:w-32">
              <Select
                value={reportingCurrency}
                disabled={!canUpdateControl}
                onValueChange={(value) => {
                  if (value) setCurrencyOverride(value);
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Reporting currency")}>
                  <SelectValue>{reportingCurrency}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end">
                  {REPORTING_CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />

        <SettingsRow
          title={gt("Global monthly discretionary spend cap")}
          description={gt(
            "Defaults to £0. Any non-zero spend beyond existing subscriptions requires approval.",
          )}
          control={
            <div className="w-full sm:w-36">
              <Input
                size="sm"
                inputMode="decimal"
                disabled={!canUpdateControl}
                value={budgetInput}
                onChange={(event) => setBudgetOverride(event.target.value)}
                aria-label={gt("Global monthly spend cap")}
              />
            </div>
          }
        />

        <SettingsRow
          title={gt("FX rates to GBP")}
          description={gt("Conversion factors used to report multi-currency payouts in GBP.")}
          control={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-mono text-muted-foreground">USD</span>
                <div className="w-20">
                  <Input
                    size="sm"
                    inputMode="decimal"
                    disabled={!canUpdateControl}
                    value={usdRateInput}
                    onChange={(event) => setUsdRateOverride(event.target.value)}
                    aria-label={gt("USD to GBP rate")}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-mono text-muted-foreground">EUR</span>
                <div className="w-20">
                  <Input
                    size="sm"
                    inputMode="decimal"
                    disabled={!canUpdateControl}
                    value={eurRateInput}
                    onChange={(event) => setEurRateOverride(event.target.value)}
                    aria-label={gt("EUR to GBP rate")}
                  />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!canUpdateControl || saving || parsedBudgetMinor === null}
                onClick={() => void handleSave()}
              >
                <SaveIcon className="size-3.5" />
                {saving ? <T>Saving…</T> : <T>Save</T>}
              </Button>
            </div>
          }
        />
      </SettingsSection>

      <SovereignFinancialStrip metrics={metrics} />

      <SettingsSection title={gt("Global Ledger Overview")}>
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            <T>No ledger entries recorded yet across any venture.</T>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {entries.map((entry) => (
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
      </SettingsSection>
    </SettingsPageContainer>
  );
}
