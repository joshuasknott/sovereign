import {
  DEFAULT_REPORTING_CURRENCY,
  type ApprovalRequest,
  type EnvironmentId,
} from "@t3tools/contracts";
import { actionCategoryLabel, formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon, ChevronDownIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { formatShortTimestamp } from "./sovereignUi.logic";

export function SovereignApprovalsList({
  environmentId,
  approvals,
  ventureNameById,
  title,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly approvals: ReadonlyArray<ApprovalRequest>;
  readonly ventureNameById: ReadonlyMap<string, string>;
  readonly title?: string;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const canDecide = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.decideApprovalCommand,
  );
  const decideApproval = useAtomCommand(sovereignCommands.decideApprovalCommand, {
    label: "sovereign-decide-approval",
  });

  const pendingApprovals = approvals.filter((item) => item.status === "pending");

  const handleDecision = async (approval: ApprovalRequest, decision: "approve" | "reject") => {
    if (environmentId === null || !canDecide || decidingId !== null) return;
    setDecidingId(approval.id);
    const result = await decideApproval({
      environmentId,
      input: {
        approvalId: approval.id,
        decision,
      },
    });
    setDecidingId(null);
    if (result._tag === "Success") {
      toastManager.add({
        type: decision === "approve" ? "success" : "info",
        title: decision === "approve" ? gt("Action approved") : gt("Action rejected"),
        description: approval.title,
      });
    }
  };

  return (
    <section
      aria-label={title ?? gt("Pending Approvals")}
      className="flex flex-col rounded-xl border border-border/80 bg-card/80"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {title ?? <T>Pending Approvals</T>}
          </h2>
        </div>
        <Badge size="sm" variant={pendingApprovals.length > 0 ? "warning" : "secondary"}>
          {pendingApprovals.length}
        </Badge>
      </div>

      {pendingApprovals.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">
          <T>No pending approvals or external blockers.</T>
        </p>
      ) : (
        <div className="divide-y divide-border/70">
          {pendingApprovals.map((approval) => {
            const isExpanded = expandedId === approval.id;
            const ventureName = approval.ventureId
              ? (ventureNameById.get(approval.ventureId) ?? null)
              : null;
            const costLabel =
              approval.estimatedCostMinor !== undefined &&
              approval.estimatedCostMinor !== null &&
              approval.estimatedCostMinor > 0
                ? formatMinorCurrency(
                    approval.estimatedCostMinor,
                    approval.currency ?? DEFAULT_REPORTING_CURRENCY,
                  )
                : null;
            const busy = decidingId === approval.id;

            return (
              <div key={approval.id} className="space-y-2.5 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{approval.title}</span>
                      <Badge
                        size="sm"
                        variant={
                          approval.riskLevel === "critical" || approval.riskLevel === "high"
                            ? "error"
                            : approval.riskLevel === "medium"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {actionCategoryLabel(approval.category, messages)}
                      </Badge>
                      {ventureName ? (
                        <Badge size="sm" variant="outline">
                          {ventureName}
                        </Badge>
                      ) : null}
                      {costLabel ? (
                        <span className="font-mono text-xs font-medium text-warning-foreground tabular-nums">
                          {costLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{approval.summary}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedId(isExpanded ? null : approval.id)}
                    >
                      <T>Inspect</T>
                      <ChevronDownIcon
                        className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
                      />
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canDecide || busy}
                      onClick={() => void handleDecision(approval, "reject")}
                    >
                      <XIcon className="size-3.5" />
                      <T>Reject</T>
                    </Button>
                    <Button
                      size="xs"
                      disabled={!canDecide || busy}
                      onClick={() => void handleDecision(approval, "approve")}
                    >
                      <CheckIcon className="size-3.5" />
                      <T>Approve</T>
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>
                        <T>Requested action:</T>{" "}
                        <strong className="font-medium text-foreground">
                          {approval.requestedAction}
                        </strong>
                      </span>
                      {approval.targetLabel ? (
                        <span>
                          <T>Target:</T>{" "}
                          <strong className="font-medium text-foreground">
                            {approval.targetLabel}
                          </strong>
                        </span>
                      ) : null}
                      <span>
                        <T>Requested by:</T> {approval.requestedBy}
                      </span>
                      <span>{formatShortTimestamp(approval.requestedAt)}</span>
                    </div>
                    {approval.payload ? (
                      <pre className="max-h-40 overflow-auto rounded-md border border-border/60 bg-background/80 p-2 font-mono text-2xs text-foreground">
                        {JSON.stringify(approval.payload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
