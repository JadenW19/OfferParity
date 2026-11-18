"use client";

import { CheckCircle2, AlertTriangle, XCircle, Globe, Sparkles } from "lucide-react";
import { DEMO_SCENARIO_PRESETS } from "@/lib/fixtures/demoScenarios";
import type { DemoScenarioPreset, FixtureScenarioId, OverallVerdict } from "@/lib/schemas";

interface ScenarioSelectorProps {
  activeFixtureId: FixtureScenarioId | null;
  isLoading: boolean;
  onSelectScenario: (preset: DemoScenarioPreset) => void;
}

function VerdictBadge({ verdict }: { verdict: OverallVerdict }) {
  if (verdict === "PASS") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        PASS
      </span>
    );
  }
  if (verdict === "FAIL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        FAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {verdict}
    </span>
  );
}

export function ScenarioSelector({
  activeFixtureId,
  isLoading,
  onSelectScenario,
}: ScenarioSelectorProps) {
  const isCustomLiveMode = activeFixtureId === null;

  return (
    <section
      aria-label="Demo scenarios and mode selector"
      className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
            Instant Demo Scenarios
          </h2>
        </div>
        <div
          data-testid="xray-mode-indicator"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            isCustomLiveMode
              ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
              : "border-slate-700 bg-slate-800/90 text-slate-300"
          }`}
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {isCustomLiveMode ? "Mode: Custom Live URL" : `Mode: Demo Fixture (${activeFixtureId})`}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {DEMO_SCENARIO_PRESETS.map((preset) => {
          const isActive = activeFixtureId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={isLoading}
              aria-pressed={isActive}
              data-scenario-id={preset.id}
              onClick={() => onSelectScenario(preset)}
              className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                isActive
                  ? "border-sky-400 bg-sky-950/40 ring-1 ring-sky-400/60"
                  : "border-slate-800 bg-slate-950/70 hover:border-slate-600 hover:bg-slate-900"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-white group-hover:text-sky-200">
                    {preset.name}
                  </span>
                  <VerdictBadge verdict={preset.expectedVerdict} />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{preset.tagline}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs text-slate-300">
                <span>Budget: ${preset.dailyBudget.toLocaleString("en-US")}/day</span>
                <span className="font-medium text-sky-300">
                  {isActive ? "Active" : "Run scenario ->"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
