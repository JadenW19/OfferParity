import "@testing-library/jest-dom/vitest";
import dns from "node:dns/promises";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/xray/route";
import HomePage from "@/app/page";
import { getDemoScenarioPreset } from "@/lib/fixtures/demoScenarios";
import { XRayReportSchema } from "@/lib/schemas";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeJsonPostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/xray", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/xray", () => {
  it("returns 400 on malformed JSON, invalid/non-HTTP URLs, empty ad copy, and negative budget", async () => {
    const malformedReq = new Request("http://localhost:3000/api/xray", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    const malformedRes = await POST(malformedReq);
    expect(malformedRes.status).toBe(400);
    expect(malformedRes.headers.get("cache-control")).toBe("no-store");
    const malformedData = (await malformedRes.json()) as { code: string };
    expect(malformedData.code).toBe("INVALID_JSON");

    const invalidUrlRes = await POST(
      makeJsonPostRequest({
        adCopy: "Valid ad copy for trail hoodie $50",
        landingPageUrl: "ftp://example.com/product",
        dailyBudget: 500,
      })
    );
    expect(invalidUrlRes.status).toBe(400);

    const malformedUrlRes = await POST(
      makeJsonPostRequest({
        adCopy: "Valid ad copy for trail hoodie $50",
        landingPageUrl: "not-a-valid-url",
        dailyBudget: 500,
      })
    );
    expect(malformedUrlRes.status).toBe(400);

    const emptyCopyRes = await POST(
      makeJsonPostRequest({
        adCopy: "   ",
        landingPageUrl: "https://example.com/product",
        dailyBudget: 500,
      })
    );
    expect(emptyCopyRes.status).toBe(400);

    const negativeBudgetRes = await POST(
      makeJsonPostRequest({
        adCopy: "Valid ad copy for trail hoodie $50",
        landingPageUrl: "https://example.com/product",
        dailyBudget: -10,
      })
    );
    expect(negativeBudgetRes.status).toBe(400);
  });

  it("returns 400 when SSRF guard blocks loopback or cloud metadata URLs", async () => {
    const loopbackRes = await POST(
      makeJsonPostRequest({
        adCopy: "Test product $45 today only",
        landingPageUrl: "http://127.0.0.1/admin",
        dailyBudget: 300,
      })
    );
    expect(loopbackRes.status).toBe(400);
    const loopbackJson = (await loopbackRes.json()) as { code: string; error: string };
    expect(loopbackJson.code).toBe("SSRF_BLOCKED");

    const metadataRes = await POST(
      makeJsonPostRequest({
        adCopy: "Test product $45 today only",
        landingPageUrl: "http://169.254.169.254/latest/meta-data/",
        dailyBudget: 300,
      })
    );
    expect(metadataRes.status).toBe(400);
    const metadataJson = (await metadataRes.json()) as { code: string };
    expect(metadataJson.code).toBe("SSRF_BLOCKED");
  });

  it("returns 200 with validated XRayReport on all 3 canonical demo fixture scenarios", async () => {
    const scenarios = [
      { id: "healthy-offer", expectedVerdict: "PASS", expectedWaste: 0 },
      { id: "expired-promo", expectedVerdict: "FAIL", expectedWaste: 903 },
      { id: "oos-price-mismatch", expectedVerdict: "FAIL", expectedWaste: 722.5 },
    ] as const;

    for (const scenario of scenarios) {
      const preset = getDemoScenarioPreset(scenario.id);
      const res = await POST(
        makeJsonPostRequest({
          adCopy: preset.adCopy,
          landingPageUrl: preset.landingPageUrl,
          dailyBudget: preset.dailyBudget,
          fixtureId: preset.id,
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const raw = (await res.json()) as unknown;
      const parsed = XRayReportSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;

      expect(parsed.data.overallStatus).toBe(scenario.expectedVerdict);
      expect(parsed.data.checks).toHaveLength(6);
      expect(parsed.data.waste.estimatedDailyWaste).toBe(scenario.expectedWaste);
      expect(parsed.data.slackAlert).toContain(preset.landingPageUrl);
      expect(parsed.data.markdownReport).toContain("# OfferParity X-Ray QA Audit Report");
    }
  });

  it("returns 200 on a mocked live Shopify storefront request", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.endsWith("/products/trail-bottle.js")) {
        return new Response(
          JSON.stringify({
            title: "Trail Bottle 24oz",
            variants: [
              {
                id: 101,
                title: "Slate Blue",
                price: 3800,
                compare_at_price: 4500,
                available: true,
                sku: "TB-24-SB",
                options: ["Slate Blue"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Trail Bottle 24oz</title>
            <meta property="og:price:currency" content="USD" />
          </head>
          <body><h1>Trail Bottle 24oz</h1></body>
        </html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    });

    const res = await POST(
      makeJsonPostRequest({
        adCopy: "Hydrate on the trail. Trail Bottle 24oz in Slate Blue — now $38.00 (was $45.00).",
        landingPageUrl:
          "https://livebrand.example.com/products/trail-bottle?utm_source=meta&utm_medium=paid_social&utm_campaign=trail_spring",
        dailyBudget: 400,
      })
    );

    expect(res.status).toBe(200);
    const report = XRayReportSchema.parse(await res.json());
    expect(report.storefront.source).toBe("shopify_js");
    expect(report.storefront.title).toBe("Trail Bottle 24oz");
    expect(report.overallStatus).toBe("PASS");
    expect(report.waste.estimatedDailyWaste).toBe(0);
  });
});

describe("OfferParity Dashboard UI (HomePage)", () => {
  function mockApiXrayFetch() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/xray") {
        return POST(
          new Request("http://localhost:3000/api/xray", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: init?.body,
          })
        );
      }
      throw new Error(`Unexpected fetch URL in UI test: ${url}`);
    });
  }

  it("starts clean with empty inputs and loads the oos-price-mismatch scenario with variant matrix and waste math on click", async () => {
    mockApiXrayFetch();
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /OfferParity — Broken-Offer X-Ray/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("xray-mode-indicator")).toHaveTextContent(
      "Mode: Custom Live URL"
    );
    expect(screen.queryByTestId("overall-verdict-badge")).not.toBeInTheDocument();

    // Click Out-of-Stock Variant & Price Mismatch scenario pill
    fireEvent.click(
      screen.getByRole("button", { name: /Out-of-Stock Variant & Price Mismatch/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("FAIL");
    });
    expect(screen.getByTestId("xray-mode-indicator")).toHaveTextContent(
      "Mode: Demo Fixture (oos-price-mismatch)"
    );
    expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$722.50");
    expect(screen.getByTestId("monthly-waste-value")).toHaveTextContent("$21,675.00");
    expect(screen.getByTestId("at-risk-spend-value")).toHaveTextContent("$12.75");

    // Expand Raw Extraction & Variants to inspect variant matrix
    fireEvent.click(
      screen.getByRole("button", { name: /Inspect Raw Extraction & Variants/i })
    );
    expect(screen.getByText("Alpine Olive / L")).toBeInTheDocument();
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
    expect(screen.getByText("Charcoal / S")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();

    // All 6 parity checks render in the diff table
    const paritySection = screen.getByLabelText("Field-by-field parity diff checks");
    expect(within(paritySection).getAllByRole("row")).toHaveLength(7); // 1 header + 6 checks

    // Toggle Waste Math breakdown
    const mathToggle = screen.getByRole("button", { name: /Show Waste Math/i });
    fireEvent.click(mathToggle);
    expect(screen.getByTestId("waste-math-breakdown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide Waste Math/i })).toBeInTheDocument();
  });

  it("switches scenarios cleanly between healthy-offer and expired-promo via POST /api/xray", async () => {
    const fetchSpy = mockApiXrayFetch();
    render(<HomePage />);

    const healthyBtn = screen.getByRole("button", { name: /Healthy Offer/i });
    fireEvent.click(healthyBtn);

    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("PASS");
    });
    expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("xray-mode-indicator")).toHaveTextContent(
      "Mode: Demo Fixture (healthy-offer)"
    );

    const expiredBtn = screen.getByRole("button", { name: /Expired Promo Code/i });
    fireEvent.click(expiredBtn);

    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("FAIL");
    });
    expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$903.00");
    expect(screen.getByTestId("xray-mode-indicator")).toHaveTextContent(
      "Mode: Demo Fixture (expired-promo)"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("supports quick-select budget chips, custom URL mode indicator, validation, and form submission", async () => {
    const fetchSpy = mockApiXrayFetch();
    render(<HomePage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Out-of-Stock Variant & Price Mismatch/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$722.50");
    });

    // Quick-select $5,000 budget chip updates input and runs X-Ray cleanly
    const chip5000 = screen.getByRole("button", { name: "$5,000" });
    fireEvent.click(chip5000);
    expect(chip5000).toHaveAttribute("aria-pressed", "true");
    const budgetInput = screen.getByLabelText(/Daily Ad Budget/i) as HTMLInputElement;
    expect(budgetInput.value).toBe("5000");

    fireEvent.click(screen.getByRole("button", { name: /Run X-Ray/i }));
    await waitFor(() => {
      expect(screen.getByTestId("daily-waste-value")).toHaveTextContent("$4,250.00");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Editing URL away from demo preset switches mode indicator to Custom Live URL
    const urlInput = screen.getByLabelText(/Landing Page URL/i);
    fireEvent.change(urlInput, {
      target: { value: "https://customstore.example.com/products/merino-hoodie" },
    });
    expect(screen.getByTestId("xray-mode-indicator")).toHaveTextContent("Mode: Custom Live URL");

    // Instant validation feedback on invalid ad copy
    const adCopyInput = screen.getByLabelText(/Ad Copy/i);
    fireEvent.change(adCopyInput, { target: { value: "hi" } });
    expect(screen.getByText(/Ad copy must be at least 5 characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run X-Ray/i })).toBeDisabled();
  });

  it("executes all AlertExportPanel copy, preview tab, and download controls with zero dead buttons", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:offerparity-test");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockApiXrayFetch();
    render(<HomePage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Out-of-Stock Variant & Price Mismatch/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId("overall-verdict-badge")).toHaveTextContent("FAIL");
    });

    // Copy Slack Alert
    fireEvent.click(screen.getByRole("button", { name: /Copy Slack Alert/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0]).toContain("OfferParity X-Ray FAIL");
    expect(screen.getByRole("status")).toHaveTextContent("Copied Slack alert to clipboard!");

    // Copy Markdown (inside More Exports menu)
    fireEvent.click(screen.getByRole("button", { name: /More Exports/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy Markdown/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    expect(writeText.mock.calls[1]?.[0]).toContain("# OfferParity X-Ray QA Audit Report");
    expect(screen.getByRole("status")).toHaveTextContent("Copied Markdown report to clipboard!");

    // Preview tab switching
    fireEvent.click(screen.getByRole("tab", { name: /Markdown QA Preview/i }));
    expect(screen.getByTestId("export-preview-content")).toHaveTextContent(
      "# OfferParity X-Ray QA Audit Report"
    );
    fireEvent.click(screen.getByRole("tab", { name: /Slack Burn-Rate Preview/i }));
    expect(screen.getByTestId("export-preview-content")).toHaveTextContent(
      "OfferParity X-Ray FAIL"
    );

    // Download JSON & Markdown (inside More Exports menu)
    fireEvent.click(screen.getByRole("button", { name: /More Exports/i }));
    fireEvent.click(screen.getByRole("button", { name: /Download JSON/i }));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Downloaded JSON report.");

    fireEvent.click(screen.getByRole("button", { name: /More Exports/i }));
    fireEvent.click(screen.getByRole("button", { name: /Download Markdown/i }));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    expect(anchorClickSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Downloaded Markdown report.");

    await waitFor(() => {
      expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("clears stale server errors as soon as the user edits a form field", async () => {
    mockApiXrayFetch();
    render(<HomePage />);

    const adCopyInput = screen.getByLabelText(/Ad Copy/i);
    fireEvent.change(adCopyInput, {
      target: { value: "Test product $45 today only" },
    });
    const urlInput = screen.getByLabelText(/Landing Page URL/i);
    fireEvent.change(urlInput, { target: { value: "http://127.0.0.1:3000/products/test" } });
    fireEvent.click(screen.getByRole("button", { name: /Run X-Ray/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Blocked unsafe URL/i);
    });

    fireEvent.change(urlInput, { target: { value: "https://example.com/products/test" } });
    expect(screen.queryByText(/Blocked unsafe URL/i)).not.toBeInTheDocument();
  });
});
