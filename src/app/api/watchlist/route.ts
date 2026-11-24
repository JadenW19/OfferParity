import { NextResponse } from "next/server";
import { z } from "zod";
import { runWorkspaceWatchlistAudit } from "@/lib/monitor/hourlyRunner";
import { parseCampaignCsv } from "@/lib/parser/csvCampaignParser";
import {
  CreatePilotWorkspaceSchema,
  SLACK_WEBHOOK_PREFIX,
  WatchlistItemInputSchema,
} from "@/lib/schemas";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";
import {
  addWatchlistItems,
  createPilotWorkspace,
  getWorkspaceByToken,
  getWorkspaceItems,
  isPersistentWatchlistStoreConfigured,
  removeWatchlistItem,
  toPublicWorkspaceView,
  updateWorkspaceSettings,
} from "@/lib/storage/watchlistStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const WATCHLIST_RATE_LIMIT_RPM = 30;

const UpdateSettingsSchema = z.object({
  action: z.literal("update_settings"),
  token: z.string().trim().min(16),
  brandName: z.string().trim().min(1).max(120).optional(),
  slackWebhookUrl: z
    .string()
    .trim()
    .refine(
      (u) => u === "" || u.startsWith(SLACK_WEBHOOK_PREFIX),
      `Slack webhook URL must start with ${SLACK_WEBHOOK_PREFIX}`
    )
    .optional(),
});

const AddItemsSchema = z.object({
  action: z.literal("add_items"),
  token: z.string().trim().min(16),
  items: z.array(WatchlistItemInputSchema).min(1).max(250),
});

const ImportCsvSchema = z.object({
  action: z.literal("import_csv"),
  token: z.string().trim().min(16),
  csvText: z.string().trim().min(5).max(200_000),
});

const RemoveItemSchema = z.object({
  action: z.literal("remove_item"),
  token: z.string().trim().min(16),
  itemId: z.string().trim().min(1),
});

const RunNowSchema = z.object({
  action: z.literal("run_now"),
  token: z.string().trim().min(16),
  sendSlackAlerts: z.boolean().default(true),
});

const WatchlistPostSchema = z.discriminatedUnion("action", [
  CreatePilotWorkspaceSchema,
  UpdateSettingsSchema,
  AddItemsSchema,
  ImportCsvSchema,
  RemoveItemSchema,
  RunNowSchema,
]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json(
      {
        error: "Provide a workspace token query parameter.",
        code: "MISSING_TOKEN",
        persistentStore: isPersistentWatchlistStoreConfigured(),
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const workspace = await getWorkspaceByToken(token);
  if (!workspace) {
    return NextResponse.json(
      { error: "Watchlist workspace not found.", code: "NOT_FOUND" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  const items = await getWorkspaceItems(workspace.id);
  return NextResponse.json(
    {
      ok: true,
      persistentStore: isPersistentWatchlistStoreConfigured(),
      workspace: toPublicWorkspaceView(workspace, items),
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`watchlist:${ip}`, WATCHLIST_RATE_LIMIT_RPM);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Watchlist rate limit exceeded (${limit.limit}/min). Retry in ${limit.retryAfterSeconds}s.`,
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
  } catch (err) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/watchlist:",
      err instanceof Error ? err.message : "invalid json"
    );
    return NextResponse.json(
      { error: "Malformed JSON request body", code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = WatchlistPostSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid watchlist request",
        code: "VALIDATION_ERROR",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const payload = parsed.data;

  try {
    if (payload.action === "create_pilot") {
      const workspace = await createPilotWorkspace({
        email: payload.email,
        brandName: payload.brandName,
        slackWebhookUrl: payload.slackWebhookUrl,
      });
      return NextResponse.json(
        {
          ok: true,
          managementToken: workspace.managementToken,
          persistentStore: isPersistentWatchlistStoreConfigured(),
          workspace: toPublicWorkspaceView(workspace, []),
        },
        { status: 201, headers: NO_STORE_HEADERS }
      );
    }

    if (payload.action === "update_settings") {
      const updated = await updateWorkspaceSettings(payload.token, {
        brandName: payload.brandName,
        slackWebhookUrl:
          payload.slackWebhookUrl === undefined
            ? undefined
            : payload.slackWebhookUrl === ""
              ? null
              : payload.slackWebhookUrl,
      });
      if (!updated) {
        return NextResponse.json(
          { error: "Watchlist workspace not found.", code: "NOT_FOUND" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }
      const items = await getWorkspaceItems(updated.id);
      return NextResponse.json(
        { ok: true, workspace: toPublicWorkspaceView(updated, items) },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (payload.action === "add_items") {
      const result = await addWatchlistItems(payload.token, payload.items);
      return NextResponse.json(
        {
          ok: true,
          addedCount: result.addedCount,
          workspace: toPublicWorkspaceView(result.workspace, result.items),
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (payload.action === "import_csv") {
      const csvParsed = parseCampaignCsv(payload.csvText);
      if (csvParsed.items.length === 0) {
        return NextResponse.json(
          {
            error:
              csvParsed.errors[0] ??
              "No valid rows found in CSV (need ad_name, ad_copy, landing_page_url, daily_budget).",
            code: "CSV_EMPTY",
          },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const result = await addWatchlistItems(
        payload.token,
        csvParsed.items.map((row, idx) => ({
          adName: row.adName?.trim() || `Ad #${idx + 1}`,
          adCopy: row.adCopy,
          landingPageUrl: row.landingPageUrl,
          dailyBudget: row.dailyBudget,
        }))
      );
      return NextResponse.json(
        {
          ok: true,
          addedCount: result.addedCount,
          csvErrors: csvParsed.errors,
          workspace: toPublicWorkspaceView(result.workspace, result.items),
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (payload.action === "remove_item") {
      const result = await removeWatchlistItem(payload.token, payload.itemId);
      if (!result) {
        return NextResponse.json(
          { error: "Watchlist workspace not found.", code: "NOT_FOUND" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }
      return NextResponse.json(
        {
          ok: true,
          workspace: toPublicWorkspaceView(result.workspace, result.items),
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // payload.action === "run_now"
    const workspace = await getWorkspaceByToken(payload.token);
    if (!workspace) {
      return NextResponse.json(
        { error: "Watchlist workspace not found.", code: "NOT_FOUND" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const summary = await runWorkspaceWatchlistAudit(workspace, {
      sendSlackAlerts: payload.sendSlackAlerts,
    });
    const refreshedItems = await getWorkspaceItems(workspace.id);
    return NextResponse.json(
      {
        ok: true,
        summary,
        workspace: toPublicWorkspaceView(workspace, refreshedItems),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Watchlist error";
    if (message === "WORKSPACE_NOT_FOUND") {
      return NextResponse.json(
        { error: "Watchlist workspace not found.", code: "NOT_FOUND" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    if (message === "WATCHLIST_LIMIT_REACHED") {
      return NextResponse.json(
        {
          error: "Watchlist item limit reached for your current plan.",
          code: "PLAN_LIMIT_REACHED",
        },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }
    console.error("[OfferParity] POST /api/watchlist failed:", message);
    return NextResponse.json(
      { error: "Failed to process watchlist request.", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
