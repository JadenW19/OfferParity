"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronUp, FileSpreadsheet, Search, Zap } from "lucide-react";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { WasteSummaryBanner } from "@/components/WasteSummaryBanner";
import { XRayForm } from "@/components/XRayForm";
import { trackEvent } from "@/lib/analytics";
import {
  getDemoScenarioPreset,
} from "@/lib/fixtures/demoScenarios";
import {
  FixtureScenarioIdSchema,
  LeadPlanInterestSchema,
  XRayReportSchema,
  type BatchXRayResponse,
  type DemoScenarioPreset,
  type FixtureScenarioId,
  type XRayReport,
} from "@/lib/schemas";

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

export default function HomePage() {
  const [mode, setMode] = useState<AuditMode>("single");
  const [adCopy, setAdCopy] = useState<string>("");
  const [landingPageUrl, setLandingPageUrl] = useState<string>("");
  const [dailyBudget, setDailyBudget] = useState<string>("500");
  const [activeFixtureId, setActiveFixtureId] = useState<FixtureScenarioId | null>(
    null
  );
  const [report, setReport] = useState<XRayReport | null>(null);
  const [showRawDetails, setShowRawDetails] = useState<boolean>(false);
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
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-ink)]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <h1 className="text-sm font-bold tracking-tight text-[var(--text-primary)] sm:text-base">
              OfferParity — Broken-Offer X-Ray
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div
              role="group"
              aria-label="Audit workflow mode"
              className="inline-flex rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-0.5"
            >
              <button
                type="button"
                aria-pressed={mode === "single"}
                onClick={() => handleModeSwitch("single")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${mode === "single"
                  ? "bg-[var(--accent-primary)] text-[var(--accent-ink)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
              >
                <Search className="h-3 w-3" aria-hidden="true" />
                Single Ad X-Ray
              </button>
              <button
                type="button"
                aria-pressed={mode === "batch"}
                onClick={() => handleModeSwitch("batch")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${mode === "batch"
                  ? "bg-[var(--accent-primary)] text-[var(--accent-ink)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
              >
                <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
                Batch CSV Pre-Flight
              </button>
            </div>

            <nav aria-label="Secondary navigation" className="flex items-center gap-2 text-xs font-semibold">
              <Link
                href="/pricing"
                onClick={() => trackEvent("pricing_cta_clicked", { from: "header" })}
                className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1.5 text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
              >
                Pricing
              </Link>
              <Link
                href="/bot"
                className="hidden px-2 py-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] sm:inline"
              >
                Bot
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        {mode === "single" ? (
          <>
            <section
              aria-label="OfferParity overview"
              className="grid items-center gap-6 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-7 lg:grid-cols-12"
            >
              <div className="space-y-3 lg:col-span-7">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-soft-text)]">
                  Deterministic Ad-to-Checkout Audit
                </p>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
                  Stop paying for clicks to broken offers.
                </h2>
                <p className="max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
                  Verify ad copy against live Shopify prices, variant stock,
                  promo codes, and UTMs in seconds—before wasted spend compounds.
                </p>
              </div>
              <div className="lg:col-span-5">
                <div className="overflow-hidden rounded-xl border border-[var(--border-hairline)]">
                  <Image
                    src="/images/hero-xray-light.svg"
                    alt="Isometric OfferParity scanner verifying ad price and variant stock"
                    width={480}
                    height={340}
                    priority
                    className="theme-only-light h-auto w-full"
                  />
                  <Image
                    src="/images/hero-xray-dark.svg"
                    alt="Isometric OfferParity scanner verifying ad price and variant stock"
                    width={480}
                    height={340}
                    priority
                    className="theme-only-dark h-auto w-full"
                  />
                </div>
              </div>
            </section>

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

            {report ? (
              <>
                <WasteSummaryBanner
                  report={report}
                  onOpenMonitorCta={handleOpenSingleMonitorCta}
                />

                <ParityDiffTable checks={report.checks} />

                <div>
                  <button
                    type="button"
                    aria-expanded={showRawDetails}
                    onClick={() => setShowRawDetails((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  >
                    {showRawDetails ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        Hide Raw Extraction &amp; Variants
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        Inspect Raw Extraction &amp; Variants
                      </>
                    )}
                  </button>
                </div>

                {showRawDetails ? (
                  <ClaimsComparisonCard
                    extractedClaims={report.extractedClaims}
                    storefront={report.storefront}
                  />
                ) : null}

                <AlertExportPanel report={report} />
              </>
            ) : null}
          </>
        ) : (
          <BatchAuditPanel
            onInspectReport={handleInspectReport}
            onOpenBatchMonitorCta={handleOpenBatchMonitorCta}
          />
        )}

        <section
          aria-label="How OfferParity protects ad spend"
          className="grid gap-5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 sm:grid-cols-3"
        >
          <div className="flex items-start gap-3.5">
            <Image
              src="/images/spot-deterministic.svg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-[var(--border-hairline)]"
            />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                100% Deterministic
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                Pure-code extraction and live Shopify/JSON-LD verification—zero
                LLM hallucinations or guessed prices.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3.5">
            <Image
              src="/images/spot-zero-oauth.svg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-[var(--border-hairline)]"
            />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Zero Ad-Account Risk
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                Never requires Meta/TikTok write OAuth and never auto-pauses ads
                or resets campaign learning phases.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3.5">
            <Image
              src="/images/spot-slack-alert.svg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-[var(--border-hairline)]"
            />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Built for Agencies &amp; DTC
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                Audit 25 ads in seconds via CSV or upgrade to hourly Slack
                regression alerts starting at $99/mo.{" "}
                <Link href="/pricing" className="font-semibold underline">
                  View plans →
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border-hairline)] py-6 text-xs text-[var(--text-muted)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <span>OfferParity · Deterministic Ad-to-Checkout Parity Verification</span>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-[var(--text-primary)]">
              Pricing
            </Link>
            <Link href="/bot" className="hover:text-[var(--text-primary)]">
              OfferParityBot/1.0
            </Link>
            <Link href="/privacy" className="hover:text-[var(--text-primary)]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--text-primary)]">
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
