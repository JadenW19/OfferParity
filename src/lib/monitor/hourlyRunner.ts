import {
  SLACK_WEBHOOK_PREFIX,
  type WatchlistItem,
  type WatchlistWorkspace,
  type XRayReport,
} from "@/lib/schemas";
import {
  claimScheduleExecution,
  getWorkspaceItems,
  listActiveWorkspaces,
  updateWatchlistItemStatus,
} from "@/lib/storage/watchlistStore";
import type { DnsLookupFn } from "@/lib/verifier/ssrfGuard";
import { runSingleXRay } from "@/lib/xrayRunner";

const MONITOR_CONCURRENCY = 3;
const SLACK_TIMEOUT_MS = 5000;

export interface WorkspaceAuditItemOutcome {
  itemId: string;
  adName: string;
  landingPageUrl: string;
  previousStatus: WatchlistItem["lastStatus"];
  currentStatus: XRayReport["overallStatus"];
  dailyWaste: number;
  regressionTriggered: boolean;
  recovered: boolean;
  failureSummary: string | null;
}

export interface WorkspaceAuditSummary {
  workspaceId: string;
  brandName: string;
  checkedCount: number;
  failCount: number;
  warnCount: number;
  passCount: number;
  regressionCount: number;
  recoveryCount: number;
  slackAlertSent: boolean;
  totalDailyWaste: number;
  outcomes: WorkspaceAuditItemOutcome[];
}

function summarizeFailure(report: XRayReport): string | null {
  const failing = report.checks.filter((c) => c.status === "FAIL");
  if (failing.length === 0) return null;
  return failing.map((c) => `${c.label}: ${c.actual}`).join(" | ");
}

function isTransient5xxFailure(report: XRayReport): boolean {
  return (
    report.overallStatus === "FAIL" &&
    report.storefront.httpStatus >= 500 &&
    report.storefront.httpStatus < 600
  );
}

async function postSlackWebhook(
  webhookUrl: string,
  text: string,
  fetchImpl: typeof fetch
): Promise<boolean> {
  if (!webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
    console.warn("[OfferParity] Ignoring non-Slack webhook URL on watchlist.");
    return false;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[OfferParity] Watchlist Slack webhook returned HTTP ${res.status}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[OfferParity] Watchlist Slack webhook delivery failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return false;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildRegressionSlackMessage(
  workspace: WatchlistWorkspace,
  regressions: WorkspaceAuditItemOutcome[],
  recoveries: WorkspaceAuditItemOutcome[],
  appOrigin: string
): string {
  const lines: string[] = [];

  if (regressions.length > 0) {
    const totalWaste = regressions.reduce((sum, r) => sum + r.dailyWaste, 0);
    lines.push(
      `:rotating_light: *OfferParity Hourly Monitor — ${regressions.length} New Offer Break${regressions.length === 1 ? "" : "s"} (${workspace.brandName})*`
    );
    lines.push(
      `Estimated at-risk spend: *$${totalWaste.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/day*`
    );
    lines.push("");

    for (const r of regressions) {
      const xrayUrl = `${appOrigin}/?url=${encodeURIComponent(r.landingPageUrl)}&ad=${encodeURIComponent(r.adName)}&budget=500`;
      lines.push(
        `• *[FAIL]* ${r.adName} ($${r.dailyWaste.toFixed(0)}/day) — ${r.failureSummary ?? "Confirmed offer break"}\n  <${r.landingPageUrl}|Landing Page> · <${xrayUrl}|Open X-Ray>`
      );
    }
  }

  if (recoveries.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `:large_green_circle: *Recovered (${workspace.brandName}):* ${recoveries.map((r) => r.adName).join(", ")}`
    );
  }

  return lines.join("\n");
}

export async function runWorkspaceWatchlistAudit(
  workspace: WatchlistWorkspace,
  options?: {
    fetchImpl?: typeof fetch;
    lookupFn?: DnsLookupFn;
    appOrigin?: string;
    sendSlackAlerts?: boolean;
  }
): Promise<WorkspaceAuditSummary> {
  const items = (await getWorkspaceItems(workspace.id)).filter(
    (item) => item.enabled
  );
  const fetchImpl = options?.fetchImpl ?? fetch;
  const appOrigin =
    options?.appOrigin ??
    (process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
      "https://offerparity.vercel.app");

  const outcomes: WorkspaceAuditItemOutcome[] = [];

  for (let i = 0; i < items.length; i += MONITOR_CONCURRENCY) {
    const slice = items.slice(i, i + MONITOR_CONCURRENCY);
    const batch = await Promise.all(
      slice.map(async (item): Promise<WorkspaceAuditItemOutcome> => {
        const checkedAt = new Date().toISOString();
        try {
          const report = await runSingleXRay(
            {
              adCopy: item.adCopy,
              landingPageUrl: item.landingPageUrl,
              dailyBudget: item.dailyBudget,
            },
            {
              fetchImpl: options?.fetchImpl,
              lookupFn: options?.lookupFn,
            }
          );

          const isFail = report.overallStatus === "FAIL";
          const nextConsecutiveFailures = isFail
            ? item.consecutiveFailures + 1
            : 0;
          const transient5xx = isTransient5xxFailure(report);

          // Confirmed non-5xx breaks alert immediately on transition to FAIL;
          // transient 5xx responses require 2 consecutive hourly failures (damping).
          const meetsFailureThreshold =
            isFail && (!transient5xx || nextConsecutiveFailures >= 2);
          const regressionTriggered =
            meetsFailureThreshold &&
            (item.lastStatus !== "FAIL" || item.lastAlertedAt === null);
          const recovered = item.lastStatus === "FAIL" && !isFail;
          const failureSummary = summarizeFailure(report);

          await updateWatchlistItemStatus(workspace.id, item.id, {
            lastStatus: report.overallStatus,
            lastHttpStatus: report.storefront.httpStatus,
            lastDailyWaste: report.waste.estimatedDailyWaste,
            lastFailureSummary: failureSummary,
            consecutiveFailures: nextConsecutiveFailures,
            lastCheckedAt: checkedAt,
            ...(regressionTriggered
              ? { lastAlertedAt: checkedAt }
              : recovered
                ? { lastAlertedAt: null }
                : {}),
          });

          return {
            itemId: item.id,
            adName: item.adName,
            landingPageUrl: item.landingPageUrl,
            previousStatus: item.lastStatus,
            currentStatus: report.overallStatus,
            dailyWaste: report.waste.estimatedDailyWaste,
            regressionTriggered,
            recovered,
            failureSummary,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Watchlist audit error";
          console.warn(
            `[OfferParity] Watchlist check failed for item ${item.id}:`,
            message
          );
          return {
            itemId: item.id,
            adName: item.adName,
            landingPageUrl: item.landingPageUrl,
            previousStatus: item.lastStatus,
            currentStatus: "WARN",
            dailyWaste: 0,
            regressionTriggered: false,
            recovered: false,
            failureSummary: message,
          };
        }
      })
    );
    outcomes.push(...batch);
  }

  const regressions = outcomes.filter((o) => o.regressionTriggered);
  const recoveries = outcomes.filter((o) => o.recovered);

  let slackAlertSent = false;
  if (
    options?.sendSlackAlerts !== false &&
    workspace.slackWebhookUrl &&
    (regressions.length > 0 || recoveries.length > 0)
  ) {
    const text = buildRegressionSlackMessage(
      workspace,
      regressions,
      recoveries,
      appOrigin
    );
    slackAlertSent = await postSlackWebhook(
      workspace.slackWebhookUrl,
      text,
      fetchImpl
    );
  }

  return {
    workspaceId: workspace.id,
    brandName: workspace.brandName,
    checkedCount: outcomes.length,
    failCount: outcomes.filter((o) => o.currentStatus === "FAIL").length,
    warnCount: outcomes.filter(
      (o) =>
        o.currentStatus === "WARN" ||
        o.currentStatus === "WAF_CHALLENGE_MANUAL_CHECK"
    ).length,
    passCount: outcomes.filter((o) => o.currentStatus === "PASS").length,
    regressionCount: regressions.length,
    recoveryCount: recoveries.length,
    slackAlertSent,
    totalDailyWaste: outcomes.reduce((sum, o) => sum + o.dailyWaste, 0),
    outcomes,
  };
}

export async function runAllActiveWorkspacesAudit(options?: {
  executionId?: string;
  fetchImpl?: typeof fetch;
  lookupFn?: DnsLookupFn;
}): Promise<{
  skippedDuplicate: boolean;
  workspacesAudited: number;
  summaries: WorkspaceAuditSummary[];
}> {
  if (options?.executionId) {
    const claimed = await claimScheduleExecution(options.executionId);
    if (!claimed) {
      return {
        skippedDuplicate: true,
        workspacesAudited: 0,
        summaries: [],
      };
    }
  }

  const workspaces = await listActiveWorkspaces();
  const summaries: WorkspaceAuditSummary[] = [];

  for (const ws of workspaces) {
    const summary = await runWorkspaceWatchlistAudit(ws, {
      fetchImpl: options?.fetchImpl,
      lookupFn: options?.lookupFn,
      sendSlackAlerts: true,
    });
    summaries.push(summary);
  }

  return {
    skippedDuplicate: false,
    workspacesAudited: summaries.length,
    summaries,
  };
}
