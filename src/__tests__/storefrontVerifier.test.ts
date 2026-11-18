import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { StorefrontSnapshotSchema } from "@/lib/schemas";
import {
  DEMO_SCENARIO_PRESETS,
  getDemoScenarioPreset,
  resolveFixtureSnapshot,
} from "@/lib/fixtures/demoScenarios";
import { parseHtmlStorefrontMetadata } from "@/lib/verifier/htmlMetadataParser";
import {
  assertSafeUrl,
  SsrfBlockedError,
  type DnsLookupFn,
} from "@/lib/verifier/ssrfGuard";
import { verifyStorefront } from "@/lib/verifier/storefrontVerifier";

const publicDnsLookup: DnsLookupFn = async (): Promise<LookupAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

describe("DEMO_SCENARIO_PRESETS & resolveFixtureSnapshot", () => {
  it("exposes all 3 canonical presets and resolves them deterministically", () => {
    expect(DEMO_SCENARIO_PRESETS).toHaveLength(3);

    const healthyPreset = getDemoScenarioPreset("healthy-offer");
    expect(healthyPreset.expectedVerdict).toBe("PASS");
    expect(healthyPreset.dailyBudget).toBe(600);

    const healthySnap = resolveFixtureSnapshot({
      landingPageUrl: healthyPreset.landingPageUrl,
    });
    expect(healthySnap).not.toBeNull();
    expect(healthySnap?.source).toBe("fixture");
    expect(healthySnap?.basePrice).toBe(45);
    expect(healthySnap?.promoVerification?.code).toBe("HYDRATE20");
    expect(healthySnap?.promoVerification?.state).toBe("ACTIVE");
    expect(healthySnap?.variants.every((v) => v.available)).toBe(true);

    const expiredSnap = resolveFixtureSnapshot({
      fixtureId: "expired-promo",
      landingPageUrl: "https://example.com/custom-override",
    });
    expect(expiredSnap?.promoVerification?.code).toBe("BFCM25");
    expect(expiredSnap?.promoVerification?.state).toBe("EXPIRED");
    expect(expiredSnap?.promoVerification?.expiresAt).toBe("2026-11-05");
    expect(expiredSnap?.basePrice).toBe(199);

    const oosSnap = resolveFixtureSnapshot({
      fixtureId: "oos-price-mismatch",
      landingPageUrl: getDemoScenarioPreset("oos-price-mismatch").landingPageUrl,
    });
    expect(oosSnap?.basePrice).toBe(84);
    expect(oosSnap?.inStock).toBe(true);
    expect(
      oosSnap?.variants.find((v) => v.title === "Alpine Olive / L")?.available
    ).toBe(false);
    expect(
      oosSnap?.variants.find((v) => v.title === "Charcoal / S")?.available
    ).toBe(true);
  });

  it("bypasses network fetch when verifyStorefront runs against a demo fixture", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const snapshot = await verifyStorefront({
      landingPageUrl: getDemoScenarioPreset("healthy-offer").landingPageUrl,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(snapshot.source).toBe("fixture");
    expect(snapshot.httpStatus).toBe(200);
  });
});

describe("ssrfGuard (assertSafeUrl)", () => {
  it("blocks private/loopback/metadata IPs, non-HTTP protocols, credentials, and IPv4-mapped IPv6", async () => {
    const blockedUrls = [
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "http://[::ffff:127.0.0.1]/",
      "http://[::1]/",
      "http://10.0.0.1/",
      "http://172.16.5.4/",
      "http://192.168.1.10/",
      "http://100.64.0.1/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://user:pass@example.com/",
      "http://localhost:3000/test",
      "http://store.local/products/test",
      "http://metadata.google.internal/computeMetadata/v1/",
    ];

    for (const url of blockedUrls) {
      await expect(assertSafeUrl(url, publicDnsLookup)).rejects.toThrow(
        SsrfBlockedError
      );
    }
  });

  it("blocks hostnames whose DNS lookup resolves to a private IP", async () => {
    const rebindingLookup: DnsLookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.10.0.5", family: 4 },
    ];

    await expect(
      assertSafeUrl("https://rebind.example.com/product", rebindingLookup)
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("allows safe public hostnames and public IPv4/IPv6 addresses", async () => {
    const safeUrl = await assertSafeUrl(
      "https://shop.example.com/products/bottle",
      publicDnsLookup
    );
    expect(safeUrl.hostname).toBe("shop.example.com");

    const publicIpv6 = await assertSafeUrl(
      "https://[2606:2800:220:1:248:1893:25c8:1946]/",
      publicDnsLookup
    );
    expect(publicIpv6.protocol).toBe("https:");
  });

  it("blocks open redirects targeting private IP ranges like 10.0.0.1", async () => {
    const redirectFetch: typeof fetch = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://10.0.0.1/internal" },
      });
    });

    await expect(
      verifyStorefront({
        landingPageUrl: "https://shop.example.com/redirect",
        fetchImpl: redirectFetch,
        lookupFn: publicDnsLookup,
      })
    ).rejects.toThrow(SsrfBlockedError);
  });
});

describe("parseHtmlStorefrontMetadata", () => {
  it("parses standard Product JSON-LD and detects on-page promo banner match", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Trail Hydration Pack",
              "offers": {
                "@type": "Offer",
                "price": "59.95",
                "priceCurrency": "USD",
                "availability": "https://schema.org/InStock"
              }
            }
          </script>
        </head>
        <body>
          <div class="banner">Use code TRAIL15 for 15% off today!</div>
        </body>
      </html>
    `;

    const parsed = parseHtmlStorefrontMetadata(html, "TRAIL15");
    expect(parsed.source).toBe("json_ld");
    expect(parsed.title).toBe("Trail Hydration Pack");
    expect(parsed.basePrice).toBe(59.95);
    expect(parsed.currency).toBe("USD");
    expect(parsed.inStock).toBe(true);
    expect(parsed.promoVerification?.state).toBe("PAGE_BANNER_MATCH");
    expect(parsed.promoVerification?.discountPct).toBe(15);
  });

  it("parses @graph arrays and AggregateOffer JSON-LD", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "WebPage", "name": "Storefront" },
                {
                  "@type": "Product",
                  "name": "Recovery Sleeves",
                  "offers": {
                    "@type": "AggregateOffer",
                    "lowPrice": "42.00",
                    "highPrice": "68.00",
                    "priceCurrency": "GBP",
                    "availability": "https://schema.org/OutOfStock"
                  }
                }
              ]
            }
          </script>
        </head>
        <body><p>Recovery Sleeves</p></body>
      </html>
    `;

    const parsed = parseHtmlStorefrontMetadata(html, "MISSINGCODE");
    expect(parsed.source).toBe("json_ld");
    expect(parsed.title).toBe("Recovery Sleeves");
    expect(parsed.basePrice).toBe(42);
    expect(parsed.currency).toBe("GBP");
    expect(parsed.inStock).toBe(false);
    expect(parsed.promoVerification?.state).toBe("UNVERIFIED_LIVE_STORE");
  });

  it("falls back to Schema.org Microdata when JSON-LD is absent, then OpenGraph, then http_only", () => {
    const microdataHtml = `
      <html>
        <head><title>Microdata Store</title></head>
        <body>
          <div itemscope itemtype="https://schema.org/Product">
            <h1 itemprop="name">Aero Running Vest</h1>
            <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
              <meta itemprop="priceCurrency" content="USD" />
              <meta itemprop="price" content="119.00" />
              <link itemprop="availability" href="https://schema.org/InStock" />
              <span itemprop="sku">AERO-VEST-M</span>
            </div>
          </div>
        </body>
      </html>
    `;
    const mdParsed = parseHtmlStorefrontMetadata(microdataHtml);
    expect(mdParsed.source).toBe("microdata");
    expect(mdParsed.title).toBe("Aero Running Vest");
    expect(mdParsed.basePrice).toBe(119);
    expect(mdParsed.currency).toBe("USD");
    expect(mdParsed.inStock).toBe(true);
    expect(mdParsed.variants).toHaveLength(1);
    expect(mdParsed.variants[0]?.sku).toBe("AERO-VEST-M");

    const ogHtml = `
      <html>
        <head>
          <meta property="og:title" content="OG Bottle" />
          <meta property="product:price:amount" content="34.50" />
          <meta property="product:price:currency" content="EUR" />
          <meta property="product:availability" content="instock" />
        </head>
        <body></body>
      </html>
    `;
    const ogParsed = parseHtmlStorefrontMetadata(ogHtml);
    expect(ogParsed.source).toBe("opengraph");
    expect(ogParsed.title).toBe("OG Bottle");
    expect(ogParsed.basePrice).toBe(34.5);
    expect(ogParsed.currency).toBe("EUR");
    expect(ogParsed.inStock).toBe(true);

    const plainHtml = `<html><head><title>Plain Store</title></head><body>Hello</body></html>`;
    const plainParsed = parseHtmlStorefrontMetadata(plainHtml);
    expect(plainParsed.source).toBe("http_only");
    expect(plainParsed.title).toBe("Plain Store");
    expect(plainParsed.basePrice).toBeNull();
  });
});

describe("verifyStorefront live fetch strategies", () => {
  it("enriches /products/<handle> pages via Shopify .js with cent & string prices", async () => {
    const htmlPage = `
      <html>
        <head>
          <meta property="product:price:currency" content="USD" />
          <script>Shopify.currency = {"active":"USD","rate":"1.0"};</script>
        </head>
        <body><div>Banner: Code HYDRATE20 for 20% off</div></body>
      </html>
    `;
    const shopifyJson = {
      title: "Lumina Bottle",
      price: 4500,
      compare_at_price: 5500,
      available: true,
      variants: [
        {
          id: 101,
          title: "Obsidian Black",
          price: 4500,
          compare_at_price: "55.00",
          available: true,
          sku: "LUM-OB",
          options: ["Obsidian Black"],
        },
        {
          id: 102,
          title: "Alpine Olive",
          price: "49.50",
          compare_at_price: null,
          available: false,
          sku: "LUM-AO",
          options: ["Alpine Olive"],
        },
      ],
    };

    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/products/lumina-bottle.js")) {
        return new Response(JSON.stringify(shopifyJson), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(htmlPage, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const snapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/products/lumina-bottle",
      promoCode: "HYDRATE20",
      fetchImpl: mockFetch,
      lookupFn: publicDnsLookup,
    });

    expect(snapshot.source).toBe("shopify_js");
    expect(snapshot.title).toBe("Lumina Bottle");
    expect(snapshot.basePrice).toBe(45);
    expect(snapshot.compareAtPrice).toBe(55);
    expect(snapshot.currency).toBe("USD");
    expect(snapshot.inStock).toBe(true);
    expect(snapshot.variants).toHaveLength(2);
    expect(snapshot.variants[0]?.compareAtPrice).toBe(55);
    expect(snapshot.variants[1]?.price).toBe(49.5);
    expect(snapshot.variants[1]?.available).toBe(false);
    expect(snapshot.promoVerification?.state).toBe("PAGE_BANNER_MATCH");
  });

  it("resolves Shopify /discount/<code>?redirect=/products/<handle> share links to .js product inventory", async () => {
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/products/aero-pack.js")) {
        return new Response(
          JSON.stringify({
            title: "Aero Trail Pack",
            price: 8000,
            available: true,
            variants: [
              {
                id: 99887766,
                title: "Storm Grey",
                price: 8000,
                compare_at_price: 10000,
                available: false,
                sku: "AERO-SG",
                options: ["Storm Grey"],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        '<html><head><meta property="product:price:currency" content="USD" /></head><body>Use SPRING20 for 20% off</body></html>',
        { status: 200, headers: { "content-type": "text/html" } }
      );
    });

    const snapshot = await verifyStorefront({
      landingPageUrl:
        "https://brand.example.com/discount/SPRING20?redirect=/products/aero-pack&variant=99887766",
      promoCode: "SPRING20",
      fetchImpl: mockFetch,
      lookupFn: publicDnsLookup,
    });

    expect(snapshot.source).toBe("shopify_js");
    expect(snapshot.title).toBe("Aero Trail Pack");
    expect(snapshot.variants[0]?.id).toBe("99887766");
    expect(snapshot.variants[0]?.available).toBe(false);
    expect(snapshot.promoVerification?.state).toBe("PAGE_BANNER_MATCH");
  });

  it("handles HTTP 404 and 500 error responses cleanly", async () => {
    const fetch404: typeof fetch = vi.fn(
      async () => new Response("Not Found", { status: 404 })
    );
    const snap404 = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/missing",
      fetchImpl: fetch404,
      lookupFn: publicDnsLookup,
    });
    expect(snap404.httpStatus).toBe(404);
    expect(snap404.wafStatus).toBe("NONE");
    expect(snap404.source).toBe("http_only");
    expect(snap404.fetchError).toContain("404");

    const fetch500: typeof fetch = vi.fn(
      async () => new Response("Server Error", { status: 500 })
    );
    const snap500 = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/error",
      fetchImpl: fetch500,
      lookupFn: publicDnsLookup,
    });
    expect(snap500.httpStatus).toBe(500);
    expect(snap500.fetchError).toContain("500");
  });

  it("detects Cloudflare and DataDome 403 challenges as WAF_CHALLENGE_MANUAL_CHECK", async () => {
    const cloudflareFetch: typeof fetch = vi.fn(
      async () =>
        new Response("<html><title>Just a moment...</title><script>window._cf_chl_opt={};</script></html>", {
          status: 403,
          headers: {
            "cf-mitigated": "challenge",
            server: "cloudflare",
          },
        })
    );

    const cfSnapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/products/bottle",
      fetchImpl: cloudflareFetch,
      lookupFn: publicDnsLookup,
    });
    expect(cfSnapshot.httpStatus).toBe(403);
    expect(cfSnapshot.wafStatus).toBe("WAF_CHALLENGE_MANUAL_CHECK");
    expect(cfSnapshot.wafProvider).toBe("Cloudflare");

    const datadomeFetch: typeof fetch = vi.fn(
      async () =>
        new Response(
          '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>',
          {
            status: 403,
            headers: { "x-datadome": "protected" },
          }
        )
    );

    const ddSnapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/products/boots",
      fetchImpl: datadomeFetch,
      lookupFn: publicDnsLookup,
    });
    expect(ddSnapshot.httpStatus).toBe(403);
    expect(ddSnapshot.wafStatus).toBe("WAF_CHALLENGE_MANUAL_CHECK");
    expect(ddSnapshot.wafProvider).toBe("DataDome");
  });

  it("enforces the shared AbortController timeout across DNS and fetch", async () => {
    const slowFetch: typeof fetch = vi.fn((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const snapshot = await verifyStorefront({
      landingPageUrl: "https://slow.example.com/products/hoodie",
      fetchImpl: slowFetch,
      lookupFn: publicDnsLookup,
      timeoutMs: 40,
    });

    expect(snapshot.httpStatus).toBe(504);
    expect(snapshot.wafStatus).toBe("NONE");
    expect(snapshot.fetchError).toContain("timed out");
  });

  it("tracks safe redirect hops up to 3 and stops if redirect limit is exceeded", async () => {
    let hopCount = 0;
    const fourRedirectsFetch: typeof fetch = vi.fn(async () => {
      hopCount += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://brand.example.com/step-${hopCount}` },
      });
    });

    const snapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/start",
      fetchImpl: fourRedirectsFetch,
      lookupFn: publicDnsLookup,
    });

    expect(snapshot.redirectChain).toHaveLength(3);
    expect(snapshot.fetchError).toContain("Exceeded maximum redirect limit");
    expect(StorefrontSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("follows up to 3 safe redirects to a 200 JSON-LD landing page", async () => {
    let calls = 0;
    const twoHopFetch: typeof fetch = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) {
        return new Response(null, {
          status: 301,
          headers: { location: `https://brand.example.com/hop-${calls}` },
        });
      }
      return new Response(
        `<html><head><script type="application/ld+json">${JSON.stringify({
          "@type": "Product",
          name: "Redirected Tee",
          offers: {
            "@type": "Offer",
            price: "29.00",
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          },
        })}</script></head><body></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    });

    const snapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/start",
      fetchImpl: twoHopFetch,
      lookupFn: publicDnsLookup,
    });

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.redirectChain).toHaveLength(2);
    expect(snapshot.finalUrl).toBe("https://brand.example.com/hop-2");
    expect(snapshot.source).toBe("json_ld");
    expect(snapshot.basePrice).toBe(29);
    expect(StorefrontSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("caps streamed response reading at 2 MB", async () => {
    const chunkSize = 512 * 1024;
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === 0) {
          const head = new TextEncoder().encode(
            '<html><head><meta property="og:title" content="Big Page" /></head><body>'
          );
          controller.enqueue(head);
          emitted += head.byteLength;
          return;
        }
        if (emitted < 3 * 1024 * 1024) {
          controller.enqueue(new Uint8Array(chunkSize).fill(65)); // 'A'
          emitted += chunkSize;
          return;
        }
        controller.close();
      },
    });

    const largeFetch: typeof fetch = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );

    const snapshot = await verifyStorefront({
      landingPageUrl: "https://brand.example.com/large",
      fetchImpl: largeFetch,
      lookupFn: publicDnsLookup,
    });

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.title).toBe("Big Page");
    expect(StorefrontSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});
