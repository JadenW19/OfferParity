import { NextResponse } from "next/server";
import {
  LeadCaptureRequestSchema,
  SLACK_WEBHOOK_PREFIX,
  type LeadCaptureRequest,
} from "@/lib/schemas";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";

export const dynamic = "force-dynamic";

const LEADS_RATE_LIMIT_RPM = 10;
const SLACK_TIMEOUT_MS = 5000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function getLeadAlertWebhookUrl(): string | null {
  const dedicated = process.env.LEAD_ALERT_SLACK_WEBHOOK_URL?.trim();
  if (dedicated && dedicated.startsWith(SLACK_WEBHOOK_PREFIX)) {
    return dedicated;
  }
  const fallback = process.env.SLACK_WEBHOOK_URL?.trim();
  if (fallback && fallback.startsWith(SLACK_WEBHOOK_PREFIX)) {
    return fallback;
  }
  return null;
}

function buildLeadSlackMessage(lead: LeadCaptureRequest): string {
  const planLabel =
    lead.planInterest === "agency" ? "Agency ($249/mo)" : "Growth ($99/mo)";
  const lines = [
    `:sparkles: *New OfferParity Hourly Monitoring Request*`,
    `*Email:* ${lead.email}`,
    `*Plan Interest:* ${planLabel}`,
    `*Source CTA:* \`${lead.sourceCta}\``,
  ];

  if (lead.companyName) {
    lines.push(`*Company / Agency:* ${lead.companyName}`);
  }
  if (lead.scannedUrl) {
    lines.push(`*Scanned URL:* ${lead.scannedUrl}`);
  }
  if (lead.verdict) {
    const wasteStr =
      typeof lead.dailyWaste === "number"
        ? ` ($${lead.dailyWaste.toFixed(2)}/day est. waste)`
        : "";
    lines.push(`*Detected Verdict:* ${lead.verdict}${wasteStr}`);
  }
  if (lead.notes) {
    lines.push(`*Notes:* ${lead.notes}`);
  }

  return lines.join("\n");
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`leads:${ip}`, LEADS_RATE_LIMIT_RPM);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many requests (${limit.limit}/min). Retry in ${limit.retryAfterSeconds}s.`,
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(limit.retryAfterSeconds),
        },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (parseErr) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/leads:",
      parseErr instanceof Error ? parseErr.message : "invalid json"
    );
    return NextResponse.json(
      { error: "Malformed JSON request body", code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = LeadCaptureRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Invalid monitoring request payload",
        code: "VALIDATION_ERROR",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const lead = parsed.data;
  const webhookUrl = getLeadAlertWebhookUrl();
  let notifiedSlack = false;

  if (webhookUrl) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

    try {
      const slackRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: buildLeadSlackMessage(lead) }),
        redirect: "error",
        signal: controller.signal,
      });

      if (!slackRes.ok) {
        console.warn(
          `[OfferParity] Lead Slack notification failed with HTTP ${slackRes.status}`
        );
      } else {
        notifiedSlack = true;
      }
    } catch (err) {
      console.warn(
        "[OfferParity] Lead Slack notification error:",
        err instanceof Error ? err.message : "network error"
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  } else {
    console.info(
      `[OfferParity] Lead captured (no Slack webhook configured): ${lead.email} [${lead.planInterest}]`
    );
  }

  return NextResponse.json(
    {
      ok: true,
      receivedAt: new Date().toISOString(),
      notifiedSlack,
      planInterest: lead.planInterest,
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}
