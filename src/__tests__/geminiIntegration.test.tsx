import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  GEMINI_MODEL,
  GeminiNotConfiguredError,
  GeminiUpstreamError,
  enrichClaimsWithGeminiFallback,
  isGeminiConfigured,
  queryGeminiInsights,
  type GeminiInteractionsClient,
} from "@/lib/ai/geminiClient";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import { GET, POST } from "@/app/api/gemini/route";
import { GeminiAssistantCard } from "@/components/GeminiAssistantCard";
import { XRayReportSchema } from "@/lib/schemas";

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

function makeMockClient(outputText: string | null): GeminiInteractionsClient {
  return {
    interactions: {
      create: vi.fn(async () => ({ output_text: outputText })),
    },
  };
}

describe("Gemini API Integration", () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = ORIGINAL_KEY;
    }
  });

  it("reports isGeminiConfigured accurately from GEMINI_API_KEY", () => {
    expect(isGeminiConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "   ";
    expect(isGeminiConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "test-gemini-key";
    expect(isGeminiConfigured()).toBe(true);
  });

  it("enriches only null fields via Gemini fallback without overwriting deterministic claims", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const deterministic = extractAdClaims(
      "Winter trail hoodie only $68 today!",
      "https://example.com/products/hoodie"
    );
    expect(deterministic.advertisedPrice).toBe(68);
    expect(deterministic.variantName).toBeNull();
    expect(deterministic.promoCode).toBeNull();

    const mockClient = makeMockClient(
      JSON.stringify({
        advertisedPrice: 999, // Must NOT overwrite deterministic 68
        variantName: "Alpine Olive / L",
        promoCode: "WINTER20",
      })
    );

    const result = await enrichClaimsWithGeminiFallback(
      deterministic,
      "Winter trail hoodie only $68 today!",
      "https://example.com/products/hoodie",
      { clientFactory: () => mockClient }
    );

    expect(result.usedGemini).toBe(true);
    expect(result.claims.advertisedPrice).toBe(68);
    expect(result.claims.variantName).toBe("Alpine Olive / L");
    expect(result.claims.promoCode).toBe("WINTER20");
    expect(
      result.claims.signals.some((s) => s.note?.includes(GEMINI_MODEL))
    ).toBe(true);
  });

  it("throws GeminiNotConfiguredError when querying without GEMINI_API_KEY", async () => {
    await expect(
      queryGeminiInsights({ prompt: "How do I fix this?" })
    ).rejects.toBeInstanceOf(GeminiNotConfiguredError);
  });

  it("sanitizes API keys in upstream errors", async () => {
    process.env.GEMINI_API_KEY = "AQ.Ab8SecretKeyTokenExample123";
    const failingClient: GeminiInteractionsClient = {
      interactions: {
        create: vi.fn(async () => {
          throw new Error("403 PERMISSION_DENIED for key AQ.Ab8SecretKeyTokenExample123");
        }),
      },
    };

    try {
      await queryGeminiInsights(
        { prompt: "Summarize waste" },
        { clientFactory: () => failingClient }
      );
      expect.fail("Expected GeminiUpstreamError");
    } catch (err) {
      expect(err).toBeInstanceOf(GeminiUpstreamError);
      expect((err as Error).message).not.toContain("AQ.Ab8SecretKeyTokenExample123");
      expect((err as Error).message).toContain("[REDACTED]");
      expect((err as GeminiUpstreamError).status).toBe(403);
    }
  });

  it("handles GET /api/gemini and POST /api/gemini validation & missing-key 503", async () => {
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      configured: false,
      model: GEMINI_MODEL,
    });

    const badRes = await POST(
      new Request("http://localhost:3000/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      })
    );
    expect(badRes.status).toBe(400);

    const missingKeyRes = await POST(
      new Request("http://localhost:3000/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "What is the fastest fix?" }),
      })
    );
    expect(missingKeyRes.status).toBe(503);
  });

  it("renders GeminiAssistantCard and submits queries to /api/gemini", async () => {
    const sampleReport = XRayReportSchema.parse({
      request: {
        adCopy: "Kova Hoodie in Alpine Olive (Size L) — $68.00",
        landingPageUrl: "https://demo.offerparity.app/products/kova-merino-hoodie",
        dailyBudget: 850,
        fixtureId: "oos-price-mismatch",
      },
      extractedClaims: extractAdClaims(
        "Kova Hoodie in Alpine Olive (Size L) — $68.00",
        "https://demo.offerparity.app/products/kova-merino-hoodie"
      ),
      storefront: {
        url: "https://demo.offerparity.app/products/kova-merino-hoodie",
        finalUrl: "https://demo.offerparity.app/products/kova-merino-hoodie",
        httpStatus: 200,
        redirectChain: [],
        wafStatus: "NONE",
        title: "Kova Merino Trail Hoodie",
        basePrice: 84,
        compareAtPrice: null,
        currency: "USD",
        inStock: true,
        variants: [],
        promoVerification: null,
        source: "fixture",
      },
      checks: [
        {
          id: "price_parity",
          label: "Price & Currency Parity",
          status: "FAIL",
          expected: "USD 68.00",
          actual: "USD 84.00",
          impactWeight: 0.4,
          remediation: "Update ad copy price to $84.00.",
        },
      ],
      overallStatus: "FAIL",
      waste: {
        estimatedDailyWaste: 340,
        projectedMonthlyWaste: 10200,
        atRiskDailySpend: 0,
        effectiveWasteRate: 0.4,
        breakdown: {
          formula: "1 - (1 - 0.4)",
          failingFactors: [{ id: "price_parity", label: "Price & Currency Parity", weight: 0.4 }],
          warningFactors: [],
        },
      },
      slackAlert: "alert",
      markdownReport: "# report",
      generatedAt: "2026-11-18T00:00:00.000Z",
      durationMs: 1,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: "Pause the Alpine Olive ad set and update price copy to $84.00.",
          model: GEMINI_MODEL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    render(<GeminiAssistantCard report={sampleReport} />);

    const input = screen.getByLabelText(/Ask Gemini about this OfferParity X-Ray report/i);
    fireEvent.change(input, { target: { value: "How do I stop wasting budget?" } });
    fireEvent.click(screen.getByRole("button", { name: /Ask Gemini/i }));

    await waitFor(() => {
      expect(screen.getByTestId("gemini-assistant-answer")).toHaveTextContent(
        "Pause the Alpine Olive ad set and update price copy to $84.00."
      );
    });
  });
});
