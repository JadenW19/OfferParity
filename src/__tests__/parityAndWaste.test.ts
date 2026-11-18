import { describe, expect, it } from "vitest";
import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { buildMarkdownReport, buildSlackAlert } from "@/lib/exporters/reportFormatters";
import type {
  ExtractedAdClaims,
  ParityCheck,
  StorefrontSnapshot,
  XRayReport,
} from "@/lib/schemas";

function makeClaims(overrides: Partial<ExtractedAdClaims> = {}): ExtractedAdClaims {
  return {
    advertisedPrice: 36,
    compareAtPrice: 45,
    currency: "USD",
    promoCode: "HYDRATE20",
    discountPct: 20,
    isUpToDiscount: false,
    variantName: "Obsidian Black",
    utmParams: {
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "q4_lumina_launch",
      utm_content: null,
      utm_term: null,
      fbclid: null,
      ttclid: null,
      gclid: null,
    },
    signals: [],
    ...overrides,
  };
}

function makeStorefront(overrides: Partial<StorefrontSnapshot> = {}): StorefrontSnapshot {
  return {
    url: "https://demo.offerparity.app/products/lumina-bottle",
    finalUrl: "https://demo.offerparity.app/products/lumina-bottle",
    httpStatus: 200,
    redirectChain: [],
    wafStatus: "NONE",
    wafProvider: null,
    title: "Lumina 32oz Insulated Bottle",
    basePrice: 45,
    compareAtPrice: 45,
    currency: "USD",
    inStock: true,
    variants: [
      {
        id: "v-obsidian",
        title: "Obsidian Black",
        price: 45,
        compareAtPrice: 45,
        available: true,
        sku: "LUM-OBS-32",
        optionValues: ["Obsidian Black"],
      },
    ],
    promoVerification: {
      code: "HYDRATE20",
      state: "ACTIVE",
      discountPct: 20,
      discountAmount: null,
      minSpend: null,
      expiresAt: "2026-12-31",
      detail: "20% off sitewide active",
    },
    source: "fixture",
    fetchError: null,
    ...overrides,
  };
}

function makeReportInput(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot,
  dailyBudget: number,
  landingPageUrl = storefront.url
): Omit<XRayReport, "slackAlert" | "markdownReport"> {
  const { checks, overallStatus } = evaluateParity(claims, storefront);
  const waste = calculateWaste(checks, dailyBudget, overallStatus);
  return {
    request: {
      adCopy: "Sample ad copy for OfferParity diagnostic test.",
      landingPageUrl,
      dailyBudget,
    },
    extractedClaims: claims,
    storefront,
    checks,
    overallStatus,
    waste,
    generatedAt: "2026-11-18T15:00:00.000Z",
    durationMs: 12,
  };
}

describe("evaluateParity + calculateWaste (Gate 3)", () => {
  it("passes canonical Scenario 1: healthy-offer with $0 waste", () => {
    const claims = makeClaims();
    const storefront = makeStorefront();

    const { checks, overallStatus } = evaluateParity(claims, storefront);
    const waste = calculateWaste(checks, 600, overallStatus);

    expect(overallStatus).toBe("PASS");
    expect(checks).toHaveLength(6);
    expect(checks.every((c) => c.status === "PASS")).toBe(true);
    expect(waste.effectiveWasteRate).toBe(0);
    expect(waste.estimatedDailyWaste).toBe(0);
    expect(waste.projectedMonthlyWaste).toBe(0);
    expect(waste.atRiskDailySpend).toBe(0);
  });

  it("fails canonical Scenario 2: expired-promo on promo_code, price_parity, and discount_math", () => {
    const claims = makeClaims({
      advertisedPrice: 149.25,
      compareAtPrice: 199,
      currency: "USD",
      promoCode: "BFCM25",
      discountPct: 25,
      variantName: null,
    });
    const storefront = makeStorefront({
      url: "https://demo.offerparity.app/products/veloce-recovery-boots",
      finalUrl: "https://demo.offerparity.app/products/veloce-recovery-boots",
      title: "Veloce Recovery Boots",
      basePrice: 199,
      compareAtPrice: 199,
      variants: [
        {
          id: "v-std",
          title: "Standard",
          price: 199,
          compareAtPrice: 199,
          available: true,
          sku: "VEL-01",
        },
      ],
      promoVerification: {
        code: "BFCM25",
        state: "EXPIRED",
        discountPct: 25,
        discountAmount: null,
        minSpend: null,
        expiresAt: "2026-11-05",
        detail: "Promo code BFCM25 expired on 2026-11-05",
      },
    });

    const { checks, overallStatus } = evaluateParity(claims, storefront);
    const waste = calculateWaste(checks, 1200, overallStatus);

    expect(overallStatus).toBe("FAIL");
    const byId = Object.fromEntries(checks.map((c) => [c.id, c])) as Record<
      ParityCheck["id"],
      ParityCheck
    >;
    expect(byId.promo_code.status).toBe("FAIL");
    expect(byId.promo_code.impactWeight).toBe(0.45);
    expect(byId.price_parity.status).toBe("FAIL");
    expect(byId.price_parity.impactWeight).toBe(0.4);
    expect(byId.discount_math.status).toBe("FAIL");
    expect(byId.discount_math.impactWeight).toBe(0.25);

    // 1 - (1 - 0.40) * (1 - 0.45) * (1 - 0.25) = 1 - 0.6 * 0.55 * 0.75 = 0.7525
    expect(waste.effectiveWasteRate).toBe(0.7525);
    expect(waste.estimatedDailyWaste).toBe(903);
    expect(waste.projectedMonthlyWaste).toBe(27090);
    expect(waste.breakdown.failingFactors).toHaveLength(3);
  });

  it("fails canonical Scenario 3: oos-price-mismatch with token-normalized variant matching and missing UTM warn", () => {
    const claims = makeClaims({
      advertisedPrice: 68,
      compareAtPrice: null,
      currency: "USD",
      promoCode: null,
      discountPct: null,
      variantName: "Alpine Olive (Size L)",
      utmParams: {
        utm_source: "meta",
        utm_medium: "paid_social",
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
        fbclid: null,
        ttclid: null,
        gclid: null,
      },
    });
    const storefront = makeStorefront({
      url: "https://demo.offerparity.app/products/kova-merino-hoodie",
      finalUrl: "https://demo.offerparity.app/products/kova-merino-hoodie",
      title: "Kova Merino Trail Hoodie",
      basePrice: 84,
      compareAtPrice: null,
      inStock: true,
      variants: [
        {
          id: "v-olive-l",
          title: "Alpine Olive / L",
          price: 84,
          compareAtPrice: null,
          available: false,
          sku: "KOVA-OLV-L",
          optionValues: ["Alpine Olive", "L"],
        },
        {
          id: "v-charcoal-s",
          title: "Charcoal / S",
          price: 84,
          compareAtPrice: null,
          available: true,
          sku: "KOVA-CHR-S",
          optionValues: ["Charcoal", "S"],
        },
      ],
      promoVerification: null,
    });

    const { checks, overallStatus } = evaluateParity(claims, storefront);
    const waste = calculateWaste(checks, 850, overallStatus);

    expect(overallStatus).toBe("FAIL");
    const byId = Object.fromEntries(checks.map((c) => [c.id, c])) as Record<
      ParityCheck["id"],
      ParityCheck
    >;
    expect(byId.variant_stock.status).toBe("FAIL");
    expect(byId.variant_stock.impactWeight).toBe(0.75);
    expect(byId.variant_stock.actual).toContain("Alpine Olive / L");
    expect(byId.price_parity.status).toBe("FAIL");
    expect(byId.price_parity.impactWeight).toBe(0.4);
    expect(byId.utm_hygiene.status).toBe("WARN");
    expect(byId.utm_hygiene.impactWeight).toBe(0.1);

    // 1 - (1 - 0.40) * (1 - 0.75) = 0.85
    expect(waste.effectiveWasteRate).toBe(0.85);
    expect(waste.estimatedDailyWaste).toBe(722.5);
    expect(waste.projectedMonthlyWaste).toBe(21675);
    // Remaining non-wasted budget = 850 - 722.50 = 127.50; 10% at risk = 12.75
    expect(waste.atRiskDailySpend).toBe(12.75);
    expect(waste.estimatedDailyWaste + waste.atRiskDailySpend).toBeLessThanOrEqual(850);
  });

  it("fails on explicit currency mismatch (USD vs GBP) and warns when storefront currency is missing", () => {
    const mismatchResult = evaluateParity(
      makeClaims({ currency: "USD", advertisedPrice: 45, promoCode: null, discountPct: null }),
      makeStorefront({ currency: "GBP", basePrice: 45, promoVerification: null })
    );
    const mismatchPriceCheck = mismatchResult.checks.find((c) => c.id === "price_parity");
    expect(mismatchPriceCheck?.status).toBe("FAIL");
    expect(mismatchPriceCheck?.actual).toContain("GBP");
    expect(mismatchResult.overallStatus).toBe("FAIL");

    const missingCurrencyResult = evaluateParity(
      makeClaims({ currency: "USD", advertisedPrice: 45, promoCode: null, discountPct: null }),
      makeStorefront({ currency: null, basePrice: 45, promoVerification: null })
    );
    const missingCurrencyCheck = missingCurrencyResult.checks.find(
      (c) => c.id === "price_parity"
    );
    expect(missingCurrencyCheck?.status).toBe("WARN");
    expect(missingCurrencyResult.overallStatus).toBe("WARN");
  });

  it("enforces ±$0.01 rounding tolerance on price parity", () => {
    const withinTolerance = evaluateParity(
      makeClaims({ advertisedPrice: 36.0, promoCode: "HYDRATE20", discountPct: 20 }),
      makeStorefront({
        basePrice: 45.01,
        variants: [
          {
            id: "v-1",
            title: "Obsidian Black",
            price: 45.01,
            compareAtPrice: 45.01,
            available: true,
            sku: "OBS-1",
          },
        ],
      })
    );
    // 45.01 * 0.8 = 36.008 -> 36.01, diff = 0.01 <= 0.01 -> PASS
    expect(withinTolerance.checks.find((c) => c.id === "price_parity")?.status).toBe("PASS");

    const overTolerance = evaluateParity(
      makeClaims({ advertisedPrice: 36.0, promoCode: null, discountPct: null }),
      makeStorefront({
        basePrice: 36.02,
        variants: [
          {
            id: "v-1",
            title: "Obsidian Black",
            price: 36.02,
            compareAtPrice: null,
            available: true,
            sku: "OBS-1",
          },
        ],
        promoVerification: null,
      })
    );
    expect(overTolerance.checks.find((c) => c.id === "price_parity")?.status).toBe("FAIL");
  });

  it("handles WAF_CHALLENGE_MANUAL_CHECK with zero fabricated waste", () => {
    const claims = makeClaims();
    const storefront = makeStorefront({
      httpStatus: 403,
      wafStatus: "WAF_CHALLENGE_MANUAL_CHECK",
      wafProvider: "Cloudflare",
      basePrice: null,
      compareAtPrice: null,
      currency: null,
      inStock: null,
      variants: [],
      promoVerification: null,
      source: "http_only",
    });

    const { checks, overallStatus } = evaluateParity(claims, storefront);
    const waste = calculateWaste(checks, 2000, overallStatus);

    expect(overallStatus).toBe("WAF_CHALLENGE_MANUAL_CHECK");
    expect(checks.find((c) => c.id === "http_health")?.status).toBe("WARN");
    expect(checks.some((c) => c.status === "FAIL")).toBe(false);
    expect(waste.estimatedDailyWaste).toBe(0);
    expect(waste.projectedMonthlyWaste).toBe(0);
    expect(waste.effectiveWasteRate).toBe(0);
    expect(waste.atRiskDailySpend).toBe(0);
  });

  it("handles dailyBudget = 0 and keeps survival-complement waste bounded in [0, dailyBudget]", () => {
    const checks: ParityCheck[] = [
      {
        id: "http_health",
        label: "Landing Page & HTTP Health",
        status: "FAIL",
        expected: "HTTP 200",
        actual: "HTTP 404",
        impactWeight: 1.0,
        remediation: "Fix URL",
      },
      {
        id: "price_parity",
        label: "Price & Currency Parity",
        status: "FAIL",
        expected: "$50",
        actual: "$80",
        impactWeight: 0.4,
        remediation: "Fix price",
      },
      {
        id: "promo_code",
        label: "Promo Code Verification",
        status: "FAIL",
        expected: "ACTIVE",
        actual: "INVALID",
        impactWeight: 0.45,
        remediation: "Fix code",
      },
      {
        id: "utm_hygiene",
        label: "UTM & Attribution Hygiene",
        status: "WARN",
        expected: "All UTMs",
        actual: "Missing utm_campaign",
        impactWeight: 0.1,
        remediation: "Add UTM",
      },
    ];

    const zeroWaste = calculateWaste(checks, 0, "FAIL");
    expect(zeroWaste.estimatedDailyWaste).toBe(0);
    expect(zeroWaste.projectedMonthlyWaste).toBe(0);
    expect(zeroWaste.atRiskDailySpend).toBe(0);
    expect(zeroWaste.effectiveWasteRate).toBe(1);

    const boundedWaste = calculateWaste(checks, 500, "FAIL");
    expect(boundedWaste.effectiveWasteRate).toBeGreaterThanOrEqual(0);
    expect(boundedWaste.effectiveWasteRate).toBeLessThanOrEqual(1);
    expect(boundedWaste.estimatedDailyWaste).toBe(500);
    expect(boundedWaste.projectedMonthlyWaste).toBe(15000);
    expect(boundedWaste.atRiskDailySpend).toBe(0);
  });

  it("handles HTTP >= 400, >2 redirect hops, all-OOS, unmatched variant, UNVERIFIED_LIVE_STORE, and isUpToDiscount", () => {
    const redirectWarn = evaluateParity(
      makeClaims({ promoCode: null, discountPct: null, variantName: null }),
      makeStorefront({
        redirectChain: [
          { url: "https://a.example", status: 301 },
          { url: "https://b.example", status: 302 },
          { url: "https://c.example", status: 302 },
        ],
        promoVerification: null,
      })
    );
    expect(redirectWarn.checks.find((c) => c.id === "http_health")?.status).toBe("WARN");
    expect(redirectWarn.checks.find((c) => c.id === "http_health")?.impactWeight).toBe(0.15);

    const deadHttp = evaluateParity(
      makeClaims({ promoCode: null, discountPct: null }),
      makeStorefront({ httpStatus: 404, inStock: false, variants: [], promoVerification: null })
    );
    expect(deadHttp.checks.find((c) => c.id === "http_health")?.status).toBe("FAIL");
    expect(deadHttp.checks.find((c) => c.id === "variant_stock")?.status).toBe("FAIL");
    expect(deadHttp.checks.find((c) => c.id === "variant_stock")?.impactWeight).toBe(1.0);

    const unmatchedVariantAndUpTo = evaluateParity(
      makeClaims({
        advertisedPrice: 45,
        compareAtPrice: 50,
        discountPct: 30,
        isUpToDiscount: true,
        variantName: "Crimson Red (Size XL)",
        promoCode: "LIVE10",
      }),
      makeStorefront({
        basePrice: 45,
        compareAtPrice: 50,
        promoVerification: {
          code: "LIVE10",
          state: "UNVERIFIED_LIVE_STORE",
          discountPct: null,
          discountAmount: null,
          minSpend: null,
          expiresAt: null,
          detail: "Checkout-only code cannot be verified without cart mutation",
        },
      })
    );
    expect(unmatchedVariantAndUpTo.checks.find((c) => c.id === "variant_stock")?.status).toBe(
      "WARN"
    );
    expect(unmatchedVariantAndUpTo.checks.find((c) => c.id === "promo_code")?.status).toBe("WARN");
    expect(unmatchedVariantAndUpTo.checks.find((c) => c.id === "promo_code")?.impactWeight).toBe(
      0.15
    );
  });

  it("handles PAGE_BANNER_MATCH and MIN_SPEND_UNMET promo states and isUpToDiscount warning", () => {
    const bannerPass = evaluateParity(
      makeClaims({ advertisedPrice: 40, compareAtPrice: 50, discountPct: 20, promoCode: "SAVE20" }),
      makeStorefront({
        basePrice: 50,
        compareAtPrice: 50,
        variants: [
          {
            id: "v-1",
            title: "Obsidian Black",
            price: 50,
            compareAtPrice: 50,
            available: true,
            sku: "OBS",
          },
        ],
        promoVerification: {
          code: "SAVE20",
          state: "PAGE_BANNER_MATCH",
          discountPct: 20,
          discountAmount: null,
          minSpend: null,
          expiresAt: null,
          detail: "Banner matches SAVE20 for 20% off",
        },
      })
    );
    expect(bannerPass.overallStatus).toBe("PASS");

    const minSpendAndUpTo = evaluateParity(
      makeClaims({
        advertisedPrice: 40,
        compareAtPrice: 50,
        discountPct: 30,
        isUpToDiscount: true,
        promoCode: "SAVE20",
      }),
      makeStorefront({
        basePrice: 50,
        compareAtPrice: 50,
        variants: [
          {
            id: "v-1",
            title: "Obsidian Black",
            price: 50,
            compareAtPrice: 50,
            available: true,
            sku: "OBS",
          },
        ],
        promoVerification: {
          code: "SAVE20",
          state: "MIN_SPEND_UNMET",
          discountPct: 20,
          discountAmount: null,
          minSpend: 100,
          expiresAt: null,
          detail: "Requires $100 minimum spend",
        },
      })
    );
    expect(minSpendAndUpTo.checks.find((c) => c.id === "promo_code")?.status).toBe("FAIL");
    expect(minSpendAndUpTo.checks.find((c) => c.id === "discount_math")?.status).toBe("WARN");
  });
});

describe("buildSlackAlert & buildMarkdownReport (Gate 3)", () => {
  it("formats FAIL Slack alert and Markdown audit report cleanly", () => {
    const baseReport = makeReportInput(
      makeClaims({
        advertisedPrice: 68,
        compareAtPrice: null,
        promoCode: null,
        discountPct: null,
        variantName: "Alpine Olive (Size L)",
      }),
      makeStorefront({
        basePrice: 84,
        compareAtPrice: null,
        variants: [
          {
            id: "v-olive-l",
            title: "Alpine Olive / L",
            price: 84,
            compareAtPrice: null,
            available: false,
            sku: "KOVA-OLV-L",
          },
          {
            id: "v-charcoal-s",
            title: "Charcoal / S",
            price: 84,
            compareAtPrice: null,
            available: true,
            sku: "KOVA-CHR-S",
          },
        ],
        promoVerification: null,
      }),
      850
    );

    const slack = buildSlackAlert(baseReport);
    expect(slack).toContain(":rotating_light:");
    expect(slack).toContain("$722.50/day");
    expect(slack).toContain("$21,675.00/mo");
    expect(slack).toContain("https://demo.offerparity.app/products/lumina-bottle");
    expect(slack).toContain("[FAIL]");

    const md = buildMarkdownReport(baseReport);
    expect(md).toContain("# OfferParity X-Ray QA Audit Report");
    expect(md).toContain("## Spend Impact Summary");
    expect(md).toContain("## Ad Claims vs. Storefront Truth");
    expect(md).toContain("## Parity Checks");
    expect(md).toContain("$722.50 / day");
    expect(md).toContain("85.00%");
    expect(md).toContain("**FAIL**");
  });

  it("formats PASS and WAF_CHALLENGE_MANUAL_CHECK Slack alerts with matching status emojis", () => {
    const passReport = makeReportInput(makeClaims(), makeStorefront(), 600);
    const passSlack = buildSlackAlert(passReport);
    expect(passSlack).toContain(":large_green_circle:");
    expect(passSlack).toContain("$0.00/day");

    const wafReport = makeReportInput(
      makeClaims(),
      makeStorefront({
        httpStatus: 403,
        wafStatus: "WAF_CHALLENGE_MANUAL_CHECK",
        wafProvider: "Cloudflare",
        basePrice: null,
        currency: null,
        variants: [],
        promoVerification: null,
      }),
      1000
    );
    const wafSlack = buildSlackAlert(wafReport);
    expect(wafSlack).toContain(":warning:");
    expect(wafSlack).toContain("Manual Check Required");
    expect(wafSlack).toContain("$0.00/day");
  });
});
