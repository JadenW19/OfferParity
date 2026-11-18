"use client";

import { useRef, useState } from "react";
import { ShieldCheck, Zap } from "lucide-react";
import { AlertExportPanel } from "@/components/AlertExportPanel";
import { ClaimsComparisonCard } from "@/components/ClaimsComparisonCard";
import { GeminiAssistantCard } from "@/components/GeminiAssistantCard";
import { ParityDiffTable } from "@/components/ParityDiffTable";
import { ScenarioSelector } from "@/components/ScenarioSelector";
import { WasteSummaryBanner } from "@/components/WasteSummaryBanner";
import { XRayForm } from "@/components/XRayForm";
import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { buildMarkdownReport, buildSlackAlert } from "@/lib/exporters/reportFormatters";
import {
  getDemoScenarioPreset,
  resolveFixtureSnapshot,
} from "@/lib/fixtures/demoScenarios";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import {
  XRayReportSchema,
  type DemoScenarioPreset,
  type FixtureScenarioId,
  type XRayReport,
} from "@/lib/schemas";

const INITIAL_SCENARIO_ID: FixtureScenarioId = "oos-price-mismatch";

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
  const [adCopy, setAdCopy] = useState<string>(initialPreset.adCopy);
  const [landingPageUrl, setLandingPageUrl] = useState<string>(initialPreset.landingPageUrl);
  const [dailyBudget, setDailyBudget] = useState<string>(String(initialPreset.dailyBudget));
  const [activeFixtureId, setActiveFixtureId] = useState<FixtureScenarioId | null>(
    INITIAL_SCENARIO_ID
  );
  const [useGeminiFallback, setUseGeminiFallback] = useState<boolean>(false);
  const [report, setReport] = useState<XRayReport>(() => buildInitialDemoReport());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function executeXRay(payload: {
    adCopy: string;
    landingPageUrl: string;
    dailyBudget: number;
    fixtureId?: FixtureScenarioId;
    useGeminiFallback?: boolean;
  }) {
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
      ...(useGeminiFallback ? { useGeminiFallback: true } : {}),
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
      ...(useGeminiFallback ? { useGeminiFallback: true } : {}),
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

          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>Zero Auth Walls · Deterministic Spend Audit</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <ScenarioSelector
          activeFixtureId={activeFixtureId}
          isLoading={isLoading}
          onSelectScenario={handleSelectScenario}
        />

        <XRayForm
          adCopy={adCopy}
          landingPageUrl={landingPageUrl}
          dailyBudget={dailyBudget}
          activeFixtureId={activeFixtureId}
          useGeminiFallback={useGeminiFallback}
          isLoading={isLoading}
          serverError={serverError}
          onAdCopyChange={handleAdCopyChange}
          onLandingPageUrlChange={handleLandingPageUrlChange}
          onDailyBudgetChange={handleDailyBudgetChange}
          onUseGeminiFallbackChange={setUseGeminiFallback}
          onSubmit={handleSubmit}
        />

        <WasteSummaryBanner report={report} />

        <ParityDiffTable checks={report.checks} />

        <ClaimsComparisonCard
          extractedClaims={report.extractedClaims}
          storefront={report.storefront}
        />

        <AlertExportPanel report={report} />

        <GeminiAssistantCard report={report} />
      </main>
    </div>
  );
}
