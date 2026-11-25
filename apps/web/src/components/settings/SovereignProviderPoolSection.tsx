import {
  DEFAULT_REPORTING_CURRENCY,
  PaidFallbackMode,
  ProviderBillingClass,
  type EnvironmentId,
  type ProviderPoolMemberStatus,
} from "@t3tools/contracts";
import { formatQuotaStatus } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { SaveIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { cn } from "../../lib/utils";
import {
  formatMinorToMajorInput,
  parseMajorCurrencyToMinor,
} from "../../sovereign/sovereignUi.logic";
import {
  sovereignCommands,
  useSovereignCommandPermission,
  useSovereignOverview,
  useSovereignProviderPool,
} from "../../state/sovereign";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

function ProviderPoolMemberRow({
  environmentId,
  member,
  canEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly member: ProviderPoolMemberStatus;
  readonly canEdit: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [poolEnabled, setPoolEnabled] = useState(member.poolEnabled);
  const [billingClass, setBillingClass] = useState<ProviderBillingClass>(member.billingClass);
  const [priorityInput, setPriorityInput] = useState(String(member.poolPriority));
  const [concurrencyInput, setConcurrencyInput] = useState(String(member.maxConcurrentRuns));
  const [monthlyCostInput, setMonthlyCostInput] = useState(
    formatMinorToMajorInput(member.monthlySubscriptionCostMinor ?? 0),
  );
  const [saving, setSaving] = useState(false);

  const updatePoolConfig = useAtomCommand(sovereignCommands.updateProviderPoolConfigCommand, {
    label: "sovereign-update-provider-pool",
  });

  const quota = formatQuotaStatus(member.quotaAvailability, member.quotaRemainingPct, messages);

  const billingLabel = (value: ProviderBillingClass): string => {
    switch (value) {
      case "subscription":
        return gt("Subscription");
      case "local":
        return gt("Local");
      case "free":
        return gt("Free");
      case "metered_api":
        return gt("Metered API");
      case "manual_only":
        return gt("Manual only");
      case "unknown":
        return gt("Unknown");
    }
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    const priority = Math.max(0, Math.min(100, Math.round(Number(priorityInput) || 50)));
    const maxConcurrentRuns = Math.max(1, Math.min(16, Math.round(Number(concurrencyInput) || 1)));
    const monthlyCostMinor = parseMajorCurrencyToMinor(monthlyCostInput);
    setSaving(true);
    const result = await updatePoolConfig({
      environmentId,
      input: {
        instanceId: member.instanceId,
        pool: {
          poolEnabled,
          billingClass,
          poolPriority: priority,
          maxConcurrentRuns,
          preferredTiers: [...member.preferredTiers],
          poolTags: [...member.poolTags],
          ...(monthlyCostMinor !== null && monthlyCostMinor > 0
            ? {
                monthlySubscriptionCostMinor: monthlyCostMinor,
                subscriptionCurrency: member.subscriptionCurrency ?? DEFAULT_REPORTING_CURRENCY,
              }
            : {}),
        },
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Pool routing saved"),
        description: member.displayName,
      });
    }
  };

  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{member.displayName}</span>
          <Badge size="sm" variant={member.healthStatus === "healthy" ? "success" : "secondary"}>
            {member.healthStatus}
          </Badge>
          <span className="font-mono text-muted-foreground tabular-nums">
            {member.activeRunCount}/{member.maxConcurrentRuns}
          </span>
          <span
            className={cn(
              "font-mono tabular-nums",
              quota.tone === "healthy"
                ? "text-success-foreground"
                : quota.tone === "warning"
                  ? "text-warning-foreground"
                  : quota.tone === "critical"
                    ? "text-destructive-foreground"
                    : "text-muted-foreground",
            )}
          >
            {quota.label}
          </span>
        </div>

        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <span>
            <T>In pool</T>
          </span>
          <Switch
            checked={poolEnabled}
            disabled={!canEdit}
            onCheckedChange={(checked) => setPoolEnabled(Boolean(checked))}
            aria-label={gt("Include {name} in Sovereign provider pool", {
              name: member.displayName,
            })}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        <Select
          value={billingClass}
          disabled={!canEdit}
          onValueChange={(value) => {
            if (value) setBillingClass(value as ProviderBillingClass);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={gt("Billing class for {name}", { name: member.displayName })}
          >
            <SelectValue>{billingLabel(billingClass)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start">
            {ProviderBillingClass.literals.map((option) => (
              <SelectItem key={option} value={option}>
                {billingLabel(option)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Input
          size="sm"
          inputMode="numeric"
          disabled={!canEdit}
          value={priorityInput}
          onChange={(event) => setPriorityInput(event.target.value)}
          placeholder={gt("Priority (0-100)")}
          aria-label={gt("Pool priority")}
        />

        <Input
          size="sm"
          inputMode="numeric"
          disabled={!canEdit}
          value={concurrencyInput}
          onChange={(event) => setConcurrencyInput(event.target.value)}
          placeholder={gt("Max runs")}
          aria-label={gt("Max concurrent runs")}
        />

        <Input
          size="sm"
          inputMode="decimal"
          disabled={!canEdit}
          value={monthlyCostInput}
          onChange={(event) => setMonthlyCostInput(event.target.value)}
          placeholder={gt("Monthly GBP")}
          aria-label={gt("Monthly subscription cost")}
        />

        <Button
          size="sm"
          variant="outline"
          disabled={!canEdit || saving}
          onClick={() => void handleSave()}
        >
          <SaveIcon className="size-3.5" />
          {saving ? <T>Saving…</T> : <T>Save</T>}
        </Button>
      </div>
    </div>
  );
}

export function SovereignProviderPoolSection({
  environmentId,
  readOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly?: boolean;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const poolQuery = useSovereignProviderPool(environmentId, "settings-provider-pool");
  const overviewQuery = useSovereignOverview(environmentId, "settings-provider-pool-control");
  const poolPermitted = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateProviderPoolConfigCommand,
  );
  const controlPermitted = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateControlStateCommand,
  );
  const canUpdatePool = !readOnly && poolPermitted;
  const canUpdateControl = !readOnly && controlPermitted;
  const updateControlState = useAtomCommand(sovereignCommands.updateControlStateCommand, {
    label: "sovereign-paid-fallback-mode",
  });

  const paidFallbackMode =
    overviewQuery.data?.controlState.defaultPaidFallbackMode ??
    poolQuery.data?.defaultRoutingPolicy.paidFallbackMode ??
    "deny";

  const fallbackLabel = (mode: PaidFallbackMode): string => {
    switch (mode) {
      case "deny":
        return gt("Deny paid fallback");
      case "ask_approval":
        return gt("Ask approval first");
      case "allow":
        return gt("Allow within budget");
    }
  };

  const handleFallbackChange = async (next: PaidFallbackMode) => {
    if (!canUpdateControl) return;
    const result = await updateControlState({
      environmentId,
      input: {
        defaultPaidFallbackMode: next,
      },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Paid fallback policy updated"),
        description: fallbackLabel(next),
      });
    }
  };

  const members = poolQuery.data?.members ?? [];

  return (
    <SettingsSection
      {...searchableSetting("sovereign-provider-pool")}
      title={gt("Sovereign Provider Pool")}
    >
      <SettingsRow
        title={gt("Paid API fallback policy")}
        description={gt(
          "Controls whether Sovereign may fall back to paid API instances when subscription, local, or free quota is exhausted.",
        )}
        control={
          <div className="w-full sm:w-48">
            <Select
              value={paidFallbackMode}
              disabled={!canUpdateControl}
              onValueChange={(value) => {
                if (value) void handleFallbackChange(value as PaidFallbackMode);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Paid API fallback policy")}>
                <SelectValue>{fallbackLabel(paidFallbackMode)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end">
                {PaidFallbackMode.literals.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {fallbackLabel(mode)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      {members.length === 0 ? (
        <div className="px-4 py-4 text-xs text-muted-foreground">
          <T>
            Configure provider instances above to manage billing class, priority, and concurrency.
          </T>
        </div>
      ) : (
        <div className="divide-y divide-border/70">
          {members.map((member) => (
            <ProviderPoolMemberRow
              key={member.instanceId}
              environmentId={environmentId}
              member={member}
              canEdit={canUpdatePool}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
