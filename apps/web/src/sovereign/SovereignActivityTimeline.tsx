import type { AuditEvent } from "@t3tools/contracts";
import { actionCategoryLabel } from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import { ActivityIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { formatShortTimestamp } from "./sovereignUi.logic";

export function SovereignActivityTimeline({
  events,
  title,
  limit = 12,
}: {
  readonly events: ReadonlyArray<AuditEvent>;
  readonly title?: string;
  readonly limit?: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const visible = events.slice(0, limit);

  return (
    <section
      aria-label={title ?? gt("Recent Developments")}
      className="flex flex-col rounded-xl border border-border/80 bg-card/80"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <ActivityIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {title ?? <T>Recent Developments</T>}
          </h2>
        </div>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
          {visible.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">
          <T>Audit trail events and operational milestones will appear here.</T>
        </p>
      ) : (
        <div className="divide-y divide-border/70">
          {visible.map((event) => (
            <div key={event.id} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  event.severity === "critical"
                    ? "bg-destructive"
                    : event.severity === "warning"
                      ? "bg-warning"
                      : "bg-primary",
                )}
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-foreground">{event.summary}</p>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span>{event.actor}</span>
                  {event.category ? (
                    <Badge size="sm" variant="outline">
                      {actionCategoryLabel(event.category, messages)}
                    </Badge>
                  ) : null}
                  <span className="tabular-nums">{formatShortTimestamp(event.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
