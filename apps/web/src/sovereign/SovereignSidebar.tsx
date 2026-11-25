import { Link, useLocation } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { Cpu, LayoutGrid, ListTree, Settings, Search, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { formatQuotaStatus } from "@t3tools/client-runtime/sovereign/format";
import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import {
  useSovereignEnvironmentId,
  useSovereignLiveSubscription,
  useSovereignOverview,
} from "../state/sovereign";
import ThreadSidebar from "../components/Sidebar";
import type { SidebarRouteReveal } from "../components/sidebar/routeReveal";
import { SidebarProviderUpdatePill } from "../components/sidebar/SidebarProviderUpdatePill";
import {
  SidebarUpdateArchitectureWarning,
  SidebarUpdatePill,
} from "../components/sidebar/SidebarUpdatePill";
import { SovereignWordmark } from "../components/SovereignWordmark";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../components/ui/preview-card";
import { useSidebar } from "../components/ui/sidebar";
import { VentureMark } from "./VentureMark";
import "./overview.css";

export function SovereignSidebar({ routeReveal }: { readonly routeReveal: SidebarRouteReveal }) {
  const gt = useGT();
  const messages = useMessages();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const id = useSovereignEnvironmentId();
  useSovereignLiveSubscription(id);
  const { data } = useSovereignOverview(id, "sidebar");
  const path = useLocation({ select: (l) => l.pathname });
  const [showThreads, setShowThreads] = useState(false);
  const subscriptions = data?.providerPool.members.filter(
    (m) =>
      m.enabled &&
      m.billingClass === "subscription" &&
      (m.healthStatus === "healthy" ||
        m.healthStatus === "cooldown" ||
        m.quotaAvailability === "exhausted"),
  );
  if (showThreads)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          className="flex items-center gap-2 p-3 text-sm"
          onClick={() => setShowThreads(false)}
        >
          <ArrowLeft size={16} />
          <T>Back to Sovereign</T>
        </button>
        <ThreadSidebar routeReveal={routeReveal} />
      </div>
    );
  return (
    <div className="sv-sidebar">
      <div className={cn("sv-brand", isElectron && "drag-region")}>
        <Link to="/overview" onClick={closeMobile}>
          <SovereignWordmark className="text-inherit" />
        </Link>
      </div>
      <div className="sv-side-menu">
        <Link
          to="/overview"
          onClick={closeMobile}
          aria-current={path === "/" || path === "/overview" ? "page" : undefined}
        >
          <LayoutGrid />
          <T>Overview</T>
        </Link>
        <div className="sv-project-label">
          <span>
            <T>Projects</T>
          </span>
          <button
            type="button"
            onClick={() => setShowThreads(true)}
            title={gt("Open full thread list")}
            aria-label={gt("Open full thread list")}
          >
            <ListTree size={15} />
          </button>
        </div>
        {data?.ventures.map(({ venture }) => (
          <Link
            key={venture.id}
            to="/ventures/$ventureId"
            params={{ ventureId: venture.id }}
            onClick={closeMobile}
            activeProps={{ "aria-current": "page" }}
          >
            <VentureMark kind={venture.kind} />
            <span>{venture.name}</span>
          </Link>
        ))}
      </div>
      <div className="sv-side-footer">
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
        <PreviewCard>
          <PreviewCardTrigger render={<Link to="/settings/providers" onClick={closeMobile} />}>
            <Cpu />
            <T>Providers</T>
          </PreviewCardTrigger>
          <PreviewCardPopup side="top" align="start">
            <div className="sv-provider-preview">
              <strong>
                <T>Connected subscriptions</T>
              </strong>
              {subscriptions?.length ? (
                subscriptions.map((m) => (
                  <div key={m.instanceId}>
                    <ProviderInstanceIcon
                      driverKind={m.driver}
                      displayName={m.displayName}
                      showBadge={false}
                      size="compact"
                    />
                    <span>{m.displayName}</span>
                    <small>
                      {formatQuotaStatus(m.quotaAvailability, m.quotaRemainingPct, messages).label}
                    </small>
                  </div>
                ))
              ) : (
                <p>{data ? gt("No connected subscriptions") : gt("Unavailable")}</p>
              )}
              <Link to="/settings/providers" onClick={closeMobile}>
                <T>Manage in Settings</T>
              </Link>
            </div>
          </PreviewCardPopup>
        </PreviewCard>
        <div className="sv-settings">
          <Link to="/settings" onClick={closeMobile}>
            <Settings />
            <T>Settings</T>
          </Link>
          <button
            type="button"
            title={gt("Open command palette")}
            aria-label={gt("Open command palette")}
            onClick={() => openCommandPalette()}
          >
            <Search size={15} />
          </button>
          <SidebarUpdatePill />
        </div>
      </div>
    </div>
  );
}
