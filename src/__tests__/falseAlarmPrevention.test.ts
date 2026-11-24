import { describe, expect, it } from "vitest";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { runSingleXRay } from "@/lib/xrayRunner";
import type { DnsLookupFn } from "@/lib/verifier/ssrfGuard";

const mockPublicDns: DnsLookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

describe("False-Alarm Prevention Regression Suite (Path C)", () => {
  it("does not false-FAIL on Grüns-style Subscribe & Save widget when static .js only exposes one-time MSRP", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(".js")) {
        return new Response(
          JSON.stringify({
            title: "Daily Greens Gummies",
            price: 6665,
            compare_at_price: 6665,
            available: true,
            variants: [
              {
                id: 1001,
                title: "28 Packs",
                price: 6665,
                compare_at_price: 6665,
                available: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        `<!doctype html><html><head><title>Daily Greens</title><meta property="og:price:currency" content="USD" /></head>
        <body>
          <div>Autoship and Save: Subscribe &amp; Save $29.99 $66.65 ($1.07/day) — Free Shipping Today</div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const report = await runSingleXRay(
      {
        adCopy: "Here is 61% off to prove otherwise. Your entire supplement stack in 2 daily gummies.",
        landingPageUrl:
          "https://gruns.example.com/products/daily-greens-gummies?utm_source=tiktok&utm_medium=paid_social&utm_campaign=gruns_q4",
        dailyBudget: 500,
      },
      { fetchImpl: mockFetch, lookupFn: mockPublicDns }
    );

    expect(report.storefront.subscriptionPricing?.detected).toBe(true);
    expect(report.storefront.subscriptionPricing?.lowestPrice).toBe(29.99);
    expect(report.overallStatus).toBe("WARN");
    expect(report.waste.estimatedDailyWaste).toBe(0);
    expect(report.checks.find((c) => c.id === "discount_math")?.status).toBe("WARN");
  });

  it("does NOT falsely mark standard Shopify stores with empty selling_plan_groups:[] as subscription stores", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(".js")) {
        return new Response(
          JSON.stringify({
            title: "Pirouette Skort",
            price: 6000,
            available: true,
            selling_plan_groups: [],
            variants: [{ id: 1, title: "Black / M", price: 6000, available: true }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        `<!doctype html><html><head><title>Pirouette Skort</title><meta property="og:price:currency" content="USD" /></head>
        <body>
          <form><input type="hidden" name="selling_plan" value="" /></form>
          <script>window.__PRODUCT__ = {"selling_plan_groups":[]};</script>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const report = await runSingleXRay(
      {
        adCopy: "Grab the Pirouette Skort today for $45.00.",
        landingPageUrl:
          "https://skort.example.com/products/pirouette-skort?utm_source=meta&utm_medium=paid_social&utm_campaign=skort",
        dailyBudget: 500,
      },
      { fetchImpl: mockFetch, lookupFn: mockPublicDns }
    );

    expect(report.storefront.subscriptionPricing?.detected).toBe(false);
    expect(report.overallStatus).toBe("FAIL");
    expect(report.checks.find((c) => c.id === "price_parity")?.status).toBe("FAIL");
    expect(report.waste.estimatedDailyWaste).toBe(200);
  });

  it("PASSes price_parity and discount_math when Shopify selling_plan_allocations match advertised subscription offer", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(".js")) {
        return new Response(
          JSON.stringify({
            title: "Daily Greens Gummies",
            price: 6665,
            compare_at_price: 6665,
            available: true,
            selling_plan_groups: [
              {
                app_id: "skio",
                selling_plans: [
                  {
                    id: 501,
                    name: "Every 4 Weeks",
                    price_adjustments: [{ value_type: "percentage", value: 55 }],
                  },
                ],
              },
            ],
            variants: [
              {
                id: 1001,
                title: "28 Packs",
                price: 6665,
                compare_at_price: 6665,
                available: true,
                selling_plan_allocations: [{ price: 2999, compare_at_price: 6665 }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        `<!doctype html><html><head><title>Daily Greens</title><meta property="og:price:currency" content="USD" /></head><body></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const report = await runSingleXRay(
      {
        adCopy: "Subscribe today for $29.99 (55% off your first box).",
        landingPageUrl:
          "https://gruns.example.com/products/daily-greens-gummies?utm_source=meta&utm_medium=paid_social&utm_campaign=sub55",
        dailyBudget: 500,
      },
      { fetchImpl: mockFetch, lookupFn: mockPublicDns }
    );

    expect(report.overallStatus).toBe("PASS");
    expect(report.waste.estimatedDailyWaste).toBe(0);
    expect(report.checks.find((c) => c.id === "price_parity")?.status).toBe("PASS");
    expect(report.checks.find((c) => c.id === "discount_math")?.status).toBe("PASS");
  });

  it("downgrades Geo-IP currency shift on multi-currency Shopify Markets stores to WARN ($0 hard waste)", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(".js")) {
        return new Response(
          JSON.stringify({
            title: "Second Skin Dewy",
            price: 3000,
            available: true,
            variants: [{ id: 1, title: "Shade 3.0", price: 3000, available: true }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        `<!doctype html><html><head><title>Second Skin</title>
        <script>Shopify.country = "IE"; Shopify.currency = {"active":"EUR","rate":"0.91"};</script>
        </head><body><form action="/localization"><select name="currency_code"></select></form></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const report = await runSingleXRay(
      {
        adCopy: "Second Skin delivers a radiant finish for $33 today.",
        landingPageUrl:
          "https://beauty.example.com/products/second-skin-dewy?utm_source=tiktok&utm_medium=paid_social&utm_campaign=us_launch",
        dailyBudget: 500,
      },
      { fetchImpl: mockFetch, lookupFn: mockPublicDns }
    );

    expect(report.storefront.localization?.multiCurrencyStore).toBe(true);
    expect(report.storefront.localization?.detectedCountry).toBe("IE");
    expect(report.overallStatus).toBe("WARN");
    expect(report.waste.estimatedDailyWaste).toBe(0);
    expect(report.checks.find((c) => c.id === "price_parity")?.status).toBe("WARN");
  });

  it("ignores size ranges like 'Sizes XXS to 3X' and 'Sizes XS-XXL' instead of extracting a bogus single variant", () => {
    const popflex = extractAdClaims(
      "The butterfly leggings are restocked in Sizes XXS to 3X. Use code FLEX30 at checkout for 30% off.",
      "https://popflex.example.com/products/pirouette-skort-black"
    );
    expect(popflex.variantName).toBeNull();

    const dfyne = extractAdClaims(
      "Impact Collection is back in Sizes XS-XXL. Drop code KELS for 10% off.",
      "https://dfyne.example.com/products/impact-red-leggings"
    );
    expect(dfyne.variantName).toBeNull();
  });

  it("still strictly FAILs confirmed non-subscription hard price mismatches and out-of-stock hero variants", () => {
    const claims = extractAdClaims(
      "Trail Hoodie in Alpine Olive (Size L) — now $68.00.",
      "https://store.example.com/products/trail-hoodie?utm_source=meta&utm_medium=paid_social&utm_campaign=fall"
    );
    const { checks, overallStatus } = evaluateParity(claims, {
      url: "https://store.example.com/products/trail-hoodie",
      finalUrl: "https://store.example.com/products/trail-hoodie",
      httpStatus: 200,
      redirectChain: [],
      wafStatus: "NONE",
      title: "Trail Hoodie",
      basePrice: 89,
      compareAtPrice: null,
      currency: "USD",
      inStock: true,
      variants: [
        {
          id: "v-1",
          title: "Alpine Olive / L",
          price: 89,
          compareAtPrice: null,
          available: false,
          sku: "TH-AO-L",
        },
        {
          id: "v-2",
          title: "Charcoal / S",
          price: 89,
          compareAtPrice: null,
          available: true,
          sku: "TH-CH-S",
        },
      ],
      promoVerification: null,
      source: "shopify_js",
    });

    const waste = calculateWaste(checks, 1000, overallStatus);
    expect(overallStatus).toBe("FAIL");
    expect(checks.find((c) => c.id === "price_parity")?.status).toBe("FAIL");
    expect(checks.find((c) => c.id === "variant_stock")?.status).toBe("FAIL");
    expect(waste.estimatedDailyWaste).toBe(850);
  });

  it("downgrades ?variant= OOS on a pure size (e.g. XS) to WARN ($0 waste) when ad copy did not specify that size and other sizes are in stock", () => {
    const claims = extractAdClaims(
      "Your everyday uniform. Women's Seamless Crop Shorts - Slate Blue | Adanola",
      "https://adanola.example.com/products/seamless-crop-shorts-slate-blue?variant=55554742845813&utm_source=meta&utm_medium=paid_social&utm_campaign=shorts"
    );
    const { checks, overallStatus } = evaluateParity(claims, {
      url: "https://adanola.example.com/products/seamless-crop-shorts-slate-blue?variant=55554742845813",
      finalUrl:
        "https://adanola.example.com/products/seamless-crop-shorts-slate-blue?variant=55554742845813",
      httpStatus: 200,
      redirectChain: [],
      wafStatus: "NONE",
      title: "Seamless Crop Shorts - Slate Blue",
      basePrice: 35,
      compareAtPrice: null,
      currency: "GBP",
      inStock: true,
      variants: [
        { id: "55554742845813", title: "XS", price: 35, compareAtPrice: null, available: false, sku: "AD-XS" },
        { id: "55554742878581", title: "S", price: 35, compareAtPrice: null, available: true, sku: "AD-S" },
        { id: "55554742911349", title: "M", price: 35, compareAtPrice: null, available: true, sku: "AD-M" },
      ],
      promoVerification: null,
      source: "shopify_js",
    });

    const waste = calculateWaste(checks, 500, overallStatus);
    expect(overallStatus).toBe("WARN");
    expect(checks.find((c) => c.id === "variant_stock")?.status).toBe("WARN");
    expect(waste.estimatedDailyWaste).toBe(0);
  });
});
