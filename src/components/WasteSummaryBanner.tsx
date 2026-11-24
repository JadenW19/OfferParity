"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { OverallVerdict, XRayReport } from "@/lib/schemas";

interface WasteSummaryBannerProps {
  report: XRayReport;
  onOpenMonitorCta?: (report: XRayReport) => void;
}

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getVerdictPresentation(verdict: OverallVerdict) {
  switch (verdict) {
    case "PASS":
      return {
        label: "PASS",
        headline: "Offer Parity Verified — $0 Wasted Spend Detected",
        containerClass: "border-[var(--status-pass-border)] bg-[var(--status-pass-bg)]",
        badgeClass: "border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] text-[var(--status-pass-text)]",
        Icon: CheckCircle2,
        iconClass: "text-[var(--status-pass-text)]",
      };
    case "FAIL":
      return {
        label: "FAIL",
        headline: "Confirmed Offer Break — Paid Spend Burn Detected",
        containerClass: "border-[var(--status-fail-border)] bg-[var(--status-fail-bg)]",
        badgeClass: "border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] text-[var(--status-fail-text)]",
        Icon: XCircle,
        iconClass: "text-[var(--status-fail-text)]",
      };
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return {
        label: "WAF_CHALLENGE_MANUAL_CHECK",
        headline: "Manual Check Required — Bot Challenge Blocked Automated Fetch",
        containerClass: "border-[var(--status-warn-border)] bg-[var(--status-warn-bg)]",
        badgeClass: "border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]",
        Icon: ShieldAlert,
        iconClass: "text-[var(--status-warn-text)]",
      };
    case "WARN":
      return {
        label: "WARN",
        headline: "Needs Manual Check — Dynamic Pricing, Promo, or Localization Detected",
        containerClass: "border-[var(--status-warn-border)] bg-[var(--status-warn-bg)]",
        badgeClass: "border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]",
        Icon: AlertTriangle,
        iconClass: "text-[var(--status-warn-text)]",
      };
  }
}

export function WasteSummaryBanner({
  report,
  onOpenMonitorCta,
}: WasteSummaryBannerProps) {
  const [showMathDetails, setShowMathDetails] = useState(false);
  const { overallStatus, waste, request, storefront, durationMs } = report;
  const presentation = getVerdictPresentation(overallStatus);
  const { Icon } = presentation;

  const wastePctLabel = `${(waste.effectiveWasteRate * 100).toFixed(1)}%`;

  return (
    <section
      aria-label="X-Ray verdict and wasted spend summary"
      className={`rounded-2xl border p-5 sm:p-6 ${presentation.containerClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${presentation.iconClass}`} aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="overall-verdict-badge"
                className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold tracking-wide ${presentation.badgeClass}`}
              >
                {presentation.label}
              </span>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                HTTP {storefront.httpStatus} · Source: <code>{storefront.source}</code> ·{" "}
                {durationMs.toFixed(0)} ms
              </span>
              {storefront.wafProvider ? (
                <span className="rounded-md border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-warn-text)]">
                  WAF: {storefront.wafProvider}
                </span>
              ) : null}
              {storefront.subscriptionPricing?.detected ? (
                <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--text-muted)]">
                  {storefront.subscriptionPricing.provider ?? "Subscription Widget"}
                </span>
              ) : null}
              {storefront.localization?.multiCurrencyStore ? (
                <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--text-muted)]">
                  Multi-Currency{storefront.localization.detectedCountry ? ` (${storefront.localization.detectedCountry})` : ""}
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 text-lg font-bold text-[var(--text-primary)] sm:text-xl">
              {presentation.headline}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {storefront.title ?? "Storefront Product"} —{" "}
              <span className="break-all">{request.landingPageUrl}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={showMathDetails}
          onClick={() => setShowMathDetails((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
        >
          <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
          {showMathDetails ? "Hide Waste Math" : "Show Waste Math"}
          {showMathDetails ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Estimated Daily Waste
          </p>
          <p
            data-testid="daily-waste-value"
            className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--text-primary)]"
          >
            {formatUsd(waste.estimatedDailyWaste)}
            <span className="text-xs font-normal text-[var(--text-muted)]">/day</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Effective waste rate: {wastePctLabel}</p>
        </div>

        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            30-Day Projected Burn
          </p>
          <p
            data-testid="monthly-waste-value"
            className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--text-primary)]"
          >
            {formatUsd(waste.projectedMonthlyWaste)}
            <span className="text-xs font-normal text-[var(--text-muted)]">/mo</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">30x daily wasted ad spend</p>
        </div>

        <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Entered Daily Budget
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {formatUsd(request.dailyBudget)}
            <span className="text-xs font-normal text-[var(--text-muted)]">/day</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Bounded survival-complement model</p>
        </div>

        {waste.atRiskDailySpend > 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              At-Risk Spend (Warnings)
            </p>
            <p
              data-testid="at-risk-spend-value"
              className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-700"
            >
              {formatUsd(waste.atRiskDailySpend)}
              <span className="text-xs font-normal">/day</span>
            </p>
            <p className="mt-1 text-xs text-amber-700/90">
              Isolated from hard waste ({waste.breakdown.warningFactors.length} warning
              {waste.breakdown.warningFactors.length === 1 ? "" : "s"})
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              At-Risk Spend (Warnings)
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--text-primary)]">$0.00</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">No warning-level spend exposure</p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)]">Formula: </span>
        <code className="break-all text-[var(--text-primary)]">{waste.breakdown.formula}</code>
      </div>

      {onOpenMonitorCta ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-4 py-3">
          <div className="flex items-center gap-2.5 text-xs text-[var(--accent-soft-text)]">
            <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {overallStatus === "FAIL" && waste.estimatedDailyWaste > 0 ? (
                <>
                  Catch <strong>{formatUsd(waste.estimatedDailyWaste)}/day</strong>{" "}
                  offer leaks before they burn budget.
                </>
              ) : (
                <>
                  Offers break at 2 AM when hero sizes sell out or promos expire.
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenMonitorCta(report)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)]"
          >
            <span>Monitor this URL hourly in Slack</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {showMathDetails ? (
        <div
          data-testid="waste-math-breakdown"
          className="mt-3 grid gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 text-xs sm:grid-cols-2"
        >
          <div>
            <h3 className="font-semibold uppercase tracking-wider text-[var(--status-fail-text)]">
              Failing Waste Factors ({waste.breakdown.failingFactors.length})
            </h3>
            {waste.breakdown.failingFactors.length === 0 ? (
              <p className="mt-1.5 text-[var(--text-muted)]">None — 0% hard waste.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[var(--text-primary)]">
                {waste.breakdown.failingFactors.map((factor) => (
                  <li key={factor.id} className="flex items-center justify-between gap-2">
                    <span>{factor.label}</span>
                    <span className="font-mono font-semibold text-[var(--status-fail-text)]">
                      w = {factor.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-semibold uppercase tracking-wider text-[var(--status-warn-text)]">
              Warning At-Risk Factors ({waste.breakdown.warningFactors.length})
            </h3>
            {waste.breakdown.warningFactors.length === 0 ? (
              <p className="mt-1.5 text-[var(--text-muted)]">None — $0.00/day at-risk spend.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[var(--text-primary)]">
                {waste.breakdown.warningFactors.map((factor) => (
                  <li key={factor.id} className="flex items-center justify-between gap-2">
                    <span>{factor.label}</span>
                    <span className="font-mono font-semibold text-[var(--status-warn-text)]">
                      w = {factor.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
