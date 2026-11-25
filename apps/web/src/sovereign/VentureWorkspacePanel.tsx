import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, SovereignVentureDetail } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";

export function VentureWorkspacePanel({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly detail: SovereignVentureDetail;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const handleNewThread = useNewThreadHandler();
  const canUpdateVenture = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateVentureCommand,
  );
  const updateVenture = useAtomCommand(sovereignCommands.updateVentureCommand, {
    label: "sovereign-link-venture-project",
  });

  const { venture } = detail;
  const linkedProjectIds = new Set(venture.linkedProjectIds);
  const linkedThreadIds = new Set(venture.linkedThreadIds);

  const envProjects = projects.filter(
    (project) =>
      project.archivedAt == null &&
      (environmentId === null || project.environmentId === environmentId),
  );
  const linkedProjects = envProjects.filter((project) => linkedProjectIds.has(project.id));
  const unlinkedProjects = envProjects.filter((project) => !linkedProjectIds.has(project.id));

  const ventureThreads = threads.filter(
    (thread) =>
      thread.archivedAt == null &&
      (linkedThreadIds.has(thread.id) || linkedProjectIds.has(thread.projectId)),
  );

  const handleLinkProject = async (projectId: ProjectId) => {
    if (environmentId === null || !canUpdateVenture) return;
    const nextIds = [...venture.linkedProjectIds, projectId];
    const result = await updateVenture({
      environmentId,
      input: {
        ventureId: venture.id,
        linkedProjectIds: nextIds,
      },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Project linked to venture"),
      });
    }
  };

  const handleStartThread = (projectEnvId: EnvironmentId, projectId: ProjectId) => {
    void handleNewThread(scopeProjectRef(projectEnvId, projectId));
  };

  return (
    <div className="space-y-6">
      <section
        aria-label={gt("Linked Agent Conversations")}
        className="rounded-xl border border-border/80 bg-card/80"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              <T>Agent Conversations</T>
            </h2>
          </div>
          <Badge size="sm" variant="secondary">
            {ventureThreads.length}
          </Badge>
        </div>

        {ventureThreads.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            <T>
              No conversations linked yet. Start a thread in a linked project below to open full
              coding workspace diffs, terminals, and provider controls.
            </T>
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {ventureThreads.map((thread) => (
              <div
                key={`${thread.environmentId}:${thread.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {thread.title || gt("Untitled thread")}
                  </p>
                  <p className="truncate font-mono text-2xs text-muted-foreground">{thread.id}</p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams({
                        environmentId: thread.environmentId,
                        threadId: thread.id,
                      }),
                    })
                  }
                >
                  <T>Open thread</T>
                  <ArrowUpRightIcon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        aria-label={gt("Linked Code Workspaces")}
        className="rounded-xl border border-border/80 bg-card/80"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              <T>Code Workspaces &amp; Repositories</T>
            </h2>
          </div>
          <Badge size="sm" variant="secondary">
            {linkedProjects.length}
          </Badge>
        </div>

        {linkedProjects.length === 0 ? (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            <T>
              Link a local repository below to attach worktrees and agent threads to this venture.
            </T>
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {linkedProjects.map((project) => (
              <div
                key={`${project.environmentId}:${project.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{project.title}</p>
                  <p className="truncate font-mono text-2xs text-muted-foreground">
                    {project.workspaceRoot}
                  </p>
                </div>
                <Button
                  size="xs"
                  onClick={() => handleStartThread(project.environmentId, project.id)}
                >
                  <PlusIcon className="size-3.5" />
                  <T>New thread</T>
                </Button>
              </div>
            ))}
          </div>
        )}

        {unlinkedProjects.length > 0 ? (
          <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
            <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              <T>Available projects to link</T>
            </p>
            <div className="flex flex-wrap gap-2">
              {unlinkedProjects.map((project) => (
                <Button
                  key={`${project.environmentId}:${project.id}`}
                  size="xs"
                  variant="outline"
                  disabled={!canUpdateVenture}
                  onClick={() => void handleLinkProject(project.id)}
                >
                  <PlusIcon className="size-3" />
                  {project.title}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
