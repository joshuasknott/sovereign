import type { VentureId, VentureKind } from "@t3tools/contracts";
import { ventureKindLabel } from "@t3tools/client-runtime/sovereign/format";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, PauseIcon, PlayIcon, SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { RefreshIcon } from "../components/ui/refresh-icon";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import {
  sovereignCommands,
  useSovereignCommandPermission,
  useSovereignEnvironmentId,
  useSovereignVentureDetail,
} from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import { SovereignAtmosphere } from "./SovereignAtmosphere";
import { VENTURE_STATUS_LABELS } from "./sovereignLabels";
import { buildVentureWorkspaceTabs, type VentureWorkspaceTabId } from "./sovereignUi.logic";
import { VentureCommercialPanel } from "./VentureCommercialPanel";
import { VentureConfigSheet } from "./VentureConfigSheet";
import { VentureFinancesPanel } from "./VentureFinancesPanel";
import { VentureOperationsPanel } from "./VentureOperationsPanel";
import { VentureWorkspacePanel } from "./VentureWorkspacePanel";

function commercialTabLabel(kind: VentureKind, gt: ReturnType<typeof useGT>): string {
  switch (kind) {
    case "dev_bounties":
      return gt("Bounties & PRs");
    case "security_bounties":
      return gt("Programmes & Scope");
    case "web_agency":
      return gt("Prospects & Clients");
    case "voice_ai":
      return gt("Voice Agents");
    case "paid_tasks":
      return gt("Paid Tasks");
    case "digital_products":
      return gt("Products & Orders");
    case "micro_saas":
      return gt("Products & MRR");
    case "custom":
      return gt("Commercial Pipeline");
  }
}

function SovereignVentureWorkspace({ ventureId }: { readonly ventureId: VentureId }) {
  const gt = useGT();
  const messages = useMessages();
  const environmentId = useSovereignEnvironmentId();
  const detailQuery = useSovereignVentureDetail(environmentId, ventureId, `venture:${ventureId}`);
  const detail = detailQuery.data;

  const [activeTab, setActiveTab] = useState<VentureWorkspaceTabId>("operations");
  const [configOpen, setConfigOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const canUpdate = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateVentureCommand,
  );
  const updateVenture = useAtomCommand(sovereignCommands.updateVentureCommand, {
    label: "sovereign-venture-status-toggle",
  });

  const venture = detail?.venture ?? null;
  const tabs = venture ? buildVentureWorkspaceTabs(venture.uiModules, venture.kind) : [];
  const effectiveTab = tabs.includes(activeTab) ? activeTab : "operations";

  const handleToggleStatus = async () => {
    if (environmentId === null || venture === null || !canUpdate || toggling) return;
    const nextStatus = venture.status === "active" ? "paused" : "active";
    setToggling(true);
    const result = await updateVenture({
      environmentId,
      input: {
        ventureId: venture.id,
        status: nextStatus,
      },
    });
    setToggling(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "info",
        title: nextStatus === "paused" ? gt("Venture paused") : gt("Venture resumed"),
        description: venture.name,
      });
    }
  };

  const tabLabel = (tab: VentureWorkspaceTabId): string => {
    switch (tab) {
      case "operations":
        return gt("Operations");
      case "commercial":
        return venture ? commercialTabLabel(venture.kind, gt) : gt("Pipeline");
      case "finances":
        return gt("Finances");
      case "workspace":
        return gt("Conversations & Workspace");
    }
  };

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, venture?.name ?? gt("Venture Workspace"))}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <SovereignAtmosphere variant="quiet">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border/70">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Back to Overview")}
                render={<Link to="/overview" />}
              >
                <ArrowLeftIcon className="size-3.5" />
              </Button>
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                {venture?.name ?? gt("Venture")}
              </h1>
              {venture ? (
                <>
                  <Badge size="sm" variant="secondary">
                    {ventureKindLabel(venture.kind, messages)}
                  </Badge>
                  <Badge
                    size="sm"
                    variant={
                      venture.status === "active"
                        ? "success"
                        : venture.status === "paused"
                          ? "warning"
                          : "outline"
                    }
                  >
                    {messages(VENTURE_STATUS_LABELS[venture.status])}
                  </Badge>
                </>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Refresh venture")}
                onClick={detailQuery.refresh}
              >
                <RefreshIcon refreshing={detailQuery.isPending} />
              </Button>
              {venture ? (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canUpdate || toggling}
                    onClick={() => void handleToggleStatus()}
                  >
                    {venture.status === "active" ? (
                      <>
                        <PauseIcon className="size-3.5" />
                        <T>Pause</T>
                      </>
                    ) : (
                      <>
                        <PlayIcon className="size-3.5" />
                        <T>Resume</T>
                      </>
                    )}
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setConfigOpen(true)}>
                    <SlidersHorizontalIcon className="size-3.5" />
                    <T>Policy &amp; Config</T>
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </WorkspacePageHeader>

        {venture ? (
          <div
            role="tablist"
            aria-label={gt("Venture workspace sections")}
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-background/60 px-4 sm:px-6"
          >
            {tabs.map((tab) => {
              const selected = effectiveTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "relative shrink-0 cursor-pointer px-3 py-2.5 text-xs font-medium transition-colors outline-hidden focus-visible:text-foreground",
                    selected
                      ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tabLabel(tab)}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
            {detailQuery.error ? (
              <Alert variant="error">
                <AlertTitle>
                  <T>Could not load venture</T>
                </AlertTitle>
                <AlertDescription>{detailQuery.error}</AlertDescription>
              </Alert>
            ) : null}

            {detail === null && detailQuery.isPending ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-60 w-full" />
              </div>
            ) : detail ? (
              <>
                {detail.venture.summary ? (
                  <p className="text-sm text-muted-foreground">{detail.venture.summary}</p>
                ) : null}

                {effectiveTab === "operations" ? (
                  <VentureOperationsPanel environmentId={environmentId} detail={detail} />
                ) : effectiveTab === "commercial" ? (
                  <VentureCommercialPanel
                    environmentId={environmentId}
                    detail={detail}
                    onOpenPolicyConfig={() => setConfigOpen(true)}
                  />
                ) : effectiveTab === "finances" ? (
                  <VentureFinancesPanel environmentId={environmentId} detail={detail} />
                ) : (
                  <VentureWorkspacePanel environmentId={environmentId} detail={detail} />
                )}
              </>
            ) : null}
          </div>
        </div>

        {venture ? (
          <VentureConfigSheet
            key={`${venture.id}:${venture.updatedAt}`}
            environmentId={environmentId}
            venture={venture}
            open={configOpen}
            onOpenChange={setConfigOpen}
          />
        ) : null}
      </SovereignAtmosphere>
    </SidebarInset>
  );
}

export function SovereignVenturePage({ ventureId }: { readonly ventureId: VentureId }) {
  return <SovereignVentureWorkspace key={ventureId} ventureId={ventureId} />;
}
