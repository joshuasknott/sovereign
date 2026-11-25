import {
  ExternalActionCategory,
  type EnvironmentId,
  type PermissionDecisionMode,
  type Venture,
  type VentureActionModes,
} from "@t3tools/contracts";
import { actionCategoryLabel } from "@t3tools/client-runtime/sovereign/format";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { SaveIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { formatMinorToMajorInput, parseMajorCurrencyToMinor } from "./sovereignUi.logic";

const PERMISSION_MODES: ReadonlyArray<PermissionDecisionMode> = [
  "deny",
  "require_approval",
  "preapproved",
];

export function VentureConfigSheet({
  environmentId,
  venture,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly venture: Venture;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const canUpdate = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateVentureCommand,
  );
  const canDelete = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.deleteVentureCommand,
  );
  const updateVenture = useAtomCommand(sovereignCommands.updateVentureCommand, {
    label: "sovereign-update-venture-config",
  });
  const deleteVenture = useAtomCommand(sovereignCommands.deleteVentureCommand, {
    label: "sovereign-delete-venture",
  });

  const [name, setName] = useState(venture.name);
  const [summary, setSummary] = useState(venture.summary);
  const [monthlyCapInput, setMonthlyCapInput] = useState(
    formatMinorToMajorInput(venture.budgetPolicy.monthlyCapMinor),
  );
  const [discretionaryAllowed, setDiscretionaryAllowed] = useState(
    venture.budgetPolicy.discretionarySpendAllowed,
  );
  const [actionModes, setActionModes] = useState<VentureActionModes>(
    venture.permissionPolicy.actionModes,
  );
  const [secAuthorised, setSecAuthorised] = useState(
    venture.permissionPolicy.securityAuthorisation.authorised,
  );
  const [secProgramme, setSecProgramme] = useState(
    venture.permissionPolicy.securityAuthorisation.programmeName ?? "",
  );
  const [secScopeText, setSecScopeText] = useState(
    venture.permissionPolicy.securityAuthorisation.targetScope.join("\n"),
  );
  const [secMethodsText, setSecMethodsText] = useState(
    venture.permissionPolicy.securityAuthorisation.permittedMethods.join("\n"),
  );
  const [secDisclosure, setSecDisclosure] = useState(
    venture.permissionPolicy.securityAuthorisation.disclosurePolicy ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const parsedCapMinor = parseMajorCurrencyToMinor(monthlyCapInput);

  const modeLabel = (mode: PermissionDecisionMode): string => {
    switch (mode) {
      case "deny":
        return gt("Deny");
      case "require_approval":
        return gt("Require approval");
      case "preapproved":
        return gt("Pre-approved");
    }
  };

  const handleSave = async () => {
    if (environmentId === null || !canUpdate || saving || parsedCapMinor === null) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;

    const targetScope = secScopeText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const permittedMethods = secMethodsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setSaving(true);
    const result = await updateVenture({
      environmentId,
      input: {
        ventureId: venture.id,
        name: trimmedName,
        summary: summary.trim(),
        budgetPolicy: {
          ...venture.budgetPolicy,
          monthlyCapMinor: parsedCapMinor,
          discretionarySpendAllowed: discretionaryAllowed,
        },
        permissionPolicy: {
          ...venture.permissionPolicy,
          actionModes,
          securityAuthorisation: {
            ...venture.permissionPolicy.securityAuthorisation,
            authorised: secAuthorised,
            ...(secProgramme.trim().length > 0 ? { programmeName: secProgramme.trim() } : {}),
            targetScope,
            permittedMethods,
            ...(secDisclosure.trim().length > 0 ? { disclosurePolicy: secDisclosure.trim() } : {}),
            ...(secAuthorised && !venture.permissionPolicy.securityAuthorisation.authorisedAt
              ? { authorisedAt: new Date().toISOString(), authorisedBy: "owner" }
              : {}),
          },
        },
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Venture policy updated"),
        description: trimmedName,
      });
      onOpenChange(false);
    }
  };

  const handleDelete = async () => {
    if (environmentId === null || !canDelete || deleting) return;
    setDeleting(true);
    const result = await deleteVenture({
      environmentId,
      input: { ventureId: venture.id },
    });
    setDeleting(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "info",
        title: gt("Venture deleted"),
        description: venture.name,
      });
      setDeleteDialogOpen(false);
      onOpenChange(false);
      void navigate({ to: "/overview", replace: true });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetPopup side="right" className="max-w-lg">
          <div className="border-b border-border/70">
            <SheetHeader>
              <SheetTitle>
                <T>Venture Policy &amp; Configuration</T>
              </SheetTitle>
              <SheetDescription>
                <T>
                  Adjust budget ceilings, approval boundaries, and scope locks for this venture.
                </T>
              </SheetDescription>
            </SheetHeader>
          </div>

          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="space-y-6 p-6">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <T>Identity &amp; Strategy</T>
                </h3>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="venture-cfg-name">
                    <T>Name</T>
                  </label>
                  <Input
                    id="venture-cfg-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-medium text-foreground"
                    htmlFor="venture-cfg-summary"
                  >
                    <T>Summary &amp; boundaries</T>
                  </label>
                  <Textarea
                    id="venture-cfg-summary"
                    rows={3}
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-3 border-t border-border/70 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <T>Budget Guardrail</T>
                </h3>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="venture-cfg-cap">
                    {gt("Monthly spend cap ({currency})", {
                      currency: venture.budgetPolicy.currency,
                    })}
                  </label>
                  <Input
                    id="venture-cfg-cap"
                    inputMode="decimal"
                    value={monthlyCapInput}
                    onChange={(event) => setMonthlyCapInput(event.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">
                      <T>Allow discretionary spend</T>
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      <T>Defaults to off. Financial actions still require approval when gated.</T>
                    </p>
                  </div>
                  <Switch
                    checked={discretionaryAllowed}
                    onCheckedChange={(checked) => setDiscretionaryAllowed(Boolean(checked))}
                    aria-label={gt("Allow discretionary spend")}
                  />
                </div>
              </div>

              <div className="space-y-3 border-t border-border/70 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <T>External Action Permissions</T>
                </h3>
                <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                  {ExternalActionCategory.literals.map((category) => (
                    <div
                      key={category}
                      className="flex flex-col gap-1.5 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <span className="min-w-0 flex-1 text-foreground">
                        {actionCategoryLabel(category, messages)}
                      </span>
                      <div className="w-full shrink-0 sm:w-48">
                        <Select
                          value={actionModes[category]}
                          onValueChange={(value) => {
                            if (
                              value &&
                              PERMISSION_MODES.includes(value as PermissionDecisionMode)
                            ) {
                              setActionModes((current) => ({
                                ...current,
                                [category]: value as PermissionDecisionMode,
                              }));
                            }
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={actionCategoryLabel(category, messages)}
                          >
                            <SelectValue>{modeLabel(actionModes[category])}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup align="end">
                            {PERMISSION_MODES.map((mode) => (
                              <SelectItem key={mode} value={mode}>
                                {modeLabel(mode)}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {venture.kind === "security_bounties" ? (
                <div className="space-y-3 border-t border-border/70 pt-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="size-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <T>Authorised Security Scope Lock</T>
                    </h3>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">
                        <T>Owner authorisation granted</T>
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        <T>
                          Requires explicit programme scope and non-denied security testing policy.
                        </T>
                      </p>
                    </div>
                    <Switch
                      checked={secAuthorised}
                      onCheckedChange={(checked) => setSecAuthorised(Boolean(checked))}
                      aria-label={gt("Owner authorisation granted")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground" htmlFor="sec-programme">
                      <T>Programme name</T>
                    </label>
                    <Input
                      id="sec-programme"
                      value={secProgramme}
                      onChange={(event) => setSecProgramme(event.target.value)}
                      placeholder={gt("Example: Acme Public Bug Bounty (HackerOne)")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground" htmlFor="sec-scope">
                      <T>Authorised target scope (one domain or repo per line)</T>
                    </label>
                    <Textarea
                      id="sec-scope"
                      rows={3}
                      value={secScopeText}
                      onChange={(event) => setSecScopeText(event.target.value)}
                      placeholder={gt("app.example.com\ngithub.com/acme/public-api")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground" htmlFor="sec-methods">
                      <T>Permitted methods (one per line)</T>
                    </label>
                    <Textarea
                      id="sec-methods"
                      rows={2}
                      value={secMethodsText}
                      onChange={(event) => setSecMethodsText(event.target.value)}
                      placeholder={gt("Static code audit\nNon-destructive staging verification")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground" htmlFor="sec-disclosure">
                      <T>Disclosure policy</T>
                    </label>
                    <Input
                      id="sec-disclosure"
                      value={secDisclosure}
                      onChange={(event) => setSecDisclosure(event.target.value)}
                      placeholder={gt("Coordinated 90-day disclosure via programme portal")}
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-2 border-t border-border/70 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-destructive-foreground">
                  <T>Danger Zone</T>
                </h3>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={!canDelete}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2Icon className="size-3.5" />
                  <T>Delete venture</T>
                </Button>
              </div>
            </div>
          </ScrollArea>

          <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/20 px-6 py-3">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              <T>Cancel</T>
            </Button>
            <Button
              size="sm"
              disabled={!canUpdate || saving || name.trim().length === 0 || parsedCapMinor === null}
              onClick={() => void handleSave()}
            >
              <SaveIcon className="size-3.5" />
              {saving ? <T>Saving…</T> : <T>Save policy</T>}
            </Button>
          </div>
        </SheetPopup>
      </Sheet>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{gt("Delete {name}?", { name: venture.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                This permanently removes the venture and its associated tasks, leads, and pipeline
                records from Sovereign.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button size="sm" variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              <T>Delete venture</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
