"use client";

import { Clock, Trash2 } from "lucide-react";
import { XRayReportSchema, type OverallVerdict, type XRayReport } from "@/lib/schemas";

export const RECENT_SCANS_STORAGE_KEY = "offerparity.recentScans.v1";
const MAX_RECENT_SCANS = 10;

export interface RecentScanEntry {
  id: string;
  savedAt: string;
  report: XRayReport;
}

export function loadRecentScansFromStorage(): RecentScanEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SCANS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const valid: RecentScanEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== "string" || typeof obj.savedAt !== "string") continue;
      const reportParsed = XRayReportSchema.safeParse(obj.report);
      if (reportParsed.success) {
        valid.push({
          id: obj.id,
          savedAt: obj.savedAt,
          report: reportParsed.data,
        });
      }
    }
    return valid.slice(0, MAX_RECENT_SCANS);
  } catch {
    return [];
  }
}

export function saveRecentScanToStorage(
  existing: RecentScanEntry[],
  report: XRayReport
): RecentScanEntry[] {
  const dedupeKey = `${report.request.landingPageUrl}::${report.request.adCopy}::${report.request.dailyBudget}`;
  const filtered = existing.filter(
    (entry) =>
      `${entry.report.request.landingPageUrl}::${entry.report.request.adCopy}::${entry.report.request.dailyBudget}` !==
      dedupeKey
  );

  const next: RecentScanEntry[] = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      report,
    },
    ...filtered,
  ].slice(0, MAX_RECENT_SCANS);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_SCANS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors in restricted browsing contexts
    }
  }

  return next;
}

export function clearRecentScansInStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_SCANS_STORAGE_KEY);
  } catch {
    // Ignore restricted localStorage access
  }
}

function verdictPillClass(verdict: OverallVerdict): string {
  switch (verdict) {
    case "PASS":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
    case "WARN":
      return "border-amber-500/40 bg-amber-500/15 text-amber-300";
    case "FAIL":
      return "border-rose-500/40 bg-rose-500/15 text-rose-300";
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return "border-violet-500/40 bg-violet-500/15 text-violet-300";
  }
}

function summarizeHostname(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const segments = u.pathname.split("/").filter(Boolean);
    const tail = segments[segments.length - 1] ?? "";
    return tail ? `${u.hostname}/${tail}` : u.hostname;
  } catch {
    return urlStr;
  }
}

interface RecentScansBarProps {
  entries: RecentScanEntry[];
  onSelectScan: (entry: RecentScanEntry) => void;
  onClearHistory: () => void;
}

export function RecentScansBar({
  entries,
  onSelectScan,
  onClearHistory,
}: RecentScansBarProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Recent X-Ray scans"
      className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Clock className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          <span>Recent Audits ({entries.length})</span>
        </div>

        <button
          type="button"
          onClick={onClearHistory}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          Clear History
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {entries.map((entry) => {
          const { report } = entry;
          const label = report.storefront.title ?? summarizeHostname(report.request.landingPageUrl);
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectScan(entry)}
              className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-left text-xs transition hover:border-slate-600 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${verdictPillClass(
                  report.overallStatus
                )}`}
              >
                {report.overallStatus === "WAF_CHALLENGE_MANUAL_CHECK"
                  ? "WAF"
                  : report.overallStatus}
              </span>
              <span className="max-w-[180px] truncate font-medium text-slate-200">{label}</span>
              <span className="font-mono text-[11px] text-slate-400">
                ${report.waste.estimatedDailyWaste.toFixed(0)}/d waste
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
