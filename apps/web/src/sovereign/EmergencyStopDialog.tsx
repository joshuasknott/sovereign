import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { OctagonAlertIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
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
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";

export function EmergencyStopDialog({
  environmentId,
  emergencyStopActive,
  currentReason,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly emergencyStopActive: boolean;
  readonly currentReason: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canTrigger = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.triggerEmergencyStopCommand,
  );
  const triggerStop = useAtomCommand(sovereignCommands.triggerEmergencyStopCommand, {
    label: "sovereign-emergency-stop",
  });

  const targetActive = !emergencyStopActive;
  const trimmedReason = reason.trim();

  const handleConfirm = async () => {
    if (environmentId === null || submitting || !canTrigger) return;
    if (trimmedReason.length === 0) return;
    setSubmitting(true);
    const result = await triggerStop({
      environmentId,
      input: {
        active: targetActive,
        reason: trimmedReason,
      },
    });
    setSubmitting(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: targetActive ? "warning" : "success",
        title: targetActive ? gt("Emergency Stop activated") : gt("Sovereign operations resumed"),
        description: trimmedReason,
      });
      setReason("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {targetActive ? <T>Activate Emergency Stop</T> : <T>Resume Sovereign Operations</T>}
          </DialogTitle>
          <DialogDescription>
            {targetActive ? (
              <T>
                Immediately halts all autonomous external actions, provider routing, and outbound
                submissions until resumed.
              </T>
            ) : (
              <T>
                Lifts the global halt and restores policy-gated execution across active ventures.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {emergencyStopActive && currentReason ? (
            <Alert variant="warning">
              <AlertTitle>
                <T>Active halt reason</T>
              </AlertTitle>
              <AlertDescription>{currentReason}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="emergency-stop-reason">
              {targetActive ? (
                <T>Reason for stopping (recorded in audit log)</T>
              ) : (
                <T>Reason for resuming (recorded in audit log)</T>
              )}
            </label>
            <Textarea
              id="emergency-stop-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                targetActive
                  ? gt("Example: Pausing outbound activity to review budget and approvals")
                  : gt("Example: Reviewed pending approvals and verified caps")
              }
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            <T>Cancel</T>
          </DialogClose>
          <Button
            size="sm"
            variant={targetActive ? "destructive" : "default"}
            disabled={!canTrigger || submitting || trimmedReason.length === 0}
            onClick={() => void handleConfirm()}
          >
            {targetActive ? (
              <OctagonAlertIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
            {targetActive ? <T>Confirm Emergency Stop</T> : <T>Resume Operations</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
