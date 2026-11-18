"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { CheckStatus, ParityCheck } from "@/lib/schemas";

interface ParityDiffTableProps {
  checks: ParityCheck[];
}

function StatusBadge({ status }: { status: CheckStatus }) {
  if (status === "PASS") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        PASS
      </span>
    );
  }
  if (status === "FAIL") {
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
      WARN
    </span>
  );
}

export function ParityDiffTable({ checks }: ParityDiffTableProps) {
  const passCount = checks.filter((c) => c.status === "PASS").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;

  return (
    <section
      aria-label="Field-by-field parity diff checks"
      className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">6-Point Offer Parity Diff</h2>
          <p className="text-xs text-slate-400">
            Deterministic comparison across HTTP health, pricing, hero variant stock, promo code,
            discount math, and UTM hygiene.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300">
            {passCount} PASS
          </span>
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-300">
            {warnCount} WARN
          </span>
          <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-300">
            {failCount} FAIL
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="bg-slate-950/90 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Check</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Ad Promised (Expected)</th>
              <th className="px-4 py-3 font-semibold">Storefront Observed (Actual)</th>
              <th className="px-4 py-3 font-semibold">Weight</th>
              <th className="px-4 py-3 font-semibold">Remediation Guidance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {checks.map((check) => (
              <tr
                key={check.id}
                data-check-id={check.id}
                className="bg-slate-950/50 align-top transition hover:bg-slate-900/60"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-100">{check.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400">{check.id}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={check.status} />
                </td>
                <td className="px-4 py-3 text-slate-300">{check.expected}</td>
                <td className="px-4 py-3 text-slate-200">{check.actual}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-slate-300">
                  {Math.round(check.impactWeight * 100)}%
                </td>
                <td className="px-4 py-3 text-slate-300">{check.remediation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
