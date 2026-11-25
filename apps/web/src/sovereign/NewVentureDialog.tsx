import {
  DEFAULT_REPORTING_CURRENCY,
  DEFAULT_VENTURE_BUDGET_POLICY,
  type EnvironmentId,
  type VentureBlueprint,
  type VentureKind,
} from "@t3tools/contracts";
import { ventureKindLabel } from "@t3tools/client-runtime/sovereign/format";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import {
  sovereignCommands,
  useSovereignBlueprints,
  useSovereignCommandPermission,
} from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { dedupeVentureBlueprints, parseMajorCurrencyToMinor } from "./sovereignUi.logic";

const FALLBACK_CUSTOM_KIND: VentureKind = "custom";

function NewVentureDialogContent({
  environmentId,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const blueprintsQuery = useSovereignBlueprints(open ? environmentId : null, "new-venture-dialog");
  const blueprints = dedupeVentureBlueprints(blueprintsQuery.data?.blueprints ?? []);
  const hasCustomBlueprint = blueprints.some(
    (item) => item.templateKey === "custom" || item.kind === "custom",
  );
  const canCreate = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createVentureCommand,
  );
  const createVenture = useAtomCommand(sovereignCommands.createVentureCommand, {
    label: "sovereign-create-venture",
  });

  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("dev_bounties");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [monthlyCapInput, setMonthlyCapInput] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  const selectedBlueprint: VentureBlueprint | null =
    blueprints.find((item) => item.templateKey === selectedTemplateKey) ??
    (selectedTemplateKey === "custom" ? null : (blueprints[0] ?? null));

  const parsedCapMinor = parseMajorCurrencyToMinor(monthlyCapInput);
  const isFallbackCustomSelected = !hasCustomBlueprint && selectedBlueprint === null;

  const handleSelectBlueprint = (templateKey: string, blueprint: VentureBlueprint | null) => {
    setSelectedTemplateKey(templateKey);
    if (blueprint !== null && name.trim().length === 0) {
      setName(blueprint.name);
      setSummary(blueprint.description);
    }
  };

  const handleCreate = async () => {
    if (environmentId === null || submitting || !canCreate) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || parsedCapMinor === null) return;
    setSubmitting(true);
    const kind: VentureKind = selectedBlueprint?.kind ?? FALLBACK_CUSTOM_KIND;
    const result = await createVenture({
      environmentId,
      input: {
        name: trimmedName,
        kind,
        ...(selectedBlueprint
          ? { templateKey: selectedBlueprint.templateKey }
          : { templateKey: "custom" }),
        status: "active",
        summary: summary.trim(),
        ...(selectedBlueprint ? { uiModules: [...selectedBlueprint.uiModules] } : {}),
        budgetPolicy: {
          ...DEFAULT_VENTURE_BUDGET_POLICY,
          currency: DEFAULT_REPORTING_CURRENCY,
          monthlyCapMinor: parsedCapMinor,
          discretionarySpendAllowed: parsedCapMinor > 0,
        },
      },
    });
    setSubmitting(false);
    if (result._tag === "Success") {
      onOpenChange(false);
      toastManager.add({
        type: "success",
        title: gt("Venture created"),
        description: result.value.name,
      });
      setName("");
      setSummary("");
      setMonthlyCapInput("0");
      void navigate({
        to: "/ventures/$ventureId",
        params: { ventureId: result.value.id },
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <T>New venture</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Choose a commercial blueprint or start custom. All external actions remain gated by
              your approval policy and budget cap.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              <T>Venture blueprint</T>
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {blueprints.map((blueprint) => {
                const selected = selectedBlueprint?.templateKey === blueprint.templateKey;
                return (
                  <button
                    key={blueprint.templateKey}
                    type="button"
                    onClick={() => handleSelectBlueprint(blueprint.templateKey, blueprint)}
                    aria-pressed={selected}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary bg-accent/25 text-foreground"
                        : "border-border bg-card/60 text-foreground hover:bg-accent/10",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{blueprint.name}</span>
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        <Badge
                          size="sm"
                          variant={blueprint.kind === "custom" ? "outline" : "secondary"}
                        >
                          {ventureKindLabel(blueprint.kind, messages)}
                        </Badge>
                        {selected ? <CheckIcon className="size-3.5 text-primary" /> : null}
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {blueprint.description}
                    </p>
                  </button>
                );
              })}
              {!hasCustomBlueprint ? (
                <button
                  type="button"
                  onClick={() => handleSelectBlueprint("custom", null)}
                  aria-pressed={isFallbackCustomSelected}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isFallbackCustomSelected
                      ? "border-primary bg-accent/25 text-foreground"
                      : "border-border bg-card/60 text-foreground hover:bg-accent/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug">
                      <T>Custom Venture</T>
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      <Badge size="sm" variant="outline">
                        {ventureKindLabel("custom", messages)}
                      </Badge>
                      {isFallbackCustomSelected ? (
                        <CheckIcon className="size-3.5 text-primary" />
                      ) : null}
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    <T>Flexible workspace with operations, pipeline, ledger, and agent threads.</T>
                  </p>
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-foreground" htmlFor="new-venture-name">
                <T>Venture name</T>
              </label>
              <Input
                id="new-venture-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={gt("Example: Open-Source Bounties UK")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="new-venture-cap">
                <T>Monthly cap (GBP)</T>
              </label>
              <Input
                id="new-venture-cap"
                inputMode="decimal"
                value={monthlyCapInput}
                onChange={(event) => setMonthlyCapInput(event.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="new-venture-summary">
              <T>Commercial objective and boundaries</T>
            </label>
            <Textarea
              id="new-venture-summary"
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={gt(
                "Describe the target offer, revenue model, and boundaries for this venture.",
              )}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            <T>Cancel</T>
          </DialogClose>
          <Button
            size="sm"
            disabled={
              !canCreate || submitting || name.trim().length === 0 || parsedCapMinor === null
            }
            onClick={() => void handleCreate()}
          >
            <PlusIcon className="size-3.5" />
            <T>Create venture</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function NewVentureDialog(props: {
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  if (!props.open) return null;
  return <NewVentureDialogContent {...props} />;
}
