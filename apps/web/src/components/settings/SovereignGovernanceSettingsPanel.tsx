import { DEFAULT_REPORTING_CURRENCY, ExternalActionCategory } from "@t3tools/contracts";
import { actionCategoryLabel, formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { OctagonAlertIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { EmergencyStopDialog } from "../../sovereign/EmergencyStopDialog";
import { SovereignActivityTimeline } from "../../sovereign/SovereignActivityTimeline";
import { parseMajorCurrencyToMinor } from "../../sovereign/sovereignUi.logic";
import {
  sovereignCommands,
  useSovereignApprovals,
  useSovereignAuditEvents,
  useSovereignCommandPermission,
  useSovereignEnvironmentId,
  useSovereignOverview,
} from "../../state/sovereign";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function SovereignGovernanceSettingsPanel() {
  const gt = useGT();
  const messages = useMessages();
  const searchableSetting = useSearchableSetting();
  const environmentId = useSovereignEnvironmentId();
  const overviewQuery = useSovereignOverview(environmentId, "settings-governance");
  const approvalsQuery = useSovereignApprovals(environmentId, {}, "settings-governance");
  const auditQuery = useSovereignAuditEvents(environmentId, { limit: 30 }, "settings-governance");

  const canUpdateControl = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateControlStateCommand,
  );
  const canUpsertPolicy = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.upsertPreapprovalPolicyCommand,
  );
  const canDeletePolicy = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.deletePreapprovalPolicyCommand,
  );

  const updateControlState = useAtomCommand(sovereignCommands.updateControlStateCommand, {
    label: "sovereign-governance-control-state",
  });
  const upsertPolicy = useAtomCommand(sovereignCommands.upsertPreapprovalPolicyCommand, {
    label: "sovereign-upsert-preapproval-policy",
  });
  const deletePolicy = useAtomCommand(sovereignCommands.deletePreapprovalPolicyCommand, {
    label: "sovereign-delete-preapproval-policy",
  });

  const [emergencyStopOpen, setEmergencyStopOpen] = useState(false);
  const [policyCategory, setPolicyCategory] =
    useState<ExternalActionCategory>("external_submission");
  const [policyLabel, setPolicyLabel] = useState("");
  const [singleCapInput, setSingleCapInput] = useState("0");
  const [monthlyCapInput, setMonthlyCapInput] = useState("0");
  const [savingPolicy, setSavingPolicy] = useState(false);

  const controlState = overviewQuery.data?.controlState;
  const emergencyStopActive = controlState?.emergencyStopActive === true;
  const promptInjectionGuardEnabled = controlState?.promptInjectionGuardEnabled ?? true;
  const currency = controlState?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY;
  const policies = approvalsQuery.data?.preapprovalPolicies ?? [];

  const handleToggleInjectionGuard = async (enabled: boolean) => {
    if (environmentId === null || !canUpdateControl) return;
    const result = await updateControlState({
      environmentId,
      input: { promptInjectionGuardEnabled: enabled },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "info",
        title: enabled
          ? gt("Prompt-injection guard enabled")
          : gt("Prompt-injection guard disabled"),
      });
    }
  };

  const handleCreatePolicy = async () => {
    const singleMinor = parseMajorCurrencyToMinor(singleCapInput);
    const monthlyMinor = parseMajorCurrencyToMinor(monthlyCapInput);
    if (
      environmentId === null ||
      !canUpsertPolicy ||
      savingPolicy ||
      policyLabel.trim().length === 0 ||
      singleMinor === null ||
      monthlyMinor === null
    ) {
      return;
    }
    setSavingPolicy(true);
    const result = await upsertPolicy({
      environmentId,
      input: {
        category: policyCategory,
        label: policyLabel.trim(),
        enabled: true,
        maxSingleActionMinor: singleMinor,
        maxMonthlyAggregateMinor: monthlyMinor,
        currency,
      },
    });
    setSavingPolicy(false);
    if (result._tag === "Success") {
      setPolicyLabel("");
      setSingleCapInput("0");
      setMonthlyCapInput("0");
      toastManager.add({
        type: "success",
        title: gt("Pre-approval policy created"),
        description: result.value.label,
      });
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("sovereign-governance")}
        title={gt("Safety & Controls")}
      >
        <SettingsRow
          title={gt("Emergency Stop")}
          description={
            emergencyStopActive
              ? gt("Halted: all autonomous external execution and provider routing are stopped.")
              : gt("Operating normally. Trigger Emergency Stop at any time to halt all ventures.")
          }
          control={
            <Button
              size="sm"
              variant={emergencyStopActive ? "default" : "destructive-outline"}
              disabled={environmentId === null}
              onClick={() => setEmergencyStopOpen(true)}
            >
              {emergencyStopActive ? (
                <>
                  <PlayIcon className="size-3.5" />
                  <T>Resume Operations</T>
                </>
              ) : (
                <>
                  <OctagonAlertIcon className="size-3.5" />
                  <T>Emergency Stop</T>
                </>
              )}
            </Button>
          }
        />

        <SettingsRow
          title={gt("Prompt-injection guard")}
          description={gt(
            "Quarantine suspicious instructions in untrusted external emails, issues, and web pages before agents act.",
          )}
          control={
            <Switch
              checked={promptInjectionGuardEnabled}
              disabled={!canUpdateControl}
              onCheckedChange={(checked) => void handleToggleInjectionGuard(Boolean(checked))}
              aria-label={gt("Prompt-injection guard")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={gt("Pre-Approval Policies")}>
        <div className="space-y-3 border-b border-border/70 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                <T>Action category</T>
              </span>
              <Select
                value={policyCategory}
                onValueChange={(value) => {
                  if (value) setPolicyCategory(value as ExternalActionCategory);
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Action category")}>
                  <SelectValue>{actionCategoryLabel(policyCategory, messages)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start">
                  {ExternalActionCategory.literals.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {actionCategoryLabel(cat, messages)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="preapproval-policy-name"
                className="text-xs font-medium text-muted-foreground"
              >
                <T>Policy name</T>
              </label>
              <Input
                id="preapproval-policy-name"
                size="sm"
                value={policyLabel}
                onChange={(event) => setPolicyLabel(event.target.value)}
                placeholder={gt("Example: Routine PR submissions")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1">
              <label
                htmlFor="preapproval-single-cap"
                className="text-xs font-medium text-muted-foreground"
              >
                {gt("Max per action ({currency})", { currency })}
              </label>
              <Input
                id="preapproval-single-cap"
                size="sm"
                inputMode="decimal"
                value={singleCapInput}
                onChange={(event) => setSingleCapInput(event.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="preapproval-monthly-cap"
                className="text-xs font-medium text-muted-foreground"
              >
                {gt("Max monthly ({currency})", { currency })}
              </label>
              <Input
                id="preapproval-monthly-cap"
                size="sm"
                inputMode="decimal"
                value={monthlyCapInput}
                onChange={(event) => setMonthlyCapInput(event.target.value)}
                placeholder="0"
              />
            </div>

            <Button
              size="sm"
              aria-label={gt("Add pre-approval policy")}
              disabled={
                environmentId === null ||
                !canUpsertPolicy ||
                savingPolicy ||
                policyLabel.trim().length === 0
              }
              onClick={() => void handleCreatePolicy()}
            >
              <PlusIcon className="size-3.5" />
              <T>Add policy</T>
            </Button>
          </div>
        </div>

        {policies.length === 0 ? (
          <div className="px-4 py-5 text-xs text-muted-foreground">
            <T>
              No standing pre-approvals configured. Every external action defaults to requiring
              explicit approval.
            </T>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {policies.map((policy) => (
              <div
                key={policy.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{policy.label}</span>
                    <Badge size="sm" variant="secondary">
                      {actionCategoryLabel(policy.category, messages)}
                    </Badge>
                    <Badge size="sm" variant={policy.enabled ? "success" : "outline"}>
                      {policy.enabled ? gt("Active") : gt("Disabled")}
                    </Badge>
                  </div>
                  <p className="font-mono text-2xs text-muted-foreground tabular-nums">
                    {gt("Single cap: {single} · Monthly cap: {monthly}", {
                      single: formatMinorCurrency(
                        policy.maxSingleActionMinor ?? 0,
                        policy.currency,
                      ),
                      monthly: formatMinorCurrency(
                        policy.maxMonthlyAggregateMinor ?? 0,
                        policy.currency,
                      ),
                    })}
                  </p>
                </div>

                <Button
                  size="icon-xs"
                  variant="ghost-destructive"
                  disabled={environmentId === null || !canDeletePolicy}
                  aria-label={gt("Delete policy {label}", { label: policy.label })}
                  onClick={() => {
                    if (environmentId !== null) {
                      void deletePolicy({
                        environmentId,
                        input: { policyId: policy.id },
                      });
                    }
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SovereignActivityTimeline
        events={auditQuery.data?.events ?? overviewQuery.data?.recentAuditEvents ?? []}
        title={gt("Governance Audit Log")}
        limit={30}
      />

      <EmergencyStopDialog
        environmentId={environmentId}
        emergencyStopActive={emergencyStopActive}
        currentReason={controlState?.emergencyStopReason ?? null}
        open={emergencyStopOpen}
        onOpenChange={setEmergencyStopOpen}
      />
    </SettingsPageContainer>
  );
}
