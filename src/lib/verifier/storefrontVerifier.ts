import type {
  FixtureScenarioId,
  RedirectHop,
  StorefrontSnapshot,
  StorefrontVariant,
} from "@/lib/schemas";
import { resolveFixtureSnapshot } from "@/lib/fixtures/demoScenarios";
import { parseHtmlStorefrontMetadata } from "@/lib/verifier/htmlMetadataParser";
import {
  assertSafeUrl,
  SsrfBlockedError,
  type DnsLookupFn,
} from "@/lib/verifier/ssrfGuard";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECT_HOPS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

const USER_AGENT =
  "OfferParityBot/1.0 (+https://offerparity.app; deterministic-ad-verifier)";

export interface VerifyStorefrontInput {
  landingPageUrl: string;
  fixtureId?: FixtureScenarioId;
  promoCode?: string | null;
  fetchImpl?: typeof fetch;
  lookupFn?: DnsLookupFn;
  timeoutMs?: number;
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function isAbortError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  return err instanceof Error && err.name === "AbortError";
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  if (!response.body) {
    const text = await raceWithAbort(response.text(), signal);
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done || !value) {
        break;
      }

      const remaining = maxBytes - totalBytes;
      if (remaining <= 0) {
        await reader.cancel().catch(() => undefined);
        break;
      }

      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        totalBytes += remaining;
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function detectWafChallenge(
  status: number,
  headers: Headers,
  body: string
): { blocked: boolean; provider: string | null } {
  const cfMitigated = headers.get("cf-mitigated");
  if (cfMitigated) {
    return { blocked: true, provider: "Cloudflare" };
  }

  if (status !== 403 && status !== 429 && status !== 503) {
    return { blocked: false, provider: null };
  }

  const server = (headers.get("server") ?? "").toLowerCase();
  const setCookie = (headers.get("set-cookie") ?? "").toLowerCase();
  const xDataDome = headers.get("x-datadome") ?? headers.get("x-datadome-cid");
  const xPx = headers.get("x-px-blocked") ?? headers.get("x-px");

  const bodyLower = body.toLowerCase();

  if (
    xDataDome ||
    setCookie.includes("datadome=") ||
    bodyLower.includes("datadome") ||
    bodyLower.includes("geo.captcha-delivery.com")
  ) {
    return { blocked: true, provider: "DataDome" };
  }

  if (
    xPx ||
    setCookie.includes("_px") ||
    bodyLower.includes("_px") ||
    bodyLower.includes("px-captcha") ||
    bodyLower.includes("perimeterx")
  ) {
    return { blocked: true, provider: "PerimeterX" };
  }

  if (
    bodyLower.includes("_cf_chl_opt") ||
    bodyLower.includes("just a moment...") ||
    bodyLower.includes("cf-challenge-running") ||
    bodyLower.includes("attention required! | cloudflare") ||
    (server.includes("cloudflare") &&
      (bodyLower.includes("cloudflare") || status === 403 || status === 503))
  ) {
    return { blocked: true, provider: "Cloudflare" };
  }

  return { blocked: false, provider: null };
}

/**
 * Shopify `/products/<handle>.js` returns prices as integer cents (e.g., 4500)
 * or occasionally numeric/string dollar or cent values.
 */
function parseShopifyPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      return null;
    }
    if (Number.isInteger(raw)) {
      return Number((raw / 100).toFixed(2));
    }
    return Number(raw.toFixed(2));
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.]/g, "").trim();
    if (!cleaned) {
      return null;
    }
    if (cleaned.includes(".")) {
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) && parsed >= 0
        ? Number(parsed.toFixed(2))
        : null;
    }
    const cents = Number.parseInt(cleaned, 10);
    return Number.isFinite(cents) && cents >= 0
      ? Number((cents / 100).toFixed(2))
      : null;
  }
  return null;
}

function extractShopifyCurrencyFromHtml(html: string): string | null {
  const activeMatch =
    /Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Z]{3})["']/i.exec(
      html
    );
  if (activeMatch?.[1]) {
    return activeMatch[1].toUpperCase();
  }
  const jsonMatch = /["']currency["']\s*:\s*["']([A-Z]{3})["']/i.exec(html);
  if (jsonMatch?.[1]) {
    return jsonMatch[1].toUpperCase();
  }
  return null;
}

interface ShopifyProductJson {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  price?: unknown;
  price_min?: unknown;
  compare_at_price?: unknown;
  compare_at_price_max?: unknown;
  available?: unknown;
  variants?: unknown;
}

function buildSnapshotFromShopifyJson(
  data: ShopifyProductJson,
  htmlMetadata: ReturnType<typeof parseHtmlStorefrontMetadata>,
  htmlBody: string,
  meta: {
    url: string;
    finalUrl: string;
    httpStatus: number;
    redirectChain: RedirectHop[];
  }
): StorefrontSnapshot | null {
  const rawVariants = Array.isArray(data.variants) ? data.variants : null;
  if (!rawVariants && data.price === undefined && data.title === undefined) {
    return null;
  }

  const variants: StorefrontVariant[] = [];
  if (rawVariants) {
    for (let i = 0; i < rawVariants.length; i += 1) {
      const item = rawVariants[i];
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const v = item as Record<string, unknown>;
      const vPrice = parseShopifyPrice(v.price);
      if (vPrice === null) {
        continue;
      }
      const options = Array.isArray(v.options)
        ? v.options.filter((opt): opt is string => typeof opt === "string")
        : undefined;
      const vTitle =
        typeof v.title === "string" && v.title.trim()
          ? v.title.trim()
          : options && options.length > 0
            ? options.join(" / ")
            : `Variant ${i + 1}`;
      variants.push({
        id: v.id !== undefined ? String(v.id) : `shopify-var-${i + 1}`,
        title: vTitle,
        price: vPrice,
        compareAtPrice: parseShopifyPrice(v.compare_at_price),
        available: Boolean(v.available),
        sku: typeof v.sku === "string" && v.sku.trim() ? v.sku.trim() : null,
        optionValues: options && options.length > 0 ? options : undefined,
      });
    }
  }

  const basePrice =
    parseShopifyPrice(data.price) ??
    parseShopifyPrice(data.price_min) ??
    variants[0]?.price ??
    htmlMetadata.basePrice;

  const compareAtPrice =
    parseShopifyPrice(data.compare_at_price) ??
    parseShopifyPrice(data.compare_at_price_max) ??
    variants[0]?.compareAtPrice ??
    htmlMetadata.compareAtPrice;

  const inStock =
    typeof data.available === "boolean"
      ? data.available
      : variants.length > 0
        ? variants.some((v) => v.available)
        : htmlMetadata.inStock;

  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : htmlMetadata.title;

  const currency =
    htmlMetadata.currency ?? extractShopifyCurrencyFromHtml(htmlBody);

  return {
    url: meta.url,
    finalUrl: meta.finalUrl,
    httpStatus: meta.httpStatus,
    redirectChain: meta.redirectChain,
    wafStatus: "NONE",
    wafProvider: null,
    title,
    basePrice,
    compareAtPrice,
    currency,
    inStock,
    variants,
    promoVerification: htmlMetadata.promoVerification,
    source: "shopify_js",
    fetchError: null,
  };
}

function buildErrorSnapshot(params: {
  url: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain: RedirectHop[];
  fetchError: string;
}): StorefrontSnapshot {
  return {
    url: params.url,
    finalUrl: params.finalUrl,
    httpStatus: params.httpStatus,
    redirectChain: params.redirectChain,
    wafStatus: "NONE",
    wafProvider: null,
    title: null,
    basePrice: null,
    compareAtPrice: null,
    currency: null,
    inStock: null,
    variants: [],
    promoVerification: null,
    source: "http_only",
    fetchError: params.fetchError,
  };
}

/**
 * Verify a storefront landing page deterministically via fixture lookup or
 * an SSRF-hardened live HTTP fetch with manual redirect checks, WAF detection,
 * Shopify `/products/<handle>.js` inspection, and JSON-LD/OpenGraph fallback.
 */
export async function verifyStorefront(
  input: VerifyStorefrontInput
): Promise<StorefrontSnapshot> {
  const fixtureSnapshot = resolveFixtureSnapshot({
    fixtureId: input.fixtureId,
    landingPageUrl: input.landingPageUrl,
    promoCode: input.promoCode,
  });

  if (fixtureSnapshot) {
    return fixtureSnapshot;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(
      new Error(`Storefront verification timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

  const redirectChain: RedirectHop[] = [];
  let currentUrl = input.landingPageUrl;

  try {
    const initialSafeUrl = await raceWithAbort(
      assertSafeUrl(input.landingPageUrl, input.lookupFn),
      controller.signal
    );
    currentUrl = initialSafeUrl.toString();

    let finalResponse: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const response = await raceWithAbort(
        fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          },
        }),
        controller.signal
      );

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          finalResponse = response;
          break;
        }

        const resolvedNext = new URL(location, currentUrl).toString();
        const safeNext = await raceWithAbort(
          assertSafeUrl(resolvedNext, input.lookupFn),
          controller.signal
        );

        if (redirectChain.length >= MAX_REDIRECT_HOPS) {
          return buildErrorSnapshot({
            url: input.landingPageUrl,
            finalUrl: currentUrl,
            httpStatus: response.status,
            redirectChain,
            fetchError: `Exceeded maximum redirect limit (${MAX_REDIRECT_HOPS} hops)`,
          });
        }

        redirectChain.push({ url: currentUrl, status: response.status });
        currentUrl = safeNext.toString();
        continue;
      }

      finalResponse = response;
      break;
    }

    if (!finalResponse) {
      return buildErrorSnapshot({
        url: input.landingPageUrl,
        finalUrl: currentUrl,
        httpStatus: 502,
        redirectChain,
        fetchError: "No final HTTP response received",
      });
    }

    const bodyText = await readResponseTextWithLimit(
      finalResponse,
      MAX_RESPONSE_BYTES,
      controller.signal
    );

    const waf = detectWafChallenge(
      finalResponse.status,
      finalResponse.headers,
      bodyText
    );
    if (waf.blocked) {
      return {
        url: input.landingPageUrl,
        finalUrl: currentUrl,
        httpStatus: finalResponse.status,
        redirectChain,
        wafStatus: "WAF_CHALLENGE_MANUAL_CHECK",
        wafProvider: waf.provider,
        title: null,
        basePrice: null,
        compareAtPrice: null,
        currency: null,
        inStock: null,
        variants: [],
        promoVerification: null,
        source: "http_only",
        fetchError: null,
      };
    }

    if (finalResponse.status >= 400) {
      return buildErrorSnapshot({
        url: input.landingPageUrl,
        finalUrl: currentUrl,
        httpStatus: finalResponse.status,
        redirectChain,
        fetchError: `Storefront returned HTTP ${finalResponse.status}`,
      });
    }

    const htmlMetadata = parseHtmlStorefrontMetadata(bodyText, input.promoCode);
    const finalUrlObj = new URL(currentUrl);
    const productPathMatch = /\/products\/([^/?#]+?)(?:\.js)?\/?$/i.exec(
      finalUrlObj.pathname
    );

    // If URL itself already returned Shopify .js JSON directly
    const contentType = (
      finalResponse.headers.get("content-type") ?? ""
    ).toLowerCase();
    if (
      finalUrlObj.pathname.toLowerCase().endsWith(".js") ||
      contentType.includes("application/json")
    ) {
      try {
        const directJson = JSON.parse(bodyText) as ShopifyProductJson;
        const directSnapshot = buildSnapshotFromShopifyJson(
          directJson,
          htmlMetadata,
          bodyText,
          {
            url: input.landingPageUrl,
            finalUrl: currentUrl,
            httpStatus: finalResponse.status,
            redirectChain,
          }
        );
        if (directSnapshot) {
          return directSnapshot;
        }
      } catch {
        // Fall through to HTML parsing
      }
    }

    // Attempt Shopify /products/<handle>.js enrichment
    if (productPathMatch?.[1]) {
      const handle = productPathMatch[1];
      const shopifyJsUrl = new URL(
        `/products/${handle}.js`,
        finalUrlObj.origin
      ).toString();

      try {
        const safeShopifyUrl = await raceWithAbort(
          assertSafeUrl(shopifyJsUrl, input.lookupFn),
          controller.signal
        );
        const shopifyRes = await raceWithAbort(
          fetchImpl(safeShopifyUrl.toString(), {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/json",
            },
          }),
          controller.signal
        );

        if (shopifyRes.ok) {
          const shopifyRaw = await readResponseTextWithLimit(
            shopifyRes,
            MAX_RESPONSE_BYTES,
            controller.signal
          );
          const shopifyJson = JSON.parse(shopifyRaw) as ShopifyProductJson;
          const shopifySnapshot = buildSnapshotFromShopifyJson(
            shopifyJson,
            htmlMetadata,
            bodyText,
            {
              url: input.landingPageUrl,
              finalUrl: currentUrl,
              httpStatus: finalResponse.status,
              redirectChain,
            }
          );
          if (shopifySnapshot) {
            return shopifySnapshot;
          }
        }
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          throw err;
        }
        if (isAbortError(err, controller.signal)) {
          throw err;
        }
        // Non-Shopify storefront or missing .js endpoint: fall back to HTML metadata
      }
    }

    return {
      url: input.landingPageUrl,
      finalUrl: currentUrl,
      httpStatus: finalResponse.status,
      redirectChain,
      wafStatus: "NONE",
      wafProvider: null,
      title: htmlMetadata.title,
      basePrice: htmlMetadata.basePrice,
      compareAtPrice: htmlMetadata.compareAtPrice,
      currency: htmlMetadata.currency,
      inStock: htmlMetadata.inStock,
      variants: htmlMetadata.variants,
      promoVerification: htmlMetadata.promoVerification,
      source: htmlMetadata.source,
      fetchError: null,
    };
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw err;
    }

    if (isAbortError(err, controller.signal)) {
      return buildErrorSnapshot({
        url: input.landingPageUrl,
        finalUrl: currentUrl,
        httpStatus: 504,
        redirectChain,
        fetchError: `Storefront request timed out after ${timeoutMs}ms`,
      });
    }

    return buildErrorSnapshot({
      url: input.landingPageUrl,
      finalUrl: currentUrl,
      httpStatus: 502,
      redirectChain,
      fetchError:
        err instanceof Error ? err.message : "Failed to fetch storefront",
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
