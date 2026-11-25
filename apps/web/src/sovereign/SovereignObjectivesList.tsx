import type { CommercialObjective } from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon, CompassIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";

export function SovereignObjectivesList({
  objectives,
  ventureNameById,
  emptyMessage,
}: {
  readonly objectives: ReadonlyArray<CommercialObjective>;
  readonly ventureNameById: ReadonlyMap<string, string>;
  readonly emptyMessage?: string;
}) {
  const gt = useGT();

  return (
    <section
      aria-label={gt("Active Objectives and Strategy")}
      className="flex flex-col rounded-xl border border-border/80 bg-card/80"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <CompassIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            <T>Active Objectives &amp; Strategy</T>
          </h2>
        </div>
        <Badge size="sm" variant="secondary">
          {objectives.length}
        </Badge>
      </div>

      {objectives.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">
          {emptyMessage ??
            gt(
              "No active objectives yet. Use the instruction composer above to set a commercial goal.",
            )}
        </p>
      ) : (
        <div className="divide-y divide-border/70">
          {objectives.map((objective) => (
            <div key={objective.id} className="space-y-2.5 px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{objective.title}</span>
                    <Badge
                      size="sm"
                      variant={objective.status === "active" ? "success" : "secondary"}
                    >
                      {objective.status}
                    </Badge>
                    <Badge size="sm" variant="outline">
                      {objective.horizon}
                    </Badge>
                  </div>
                  {objective.description && objective.description !== objective.title ? (
                    <p className="text-xs text-muted-foreground">{objective.description}</p>
                  ) : null}
                </div>
                {objective.targetRevenueMinor !== null ? (
                  <span className="shrink-0 font-mono text-xs font-medium text-foreground tabular-nums">
                    {formatMinorCurrency(objective.targetRevenueMinor, objective.currency)}
                  </span>
                ) : null}
              </div>

              {objective.strategyPlan ? (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs text-foreground">{objective.strategyPlan.summary}</p>
                  {objective.strategyPlan.steps.length > 0 ? (
                    <ol className="space-y-1.5">
                      {objective.strategyPlan.steps.slice(0, 5).map((step) => {
                        const linkedName = step.ventureId
                          ? ventureNameById.get(step.ventureId)
                          : null;
                        return (
                          <li
                            key={step.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span className="min-w-0 flex-1 text-muted-foreground">
                              <span className="font-medium text-foreground">{step.title}</span>
                              {step.requiresApproval ? (
                                <span className="ms-1.5 text-2xs text-warning-foreground">
                                  ({gt("Approval gated")})
                                </span>
                              ) : null}
                            </span>
                            {step.ventureId && linkedName ? (
                              <Link
                                to="/ventures/$ventureId"
                                params={{ ventureId: step.ventureId }}
                                className="inline-flex items-center gap-0.5 text-2xs font-medium text-primary hover:underline"
                              >
                                {linkedName}
                                <ArrowUpRightIcon className="size-3" />
                              </Link>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
