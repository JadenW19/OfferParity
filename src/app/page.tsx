"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Search, ShieldCheck, Zap } from "lucide-react";
import { AlertExportPanel } from "@/components/AlertExportPanel";
import { BatchAuditPanel } from "@/components/BatchAuditPanel";
import { ClaimsComparisonCard } from "@/components/ClaimsComparisonCard";
import {
  MonitorCtaModal,
  type MonitorCtaContext,
} from "@/components/MonitorCtaModal";
import { ParityDiffTable } from "@/components/ParityDiffTable";
import {
  RecentScansBar,
  clearRecentScansInStorage,
  loadRecentScansFromStorage,
  saveRecentScanToStorage,
  type RecentScanEntry,
} from "@/components/RecentScansBar";
import { ScenarioSelector } from "@/components/ScenarioSelector";
import { WasteSummaryBanner } from "@/components/WasteSummaryBanner";
import { XRayForm } from "@/components/XRayForm";
import { trackEvent } from "@/lib/analytics";
import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { buildMarkdownReport, buildSlackAlert } from "@/lib/exporters/reportFormatters";
import {
  getDemoScenarioPreset,
  resolveFixtureSnapshot,
} from "@/lib/fixtures/demoScenarios";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import {
  FixtureScenarioIdSchema,
  LeadPlanInterestSchema,
  XRayReportSchema,
  type BatchXRayResponse,
  type DemoScenarioPreset,
  type FixtureScenarioId,
  type XRayReport,
} from "@/lib/schemas";

const INITIAL_SCENARIO_ID: FixtureScenarioId = "oos-price-mismatch";
type AuditMode = "single" | "batch";

interface SharedUrlParams {
  adCopy: string;
  landingPageUrl: string;
  dailyBudget: number;
  fixtureId: FixtureScenarioId | null;
}

function readSharedQueryParams(): SharedUrlParams | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const sharedUrl = params.get("url")?.trim() ?? "";
  const sharedAd = params.get("ad")?.trim() ?? "";
  if (!sharedUrl || !sharedAd) {
    return null;
  }

  const rawBudget = params.get("budget")?.trim() ?? "500";
  const parsedBudget = Number(rawBudget);
  const effectiveBudget =
    Number.isFinite(parsedBudget) && parsedBudget >= 0 && parsedBudget <= 1_000_000
      ? parsedBudget
      : 500;

  const rawFixture = params.get("fixture")?.trim() ?? "";
  const parsedFixture = rawFixture ? FixtureScenarioIdSchema.safeParse(rawFixture) : null;

  return {
    adCopy: sharedAd,
    landingPageUrl: sharedUrl,
    dailyBudget: effectiveBudget,
    fixtureId: parsedFixture?.success ? parsedFixture.data : null,
  };
}

function buildInitialDemoReport(): XRayReport {
  const preset = getDemoScenarioPreset(INITIAL_SCENARIO_ID);
  const request = {
    adCopy: preset.adCopy,
    landingPageUrl: preset.landingPageUrl,
    dailyBudget: preset.dailyBudget,
    fixtureId: preset.id,
  };
  const extractedClaims = extractAdClaims(request.adCopy, request.landingPageUrl);
  const storefront = resolveFixtureSnapshot({
    fixtureId: preset.id,
    landingPageUrl: request.landingPageUrl,
    promoCode: extractedClaims.promoCode,
  });
  if (!storefront) {
    throw new Error(`Missing initial fixture snapshot for ${INITIAL_SCENARIO_ID}`);
  }
  const { checks, overallStatus } = evaluateParity(extractedClaims, storefront);
  const waste = calculateWaste(checks, request.dailyBudget, overallStatus);
  const reportBase = {
    request,
    extractedClaims,
    storefront,
    checks,
    overallStatus,
    waste,
    generatedAt: "2026-11-18T00:00:00.000Z",
    durationMs: 1,
  };
  const slackAlert = buildSlackAlert(reportBase);
  const markdownReport = buildMarkdownReport(reportBase);

  return XRayReportSchema.parse({
    ...reportBase,
    slackAlert,
    markdownReport,
  });
}

export default function HomePage() {
  const initialPreset = getDemoScenarioPreset(INITIAL_SCENARIO_ID);
  const [mode, setMode] = useState<AuditMode>("single");
  const [adCopy, setAdCopy] = useState<string>(initialPreset.adCopy);
  const [landingPageUrl, setLandingPageUrl] = useState<string>(initialPreset.landingPageUrl);
  const [dailyBudget, setDailyBudget] = useState<string>(String(initialPreset.dailyBudget));
  const [activeFixtureId, setActiveFixtureId] = useState<FixtureScenarioId | null>(
    INITIAL_SCENARIO_ID
  );
  const [report, setReport] = useState<XRayReport>(() => buildInitialDemoReport());
  const [recentScans, setRecentScans] = useState<RecentScanEntry[]>([]);
  const [hasMounted, setHasMounted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [monitorCtaContext, setMonitorCtaContext] =
    useState<MonitorCtaContext | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hydratedShareRef = useRef<boolean>(false);

  const executeXRay = useCallback(
    async (payload: {
      adCopy: string;
      landingPageUrl: string;
      dailyBudget: number;
      fixtureId?: FixtureScenarioId;
    }) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setServerError(null);

      try {
        const response = await fetch("/api/xray", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const body = (await response.json()) as unknown;

        if (!response.ok) {
          const errorObj =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : `Request failed with status ${response.status}`;
          setServerError(errorObj);
          return;
        }

        const parsed = XRayReportSchema.safeParse(body);
        if (!parsed.success) {
          setServerError("Received unexpected X-Ray report format from server.");
          return;
        }

        setReport(parsed.data);
        setRecentScans((prev) => saveRecentScanToStorage(prev, parsed.data));
        trackEvent("xray_completed", {
          verdict: parsed.data.overallStatus,
          dailyWaste: parsed.data.waste.estimatedDailyWaste,
          source: parsed.data.storefront.source,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setServerError(
          err instanceof Error ? err.message : "Network error while running OfferParity X-Ray."
        );
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      setHasMounted(true);
      setRecentScans(loadRecentScansFromStorage());

      if (!hydratedShareRef.current) {
        const params = new URLSearchParams(window.location.search);
        const monitorPlan = params.get("monitor")?.trim() ?? "";
        const parsedPlan = monitorPlan
          ? LeadPlanInterestSchema.safeParse(monitorPlan)
          : null;
        if (parsedPlan?.success) {
          setMonitorCtaContext({
            sourceCta: "pricing_page_onboarding",
            defaultPlan: parsedPlan.data,
          });
        }

        const shared = readSharedQueryParams();
        if (shared) {
          hydratedShareRef.current = true;
          setMode("single");
          setAdCopy(shared.adCopy);
          setLandingPageUrl(shared.landingPageUrl);
          setDailyBudget(String(shared.dailyBudget));
          setActiveFixtureId(shared.fixtureId);
          void executeXRay({
            adCopy: shared.adCopy,
            landingPageUrl: shared.landingPageUrl,
            dailyBudget: shared.dailyBudget,
            ...(shared.fixtureId ? { fixtureId: shared.fixtureId } : {}),
          });
        }
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [executeXRay]);

  function handleModeSwitch(nextMode: AuditMode) {
    setMode(nextMode);
    setServerError(null);
  }

  function handleSelectScenario(preset: DemoScenarioPreset) {
    setAdCopy(preset.adCopy);
    setLandingPageUrl(preset.landingPageUrl);
    setDailyBudget(String(preset.dailyBudget));
    setActiveFixtureId(preset.id);
    setServerError(null);

    void executeXRay({
      adCopy: preset.adCopy,
      landingPageUrl: preset.landingPageUrl,
      dailyBudget: preset.dailyBudget,
      fixtureId: preset.id,
    });
  }

  function handleAdCopyChange(nextAdCopy: string) {
    setAdCopy(nextAdCopy);
    setServerError(null);
  }

  function handleLandingPageUrlChange(nextUrl: string) {
    setLandingPageUrl(nextUrl);
    setServerError(null);
    if (activeFixtureId) {
      const preset = getDemoScenarioPreset(activeFixtureId);
      if (nextUrl.trim() !== preset.landingPageUrl) {
        setActiveFixtureId(null);
      }
    }
  }

  function handleDailyBudgetChange(nextBudget: string) {
    setDailyBudget(nextBudget);
    setServerError(null);
  }

  function handleSubmit() {
    const parsedBudget = Number(dailyBudget);
    if (!Number.isFinite(parsedBudget) || parsedBudget < 0) {
      return;
    }

    void executeXRay({
      adCopy,
      landingPageUrl,
      dailyBudget: parsedBudget,
      ...(activeFixtureId ? { fixtureId: activeFixtureId } : {}),
    });
  }

  function handleInspectReport(targetReport: XRayReport) {
    setMode("single");
    setAdCopy(targetReport.request.adCopy);
    setLandingPageUrl(targetReport.request.landingPageUrl);
    setDailyBudget(String(targetReport.request.dailyBudget));
    setActiveFixtureId(targetReport.request.fixtureId ?? null);
    setServerError(null);
    setReport(targetReport);
    setHasMounted(true);
    setRecentScans((prev) => saveRecentScanToStorage(prev, targetReport));
  }

  function handleSelectRecentScan(entry: RecentScanEntry) {
    setMode("single");
    setAdCopy(entry.report.request.adCopy);
    setLandingPageUrl(entry.report.request.landingPageUrl);
    setDailyBudget(String(entry.report.request.dailyBudget));
    setActiveFixtureId(entry.report.request.fixtureId ?? null);
    setServerError(null);
    setReport(entry.report);
  }

  function handleClearHistory() {
    clearRecentScansInStorage();
    setRecentScans([]);
  }

  function handleOpenSingleMonitorCta(targetReport: XRayReport) {
    trackEvent("monitor_cta_opened", {
      source: "waste_banner",
      verdict: targetReport.overallStatus,
      dailyWaste: targetReport.waste.estimatedDailyWaste,
    });
    setMonitorCtaContext({
      scannedUrl: targetReport.request.landingPageUrl,
      dailyBudget: targetReport.request.dailyBudget,
      dailyWaste: targetReport.waste.estimatedDailyWaste,
      verdict: targetReport.overallStatus,
      sourceCta: "waste_banner_monitor_cta",
      defaultPlan: "growth",
    });
  }

  function handleOpenBatchMonitorCta(batchResult: BatchXRayResponse) {
    trackEvent("monitor_cta_opened", {
      source: "batch_summary",
      totalRows: batchResult.summary.totalRows,
      dailyWaste: batchResult.summary.totalDailyWaste,
    });
    setMonitorCtaContext({
      totalRows: batchResult.summary.totalRows,
      dailyBudget: batchResult.summary.totalDailyBudget,
      dailyWaste: batchResult.summary.totalDailyWaste,
      sourceCta: "batch_summary_monitor_cta",
      defaultPlan: "agency",
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/90 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/15 text-sky-300">
              <Zap className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                OfferParity — Broken-Offer X-Ray
              </h1>
              <p className="text-xs text-slate-400">
                Pre-flight &amp; live ad-to-checkout parity verification for DTC performance teams
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Audit workflow mode"
              className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1"
            >
              <button
                type="button"
                aria-pressed={mode === "single"}
                onClick={() => handleModeSwitch("single")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                  mode === "single"
                    ? "bg-sky-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Single Ad X-Ray
              </button>
              <button
                type="button"
                aria-pressed={mode === "batch"}
                onClick={() => handleModeSwitch("batch")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                  mode === "batch"
                    ? "bg-sky-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                Batch CSV Pre-Flight
              </button>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Zero Auth Walls · Deterministic Spend Audit</span>
            </div>

            <nav aria-label="Secondary navigation" className="flex items-center gap-3 text-xs font-semibold">
              <Link
                href="/pricing"
                onClick={() => trackEvent("pricing_cta_clicked", { from: "header" })}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200 transition hover:border-sky-400 hover:text-white"
              >
                Pricing
              </Link>
              <Link
                href="/bot"
                className="text-slate-400 transition hover:text-slate-200"
              >
                Bot Allowlist
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {mode === "single" ? (
          <>
            <ScenarioSelector
              activeFixtureId={activeFixtureId}
              isLoading={isLoading}
              onSelectScenario={handleSelectScenario}
            />

            {hasMounted ? (
              <RecentScansBar
                entries={recentScans}
                onSelectScan={handleSelectRecentScan}
                onClearHistory={handleClearHistory}
              />
            ) : null}

            <XRayForm
              adCopy={adCopy}
              landingPageUrl={landingPageUrl}
              dailyBudget={dailyBudget}
              activeFixtureId={activeFixtureId}
              isLoading={isLoading}
              serverError={serverError}
              onAdCopyChange={handleAdCopyChange}
              onLandingPageUrlChange={handleLandingPageUrlChange}
              onDailyBudgetChange={handleDailyBudgetChange}
              onSubmit={handleSubmit}
            />

            <WasteSummaryBanner
              report={report}
              onOpenMonitorCta={handleOpenSingleMonitorCta}
            />

            <ParityDiffTable checks={report.checks} />

            <ClaimsComparisonCard
              extractedClaims={report.extractedClaims}
              storefront={report.storefront}
            />

            <AlertExportPanel report={report} />
          </>
        ) : (
          <BatchAuditPanel
            onInspectReport={handleInspectReport}
            onOpenBatchMonitorCta={handleOpenBatchMonitorCta}
          />
        )}

        <section
          aria-label="How OfferParity protects ad spend"
          className="grid gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5 sm:grid-cols-3 sm:p-6"
        >
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-sky-300">
              100% Deterministic
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Pure-code extraction and live Shopify/JSON-LD verification—zero
              LLM hallucinations or guessed prices.
            </p>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
              Zero Ad-Account Risk
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Never requires Meta/TikTok write OAuth and never auto-pauses ads
              or resets campaign learning phases.
            </p>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Built for Agencies &amp; DTC
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Audit 25 ads in seconds via CSV or upgrade to hourly Slack
              regression alerts starting at $99/mo.{" "}
              <Link href="/pricing" className="font-semibold text-sky-400 hover:underline">
                View plans →
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <span>OfferParity · Deterministic Ad-to-Checkout Parity Verification</span>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-slate-300">
              Pricing
            </Link>
            <Link href="/bot" className="hover:text-slate-300">
              OfferParityBot/1.0
            </Link>
            <Link href="/privacy" className="hover:text-slate-300">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-slate-300">
              Terms
            </Link>
          </div>
        </div>
      </footer>

      <MonitorCtaModal
        key={monitorCtaContext?.sourceCta ?? "closed"}
        isOpen={monitorCtaContext !== null}
        context={monitorCtaContext}
        onClose={() => setMonitorCtaContext(null)}
      />
    </div>
  );
}
