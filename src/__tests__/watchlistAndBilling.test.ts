import { beforeEach, describe, expect, it } from "vitest";
import { POST as billingPortalPost } from "@/app/api/billing/portal/route";
import { POST as billingWebhookPost } from "@/app/api/billing/webhook/route";
import { GET as watchlistGet, POST as watchlistPost } from "@/app/api/watchlist/route";
import {
  runAllActiveWorkspacesAudit,
  runWorkspaceWatchlistAudit,
} from "@/lib/monitor/hourlyRunner";
import {
  addWatchlistItems,
  createPilotWorkspace,
  provisionPaidWorkspace,
  resetInMemoryWatchlistStore,
} from "@/lib/storage/watchlistStore";
import type { DnsLookupFn } from "@/lib/verifier/ssrfGuard";

const mockPublicDns: DnsLookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("Watchlist Store, Hourly Regression Runner & Billing Routes (Option 2)", () => {
  beforeEach(() => {
    resetInMemoryWatchlistStore();
  });

  it("creates a pilot workspace, masks Slack webhook URLs, and runs regression-only alerts + recovery", async () => {
    const slackDeliveries: string[] = [];
    const currentProductStatus = 200;
    let currentAvailable = true;

    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url.startsWith("https://hooks.slack.com/services/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        if (body.text) slackDeliveries.push(body.text);
        return new Response("ok", { status: 200 });
      }

      if (url.endsWith(".js")) {
        return new Response(
          JSON.stringify({
            title: "Storm Puffer",
            price: 11830,
            available: currentAvailable,
            variants: [
              { id: 1, title: "M", price: 11830, available: currentAvailable },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (currentProductStatus >= 400) {
        return new Response("Not Found", { status: currentProductStatus });
      }

      return new Response(
        `<!doctype html><html><head><title>Storm Puffer</title><meta property="og:price:currency" content="GBP" /></head><body></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const ws = await createPilotWorkspace({
      email: "growth@tala.example.com",
      brandName: "WE ARE TALA",
      slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/SECRET1234",
    });

    await addWatchlistItems(ws.managementToken, [
      {
        adName: "Storm Puffer UK",
        adCopy: "Fan favourite returns better than ever.",
        landingPageUrl:
          "https://tala.example.com/products/storm-puffer?utm_source=meta&utm_medium=paid_social&utm_campaign=winter",
        dailyBudget: 500,
      },
    ]);

    // 1. Initial healthy run -> PASS, 0 Slack alerts
    const run1 = await runWorkspaceWatchlistAudit(ws, {
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(run1.passCount).toBe(1);
    expect(run1.regressionCount).toBe(0);
    expect(slackDeliveries).toHaveLength(0);

    // 2. Product goes OOS -> FAIL regression triggers 1 Slack alert
    currentAvailable = false;
    const run2 = await runWorkspaceWatchlistAudit(ws, {
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(run2.failCount).toBe(1);
    expect(run2.regressionCount).toBe(1);
    expect(run2.slackAlertSent).toBe(true);
    expect(slackDeliveries).toHaveLength(1);
    expect(slackDeliveries[0]).toContain("New Offer Break");

    // 3. Steady-state FAIL on next hour -> NO duplicate Slack alert
    const run3 = await runWorkspaceWatchlistAudit(ws, {
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(run3.failCount).toBe(1);
    expect(run3.regressionCount).toBe(0);
    expect(slackDeliveries).toHaveLength(1);

    // 4. Product restocks -> Recovery Slack alert sent
    currentAvailable = true;
    const run4 = await runWorkspaceWatchlistAudit(ws, {
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(run4.passCount).toBe(1);
    expect(run4.recoveryCount).toBe(1);
    expect(slackDeliveries).toHaveLength(2);
    expect(slackDeliveries[1]).toContain("Recovered");
  });

  it("applies transient 5xx damping (requires 2 consecutive hourly failures) and executionId idempotency", async () => {
    const slackDeliveries: string[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://hooks.slack.com/services/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        if (body.text) slackDeliveries.push(body.text);
        return new Response("ok", { status: 200 });
      }
      return new Response("Bad Gateway", { status: 502 });
    };

    const ws = await provisionPaidWorkspace({
      email: "agency@nest.example.com",
      brandName: "Nest Agency",
      plan: "agency",
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_123",
      stripeCheckoutSessionId: "cs_test_123",
    });

    await addWatchlistItems(ws.managementToken, [
      {
        adName: "Hero Ad",
        adCopy: "Shop our best-selling serum for $28.",
        landingPageUrl: "https://shop.example.com/products/serum",
        dailyBudget: 400,
      },
    ]);

    // Update Slack webhook via API route
    const updateRes = await watchlistPost(
      new Request("http://localhost:3000/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          token: ws.managementToken,
          slackWebhookUrl:
            "https://hooks.slack.com/services/T111/B111/SECRET9999",
        }),
      })
    );
    expect(updateRes.status).toBe(200);
    const updateJson = (await updateRes.json()) as {
      workspace: { slackWebhookMasked: string; slackWebhookUrl?: string };
    };
    expect(updateJson.workspace.slackWebhookUrl).toBeUndefined();
    expect(updateJson.workspace.slackWebhookMasked).toContain("...");

    // Run 1 (502): damped, no Slack alert yet
    const exec1 = await runAllActiveWorkspacesAudit({
      executionId: "exec-hour-1",
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(exec1.skippedDuplicate).toBe(false);
    expect(exec1.summaries[0]?.regressionCount).toBe(0);
    expect(slackDeliveries).toHaveLength(0);

    // Duplicate executionId is skipped cleanly
    const execDup = await runAllActiveWorkspacesAudit({
      executionId: "exec-hour-1",
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(execDup.skippedDuplicate).toBe(true);

    // Run 2 (second consecutive 502): triggers Slack alert
    const exec2 = await runAllActiveWorkspacesAudit({
      executionId: "exec-hour-2",
      fetchImpl: mockFetch,
      lookupFn: mockPublicDns,
    });
    expect(exec2.summaries[0]?.regressionCount).toBe(1);
    expect(slackDeliveries).toHaveLength(1);
  });

  it("handles watchlist API CSV import, GET lookup, and billing route validation cleanly", async () => {
    const createRes = await watchlistPost(
      new Request("http://localhost:3000/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_pilot",
          email: "team@brand.example.com",
          brandName: "Brand Co",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { managementToken: string };

    const csvRes = await watchlistPost(
      new Request("http://localhost:3000/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_csv",
          token: created.managementToken,
          csvText: `ad_name,ad_copy,landing_page_url,daily_budget\n"Ad 1","Save 20% with SAVE20","https://brand.example.com/products/a",300`,
        }),
      })
    );
    expect(csvRes.status).toBe(200);
    const csvJson = (await csvRes.json()) as { addedCount: number };
    expect(csvJson.addedCount).toBe(1);

    const getRes = await watchlistGet(
      new Request(
        `http://localhost:3000/api/watchlist?token=${encodeURIComponent(created.managementToken)}`
      )
    );
    expect(getRes.status).toBe(200);

    const webhookRes = await billingWebhookPost(
      new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        body: "{}",
      })
    );
    expect([400, 503]).toContain(webhookRes.status);

    const portalRes = await billingPortalPost(
      new Request("http://localhost:3000/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceToken: created.managementToken }),
      })
    );
    expect([404, 503]).toContain(portalRes.status);
  });
});
