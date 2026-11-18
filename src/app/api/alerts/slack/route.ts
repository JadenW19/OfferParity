import { NextResponse } from "next/server";
import {
  SLACK_WEBHOOK_PREFIX,
  SlackWebhookRequestSchema,
} from "@/lib/schemas";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";

const SLACK_RATE_LIMIT_RPM = 10;
const SLACK_TIMEOUT_MS = 5000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function getDefaultSlackWebhookUrl(): string | null {
  const envUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!envUrl) return null;
  return envUrl.startsWith(SLACK_WEBHOOK_PREFIX) ? envUrl : null;
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      defaultWebhookConfigured: getDefaultSlackWebhookUrl() !== null,
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`slack-alert:${ip}`, SLACK_RATE_LIMIT_RPM);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Slack alert rate limit exceeded (${limit.limit}/min). Retry in ${limit.retryAfterSeconds}s.`,
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
      "[OfferParity] Malformed JSON on POST /api/alerts/slack:",
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

  const parsed = SlackWebhookRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Invalid Slack webhook request payload",
        code: "VALIDATION_ERROR",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const targetWebhook = parsed.data.webhookUrl ?? getDefaultSlackWebhookUrl();
  if (!targetWebhook) {
    return NextResponse.json(
      {
        error:
          "Provide a Slack Incoming Webhook URL (https://hooks.slack.com/services/...) or configure SLACK_WEBHOOK_URL on the server.",
        code: "WEBHOOK_NOT_CONFIGURED",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!targetWebhook.startsWith(SLACK_WEBHOOK_PREFIX)) {
    return NextResponse.json(
      {
        error: `Slack webhook URL must start with ${SLACK_WEBHOOK_PREFIX}`,
        code: "UNSAFE_WEBHOOK_HOST",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    const slackRes = await fetch(targetWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: parsed.data.text }),
      redirect: "error",
      signal: controller.signal,
    });

    if (!slackRes.ok) {
      console.warn(
        `[OfferParity] Slack webhook returned HTTP ${slackRes.status}`
      );
      return NextResponse.json(
        {
          error: `Slack webhook rejected payload with HTTP ${slackRes.status}`,
          code: "SLACK_UPSTREAM_ERROR",
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        deliveredAt: new Date().toISOString(),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Failed to reach hooks.slack.com";
    console.warn("[OfferParity] Slack webhook delivery failed:", reason);
    return NextResponse.json(
      {
        error: "Failed to deliver alert to Slack Incoming Webhook",
        code: "SLACK_NETWORK_ERROR",
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}
