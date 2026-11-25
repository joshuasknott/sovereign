import {
  DEFAULT_REPORTING_CURRENCY,
  type Lead,
  type Opportunity,
  type Venture,
  type VentureBlueprint,
  type VentureKind,
  type VentureUiModule,
} from "@t3tools/contracts";
import { formatMinorCurrency } from "@t3tools/client-runtime/sovereign/format";

export type VentureWorkspaceTabId = "operations" | "commercial" | "finances" | "workspace";

export type BudgetProgressState = "none" | "healthy" | "warning" | "exceeded";

export interface BudgetProgressSummary {
  readonly pct: number;
  readonly state: BudgetProgressState;
}

export interface LeadConsentSummary {
  readonly status: "granted" | "opted_out" | "missing";
  readonly aiDisclosed: boolean;
}

/** Parses a major-unit decimal string (e.g. "125.50" or "£500") into integer minor units. */
export function parseMajorCurrencyToMinor(raw: string): number | null {
  const cleaned = raw.trim().replace(/[£$€,\s]/g, "");
  if (cleaned.length === 0) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatMinorToMajorInput(amountMinor: number): string {
  const safe = Number.isFinite(amountMinor) ? Math.max(0, Math.trunc(amountMinor)) : 0;
  if (safe === 0) return "0";
  const whole = Math.floor(safe / 100);
  const fraction = safe % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function formatCompactMinor(
  amountMinor: number,
  currency: string = DEFAULT_REPORTING_CURRENCY,
): string {
  const safe = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : safe > 0 ? "+" : "";
  if (abs === 0) return formatMinorCurrency(0, currency);
  if (abs >= 100_000) {
    const majorK = abs / 100_000;
    const symbol =
      currency.toUpperCase() === "GBP"
        ? "£"
        : currency.toUpperCase() === "USD"
          ? "$"
          : currency.toUpperCase() === "EUR"
            ? "€"
            : `${currency.toUpperCase()} `;
    return `${sign}${symbol}${majorK.toFixed(1)}k`;
  }
  return formatMinorCurrency(safe, currency, { signed: safe > 0 });
}

export function computeBudgetProgress(
  spentMinor: number,
  capMinor: number,
  alertThresholdPct = 80,
): BudgetProgressSummary {
  const safeSpent = Math.max(0, Number.isFinite(spentMinor) ? spentMinor : 0);
  const safeCap = Math.max(0, Number.isFinite(capMinor) ? capMinor : 0);
  if (safeCap === 0) {
    return {
      pct: safeSpent > 0 ? 100 : 0,
      state: safeSpent > 0 ? "exceeded" : "none",
    };
  }
  const rawPct = Math.round((safeSpent / safeCap) * 100);
  const pct = Math.min(100, rawPct);
  if (safeSpent > safeCap) return { pct: 100, state: "exceeded" };
  if (rawPct >= alertThresholdPct) return { pct, state: "warning" };
  return { pct, state: "healthy" };
}

const COMMERCIAL_MODULES: ReadonlySet<VentureUiModule> = new Set([
  "bounties",
  "security_programmes",
  "prospects_sales",
  "voice_agents",
  "paid_tasks",
  "digital_products",
  "micro_saas",
]);

export function buildVentureWorkspaceTabs(
  uiModules: ReadonlyArray<VentureUiModule>,
  kind: VentureKind,
): ReadonlyArray<VentureWorkspaceTabId> {
  const tabs: VentureWorkspaceTabId[] = ["operations"];
  const hasCommercialModule =
    kind !== "custom" || uiModules.some((module) => COMMERCIAL_MODULES.has(module));
  if (hasCommercialModule || uiModules.length === 0) {
    tabs.push("commercial");
  } else {
    tabs.push("commercial");
  }
  if (uiModules.length === 0 || uiModules.includes("finances")) {
    tabs.push("finances");
  }
  if (uiModules.length === 0 || uiModules.includes("workspace_conversations")) {
    tabs.push("workspace");
  }
  return tabs;
}

export function splitPaidTaskOpportunities(opportunities: ReadonlyArray<Opportunity>): {
  readonly automatedPermitted: ReadonlyArray<Opportunity>;
  readonly humanRequired: ReadonlyArray<Opportunity>;
} {
  const automatedPermitted: Opportunity[] = [];
  const humanRequired: Opportunity[] = [];
  for (const opportunity of opportunities) {
    if (
      opportunity.automationMode === "manual" ||
      opportunity.aiPermissionStatus === "prohibited"
    ) {
      humanRequired.push(opportunity);
    } else {
      automatedPermitted.push(opportunity);
    }
  }
  return { automatedPermitted, humanRequired };
}

export function summarizeLeadConsent(lead: Lead): LeadConsentSummary {
  if (lead.stage === "unsubscribed" || lead.consents.some((consent) => consent.optedOut)) {
    return {
      status: "opted_out",
      aiDisclosed: lead.consents.some((consent) => consent.aiDisclosureGiven),
    };
  }
  const granted = lead.consents.some((consent) => consent.status === "granted");
  return {
    status: granted ? "granted" : "missing",
    aiDisclosed: lead.consents.some((consent) => consent.aiDisclosureGiven),
  };
}

export function isSecurityAuthorised(venture: Venture): boolean {
  const auth = venture.permissionPolicy.securityAuthorisation;
  if (!auth.authorised) return false;
  if (auth.expiresAt) {
    const expiry = Date.parse(auth.expiresAt);
    if (Number.isFinite(expiry) && expiry < Date.now()) return false;
  }
  return (
    auth.targetScope.length > 0 && venture.permissionPolicy.actionModes.security_testing !== "deny"
  );
}

export function dedupeVentureBlueprints(
  blueprints: ReadonlyArray<VentureBlueprint>,
): ReadonlyArray<VentureBlueprint> {
  const seen = new Set<string>();
  const result: VentureBlueprint[] = [];
  for (const blueprint of blueprints) {
    if (seen.has(blueprint.templateKey)) continue;
    seen.add(blueprint.templateKey);
    result.push(blueprint);
  }
  return result;
}

export function formatShortTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
