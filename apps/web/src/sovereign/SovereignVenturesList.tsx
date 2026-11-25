import type { EnvironmentId, SovereignOverviewSnapshot } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { ArrowRight, Plus } from "lucide-react";
import { ventureKindLabel } from "@t3tools/client-runtime/sovereign/format";
import { useVisibleThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { VentureMark } from "./VentureMark";

export function SovereignVenturesList({
  environmentId,
  overview,
  onNewVenture,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly overview: SovereignOverviewSnapshot;
  readonly onNewVenture: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const threads = useVisibleThreadShells();
  const canCreate = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createVentureCommand,
  );
  const projectThreads = threads.filter(
    (thread) => thread.environmentId === environmentId && !thread.archivedAt,
  );
  return (
    <section aria-labelledby="venture-heading">
      <div className="sv-ventures-heading">
        <h1 id="venture-heading">
          <T>Ventures</T>
        </h1>
        <button type="button" disabled={!canCreate} onClick={onNewVenture}>
          <Plus aria-hidden="true" />
          <T>New venture</T>
        </button>
      </div>
      {overview.ventures.length === 0 && (
        <p className="sv-empty">
          <T>No ventures configured yet</T>
        </p>
      )}
      <div className="sv-venture-grid">
        {overview.ventures.map((row) => {
          const { venture } = row;
          const approval = overview.pendingApprovals.find((item) => item.ventureId === venture.id);
          const task = overview.activeTasks.find((item) => item.ventureId === venture.id);
          const objective = overview.activeObjectives.find((item) => item.ventureId === venture.id);
          const thread =
            projectThreads.find((item) => item.id === task?.linkedThreadId) ??
            projectThreads.find((item) => venture.linkedThreadIds.includes(item.id)) ??
            projectThreads.find((item) => venture.linkedProjectIds.includes(item.projectId));
          const route = thread
            ? {
                to: "/$environmentId/$threadId" as const,
                params: buildThreadRouteParams({
                  environmentId: thread.environmentId,
                  threadId: thread.id,
                }),
              }
            : { to: "/ventures/$ventureId" as const, params: { ventureId: venture.id } };
          return (
            <Link
              key={venture.id}
              {...route}
              className="sv-venture-card"
              aria-label={gt("Open {name}", { name: venture.name })}
            >
              <div className="sv-card-top">
                <VentureMark kind={venture.kind} />
                {row.pendingApprovalsCount > 0 && (
                  <span className="sv-attention">
                    <T>Needs you</T>
                  </span>
                )}
              </div>
              <h2>{venture.name}</h2>
              <p>
                {approval?.title ||
                  task?.title ||
                  objective?.title ||
                  venture.summary ||
                  ventureKindLabel(venture.kind, messages)}
              </p>
              <ArrowRight className="sv-card-arrow" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
