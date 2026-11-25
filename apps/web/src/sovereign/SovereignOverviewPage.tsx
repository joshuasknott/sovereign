import { T, useGT } from "gt-react";
import { Power } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { isElectron } from "../env";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { useSovereignEnvironmentId, useSovereignOverview } from "../state/sovereign";
import { EmergencyStopDialog } from "./EmergencyStopDialog";
import { NewVentureDialog } from "./NewVentureDialog";
import { SovereignApprovalsList } from "./SovereignApprovalsList";
import { SovereignCommandComposer } from "./SovereignCommandComposer";
import { SovereignObjectivesList } from "./SovereignObjectivesList";
import { SovereignProfit } from "./SovereignProfit";
import { SovereignVenturesList } from "./SovereignVenturesList";
import "./overview.css";

export function SovereignOverviewPage() {
  const gt = useGT();
  const environmentId = useSovereignEnvironmentId();
  const query = useSovereignOverview(environmentId, "overview-page");
  const overview = query.data;
  const stopped = overview?.controlState.emergencyStopActive === true;
  const [stopOpen, setStopOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const approvals = overview?.pendingApprovals.filter((item) => !item.ventureId) ?? [];
  const objectives = overview?.activeObjectives.filter((item) => !item.ventureId) ?? [];
  const ventures = new Map(overview?.ventures.map((row) => [row.venture.id, row.venture.name]));
  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, gt("Sovereign Overview"))}
      className="sv-overview"
    >
      <header className={cn("sv-topbar", isElectron && "drag-region")}>
        <SovereignProfit overview={overview} />
        <button
          type="button"
          className="sv-stop"
          disabled={!environmentId}
          onClick={() => setStopOpen(true)}
        >
          <Power aria-hidden="true" />
          <span>{stopped ? gt("Resume operations") : gt("Emergency stop")}</span>
        </button>
      </header>
      <div className="sv-scroll">
        <div className="sv-projects">
          {stopped && (
            <Alert variant="error">
              <AlertTitle>
                <T>Emergency Stop is active</T>
              </AlertTitle>
              <AlertDescription>
                {overview?.controlState.emergencyStopReason ||
                  gt("All autonomous external actions and outbound submissions are halted.")}
              </AlertDescription>
            </Alert>
          )}
          {query.error && (
            <Alert variant="error">
              <AlertTitle>
                <T>Could not load Sovereign state</T>
              </AlertTitle>
              <AlertDescription>
                {query.error}{" "}
                <button type="button" onClick={query.refresh}>
                  <T>Retry</T>
                </button>
              </AlertDescription>
            </Alert>
          )}
          {overview ? (
            <SovereignVenturesList
              environmentId={environmentId}
              overview={overview}
              onNewVenture={() => setNewOpen(true)}
            />
          ) : query.isPending ? (
            <Skeleton className="h-36 w-full" />
          ) : null}
          {approvals.length > 0 && (
            <SovereignApprovalsList
              environmentId={environmentId}
              approvals={approvals}
              ventureNameById={ventures}
            />
          )}
          {objectives.length > 0 && (
            <details className="sv-objectives">
              <summary>
                <T>Active objectives</T>
              </summary>
              <SovereignObjectivesList objectives={objectives} ventureNameById={ventures} />
            </details>
          )}
        </div>
      </div>
      <div className="sv-dock">
        {environmentId && (
          <SovereignCommandComposer
            key={environmentId}
            environmentId={environmentId}
            reportingCurrency={overview?.controlState.reportingCurrency}
          />
        )}
      </div>
      <EmergencyStopDialog
        environmentId={environmentId}
        emergencyStopActive={stopped}
        currentReason={overview?.controlState.emergencyStopReason ?? null}
        open={stopOpen}
        onOpenChange={setStopOpen}
      />
      <NewVentureDialog environmentId={environmentId} open={newOpen} onOpenChange={setNewOpen} />
    </SidebarInset>
  );
}
