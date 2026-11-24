import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postBillingCheckout } from "@/app/api/billing/checkout/route";
import { POST as postLead } from "@/app/api/leads/route";
import { POST as postXray } from "@/app/api/xray/route";
import BotPage from "@/app/bot/page";
import HomePage from "@/app/page";
import PricingPage from "@/app/pricing/page";
import { BILLING_PLANS, resolveStripePriceId } from "@/lib/billing/plans";
import { resetRateLimiterForTests } from "@/lib/security/rateLimiter";

afterEach(() => {
  cleanup();
  resetRateLimiterForTests();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("POST /api/leads", () => {
  it("rejects malformed JSON and invalid emails with structured 400 errors", async () => {
    const badJson = await postLead(
      new Request("http://localhost:3000/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      })
    );
    expect(badJson.status).toBe(400);
    expect(badJson.headers.get("cache-control")).toBe("no-store");
    const badJsonBody = (await badJson.json()) as { code: string };
    expect(badJsonBody.code).toBe("INVALID_JSON");

    const badEmail = await postLead(
      new Request("http://localhost:3000/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "not-an-email",
          planInterest: "growth",
          sourceCta: "waste_banner_monitor_cta",
        }),
      })
    );
    expect(badEmail.status).toBe(400);
    const badEmailBody = (await badEmail.json()) as { code: string };
    expect(badEmailBody.code).toBe("VALIDATION_ERROR");
  });

  it("accepts valid lead payloads and forwards to LEAD_ALERT_SLACK_WEBHOOK_URL when configured", async () => {
    vi.stubEnv(
      "LEAD_ALERT_SLACK_WEBHOOK_URL",
      "https://hooks.slack.com/services/T111/B222/LEAD"
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await postLead(
      new Request("http://localhost:3000/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "buyer@ridgewoodmedia.com",
          companyName: "Ridgewood Media",
          scannedUrl: "https://demo.offerparity.app/products/merino-hoodie",
          dailyBudget: 850,
          dailyWaste: 722.5,
          verdict: "FAIL",
          planInterest: "agency",
          sourceCta: "waste_banner_monitor_cta",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      notifiedSlack: boolean;
      planInterest: string;
    };
    expect(body.ok).toBe(true);
    expect(body.notifiedSlack).toBe(true);
    expect(body.planInterest).toBe("agency");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
  });
});

describe("Non-Blocking Conversion CTA & Commercial Pages", () => {
  it("opens MonitorCtaModal from WasteSummaryBanner, clears stale errors on edit, and submits a lead", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/api/xray") {
        return postXray(
          new Request("http://localhost:3000/api/xray", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: init?.body,
          })
        );
      }
      if (url === "/api/leads") {
        return postLead(
          new Request("http://localhost:3000/api/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: init?.body,
          })
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<HomePage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Out-of-Stock Variant & Price Mismatch/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("FAIL");
    });

    const ctaButton = screen.getByRole("button", {
      name: /Monitor this URL hourly in Slack/i,
    });
    fireEvent.click(ctaButton);

    expect(
      screen.getByRole("dialog", { name: /Monitor Offers Hourly in Slack/i })
    ).toBeInTheDocument();

    // Trigger inline validation error, then verify editing email clears it
    fireEvent.click(
      screen.getByRole("button", { name: /Request Hourly Slack Alerts/i })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Enter a valid work email address/i
    );

    const emailInput = screen.getByLabelText(/Work Email/i);
    fireEvent.change(emailInput, { target: { value: "growth@brand.com" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Request Hourly Slack Alerts/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId("monitor-cta-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("monitor-cta-success")).toHaveTextContent(
      "growth@brand.com"
    );
  });

  it("renders Pricing and OfferParityBot allowlist pages cleanly", () => {
    render(<PricingPage />);
    expect(
      screen.getByRole("heading", {
        name: /Stop Paying for Clicks to Broken Offers/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText("$99")).toBeInTheDocument();
    expect(screen.getByText("$249")).toBeInTheDocument();

    cleanup();
    render(<BotPage />);
    expect(
      screen.getByRole("heading", {
        name: /OfferParityBot\/1\.0 Verification Guide/i,
      })
    ).toBeInTheDocument();
  });
});

describe("POST /api/billing/checkout", () => {
  it("resolves Growth and Agency Stripe Price IDs and returns 503 when STRIPE_SECRET_KEY is unset", async () => {
    expect(BILLING_PLANS.growth.priceUsd).toBe(99);
    expect(BILLING_PLANS.agency.priceUsd).toBe(249);
    expect(resolveStripePriceId("growth")).toBe("price_1Uf6O4EtiOWkP8V8hjojfta9");
    expect(resolveStripePriceId("agency")).toBe("price_1Uf6OBEtiOWkP8V8KvQCd9yh");

    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await postBillingCheckout(
      new Request("http://localhost:3000/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "growth" }),
      })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("STRIPE_NOT_CONFIGURED");
    vi.unstubAllEnvs();
  });
});
