"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { CheckStatus, ParityCheck } from "@/lib/schemas";

interface ParityDiffTableProps {
  checks: ParityCheck[];
}

function StatusBadge({ status }: { status: CheckStatus }) {
  if (status === "PASS") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--status-pass-text)]">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        PASS
      </span>
    );
  }
  if (status === "FAIL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--status-fail-text)]">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        FAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--status-warn-text)]">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
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
      className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            6-Point Offer Parity Diff
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Deterministic comparison across HTTP health, pricing, hero variant stock, promo code,
            discount math, and UTM hygiene.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-700">
            {passCount} PASS
          </span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-700">
            {warnCount} WARN
          </span>
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 font-medium text-rose-700">
            {failCount} FAIL
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border-hairline)]">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="bg-[var(--bg-surface-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Check</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Ad Promised (Expected)</th>
              <th className="px-4 py-3 font-semibold">Storefront Observed (Actual)</th>
              <th className="px-4 py-3 font-semibold">Weight</th>
              <th className="px-4 py-3 font-semibold">Remediation Guidance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-hairline)]">
            {checks.map((check) => (
              <tr
                key={check.id}
                data-check-id={check.id}
                className="bg-[var(--bg-surface)] align-top transition hover:bg-[var(--bg-surface-subtle)]"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-[var(--text-primary)]">{check.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">{check.id}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={check.status} />
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{check.expected}</td>
                <td className="px-4 py-3 text-[var(--text-primary)]">{check.actual}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--text-muted)]">
                  {Math.round(check.impactWeight * 100)}%
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{check.remediation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
