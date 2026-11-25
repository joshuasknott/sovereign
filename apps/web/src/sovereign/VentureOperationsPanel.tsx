import {
  CommercialArtifactKind,
  CommercialTaskStatus,
  TaskComplexity,
  type CommercialTask,
  type EnvironmentId,
  type SovereignVentureDetail,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { FileTextIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { SovereignActivityTimeline } from "./SovereignActivityTimeline";
import { SovereignApprovalsList } from "./SovereignApprovalsList";
import { SovereignObjectivesList } from "./SovereignObjectivesList";
import {
  ARTIFACT_KIND_LABELS,
  TASK_COMPLEXITY_LABELS,
  TASK_STATUS_LABELS,
} from "./sovereignLabels";
import { formatShortTimestamp } from "./sovereignUi.logic";

export function VentureOperationsPanel({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly detail: SovereignVentureDetail;
}) {
  const gt = useGT();
  const m = useMessages();
  const [taskTitle, setTaskTitle] = useState("");
  const [taskComplexity, setTaskComplexity] = useState<TaskComplexity>("medium");
  const [creatingTask, setCreatingTask] = useState(false);

  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactKind, setArtifactKind] = useState<CommercialArtifactKind>("research_brief");
  const [artifactUri, setArtifactUri] = useState("");
  const [creatingArtifact, setCreatingArtifact] = useState(false);

  const canCreateTask = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createTaskCommand,
  );
  const canUpdateTask = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateTaskCommand,
  );
  const canCreateArtifact = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createArtifactCommand,
  );

  const createTask = useAtomCommand(sovereignCommands.createTaskCommand, {
    label: "sovereign-create-task",
  });
  const updateTask = useAtomCommand(sovereignCommands.updateTaskCommand, {
    label: "sovereign-update-task",
  });
  const createArtifact = useAtomCommand(sovereignCommands.createArtifactCommand, {
    label: "sovereign-create-artifact",
  });

  const ventureNameById = new Map([[detail.venture.id, detail.venture.name]]);

  const handleCreateTask = async () => {
    if (environmentId === null || !canCreateTask || creatingTask || taskTitle.trim().length === 0) {
      return;
    }
    setCreatingTask(true);
    const result = await createTask({
      environmentId,
      input: {
        ventureId: detail.venture.id,
        title: taskTitle.trim(),
        complexity: taskComplexity,
        status: "ready",
      },
    });
    setCreatingTask(false);
    if (result._tag === "Success") {
      setTaskTitle("");
      toastManager.add({
        type: "success",
        title: gt("Task added"),
        description: result.value.title,
      });
    }
  };

  const handleStatusChange = async (task: CommercialTask, nextStatus: CommercialTaskStatus) => {
    if (environmentId === null || !canUpdateTask) return;
    await updateTask({
      environmentId,
      input: {
        taskId: task.id,
        status: nextStatus,
      },
    });
  };

  const handleCreateArtifact = async () => {
    if (
      environmentId === null ||
      !canCreateArtifact ||
      creatingArtifact ||
      artifactTitle.trim().length === 0
    ) {
      return;
    }
    setCreatingArtifact(true);
    const result = await createArtifact({
      environmentId,
      input: {
        ventureId: detail.venture.id,
        kind: artifactKind,
        title: artifactTitle.trim(),
        ...(artifactUri.trim().length > 0 ? { uri: artifactUri.trim() } : {}),
      },
    });
    setCreatingArtifact(false);
    if (result._tag === "Success") {
      setArtifactTitle("");
      setArtifactUri("");
      toastManager.add({
        type: "success",
        title: gt("Deliverable recorded"),
        description: result.value.title,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SovereignApprovalsList
          environmentId={environmentId}
          approvals={detail.approvals}
          ventureNameById={ventureNameById}
          title={gt("Venture Approvals")}
        />
        <SovereignObjectivesList
          objectives={detail.objectives}
          ventureNameById={ventureNameById}
          emptyMessage={gt(
            "No objectives linked to this venture yet. Direct Sovereign from the Overview command centre.",
          )}
        />
      </div>

      <section
        aria-label={gt("Commercial Tasks")}
        className="rounded-xl border border-border/80 bg-card/80"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecksIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              <T>Commercial Tasks</T>
            </h2>
          </div>
          <Badge size="sm" variant="secondary">
            {detail.tasks.length}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 px-4 py-3">
          <div className="min-w-48 flex-1">
            <Input
              size="sm"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder={gt("Add a bounded commercial task...")}
              aria-label={gt("New task title")}
            />
          </div>
          <div className="w-32">
            <Select
              value={taskComplexity}
              onValueChange={(value) => {
                if (value) setTaskComplexity(value as TaskComplexity);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Task complexity")}>
                <SelectValue>{m(TASK_COMPLEXITY_LABELS[taskComplexity])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end">
                {TaskComplexity.literals.map((level) => (
                  <SelectItem key={level} value={level}>
                    {m(TASK_COMPLEXITY_LABELS[level])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!canCreateTask || creatingTask || taskTitle.trim().length === 0}
            onClick={() => void handleCreateTask()}
          >
            <PlusIcon className="size-3.5" />
            <T>Add task</T>
          </Button>
        </div>

        {detail.tasks.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            <T>No tasks scheduled for this venture yet.</T>
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {detail.tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{task.title}</span>
                    <Badge size="sm" variant="outline">
                      {m(TASK_COMPLEXITY_LABELS[task.complexity])}
                    </Badge>
                    {task.assignedModel ? (
                      <Badge size="sm" variant="secondary">
                        {task.assignedModel}
                      </Badge>
                    ) : null}
                  </div>
                  {task.blockedReason ? (
                    <p className="text-xs text-warning-foreground">
                      {gt("Blocked: {reason}", { reason: task.blockedReason })}
                    </p>
                  ) : null}
                </div>

                <div className="w-40 shrink-0">
                  <Select
                    value={task.status}
                    disabled={!canUpdateTask}
                    onValueChange={(value) => {
                      if (value) void handleStatusChange(task, value as CommercialTaskStatus);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={gt("Status for {title}", { title: task.title })}
                    >
                      <SelectValue>{m(TASK_STATUS_LABELS[task.status])}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      {CommercialTaskStatus.literals.map((status) => (
                        <SelectItem key={status} value={status}>
                          {m(TASK_STATUS_LABELS[status])}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-label={gt("Deliverables and Artifacts")}
          className="flex flex-col rounded-xl border border-border/80 bg-card/80"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                <T>Deliverables &amp; Artifacts</T>
              </h2>
            </div>
            <Badge size="sm" variant="secondary">
              {detail.artifacts.length}
            </Badge>
          </div>

          <div className="space-y-2 border-b border-border/70 bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                size="sm"
                value={artifactTitle}
                onChange={(event) => setArtifactTitle(event.target.value)}
                placeholder={gt("Deliverable title")}
                aria-label={gt("Deliverable title")}
              />
              <Input
                size="sm"
                value={artifactUri}
                onChange={(event) => setArtifactUri(event.target.value)}
                placeholder={gt("URL or file path (optional)")}
                aria-label={gt("Deliverable URL or path")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-44 flex-1">
                <Select
                  value={artifactKind}
                  onValueChange={(value) => {
                    if (value) setArtifactKind(value as CommercialArtifactKind);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Artifact kind")}>
                    <SelectValue>{m(ARTIFACT_KIND_LABELS[artifactKind])}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start">
                    {CommercialArtifactKind.literals.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {m(ARTIFACT_KIND_LABELS[kind])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <Button
                size="sm"
                aria-label={gt("Add deliverable")}
                disabled={
                  !canCreateArtifact || creatingArtifact || artifactTitle.trim().length === 0
                }
                onClick={() => void handleCreateArtifact()}
              >
                <PlusIcon className="size-3.5" />
                <T>Add</T>
              </Button>
            </div>
          </div>

          {detail.artifacts.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              <T>
                Patches, pull requests, proposals, and reports produced by this venture appear here.
              </T>
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {detail.artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{artifact.title}</p>
                    {artifact.uri ? (
                      <p className="truncate font-mono text-2xs text-muted-foreground">
                        {artifact.uri}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge size="sm" variant="outline">
                      {m(ARTIFACT_KIND_LABELS[artifact.kind])}
                    </Badge>
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      {formatShortTimestamp(artifact.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <SovereignActivityTimeline events={detail.auditEvents} title={gt("Venture Audit Log")} />
      </div>
    </div>
  );
}
