import * as cheerio from "cheerio";
import type {
  PromoVerification,
  StorefrontVariant,
} from "@/lib/schemas";

export interface ParsedHtmlMetadata {
  title: string | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  inStock: boolean | null;
  variants: StorefrontVariant[];
  promoVerification: PromoVerification | null;
  source: "json_ld" | "opengraph" | "http_only";
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

/**
 * Parse product metadata, pricing, availability, and promo banners from HTML
 * using Schema.org JSON-LD first, then OpenGraph/meta tag fallbacks.
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
    : hasOgProductSignal
      ? "opengraph"
      : "http_only";

  return {
    title: jsonLd.title ?? ogTitle,
    basePrice: jsonLd.basePrice ?? ogPrice,
    compareAtPrice: jsonLd.compareAtPrice ?? ogCompareAt,
    currency: jsonLd.currency ?? ogCurrency,
    inStock: jsonLd.inStock ?? ogStock,
    variants: jsonLd.variants,
    promoVerification: detectOnPagePromo($, promoCode),
    source,
  };
}
