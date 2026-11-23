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
        containerClass: "border-emerald-500/40 bg-emerald-950/35",
        badgeClass: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200",
        Icon: CheckCircle2,
        iconClass: "text-emerald-400",
      };
    case "FAIL":
      return {
        label: "FAIL",
        headline: "Paid Spend Burn Detected — Broken Offer Parity",
        containerClass: "border-rose-500/50 bg-rose-950/35",
        badgeClass: "border-rose-400/50 bg-rose-500/20 text-rose-200",
        Icon: XCircle,
        iconClass: "text-rose-400",
      };
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return {
        label: "WAF_CHALLENGE_MANUAL_CHECK",
        headline: "Manual Check Required — Bot Challenge Blocked Automated Fetch",
        containerClass: "border-amber-500/50 bg-amber-950/35",
        badgeClass: "border-amber-400/50 bg-amber-500/20 text-amber-200",
        Icon: ShieldAlert,
        iconClass: "text-amber-400",
      };
    case "WARN":
      return {
        label: "WARN",
        headline: "Partial Verification — At-Risk or Unverified Signals Found",
        containerClass: "border-amber-500/40 bg-amber-950/30",
        badgeClass: "border-amber-400/50 bg-amber-500/20 text-amber-200",
        Icon: AlertTriangle,
        iconClass: "text-amber-400",
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
              <span className="text-xs text-slate-300">
                HTTP {storefront.httpStatus} · Source: <code>{storefront.source}</code> ·{" "}
                {durationMs.toFixed(0)} ms
              </span>
              {storefront.wafProvider ? (
                <span className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">
                  WAF: {storefront.wafProvider}
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 text-lg font-bold text-white sm:text-xl">
              {presentation.headline}
            </h2>
            <p className="mt-0.5 text-sm text-slate-300">
              {storefront.title ?? "Storefront Product"} —{" "}
              <span className="break-all text-slate-400">{request.landingPageUrl}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={showMathDetails}
          onClick={() => setShowMathDetails((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Calculator className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          {showMathDetails ? "Hide Waste Math" : "Show Waste Math"}
          {showMathDetails ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Estimated Daily Waste
          </p>
          <p
            data-testid="daily-waste-value"
            className="mt-1 text-2xl font-bold tabular-nums text-white"
          >
            {formatUsd(waste.estimatedDailyWaste)}
            <span className="text-sm font-normal text-slate-400">/day</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">Effective waste rate: {wastePctLabel}</p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            30-Day Projected Burn
          </p>
          <p
            data-testid="monthly-waste-value"
            className="mt-1 text-2xl font-bold tabular-nums text-white"
          >
            {formatUsd(waste.projectedMonthlyWaste)}
            <span className="text-sm font-normal text-slate-400">/mo</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">30x daily wasted ad spend</p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Entered Daily Budget
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-100">
            {formatUsd(request.dailyBudget)}
            <span className="text-sm font-normal text-slate-400">/day</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">Bounded survival-complement model</p>
        </div>

        {waste.atRiskDailySpend > 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/35 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-300">
              At-Risk Spend (Warnings)
            </p>
            <p
              data-testid="at-risk-spend-value"
              className="mt-1 text-2xl font-bold tabular-nums text-amber-200"
            >
              {formatUsd(waste.atRiskDailySpend)}
              <span className="text-sm font-normal text-amber-300/80">/day</span>
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              Isolated from hard waste ({waste.breakdown.warningFactors.length} warning
              {waste.breakdown.warningFactors.length === 1 ? "" : "s"})
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              At-Risk Spend (Warnings)
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-200">$0.00</p>
            <p className="mt-1 text-xs text-slate-400">No warning-level spend exposure</p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/70 px-3.5 py-2.5 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Formula: </span>
        <code className="break-all text-sky-300">{waste.breakdown.formula}</code>
      </div>

      {onOpenMonitorCta ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-950/30 px-4 py-3">
          <div className="flex items-center gap-2.5 text-xs text-slate-200">
            <BellRing className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
            <span>
              {overallStatus === "FAIL" && waste.estimatedDailyWaste > 0 ? (
                <>
                  Catch <strong className="text-white">{formatUsd(waste.estimatedDailyWaste)}/day</strong>{" "}
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            <span>Monitor this URL hourly in Slack</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {showMathDetails ? (
        <div
          data-testid="waste-math-breakdown"
          className="mt-3 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/90 p-4 text-xs sm:grid-cols-2"
        >
          <div>
            <h3 className="font-semibold uppercase tracking-wider text-rose-300">
              Failing Waste Factors ({waste.breakdown.failingFactors.length})
            </h3>
            {waste.breakdown.failingFactors.length === 0 ? (
              <p className="mt-1.5 text-slate-400">None — 0% hard waste.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-slate-300">
                {waste.breakdown.failingFactors.map((factor) => (
                  <li key={factor.id} className="flex items-center justify-between gap-2">
                    <span>{factor.label}</span>
                    <span className="font-mono font-semibold text-rose-300">
                      w = {factor.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-semibold uppercase tracking-wider text-amber-300">
              Warning At-Risk Factors ({waste.breakdown.warningFactors.length})
            </h3>
            {waste.breakdown.warningFactors.length === 0 ? (
              <p className="mt-1.5 text-slate-400">None — $0.00/day at-risk spend.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-slate-300">
                {waste.breakdown.warningFactors.map((factor) => (
                  <li key={factor.id} className="flex items-center justify-between gap-2">
                    <span>{factor.label}</span>
                    <span className="font-mono font-semibold text-amber-300">
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
