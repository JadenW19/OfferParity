import * as cheerio from "cheerio";
import type {
  PromoVerification,
  StorefrontLocalization,
  StorefrontVariant,
  SubscriptionPricing,
} from "@/lib/schemas";

export interface ParsedHtmlMetadata {
  title: string | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  inStock: boolean | null;
  variants: StorefrontVariant[];
  promoVerification: PromoVerification | null;
  subscriptionPricing: SubscriptionPricing;
  localization: StorefrontLocalization;
  source: "json_ld" | "microdata" | "opengraph" | "http_only";
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNumericPrice(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Number(raw.toFixed(2)) : null;
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.,-]/g, "").trim();
    if (!cleaned) {
      return null;
    }
    // Handle comma as thousands separator when dot is present or >2 digits follow comma
    const normalized = cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : /,\d{2}$/.test(cleaned)
        ? cleaned.replace(",", ".")
        : cleaned.replace(/,/g, "");
    const num = Number(normalized);
    return Number.isFinite(num) && num >= 0 ? Number(num.toFixed(2)) : null;
  }
  return null;
}

function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseAvailability(raw: unknown): boolean | null {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (
    value.includes("outofstock") ||
    value.includes("out_of_stock") ||
    value.includes("out of stock") ||
    value.includes("soldout") ||
    value.includes("sold_out") ||
    value.includes("sold out") ||
    value.includes("discontinued") ||
    value === "oos"
  ) {
    return false;
  }
  if (
    value.includes("instock") ||
    value.includes("in_stock") ||
    value.includes("in stock") ||
    value.includes("onlineonly") ||
    value.includes("limitedavailability") ||
    value.includes("preorder") ||
    value === "available"
  ) {
    return true;
  }
  return null;
}

function getSchemaTypes(node: JsonRecord): string[] {
  const rawType = node["@type"];
  const list = Array.isArray(rawType) ? rawType : [rawType];
  return list
    .filter((t): t is string => typeof t === "string")
    .map((t) =>
      t
        .replace(/^https?:\/\/schema\.org\//i, "")
        .replace(/^schema:/i, "")
        .trim()
        .toLowerCase()
    );
}

function hasSchemaType(node: JsonRecord, target: string): boolean {
  return getSchemaTypes(node).includes(target.toLowerCase());
}

function collectJsonLdNodes(root: unknown, out: JsonRecord[]): void {
  if (Array.isArray(root)) {
    for (const item of root) {
      collectJsonLdNodes(item, out);
    }
    return;
  }
  if (!isRecord(root)) {
    return;
  }

  out.push(root);

  if (Array.isArray(root["@graph"])) {
    collectJsonLdNodes(root["@graph"], out);
  }
}

interface OfferExtract {
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  available: boolean | null;
  variants: StorefrontVariant[];
}

function extractPriceSpecification(specRaw: unknown): {
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
} {
  const specs = Array.isArray(specRaw) ? specRaw : [specRaw];
  let price: number | null = null;
  let compareAtPrice: number | null = null;
  let currency: string | null = null;

  for (const spec of specs) {
    if (!isRecord(spec)) {
      continue;
    }
    const specPrice = parseNumericPrice(spec.price);
    const specCurrency = normalizeCurrency(spec.priceCurrency);
    if (!currency && specCurrency) {
      currency = specCurrency;
    }
    const priceType =
      typeof spec.priceType === "string" ? spec.priceType.toLowerCase() : "";
    if (
      priceType.includes("listprice") ||
      priceType.includes("strikethrough")
    ) {
      if (compareAtPrice === null && specPrice !== null) {
        compareAtPrice = specPrice;
      }
    } else if (price === null && specPrice !== null) {
      price = specPrice;
    }
  }

  return { price, compareAtPrice, currency };
}

function extractOfferData(
  offerRaw: unknown,
  fallbackTitle: string | null
): OfferExtract {
  const offerList = Array.isArray(offerRaw) ? offerRaw : [offerRaw];
  const validOffers = offerList.filter(isRecord);
  if (validOffers.length === 0) {
    return {
      price: null,
      compareAtPrice: null,
      currency: null,
      available: null,
      variants: [],
    };
  }

  let primaryPrice: number | null = null;
  let primaryCompareAt: number | null = null;
  let primaryCurrency: string | null = null;
  const availabilities: boolean[] = [];
  const variants: StorefrontVariant[] = [];

  for (let idx = 0; idx < validOffers.length; idx += 1) {
    const offer = validOffers[idx]!;
    if (hasSchemaType(offer, "aggregateoffer")) {
      const low = parseNumericPrice(offer.lowPrice);
      const high = parseNumericPrice(offer.highPrice);
      const direct = parseNumericPrice(offer.price);
      const curr = normalizeCurrency(offer.priceCurrency);
      const avail = parseAvailability(offer.availability);

      const nested = offer.offers
        ? extractOfferData(offer.offers, fallbackTitle)
        : null;

      const resolvedPrice = low ?? direct ?? nested?.price ?? high ?? null;
      if (primaryPrice === null && resolvedPrice !== null) {
        primaryPrice = resolvedPrice;
      }
      if (primaryCurrency === null) {
        primaryCurrency = curr ?? nested?.currency ?? null;
      }
      if (avail !== null) {
        availabilities.push(avail);
      } else if (nested?.available !== null && nested?.available !== undefined) {
        availabilities.push(nested.available);
      }
      if (nested && nested.variants.length > 0) {
        variants.push(...nested.variants);
      }
      continue;
    }

    const spec = extractPriceSpecification(offer.priceSpecification);
    const price = parseNumericPrice(offer.price) ?? spec.price;
    const compareAt = spec.compareAtPrice;
    const currency = normalizeCurrency(offer.priceCurrency) ?? spec.currency;
    const avail = parseAvailability(offer.availability);

    if (primaryPrice === null && price !== null) {
      primaryPrice = price;
    }
    if (primaryCompareAt === null && compareAt !== null) {
      primaryCompareAt = compareAt;
    }
    if (primaryCurrency === null && currency !== null) {
      primaryCurrency = currency;
    }
    if (avail !== null) {
      availabilities.push(avail);
    }

    const offerName =
      typeof offer.name === "string" && offer.name.trim()
        ? offer.name.trim()
        : null;
    const sku =
      typeof offer.sku === "string" && offer.sku.trim()
        ? offer.sku.trim()
        : null;
    const shouldCreateVariant =
      validOffers.length > 1 || offerName !== null || sku !== null;

    if (shouldCreateVariant && price !== null) {
      const id =
        (typeof offer["@id"] === "string" && offer["@id"]) ||
        sku ||
        `offer-${idx + 1}`;
      variants.push({
        id,
        title: offerName ?? fallbackTitle ?? `Option ${idx + 1}`,
        price,
        compareAtPrice: compareAt,
        available: avail ?? true,
        sku,
      });
    }
  }

  const available =
    availabilities.length > 0 ? availabilities.some(Boolean) : null;

  return {
    price: primaryPrice,
    compareAtPrice: primaryCompareAt,
    currency: primaryCurrency,
    available,
    variants,
  };
}

function extractProductFromJsonLd(nodes: JsonRecord[]): {
  title: string | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  inStock: boolean | null;
  variants: StorefrontVariant[];
  found: boolean;
} {
  const productNodes = nodes.filter(
    (node) =>
      hasSchemaType(node, "product") || hasSchemaType(node, "productgroup")
  );

  for (const product of productNodes) {
    const title =
      typeof product.name === "string" && product.name.trim()
        ? product.name.trim()
        : null;
    const variants: StorefrontVariant[] = [];
    let basePrice: number | null = null;
    let compareAtPrice: number | null = null;
    let currency: string | null = null;
    const stockSignals: boolean[] = [];

    if (product.offers !== undefined) {
      const extracted = extractOfferData(product.offers, title);
      basePrice = extracted.price;
      compareAtPrice = extracted.compareAtPrice;
      currency = extracted.currency;
      if (extracted.available !== null) {
        stockSignals.push(extracted.available);
      }
      variants.push(...extracted.variants);
    }

    // Handle ProductGroup.hasVariant
    if (Array.isArray(product.hasVariant)) {
      for (let i = 0; i < product.hasVariant.length; i += 1) {
        const variantNode = product.hasVariant[i];
        if (!isRecord(variantNode)) {
          continue;
        }
        const vTitle =
          typeof variantNode.name === "string" && variantNode.name.trim()
            ? variantNode.name.trim()
            : `Variant ${i + 1}`;
        const vSku =
          typeof variantNode.sku === "string" && variantNode.sku.trim()
            ? variantNode.sku.trim()
            : null;
        const vOffers = extractOfferData(variantNode.offers, vTitle);
        const vPrice = vOffers.price ?? basePrice;
        if (basePrice === null && vOffers.price !== null) {
          basePrice = vOffers.price;
        }
        if (currency === null && vOffers.currency !== null) {
          currency = vOffers.currency;
        }
        if (vOffers.available !== null) {
          stockSignals.push(vOffers.available);
        }
        if (vPrice !== null) {
          variants.push({
            id:
              (typeof variantNode["@id"] === "string" && variantNode["@id"]) ||
              vSku ||
              `variant-${i + 1}`,
            title: vTitle,
            price: vPrice,
            compareAtPrice: vOffers.compareAtPrice,
            available: vOffers.available ?? true,
            sku: vSku,
          });
        }
      }
    }

    const inStock =
      stockSignals.length > 0 ? stockSignals.some(Boolean) : null;

    if (
      title !== null ||
      basePrice !== null ||
      inStock !== null ||
      variants.length > 0
    ) {
      return {
        title,
        basePrice,
        compareAtPrice,
        currency,
        inStock,
        variants,
        found: true,
      };
    }
  }

  // Standalone Offer / AggregateOffer fallback if no Product wrapper exists
  const offerNodes = nodes.filter(
    (node) =>
      hasSchemaType(node, "offer") || hasSchemaType(node, "aggregateoffer")
  );
  if (offerNodes.length > 0) {
    const extracted = extractOfferData(offerNodes, null);
    if (
      extracted.price !== null ||
      extracted.available !== null ||
      extracted.variants.length > 0
    ) {
      return {
        title: null,
        basePrice: extracted.price,
        compareAtPrice: extracted.compareAtPrice,
        currency: extracted.currency,
        inStock: extracted.available,
        variants: extracted.variants,
        found: true,
      };
    }
  }

  return {
    title: null,
    basePrice: null,
    compareAtPrice: null,
    currency: null,
    inStock: null,
    variants: [],
    found: false,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectOnPagePromo(
  $: cheerio.CheerioAPI,
  promoCode?: string | null
): PromoVerification | null {
  const normalizedCode = promoCode?.trim().toUpperCase() || null;
  if (!normalizedCode) {
    return null;
  }

  const metaDescription =
    $('meta[name="description"]').attr("content") ?? "";
  const ogDescription =
    $('meta[property="og:description"]').attr("content") ?? "";

  const $clone = cheerio.load($.html());
  $clone("script, style, noscript").remove();
  const visibleText = $clone("body").text();
  const searchableText = `${metaDescription}\n${ogDescription}\n${visibleText}`
    .replace(/\s+/g, " ")
    .trim();

  const codePattern = new RegExp(
    `(?:^|[^A-Z0-9])${escapeRegExp(normalizedCode)}(?:$|[^A-Z0-9])`,
    "i"
  );
  const match = codePattern.exec(searchableText);

  if (!match) {
    return {
      code: normalizedCode,
      state: "UNVERIFIED_LIVE_STORE",
      discountPct: null,
      discountAmount: null,
      minSpend: null,
      expiresAt: null,
      detail: `Promo code ${normalizedCode} was not found in storefront HTML; checkout verification required.`,
    };
  }

  const start = Math.max(0, match.index - 60);
  const end = Math.min(searchableText.length, match.index + normalizedCode.length + 60);
  const snippet = searchableText.slice(start, end);

  const pctMatch = /(\d{1,2}(?:\.\d+)?)\s*%\s*off/i.exec(snippet);
  const discountPct = pctMatch?.[1] ? Number(pctMatch[1]) : null;

  const amountMatch = /\$\s*(\d+(?:\.\d{1,2})?)\s*off/i.exec(snippet);
  const discountAmount = amountMatch?.[1] ? Number(amountMatch[1]) : null;

  return {
    code: normalizedCode,
    state: "PAGE_BANNER_MATCH",
    discountPct:
      discountPct !== null && Number.isFinite(discountPct) ? discountPct : null,
    discountAmount:
      discountAmount !== null && Number.isFinite(discountAmount)
        ? discountAmount
        : null,
    minSpend: null,
    expiresAt: null,
    detail: `Promo code ${normalizedCode} matched on storefront page banner/text.`,
  };
}

function detectSubscriptionAndBundleSignals(
  $: cheerio.CheerioAPI,
  html: string,
  basePrice: number | null
): SubscriptionPricing {
  const lowerHtml = html.toLowerCase();
  let provider: string | null = null;

  if (lowerHtml.includes("rechargepayments") || lowerHtml.includes("rc-widget")) {
    provider = "Recharge";
  } else if (lowerHtml.includes("skio-plan-picker") || lowerHtml.includes("skio.com")) {
    provider = "Skio";
  } else if (lowerHtml.includes("loop-subscription") || lowerHtml.includes("loopwork")) {
    provider = "Loop";
  } else if (lowerHtml.includes("appstle")) {
    provider = "Appstle";
  } else if (lowerHtml.includes("stay.ai") || lowerHtml.includes("stayai")) {
    provider = "Stay AI";
  } else if (
    $('input[name="selling_plan"][value]:not([value=""]), select[name="selling_plan"] option[value]:not([value=""])')
      .length > 0 ||
    /"selling_plan_groups"\s*:\s*\[\s*\{/i.test(html)
  ) {
    provider = "Shopify Subscriptions";
  }

  const $clone = cheerio.load(html);
  $clone("script, style, noscript").remove();
  const visibleText = $clone("body").text().replace(/\s+/g, " ").trim();

  const subPhraseRegex =
    /\b(?:subscribe\s*(?:&|and)\s*save|autoship(?:\s*(?:&|and)\s*save)?|auto[-\s]?deliver|monthly\s+subscription)\b/gi;
  const subMatches: RegExpExecArray[] = [];
  let subMatch: RegExpExecArray | null;
  while ((subMatch = subPhraseRegex.exec(visibleText)) !== null) {
    subMatches.push(subMatch);
  }
  const detected = provider !== null || subMatches.length > 0;

  if (!detected) {
    return {
      detected: false,
      lowestPrice: null,
      maxDiscountPct: null,
      provider: null,
    };
  }

  let lowestPrice: number | null = null;
  let maxDiscountPct: number | null = null;

  const perUnitSuffixRegex =
    /^\s*(?:\/|per\s+)(?:day|d\b|serving|pack|gumm(?:y|ies)|scoop|dose|oz|ml|unit|count|bar|capsule|pill|tablet|bottle|stick|meal|wk|week|pc|piece|item)\b/i;

  for (const match of subMatches) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(visibleText.length, match.index + 240);
    const snippet = visibleText.slice(start, end);

    const priceRegex = /(?:[$£€]|US\$|CA\$|AU\$)\s*(\d{1,4}(?:\.\d{2})?)/g;
    let pm: RegExpExecArray | null;
    while ((pm = priceRegex.exec(snippet)) !== null) {
      const trailing = snippet.slice(pm.index + pm[0].length, pm.index + pm[0].length + 24);
      if (perUnitSuffixRegex.test(trailing)) {
        continue;
      }
      const val = parseNumericPrice(pm[1]);
      if (
        val !== null &&
        val > 0 &&
        (basePrice === null || (val < basePrice && (basePrice < 15 || val >= basePrice * 0.15))) &&
        (lowestPrice === null || val < lowestPrice)
      ) {
        lowestPrice = val;
      }
    }

    const pctRegex = /(\d{1,2})\s*%\s*off/gi;
    let pctMatch: RegExpExecArray | null;
    while ((pctMatch = pctRegex.exec(snippet)) !== null) {
      const pct = Number(pctMatch[1]);
      if (Number.isFinite(pct) && pct > 0 && pct <= 90) {
        if (maxDiscountPct === null || pct > maxDiscountPct) {
          maxDiscountPct = pct;
        }
      }
    }
  }

  return {
    detected: true,
    lowestPrice,
    maxDiscountPct,
    provider: provider ?? "On-page Subscribe & Save",
  };
}

function detectStorefrontLocalization(
  $: cheerio.CheerioAPI,
  html: string
): StorefrontLocalization {
  const countryMatch =
    /Shopify\.country\s*=\s*["']([A-Z]{2})["']/i.exec(html) ??
    /["']country_code["']\s*:\s*["']([A-Z]{2})["']/i.exec(html);
  const detectedCountry = countryMatch?.[1] ? countryMatch[1].toUpperCase() : null;

  const rateMatch =
    /Shopify\.currency\s*=\s*\{[^}]*["']rate["']\s*:\s*["']?([0-9.]+)["']?/i.exec(html);
  const rateNum = rateMatch?.[1] ? Number(rateMatch[1]) : null;
  const hasNonUnitExchangeRate =
    rateNum !== null && Number.isFinite(rateNum) && Math.abs(rateNum - 1) > 0.001;

  const hasLocalizationForm =
    $('form[action*="/localization"]').length > 0 ||
    $('select[name="currency_code"], select[name="country_code"], input[name="country_code"]')
      .length > 0;

  const hreflangRegions = new Set<string>();
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang")?.trim().toLowerCase();
    if (lang && lang !== "x-default" && /^[a-z]{2}-[a-z]{2}$/.test(lang)) {
      hreflangRegions.add(lang);
    }
  });
  const hasMultipleRegionalAlternates = hreflangRegions.size >= 2;

  const lowerHtml = html.toLowerCase();
  const hasGeoApp =
    lowerHtml.includes("global-e") ||
    lowerHtml.includes("globale") ||
    lowerHtml.includes("shopify-markets") ||
    lowerHtml.includes("currency-selector") ||
    lowerHtml.includes("currency-switcher") ||
    lowerHtml.includes("country-selector") ||
    lowerHtml.includes("geolizr") ||
    lowerHtml.includes("orbe") ||
    lowerHtml.includes("transcy");

  return {
    detectedCountry,
    multiCurrencyStore:
      hasNonUnitExchangeRate ||
      hasLocalizationForm ||
      hasMultipleRegionalAlternates ||
      hasGeoApp,
    requestedCurrency: null,
  };
}

function extractProductFromMicrodata($: cheerio.CheerioAPI): {
  title: string | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  inStock: boolean | null;
  variants: StorefrontVariant[];
  found: boolean;
} {
  const productEl = $(
    '[itemtype*="schema.org/Product" i], [itemtype*="schema.org/ProductGroup" i]'
  ).first();

  if (productEl.length === 0) {
    return {
      title: null,
      basePrice: null,
      compareAtPrice: null,
      currency: null,
      inStock: null,
      variants: [],
      found: false,
    };
  }

  const readItemprop = (
    scope: ReturnType<cheerio.CheerioAPI>,
    prop: string
  ): string | null => {
    const el = scope.find(`[itemprop="${prop}"]`).first();
    if (el.length === 0) return null;
    const raw =
      el.attr("content") ??
      el.attr("href") ??
      el.attr("value") ??
      el.text();
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  };

  const title = readItemprop(productEl, "name");
  const offerEls = productEl.find(
    '[itemprop="offers"], [itemtype*="schema.org/Offer" i]'
  );

  const variants: StorefrontVariant[] = [];
  let basePrice: number | null = null;
  let currency: string | null = null;
  const availabilities: boolean[] = [];

  if (offerEls.length > 0) {
    offerEls.each((idx, el) => {
      const offerScope = $(el);
      const p = parseNumericPrice(readItemprop(offerScope, "price"));
      const c = normalizeCurrency(readItemprop(offerScope, "priceCurrency"));
      const a = parseAvailability(readItemprop(offerScope, "availability"));
      const name = readItemprop(offerScope, "name");
      const sku = readItemprop(offerScope, "sku");

      if (basePrice === null && p !== null) basePrice = p;
      if (currency === null && c !== null) currency = c;
      if (a !== null) availabilities.push(a);

      if ((offerEls.length > 1 || name !== null || sku !== null) && p !== null) {
        variants.push({
          id: sku ?? `microdata-offer-${idx + 1}`,
          title: name ?? title ?? `Option ${idx + 1}`,
          price: p,
          compareAtPrice: null,
          available: a ?? true,
          sku,
        });
      }
    });
  } else {
    basePrice = parseNumericPrice(readItemprop(productEl, "price"));
    currency = normalizeCurrency(readItemprop(productEl, "priceCurrency"));
    const directAvail = parseAvailability(readItemprop(productEl, "availability"));
    if (directAvail !== null) availabilities.push(directAvail);
  }

  const inStock =
    availabilities.length > 0 ? availabilities.some(Boolean) : null;

  const found =
    title !== null || basePrice !== null || inStock !== null || variants.length > 0;

  return {
    title,
    basePrice,
    compareAtPrice: null,
    currency,
    inStock,
    variants,
    found,
  };
}

/**
 * Parse product metadata, pricing, availability, and promo banners from HTML
 * using Schema.org JSON-LD first, then Microdata, then OpenGraph/meta tag fallbacks.
 */
export function parseHtmlStorefrontMetadata(
  html: string,
  promoCode?: string | null
): ParsedHtmlMetadata {
  const $ = cheerio.load(html);

  const allJsonLdNodes: JsonRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      collectJsonLdNodes(parsed, allJsonLdNodes);
    } catch {
      // Ignore malformed JSON-LD script blocks
    }
  });

  const jsonLd = extractProductFromJsonLd(allJsonLdNodes);
  const microdata = jsonLd.found ? null : extractProductFromMicrodata($);

  // OpenGraph & standard meta extraction
  const ogTitle =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="twitter:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;

  const ogPrice = parseNumericPrice(
    $('meta[property="product:price:amount"]').attr("content") ??
      $('meta[property="og:price:amount"]').attr("content") ??
      $('meta[itemprop="price"]').attr("content")
  );

  const ogCompareAt = parseNumericPrice(
    $('meta[property="product:original_price:amount"]').attr("content")
  );

  const ogCurrency = normalizeCurrency(
    $('meta[property="product:price:currency"]').attr("content") ??
      $('meta[property="og:price:currency"]').attr("content") ??
      $('meta[itemprop="priceCurrency"]').attr("content")
  );

  const ogStock = parseAvailability(
    $('meta[property="product:availability"]').attr("content") ??
      $('meta[property="og:availability"]').attr("content") ??
      $('meta[itemprop="availability"]').attr("content") ??
      $('link[itemprop="availability"]').attr("href")
  );

  const hasOgProductSignal =
    ogPrice !== null || ogCurrency !== null || ogStock !== null;

  const source: ParsedHtmlMetadata["source"] = jsonLd.found
    ? "json_ld"
    : microdata?.found
      ? "microdata"
      : hasOgProductSignal
        ? "opengraph"
        : "http_only";

  const resolvedBasePrice = jsonLd.basePrice ?? microdata?.basePrice ?? ogPrice;

  return {
    title: jsonLd.title ?? microdata?.title ?? ogTitle,
    basePrice: resolvedBasePrice,
    compareAtPrice:
      jsonLd.compareAtPrice ?? microdata?.compareAtPrice ?? ogCompareAt,
    currency: jsonLd.currency ?? microdata?.currency ?? ogCurrency,
    inStock: jsonLd.inStock ?? microdata?.inStock ?? ogStock,
    variants:
      jsonLd.variants.length > 0
        ? jsonLd.variants
        : (microdata?.variants ?? []),
    promoVerification: detectOnPagePromo($, promoCode),
    subscriptionPricing: detectSubscriptionAndBundleSignals($, html, resolvedBasePrice),
    localization: detectStorefrontLocalization($, html),
    source,
  };
}
