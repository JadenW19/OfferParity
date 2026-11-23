"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import { copyTextWithFallback, triggerBlobDownload } from "@/components/AlertExportPanel";
import {
  SAMPLE_AGENCY_CAMPAIGN_CSV,
  parseCampaignCsv,
  serializeBatchAuditCsv,
} from "@/lib/parser/csvCampaignParser";
import {
  BatchXRayResponseSchema,
  MAX_BATCH_ITEMS,
  type BatchXRayItemResult,
  type BatchXRayResponse,
  type OverallVerdict,
  type XRayReport,
} from "@/lib/schemas";

type StatusFilter = "ALL" | "FAIL" | "WARN" | "PASS";

interface BatchAuditPanelProps {
  onInspectReport: (report: XRayReport) => void;
  onOpenBatchMonitorCta?: (batchResult: BatchXRayResponse) => void;
}

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function verdictBadgeClass(status: OverallVerdict | "ERROR"): string {
  switch (status) {
    case "PASS":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
    case "WARN":
      return "border-amber-500/40 bg-amber-500/15 text-amber-300";
    case "FAIL":
    case "ERROR":
      return "border-rose-500/40 bg-rose-500/15 text-rose-300";
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return "border-violet-500/40 bg-violet-500/15 text-violet-300";
  }
}

export function BatchAuditPanel({
  onInspectReport,
  onOpenBatchMonitorCta,
}: BatchAuditPanelProps) {
  const [csvText, setCsvText] = useState<string>(SAMPLE_AGENCY_CAMPAIGN_CSV);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<BatchXRayResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [copiedDigest, setCopiedDigest] = useState<boolean>(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string>("");

  function handleCsvTextChange(nextValue: string) {
    setCsvText(nextValue);
    setValidationErrors([]);
    setServerError(null);
  }

  function handleLoadSampleCampaign() {
    setCsvText(SAMPLE_AGENCY_CAMPAIGN_CSV);
    setValidationErrors([]);
    setServerError(null);
    setFeedbackNotice("Loaded sample 4-ad BFCM agency campaign.");
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setCsvText(content);
      setValidationErrors([]);
      setServerError(null);
      setFeedbackNotice(`Loaded ${file.name} (${content.length.toLocaleString("en-US")} bytes).`);
    } catch {
      setServerError("Unable to read the selected CSV file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleRunBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    setValidationErrors([]);
    setServerError(null);
    setFeedbackNotice("");

    const parsedCsv = parseCampaignCsv(csvText);
    if (parsedCsv.errors.length > 0) {
      setValidationErrors(parsedCsv.errors);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/xray/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsedCsv.items }),
      });

      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const errMsg =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : `Batch audit failed with HTTP ${response.status}`;
        setServerError(errMsg);
        return;
      }

      const validated = BatchXRayResponseSchema.safeParse(body);
      if (!validated.success) {
        setServerError("Received unexpected batch audit payload from server.");
        return;
      }

      setBatchResult(validated.data);
      setStatusFilter("ALL");
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Network error while running batch campaign audit."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopyDigest() {
    if (!batchResult) return;
    const ok = await copyTextWithFallback(batchResult.slackDigest);
    setCopiedDigest(ok);
    setFeedbackNotice(
      ok
        ? "Copied campaign Slack burn-rate digest to clipboard!"
        : "Unable to copy digest to clipboard."
    );
    setTimeout(() => setCopiedDigest(false), 2500);
  }

  function handleDownloadCsv() {
    if (!batchResult) return;
    const csvOutput = serializeBatchAuditCsv(batchResult);
    triggerBlobDownload(csvOutput, "text/csv;charset=utf-8", "offerparity-campaign-audit.csv");
    setFeedbackNotice("Downloaded campaign audit CSV.");
  }

  const filteredRows: BatchXRayItemResult[] = batchResult
    ? batchResult.results.filter((row) => {
        if (statusFilter === "ALL") return true;
        if (!row.ok || !row.report) return statusFilter === "FAIL";
        if (statusFilter === "FAIL") {
          return row.report.overallStatus === "FAIL";
        }
        if (statusFilter === "WARN") {
          return (
            row.report.overallStatus === "WARN" ||
            row.report.overallStatus === "WAF_CHALLENGE_MANUAL_CHECK"
          );
        }
        return row.report.overallStatus === "PASS";
      })
    : [];

  return (
    <div className="space-y-6">
      <section
        aria-label="Batch campaign CSV pre-flight audit"
        className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Campaign CSV Pre-Flight Audit (Up to {MAX_BATCH_ITEMS} Ads)
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Upload or paste an ad sheet (<code>ad_name, ad_copy, landing_page_url, daily_budget</code>)
              to audit every destination URL and promo claim in parallel before launch.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Upload .CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="sr-only"
                aria-label="Upload campaign CSV file"
              />
            </label>

            <button
              type="button"
              onClick={handleLoadSampleCampaign}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-soft-text)] transition hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Load Sample 4-Ad BFCM Campaign
            </button>
          </div>
        </div>

        <form onSubmit={handleRunBatch} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="batch-csv-input"
              className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Campaign CSV Rows
            </label>
            <textarea
              id="batch-csv-input"
              rows={7}
              value={csvText}
              onChange={(e) => handleCsvTextChange(e.target.value)}
              placeholder='ad_name,ad_copy,landing_page_url,daily_budget&#10;"Spring Launch","Hero Tee — $32 today with SPRING20","https://store.example.com/products/hero-tee?utm_source=meta&utm_medium=paid_social&utm_campaign=spring",500'
              className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2.5 font-mono text-xs leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-primary)] focus:outline-none"
            />
          </div>

          {validationErrors.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] px-3.5 py-2.5 text-xs text-[var(--status-fail-text)]"
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Fix CSV formatting before running audit:</span>
              </div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {serverError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] px-3.5 py-2.5 text-sm text-[var(--status-fail-text)]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] pt-4">
            <p className="text-xs text-[var(--text-muted)]">
              Bounded concurrency (4 workers) · Per-row SSRF &amp; error isolation · Exportable CSV
              &amp; Slack digest
            </p>
            <button
              type="submit"
              disabled={isLoading || csvText.trim().length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-6 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Auditing Campaign...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Run Batch Audit
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {batchResult ? (
        <section
          aria-label="Batch campaign audit results"
          data-testid="batch-audit-results"
          className="space-y-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Campaign Pre-Flight Summary ({batchResult.summary.totalRows} Ads Audited in{" "}
                {batchResult.durationMs}ms)
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Click &ldquo;Inspect Full X-Ray&rdquo; on any row to drill into full variant
                inventory, provenance signals, and waste math.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyDigest}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--accent-primary-hover)]"
              >
                {copiedDigest ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Digest Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy Campaign Slack Digest
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download Audit CSV
              </button>

              {onOpenBatchMonitorCta ? (
                <button
                  type="button"
                  onClick={() => onOpenBatchMonitorCta(batchResult)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-soft-text)] transition hover:opacity-90"
                >
                  <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Monitor All {batchResult.summary.totalRows} Ads Hourly</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          {feedbackNotice ? (
            <p className="text-xs font-medium text-[var(--status-pass-text)]">{feedbackNotice}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3.5">
              <p className="text-xs text-[var(--text-muted)]">Total Daily Spend Audited</p>
              <p
                data-testid="batch-total-budget"
                className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]"
              >
                {formatUsd(batchResult.summary.totalDailyBudget)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] p-3.5">
              <p className="text-xs text-[var(--status-fail-text)]">Estimated Daily Spend Waste</p>
              <p
                data-testid="batch-total-daily-waste"
                className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--status-fail-text)]"
              >
                {formatUsd(batchResult.summary.totalDailyWaste)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3.5">
              <p className="text-xs text-[var(--text-muted)]">Projected 30-Day Waste</p>
              <p
                data-testid="batch-total-monthly-waste"
                className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--status-warn-text)]"
              >
                {formatUsd(batchResult.summary.totalMonthlyWaste)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3.5">
              <p className="text-xs text-[var(--text-muted)]">Verdict Breakdown</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-xs font-semibold">
                <span className="rounded-full border border-[var(--status-fail-border)] bg-[var(--status-fail-bg)] px-2 py-0.5 text-[var(--status-fail-text)]">
                  {batchResult.summary.failCount + batchResult.summary.errorCount} FAIL
                </span>
                <span className="rounded-full border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] px-2 py-0.5 text-[var(--status-warn-text)]">
                  {batchResult.summary.warnCount + batchResult.summary.wafCount} WARN
                </span>
                <span className="rounded-full border border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] px-2 py-0.5 text-[var(--status-pass-text)]">
                  {batchResult.summary.passCount} PASS
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter batch rows by status">
            {(["ALL", "FAIL", "WARN", "PASS"] as const).map((filterValue) => (
              <button
                key={filterValue}
                type="button"
                aria-pressed={statusFilter === filterValue}
                onClick={() => setStatusFilter(filterValue)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  statusFilter === filterValue
                    ? "border-[var(--text-primary)] bg-[var(--accent-soft)] text-[var(--accent-soft-text)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                {filterValue}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border-hairline)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-surface-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Ad Name</th>
                  <th className="px-3.5 py-2.5 font-medium">Verdict</th>
                  <th className="px-3.5 py-2.5 font-medium">Budget/d</th>
                  <th className="px-3.5 py-2.5 font-medium">Daily Waste</th>
                  <th className="px-3.5 py-2.5 font-medium">Top Issue / Remediation</th>
                  <th className="px-3.5 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)] bg-[var(--bg-surface)]">
                {filteredRows.map((row) => {
                  const statusLabel =
                    row.ok && row.report ? row.report.overallStatus : ("ERROR" as const);
                  const topCheck =
                    row.report?.checks.find((c) => c.status === "FAIL") ??
                    row.report?.checks.find((c) => c.status === "WARN");

                  return (
                    <tr key={row.index}>
                      <td className="px-3.5 py-3 font-semibold text-[var(--text-primary)]">{row.adName}</td>
                      <td className="px-3.5 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold ${verdictBadgeClass(
                            statusLabel
                          )}`}
                        >
                          {statusLabel === "WAF_CHALLENGE_MANUAL_CHECK" ? "WAF CHECK" : statusLabel}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 font-mono tabular-nums text-[var(--text-muted)]">
                        {row.report ? formatUsd(row.report.request.dailyBudget) : "—"}
                      </td>
                      <td className="px-3.5 py-3 font-mono font-semibold tabular-nums text-[var(--status-fail-text)]">
                        {row.report ? formatUsd(row.report.waste.estimatedDailyWaste) : "—"}
                      </td>
                      <td className="max-w-sm px-3.5 py-3 text-[var(--text-muted)]">
                        {!row.ok ? (
                          <span className="text-[var(--status-fail-text)]">{row.error ?? "Row failed validation"}</span>
                        ) : topCheck ? (
                          <span>
                            <strong className="text-[var(--text-primary)]">{topCheck.label}:</strong>{" "}
                            {topCheck.actual}
                          </span>
                        ) : (
                          <span className="text-[var(--status-pass-text)]">
                            All 6 parity checks verified PASS.
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        {row.ok && row.report ? (
                          <button
                            type="button"
                            onClick={() => onInspectReport(row.report!)}
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
                          >
                            Inspect Full X-Ray
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
