import type { OverallVerdict, ParityCheck, XRayReport } from "@/lib/schemas";

type ReportPayload = Omit<XRayReport, "slackAlert" | "markdownReport">;

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getSlackEmoji(verdict: OverallVerdict): string {
  switch (verdict) {
    case "FAIL":
      return ":rotating_light:";
    case "WARN":
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return ":warning:";
    case "PASS":
      return ":large_green_circle:";
  }
}

function getVerdictHeadline(verdict: OverallVerdict): string {
  switch (verdict) {
    case "FAIL":
      return "OfferParity X-Ray FAIL — Paid Spend Burn Detected";
    case "WARN":
      return "OfferParity X-Ray WARN — Unverified / At-Risk Signals";
    case "WAF_CHALLENGE_MANUAL_CHECK":
      return "OfferParity X-Ray — Manual Check Required (WAF Blocked)";
    case "PASS":
      return "OfferParity X-Ray PASS — Offer Parity Verified";
  }
}

function formatCheckLine(check: ParityCheck): string {
  return `• *[${check.status}] ${check.label}*: Expected \`${check.expected}\` | Actual \`${check.actual}\``;
}

function pickRecommendedAction(report: ReportPayload): string {
  if (report.overallStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return "Open the landing page in a browser to verify stock, pricing, and promo code manually before scaling spend.";
  }

  const actionable =
    report.checks.find((check) => check.status === "FAIL") ??
    report.checks.find((check) => check.status === "WARN");

  return actionable
    ? actionable.remediation
    : "All parity checks passed — safe to continue running ad spend.";
}

/**
 * Formats a concise Slack burn-rate alert card summarizing verdict, wasted spend,
 * failing/warning diffs, and the top recommended media-buyer action.
 */
export function buildSlackAlert(report: ReportPayload): string {
  const emoji = getSlackEmoji(report.overallStatus);
  const headline = getVerdictHeadline(report.overallStatus);
  const titleSuffix = report.storefront.title ? ` (${report.storefront.title})` : "";

  const lines: string[] = [
    `${emoji} *${headline}*${titleSuffix}`,
    `*Landing URL:* ${report.request.landingPageUrl}`,
    `*Daily Budget:* ${formatUsd(report.request.dailyBudget)}/day | *Est. Daily Waste:* ${formatUsd(report.waste.estimatedDailyWaste)}/day | *30-Day Burn:* ${formatUsd(report.waste.projectedMonthlyWaste)}/mo (${(report.waste.effectiveWasteRate * 100).toFixed(1)}% waste rate)`,
  ];

  if (report.waste.atRiskDailySpend > 0) {
    lines.push(`*At-Risk Daily Spend (Warnings):* ${formatUsd(report.waste.atRiskDailySpend)}/day`);
  }

  const issues = report.checks.filter((check) => check.status !== "PASS");
  if (issues.length > 0) {
    lines.push("*Detected Mismatches & Warnings:*");
    for (const issue of issues) {
      lines.push(formatCheckLine(issue));
    }
  } else {
    lines.push("*Checks:* All 6 parity checks passed (price, stock, promo, discount math, HTTP, UTMs).");
  }

  lines.push(`*Recommended Action:* ${pickRecommendedAction(report)}`);
  return lines.join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Generates a structured Markdown QA audit report suitable for agency client
 * deliverables, Notion/Linear tickets, or downloadable audit archives.
 */
export function buildMarkdownReport(report: ReportPayload): string {
  const { request, extractedClaims, storefront, checks, overallStatus, waste } = report;

  const utmSummary = [
    extractedClaims.utmParams.utm_source ? `source=${extractedClaims.utmParams.utm_source}` : null,
    extractedClaims.utmParams.utm_medium ? `medium=${extractedClaims.utmParams.utm_medium}` : null,
    extractedClaims.utmParams.utm_campaign
      ? `campaign=${extractedClaims.utmParams.utm_campaign}`
      : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(", ");

  const lines: string[] = [
    "# OfferParity X-Ray QA Audit Report",
    "",
    `- **Verdict:** \`${overallStatus}\``,
    `- **Generated At:** ${report.generatedAt}`,
    `- **Product / Page Title:** ${storefront.title ?? "Unknown"}`,
    `- **Landing Page URL:** ${request.landingPageUrl}`,
    `- **Final Resolved URL:** ${storefront.finalUrl}`,
    `- **HTTP Status / Source:** HTTP ${storefront.httpStatus} (\`${storefront.source}\`)`,
    `- **Scan Duration:** ${report.durationMs} ms`,
    "",
    "## Spend Impact Summary",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Daily Ad Budget | ${formatUsd(request.dailyBudget)} / day |`,
    `| Effective Waste Rate | ${(waste.effectiveWasteRate * 100).toFixed(2)}% |`,
    `| Estimated Daily Waste | ${formatUsd(waste.estimatedDailyWaste)} / day |`,
    `| Projected 30-Day Waste | ${formatUsd(waste.projectedMonthlyWaste)} / 30 days |`,
    `| At-Risk Daily Spend (Warnings) | ${formatUsd(waste.atRiskDailySpend)} / day |`,
    `| Waste Formula | \`${escapeTableCell(waste.breakdown.formula)}\` |`,
    "",
    "## Ad Claims vs. Storefront Truth",
    "",
    "| Signal | Ad Claim | Storefront Truth |",
    "| --- | --- | --- |",
    `| Price | ${extractedClaims.advertisedPrice !== null ? extractedClaims.advertisedPrice.toFixed(2) : "None"} | ${storefront.basePrice !== null ? storefront.basePrice.toFixed(2) : "Unavailable"} |`,
    `| Currency | ${extractedClaims.currency ?? "Unspecified"} | ${storefront.currency ?? "Unavailable"} |`,
    `| Promo Code | ${extractedClaims.promoCode ?? "None"} | ${storefront.promoVerification ? `${storefront.promoVerification.state} (${storefront.promoVerification.detail})` : "None / Unverified"} |`,
    `| Discount % | ${extractedClaims.discountPct !== null ? `${extractedClaims.isUpToDiscount ? "Up to " : ""}${extractedClaims.discountPct}%` : "None"} | ${storefront.compareAtPrice !== null ? `Compare-at ${storefront.compareAtPrice.toFixed(2)}` : "No compare-at"} |`,
    `| Hero Variant | ${extractedClaims.variantName ?? "Unspecified"} | ${storefront.variants.length > 0 ? `${storefront.variants.filter((v) => v.available).length}/${storefront.variants.length} variants available` : `inStock=${String(storefront.inStock)}`} |`,
    `| UTM Parameters | ${utmSummary || "Incomplete / missing"} | Tracked on landing URL |`,
    "",
    "## Parity Checks",
    "",
    "| Check | Status | Expected (Ad) | Actual (Storefront) | Weight | Remediation |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const check of checks) {
    lines.push(
      `| ${escapeTableCell(check.label)} | **${check.status}** | ${escapeTableCell(check.expected)} | ${escapeTableCell(check.actual)} | ${check.impactWeight.toFixed(2)} | ${escapeTableCell(check.remediation)} |`
    );
  }

  const actionableChecks = checks.filter((check) => check.status !== "PASS");
  lines.push("", "## Recommended Actions", "");

  if (actionableChecks.length === 0) {
    lines.push("- All parity checks passed. No remediation required.");
  } else {
    for (const check of actionableChecks) {
      lines.push(`- **[${check.status}] ${check.label}:** ${check.remediation}`);
    }
  }

  return lines.join("\n");
}
