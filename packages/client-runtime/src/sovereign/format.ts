import {
  DEFAULT_REPORTING_CURRENCY,
  type ExternalActionCategory,
  type ProviderQuotaAvailability,
  type VentureKind,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export interface FormatMinorCurrencyOptions {
  readonly signed?: boolean;
}

export type SovereignQuotaTone = "healthy" | "warning" | "critical" | "neutral";

export interface SovereignQuotaStatus {
  readonly label: string;
  readonly tone: SovereignQuotaTone;
}

const KNOWN_CURRENCIES: Readonly<
  Record<string, { readonly symbol: string; readonly decimals: number }>
> = {
  GBP: { symbol: "£", decimals: 2 },
  USD: { symbol: "$", decimals: 2 },
  EUR: { symbol: "€", decimals: 2 },
  JPY: { symbol: "¥", decimals: 0 },
  CHF: { symbol: "CHF ", decimals: 2 },
  CAD: { symbol: "CA$", decimals: 2 },
  AUD: { symbol: "A$", decimals: 2 },
};

function formatGroupedInteger(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats integer minor units deterministically without host-locale currency drift
 * or floating-point rounding. Falls back cleanly when Hermes lacks Intl currency data.
 */
export function formatMinorCurrency(
  amountMinor: number,
  currency: string = DEFAULT_REPORTING_CURRENCY,
  options?: FormatMinorCurrencyOptions,
): string {
  const safeMinor = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  const code = currency.trim().toUpperCase() || DEFAULT_REPORTING_CURRENCY;
  const sign = safeMinor < 0 ? "-" : options?.signed === true && safeMinor > 0 ? "+" : "";
  const absMinor = Math.abs(safeMinor);

  const known = KNOWN_CURRENCIES[code];
  if (known !== undefined) {
    if (known.decimals === 0) {
      return `${sign}${known.symbol}${formatGroupedInteger(absMinor)}`;
    }
    const divisor = 10 ** known.decimals;
    const whole = Math.floor(absMinor / divisor);
    const fraction = String(absMinor % divisor).padStart(known.decimals, "0");
    return `${sign}${known.symbol}${formatGroupedInteger(whole)}.${fraction}`;
  }

  try {
    const formatted = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absMinor / 100);
    return `${sign}${formatted}`;
  } catch {
    const whole = Math.floor(absMinor / 100);
    const fraction = String(absMinor % 100).padStart(2, "0");
    return `${sign}${code} ${formatGroupedInteger(whole)}.${fraction}`;
  }
}

export function formatQuotaStatus(
  availability: ProviderQuotaAvailability,
  remainingPct: number | null,
  resolve: MFunctionType = mFallback,
): SovereignQuotaStatus {
  if (availability === "exhausted") {
    return {
      label: resolve(msg("Exhausted", { $context: "provider quota availability" })),
      tone: "critical",
    };
  }
  if (availability === "unavailable" || remainingPct === null || !Number.isFinite(remainingPct)) {
    return {
      label: resolve(msg("Unavailable", { $context: "provider quota availability" })),
      tone: "neutral",
    };
  }
  const pct = Math.max(0, Math.min(100, Math.round(remainingPct)));
  const tone: SovereignQuotaTone = pct <= 10 ? "critical" : pct <= 25 ? "warning" : "healthy";
  return {
    label: resolve(msg("{pct}% remaining", { pct })),
    tone,
  };
}

export function formatCompositeScore(score: number): string {
  const clamped = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  return `${clamped}/100`;
}

const VENTURE_KIND_LABELS: Record<VentureKind, string> = {
  dev_bounties: msg("Dev Bounties"),
  security_bounties: msg("Security Bounties"),
  web_agency: msg("Web Agency"),
  voice_ai: msg("Voice AI"),
  paid_tasks: msg("Paid Tasks"),
  digital_products: msg("Digital Products"),
  micro_saas: msg("Micro-SaaS"),
  custom: msg("Custom", { $context: "venture kind" }),
};

export function ventureKindLabel(kind: VentureKind, resolve: MFunctionType = mFallback): string {
  return resolve(VENTURE_KIND_LABELS[kind]);
}

const ACTION_CATEGORY_LABELS: Record<ExternalActionCategory, string> = {
  customer_communication: msg("Customer communication"),
  marketing_campaign: msg("Marketing campaign"),
  external_submission: msg("External submission"),
  financial_expenditure: msg("Financial expenditure"),
  payment_processing: msg("Payment processing"),
  production_deployment: msg("Production deployment"),
  contractual_commitment: msg("Contractual commitment"),
  refund: msg("Refund", { $context: "external action category" }),
  security_testing: msg("Security testing"),
  personal_data: msg("Personal data"),
  account_modification: msg("Account modification"),
  paid_provider_fallback: msg("Paid provider fallback"),
  new_venture_creation: msg("New venture creation"),
};

export function actionCategoryLabel(
  category: ExternalActionCategory,
  resolve: MFunctionType = mFallback,
): string {
  return resolve(ACTION_CATEGORY_LABELS[category]);
}
