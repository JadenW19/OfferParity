import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { buildMarkdownReport, buildSlackAlert } from "@/lib/exporters/reportFormatters";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import {
  XRayReportSchema,
  type BatchXRayItemResult,
  type BatchXRaySummary,
  type XRayReport,
  type XRayRequest,
} from "@/lib/schemas";
import { verifyStorefront, type VerifyStorefrontInput } from "@/lib/verifier/storefrontVerifier";

export interface RunSingleXRayOptions {
  fetchImpl?: VerifyStorefrontInput["fetchImpl"];
  lookupFn?: VerifyStorefrontInput["lookupFn"];
  timeoutMs?: number;
}

/**
 * Executes the complete 100% deterministic OfferParity X-Ray pipeline for a single ad.
 */
export async function runSingleXRay(
  request: XRayRequest,
  options?: RunSingleXRayOptions
): Promise<XRayReport> {
  const startedAt = performance.now();

  const extractedClaims = extractAdClaims(request.adCopy, request.landingPageUrl);
  const storefront = await verifyStorefront({
    landingPageUrl: request.landingPageUrl,
    fixtureId: request.fixtureId,
    promoCode: extractedClaims.promoCode,
    fetchImpl: options?.fetchImpl,
    lookupFn: options?.lookupFn,
    timeoutMs: options?.timeoutMs,
  });

  const { checks, overallStatus } = evaluateParity(extractedClaims, storefront);
  const waste = calculateWaste(checks, request.dailyBudget, overallStatus);
  const generatedAt = new Date().toISOString();
  const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);

  const reportBase = {
    request,
    extractedClaims,
    storefront,
    checks,
    overallStatus,
    waste,
    generatedAt,
    durationMs,
  };

  const slackAlert = buildSlackAlert(reportBase);
  const markdownReport = buildMarkdownReport(reportBase);

  return XRayReportSchema.parse({
    ...reportBase,
    slackAlert,
    markdownReport,
  });
}

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Builds a Slack-formatted multi-ad campaign burn digest for agency media teams.
 */
export function buildBatchSlackDigest(
  summary: BatchXRaySummary,
  results: BatchXRayItemResult[]
): string {
  const emoji =
    summary.failCount > 0 || summary.errorCount > 0
      ? ":rotating_light:"
      : summary.warnCount > 0 || summary.wafCount > 0
        ? ":warning:"
        : ":large_green_circle:";

  const lines: string[] = [
    `${emoji} *OfferParity Campaign Pre-Flight Digest (${summary.totalRows} Ads Audited)*`,
    `*Verdicts:* ${summary.passCount} PASS · ${summary.warnCount} WARN · ${summary.failCount} FAIL${summary.wafCount > 0 ? ` · ${summary.wafCount} WAF` : ""}${summary.errorCount > 0 ? ` · ${summary.errorCount} ERROR` : ""}`,
    `*Total Daily Budget:* ${formatUsd(summary.totalDailyBudget)}/day | *Est. Daily Waste:* ${formatUsd(summary.totalDailyWaste)}/day | *30-Day Burn:* ${formatUsd(summary.totalMonthlyWaste)}/mo`,
  ];

  if (summary.totalAtRiskDailySpend > 0) {
    lines.push(`*Total At-Risk Spend (Warnings):* ${formatUsd(summary.totalAtRiskDailySpend)}/day`);
  }

  const problemRows = results.filter(
    (item) => !item.ok || (item.report && item.report.overallStatus !== "PASS")
  );

  if (problemRows.length > 0) {
    lines.push("*Flagged Ads Requiring Attention:*");
    for (const row of problemRows.slice(0, 10)) {
      if (!row.ok || !row.report) {
        lines.push(`• *[ERROR] ${row.adName}*: ${row.error ?? "Failed to audit"}`);
        continue;
      }
      const topIssue =
        row.report.checks.find((c) => c.status === "FAIL") ??
        row.report.checks.find((c) => c.status === "WARN");
      lines.push(
        `• *[${row.report.overallStatus}] ${row.adName}* (${formatUsd(row.report.waste.estimatedDailyWaste)}/day waste): ${topIssue ? `${topIssue.label} — ${topIssue.actual}` : row.report.request.landingPageUrl}`
      );
    }
    if (problemRows.length > 10) {
      lines.push(`• _...and ${problemRows.length - 10} more flagged ad(s)_`);
    }
  } else {
    lines.push("*All audited ads passed 6-point offer parity verification.*");
  }

  return lines.join("\n");
}
