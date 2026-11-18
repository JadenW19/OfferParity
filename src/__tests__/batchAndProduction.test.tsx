import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getSlackConfig, POST as postSlackAlert } from "@/app/api/alerts/slack/route";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postXray } from "@/app/api/xray/route";
import { POST as postBatchXray } from "@/app/api/xray/batch/route";
import HomePage from "@/app/page";
import {
  SAMPLE_AGENCY_CAMPAIGN_CSV,
  parseCampaignCsv,
  serializeBatchAuditCsv,
  tokenizeCsvRows,
} from "@/lib/parser/csvCampaignParser";
import { BatchXRayResponseSchema, MAX_BATCH_ITEMS } from "@/lib/schemas";
import { checkRateLimit, resetRateLimiterForTests } from "@/lib/security/rateLimiter";

afterEach(() => {
  cleanup();
  resetRateLimiterForTests();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Campaign CSV Parser & Exporter", () => {
  it("parses RFC-4180 multiline quoted ad copy, escaped quotes, and currency-formatted budgets", () => {
    const multilineCsv = `ad_name,ad_copy,landing_page_url,daily_budget
"BFCM ""Hero"" Video","Line 1: Lumina 32oz Bottle
Line 2: Now $36.00 with code HYDRATE20","https://demo.offerparity.app/products/lumina-32oz-bottle?utm_source=meta&utm_medium=paid_social&utm_campaign=bfcm","$1,250.00"`;

    const rows = tokenizeCsvRows(multilineCsv);
    expect(rows).toHaveLength(2);

    const parsed = parseCampaignCsv(multilineCsv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.adName).toBe('BFCM "Hero" Video');
    expect(parsed.items[0]?.adCopy).toContain("Line 1: Lumina 32oz Bottle\nLine 2:");
    expect(parsed.items[0]?.dailyBudget).toBe(1250);
  });

  it("parses the 4-row sample BFCM agency campaign cleanly and rejects missing headers or >25 rows", () => {
    const sampleParsed = parseCampaignCsv(SAMPLE_AGENCY_CAMPAIGN_CSV);
    expect(sampleParsed.errors).toEqual([]);
    expect(sampleParsed.items).toHaveLength(4);

    const missingHeader = parseCampaignCsv("ad_name,ad_copy\nTest,Hello world $20");
    expect(missingHeader.errors[0]).toContain("Missing required CSV header column(s)");

    const tooManyRows = [
      "ad_name,ad_copy,landing_page_url,daily_budget",
      ...Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) =>
        `"Ad ${i + 1}","Valid copy $${20 + i}","https://example.com/products/p-${i}",100`
      ),
    ].join("\n");
    const overCap = parseCampaignCsv(tooManyRows);
    expect(overCap.errors[0]).toContain(`maximum batch size of ${MAX_BATCH_ITEMS}`);
  });
});

describe("Production API Routes (/api/xray/batch, /api/alerts/slack, /api/health, rateLimiter)", () => {
  it("runs POST /api/xray/batch concurrently and isolates per-row SSRF errors without failing the batch", async () => {
    const sample = parseCampaignCsv(SAMPLE_AGENCY_CAMPAIGN_CSV);
    const itemsWithUnsafeRow = [
      ...sample.items,
      {
        adName: "Unsafe Loopback Ad",
        adCopy: "Internal test product $25 today",
        landingPageUrl: "http://127.0.0.1/admin",
        dailyBudget: 500,
      },
    ];

    const res = await postBatchXray(
      new Request("http://localhost:3000/api/xray/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsWithUnsafeRow }),
      })
    );

    expect(res.status).toBe(200);
    const payload = BatchXRayResponseSchema.parse(await res.json());
    expect(payload.summary.totalRows).toBe(5);
    expect(payload.summary.succeededCount).toBe(4);
    expect(payload.summary.errorCount).toBe(1);
    expect(payload.summary.passCount).toBe(1);
    expect(payload.summary.warnCount).toBe(1);
    expect(payload.summary.failCount).toBe(2);
    expect(payload.summary.totalDailyBudget).toBe(3050);
    // Row 2 ($903) + Row 3 ($722.50) = $1,625.50
    expect(payload.summary.totalDailyWaste).toBe(1625.5);

    const unsafeRow = payload.results[4];
    expect(unsafeRow?.ok).toBe(false);
    expect(unsafeRow?.errorCode).toBe("SSRF_BLOCKED");

    const exportedCsv = serializeBatchAuditCsv(payload);
    expect(exportedCsv).toContain("ad_name,overall_status,daily_budget_usd");
    expect(exportedCsv).toContain("Veloce Boots - BFCM Retargeting,FAIL,1200.00,903.00");
    expect(exportedCsv).toContain("Unsafe Loopback Ad,ERROR");
  });

  it("enforces strict https://hooks.slack.com/services/ allowlist and delivers Slack alerts", async () => {
    const cfgRes = await getSlackConfig();
    expect(cfgRes.status).toBe(200);

    // Reject non-Slack host (SSRF protection)
    const badHostRes = await postSlackAlert(
      new Request("http://localhost:3000/api/alerts/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "OfferParity burn-rate alert",
          webhookUrl: "https://evil.example.com/services/T000/B000/XXXX",
        }),
      })
    );
    expect(badHostRes.status).toBe(400);

    // Reject when neither body webhookUrl nor SLACK_WEBHOOK_URL env is present
    const missingWebhookRes = await postSlackAlert(
      new Request("http://localhost:3000/api/alerts/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "OfferParity burn-rate alert" }),
      })
    );
    expect(missingWebhookRes.status).toBe(400);
    const missingBody = (await missingWebhookRes.json()) as { code: string };
    expect(missingBody.code).toBe("WEBHOOK_NOT_CONFIGURED");

    // Deliver cleanly to mocked hooks.slack.com
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("invalid_token", { status: 403 }));

    const okRes = await postSlackAlert(
      new Request("http://localhost:3000/api/alerts/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "*OfferParity Alert* — $722.50/day waste",
          webhookUrl: "https://hooks.slack.com/services/T111/B222/C333",
        }),
      })
    );
    expect(okRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Upstream 403 maps to 502 SLACK_UPSTREAM_ERROR
    const upstreamFailRes = await postSlackAlert(
      new Request("http://localhost:3000/api/alerts/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "*OfferParity Alert* — $722.50/day waste",
          webhookUrl: "https://hooks.slack.com/services/T111/B222/C333",
        }),
      })
    );
    expect(upstreamFailRes.status).toBe(502);
  });

  it("enforces sliding-window per-IP rate limiting and exposes GET /api/health", async () => {
    const t0 = 1_700_000_000_000;
    expect(checkRateLimit("ip:1", 2, { nowMs: t0, forceEnableInTest: true }).allowed).toBe(true);
    expect(checkRateLimit("ip:1", 2, { nowMs: t0 + 100, forceEnableInTest: true }).allowed).toBe(
      true
    );
    const blocked = checkRateLimit("ip:1", 2, { nowMs: t0 + 200, forceEnableInTest: true });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Window slides forward past 60s
    expect(
      checkRateLimit("ip:1", 2, { nowMs: t0 + 61_000, forceEnableInTest: true }).allowed
    ).toBe(true);

    const healthRes = await getHealth();
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      status: string;
      deterministicOnly: boolean;
    };
    expect(healthJson.status).toBe("ok");
    expect(healthJson.deterministicOnly).toBe(true);
  });
});

describe("Batch CSV Mode, Shareable Permalinks, Recent Scans & Live Slack UI", () => {
  function mockAllApiRoutes() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/xray") {
        return postXray(
          new Request("http://localhost:3000/api/xray", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: init?.body,
          })
        );
      }
      if (url === "/api/xray/batch") {
        return postBatchXray(
          new Request("http://localhost:3000/api/xray/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: init?.body,
          })
        );
      }
      if (url === "/api/alerts/slack") {
        return new Response(JSON.stringify({ ok: true, deliveredAt: new Date().toISOString() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL in production UI test: ${url}`);
    });
  }

  it("runs a 4-ad Batch CSV Pre-Flight audit and drills into Single Ad X-Ray via Inspect Full X-Ray", async () => {
    mockAllApiRoutes();
    render(<HomePage />);

    fireEvent.click(screen.getByRole("button", { name: /Batch CSV Pre-Flight/i }));
    expect(
      screen.getByRole("heading", { name: /Campaign CSV Pre-Flight Audit/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Run Batch Audit/i }));

    await waitFor(() => {
      expect(screen.getByTestId("batch-audit-results")).toBeInTheDocument();
    });

    expect(screen.getByTestId("batch-total-budget")).toHaveTextContent("$3,050.00");
    expect(screen.getByTestId("batch-total-daily-waste")).toHaveTextContent("$1,625.50");

    // Drill into row 2 (Veloce Boots - Expired Promo = $903.00/day waste)
    const inspectButtons = screen.getAllByRole("button", { name: /Inspect Full X-Ray/i });
    expect(inspectButtons).toHaveLength(4);
    fireEvent.click(inspectButtons[1]!);

    await waitFor(() => {
      expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$903.00");
    });

    // Recent Scans bar now appears with the inspected scan
    expect(screen.getByLabelText("Recent X-Ray scans")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear History/i }));
    expect(screen.queryByLabelText("Recent X-Ray scans")).not.toBeInTheDocument();
  });

  it("hydrates shared ?url=&ad=&budget= query links and supports Shareable Link + Slack Webhook delivery", async () => {
    mockAllApiRoutes();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const params = new URLSearchParams({
      url: "https://demo.offerparity.app/products/lumina-32oz-bottle?variant=obsidian-black&utm_source=meta&utm_medium=paid_social&utm_campaign=q4_lumina_launch",
      ad: "Stay cold for 36 hours. Lumina 32oz Insulated Bottle in Obsidian Black — Now $36.00 (was $45.00, 20% OFF). Use code HYDRATE20 at checkout!",
      budget: "600",
      fixture: "healthy-offer",
    });
    window.history.replaceState({}, "", `/?${params.toString()}`);

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("PASS");
    });
    expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$0.00");

    // Copy Shareable Link
    fireEvent.click(screen.getByRole("button", { name: /Copy Shareable Link/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0]).toContain("url=https%3A%2F%2Fdemo.offerparity.app");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied shareable X-Ray link to clipboard!"
    );

    // Send to Slack Webhook inline bar
    fireEvent.click(screen.getByRole("button", { name: /Send to Slack Webhook/i }));
    const webhookInput = screen.getByLabelText(/Slack Incoming Webhook URL/i);
    fireEvent.change(webhookInput, {
      target: { value: "https://hooks.slack.com/services/T123/B456/XYZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send Alert/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Delivered burn-rate alert to Slack!");
    });
  });
});
