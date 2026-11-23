"use client";

import { AlertTriangle, CheckCircle2, Globe, XCircle } from "lucide-react";
import { DEMO_SCENARIO_PRESETS } from "@/lib/fixtures/demoScenarios";
import type { DemoScenarioPreset, FixtureScenarioId, OverallVerdict } from "@/lib/schemas";

interface ScenarioSelectorProps {
  activeFixtureId: FixtureScenarioId | null;
  isLoading: boolean;
  onSelectScenario: (preset: DemoScenarioPreset) => void;
}

function VerdictDot({ verdict }: { verdict: OverallVerdict }) {
  if (verdict === "PASS") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  }
  if (verdict === "FAIL") {
    return <XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />;
  }
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Try a scenario:
        </span>
        {DEMO_SCENARIO_PRESETS.map((preset) => {
          const isActive = activeFixtureId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={isLoading}
              aria-pressed={isActive}
              data-scenario-id={preset.id}
              title={preset.tagline}
              onClick={() => onSelectScenario(preset)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                isActive
                  ? "border-[var(--text-primary)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              }`}
            >
              <VerdictDot verdict={preset.expectedVerdict} />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>

      <div
        data-testid="xray-mode-indicator"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1 font-mono text-[11px] font-medium text-[var(--text-muted)]"
      >
        <Globe className="h-3 w-3" aria-hidden="true" />
        {isCustomLiveMode ? "Mode: Custom Live URL" : `Mode: Demo Fixture (${activeFixtureId})`}
      </div>
    </section>
  );
}
