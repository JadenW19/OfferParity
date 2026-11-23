import { NextResponse } from "next/server";
import {
  BatchXRayRequestSchema,
  BatchXRayResponseSchema,
  type BatchXRayItemInput,
  type BatchXRayItemResult,
} from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";
import { SsrfBlockedError } from "@/lib/verifier/ssrfGuard";
import { buildBatchSlackDigest, runSingleXRay } from "@/lib/xrayRunner";

const BATCH_RATE_LIMIT_RPM = 6;
const BATCH_CONCURRENCY = 4;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current]!, current);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function auditBatchItem(
  item: BatchXRayItemInput,
  index: number
): Promise<BatchXRayItemResult> {
  const adName = item.adName?.trim() || `Ad #${index + 1}`;
  try {
    const report = await runSingleXRay({
      adCopy: item.adCopy,
      landingPageUrl: item.landingPageUrl,
      dailyBudget: item.dailyBudget,
      ...(item.fixtureId ? { fixtureId: item.fixtureId } : {}),
    });
    return {
      index,
      adName,
      ok: true,
      report,
      error: null,
      errorCode: null,
    };
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        index,
        adName,
        ok: false,
        report: null,
        error: err.message,
        errorCode: err.code,
      };
    }

    const message = err instanceof Error ? err.message : "Failed to verify ad row";
    console.warn(`[OfferParity] Batch item #${index + 1} (${adName}) failed:`, message);
    return {
      index,
      adName,
      ok: false,
      report: null,
      error: message,
      errorCode: "ITEM_AUDIT_ERROR",
    };
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = performance.now();
  const ip = getClientIp(req);
  const limit = checkRateLimit(`xray-batch:${ip}`, BATCH_RATE_LIMIT_RPM);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Batch rate limit exceeded (${limit.limit} batches/min). Retry in ${limit.retryAfterSeconds}s.`,
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(limit.retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (parseErr) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/xray/batch:",
      parseErr instanceof Error ? parseErr.message : "invalid json"
    );
    return NextResponse.json(
      {
        error: "Malformed JSON request body",
        code: "INVALID_JSON",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = BatchXRayRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed for batch X-Ray request",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join(".") || "body",
          message: issue.message,
        })),
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const results = await mapWithConcurrency(
    parsed.data.items,
    BATCH_CONCURRENCY,
    auditBatchItem
  );

  let succeededCount = 0;
  let errorCount = 0;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let wafCount = 0;
  let totalDailyBudget = 0;
  let totalDailyWaste = 0;
  let totalMonthlyWaste = 0;
  let totalAtRiskDailySpend = 0;

  for (const row of results) {
    if (!row.ok || !row.report) {
      errorCount += 1;
      continue;
    }
    succeededCount += 1;
    totalDailyBudget += row.report.request.dailyBudget;
    totalDailyWaste += row.report.waste.estimatedDailyWaste;
    totalMonthlyWaste += row.report.waste.projectedMonthlyWaste;
    totalAtRiskDailySpend += row.report.waste.atRiskDailySpend;

    if (row.report.overallStatus === "PASS") passCount += 1;
    else if (row.report.overallStatus === "WARN") warnCount += 1;
    else if (row.report.overallStatus === "FAIL") failCount += 1;
    else if (row.report.overallStatus === "WAF_CHALLENGE_MANUAL_CHECK") wafCount += 1;
  }

  const summary = {
    totalRows: results.length,
    succeededCount,
    errorCount,
    passCount,
    warnCount,
    failCount,
    wafCount,
    totalDailyBudget: roundCurrency(totalDailyBudget),
    totalDailyWaste: roundCurrency(totalDailyWaste),
    totalMonthlyWaste: roundCurrency(totalMonthlyWaste),
    totalAtRiskDailySpend: roundCurrency(totalAtRiskDailySpend),
  };

  const slackDigest = buildBatchSlackDigest(summary, results);
  const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);

  const responsePayload = BatchXRayResponseSchema.parse({
    summary,
    results,
    slackDigest,
    generatedAt: new Date().toISOString(),
    durationMs,
  });

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "X-RateLimit-Remaining": String(limit.remaining),
    },
  });
}
