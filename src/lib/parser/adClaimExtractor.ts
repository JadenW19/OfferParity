import {
  ExtractedAdClaimsSchema,
  type ClaimSignal,
  type ExtractedAdClaims,
  type UtmParams,
} from "@/lib/schemas";

const PROMO_STOPWORDS = new Set([
  "CHECKOUT",
  "TODAY",
  "HERE",
  "FREE",
  "LINK",
  "NOW",
  "CODE",
  "PROMO",
  "ORDER",
  "ORDERS",
  "SHIPPING",
  "SAVE",
  "OFF",
  "ONLY",
  // Common English glue words that appear in ALL-CAPS ad copy
  "FOR",
  "THE",
  "AND",
  "WITH",
  "YOUR",
  "OUR",
  "THIS",
  "THAT",
  "FROM",
  "INTO",
  "NEEDED",
  "REQUIRED",
  "APPLIED",
  "AUTOMATIC",
]);

const NON_VARIANT_IN_WORDS = new Set([
  "stock",
  "size",
  "sizes",
  "all",
  "time",
  "usa",
  "us",
  "uk",
  "canada",
  "europe",
  "australia",
  "checkout",
  "cart",
  "bio",
  "store",
  "stores",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
  "total",
  "sale",
  "advance",
  "our",
  "your",
  "this",
  "that",
  "every",
  "all",
  "any",
  "some",
  "select",
  "limited",
]);

const CURRENCY_PREFIX_RE = /(?:CA\$|AU\$|NZ\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])/;
const CURRENCY_SUFFIX_RE = /(?:USD|GBP|EUR|CAD|AUD)/;
const AMOUNT_RE = /\d{1,3}(?:,\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/;

const MONEY_TOKEN_RE = new RegExp(
  `(?:(?<prefix>${CURRENCY_PREFIX_RE.source})\\s*(?<amount1>${AMOUNT_RE.source})(?:\\s*(?<suffix1>${CURRENCY_SUFFIX_RE.source}))?\\b|\\b(?<amount2>${AMOUNT_RE.source})\\s*(?<suffix2>${CURRENCY_SUFFIX_RE.source})\\b)`,
  "gi"
);

const SHIPPING_THRESHOLD_PATTERNS: RegExp[] = [
  /(?:free|complimentary|flat[- ]rate|express|standard|fast|us|worldwide)?\s*shipping\s+(?:is\s+free\s+)?(?:on\s+)?(?:all\s+)?orders?\s+(?:over|above|of|from|at)?\s*(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+?/gi,
  /(?:free|complimentary|flat[- ]rate|express|standard|fast|us|worldwide)?\s*shipping\s+(?:over|above|starting\s+at)\s+(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+?/gi,
  /(?:free|complimentary|flat[- ]rate|express|standard|fast|us|worldwide)?\s*shipping\s+(?:on\s+)?(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+(?:\s*orders?)?/gi,
  /(?:min(?:imum)?\s*(?:order|spend|purchase)(?:\s+of)?)\s*:?\s*(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+?/gi,
  /(?:on\s+)?orders?\s+(?:over|above)\s+(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+?/gi,
  /(?:on\s+)?orders?\s+(?:of\s+)?(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\s*(?:USD|GBP|EUR|CAD|AUD)?\+/gi,
  /(?:when\s+you\s+)?spend\s+(?:over\s+|at\s+least\s+)?(?:CA\$|AU\$|C\$|A\$|US\$|USD|GBP|EUR|CAD|AUD|[$£€])\s*\d[\d,]*(?:[.,]\d{1,2})?\+?/gi,
];

interface MoneyToken {
  raw: string;
  amount: number;
  currency: string;
  start: number;
  end: number;
  role: "advertised" | "compareAt" | "savings" | null;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mapCurrencyToken(token: string): string {
  const upper = token.toUpperCase();
  if (upper === "CAD" || upper === "CA$" || upper === "C$") return "CAD";
  if (upper === "AUD" || upper === "AU$" || upper === "A$") return "AUD";
  if (upper === "GBP" || upper === "£") return "GBP";
  if (upper === "EUR" || upper === "€") return "EUR";
  return "USD";
}

function parseNumericAmount(rawAmount: string): number | null {
  let normalized = rawAmount.trim();
  if (normalized.includes(",") && !normalized.includes(".")) {
    // European decimal format (e.g. 49,99) vs thousands separator (e.g. 1,200)
    if (/,\d{1,2}$/.test(normalized)) {
      normalized = normalized.replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function maskShippingThresholds(text: string): {
  sanitized: string;
  filteredMatches: string[];
} {
  let sanitized = text;
  const filteredMatches: string[] = [];

  for (const pattern of SHIPPING_THRESHOLD_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, (match) => {
      if (/\d/.test(match)) {
        filteredMatches.push(match.trim());
        return " ".repeat(match.length);
      }
      return match;
    });
  }

  return { sanitized, filteredMatches };
}

function extractMoneyTokens(text: string): MoneyToken[] {
  const tokens: MoneyToken[] = [];
  MONEY_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MONEY_TOKEN_RE.exec(text)) !== null) {
    const groups = match.groups;
    if (!groups) continue;

    const rawAmount = groups.amount1 ?? groups.amount2;
    if (!rawAmount) continue;

    const amount = parseNumericAmount(rawAmount);
    if (amount === null) continue;

    // Prefer explicit ISO suffix (e.g. "$49 CAD") over generic "$" symbol
    const currencyRaw =
      groups.suffix1 ?? groups.suffix2 ?? groups.prefix ?? "$";
    const currency = mapCurrencyToken(currencyRaw);

    tokens.push({
      raw: match[0].trim(),
      amount,
      currency,
      start: match.index,
      end: match.index + match[0].length,
      role: null,
    });
  }

  return tokens;
}

function extractPricesAndCurrency(adCopy: string): {
  advertisedPrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  signals: ClaimSignal[];
} {
  const signals: ClaimSignal[] = [];
  const { sanitized, filteredMatches } = maskShippingThresholds(adCopy);
  const tokens = extractMoneyTokens(sanitized);

  if (tokens.length === 0) {
    return {
      advertisedPrice: null,
      compareAtPrice: null,
      currency: null,
      signals,
    };
  }

  // 1. Detect "save <M1> off/on <M2>" pairs
  let derivedAdvertised: { amount: number; currency: string; raw: string } | null =
    null;

  for (let i = 0; i < tokens.length - 1; i++) {
    const curr = tokens[i];
    const next = tokens[i + 1];
    if (!curr || !next) continue;

    const beforeCurr = sanitized.slice(Math.max(0, curr.start - 20), curr.start);
    const between = sanitized.slice(curr.end, next.start);

    if (
      /\bsave\s*$/i.test(beforeCurr) &&
      /^\s*(?:off|on)\s*$/i.test(between) &&
      next.amount > curr.amount
    ) {
      curr.role = "savings";
      next.role = "compareAt";
      derivedAdvertised = {
        amount: roundCurrency(next.amount - curr.amount),
        currency: next.currency,
        raw: sanitized.slice(
          Math.max(0, curr.start - 5),
          next.end
        ).trim(),
      };
      continue;
    }

    // 2. Detect "<M1> -> <M2>" or "from <M1> to <M2>"
    if (/^\s*(?:-->|->|=>|→|➜)\s*$/.test(between)) {
      curr.role = "compareAt";
      next.role = "advertised";
      continue;
    }

    if (
      /\bfrom\s*$/i.test(beforeCurr) &&
      /^\s+to\s+$/i.test(between) &&
      curr.amount > next.amount
    ) {
      curr.role = "compareAt";
      next.role = "advertised";
    }
  }

  // 3. Classify remaining tokens via local context
  const compareAtPrefixRe =
    /(?:\b(?:was|reg\.?|regular(?:ly)?|msrp|retail|orig\.?|originally|list|value|down\s+from)\s*[:\-]?\s*$|%\s*(?:off|discount)\s*$)/i;
  const advertisedPrefixRe =
    /\b(?:now|only|just|today|sale(?:\s+price)?|yours\s+for|get\s+it\s+for|for|starting\s+at)\s*[:(\-]?\s*$/i;
  const savingsPrefixRe = /\bsave\s*$/i;
  const savingsSuffixRe = /^\s*off\b/i;

  for (const token of tokens) {
    if (token.role !== null) continue;
    const before = sanitized.slice(Math.max(0, token.start - 30), token.start);
    const after = sanitized.slice(token.end, Math.min(sanitized.length, token.end + 15));

    if (compareAtPrefixRe.test(before)) {
      token.role = "compareAt";
    } else if (savingsPrefixRe.test(before) || savingsSuffixRe.test(after)) {
      token.role = "savings";
    } else if (advertisedPrefixRe.test(before)) {
      token.role = "advertised";
    }
  }

  const advertisedToken =
    tokens.find((t) => t.role === "advertised") ??
    tokens.find((t) => t.role === null) ??
    null;

  const compareAtToken =
    tokens.find((t) => t.role === "compareAt" && t !== advertisedToken) ?? null;

  let advertisedPrice = advertisedToken ? advertisedToken.amount : null;
  const compareAtPrice = compareAtToken ? compareAtToken.amount : null;

  const filterNote =
    filteredMatches.length > 0
      ? `Excluded shipping/order threshold(s): ${filteredMatches.join(", ")}`
      : undefined;

  if (advertisedToken) {
    signals.push({
      field: "advertisedPrice",
      source: "ad_copy",
      rawMatch: advertisedToken.raw,
      confidence: advertisedToken.role === "advertised" ? "high" : "medium",
      ...(filterNote ? { note: filterNote } : {}),
    });
  } else if (derivedAdvertised) {
    advertisedPrice = derivedAdvertised.amount;
    signals.push({
      field: "advertisedPrice",
      source: "derived",
      rawMatch: derivedAdvertised.raw,
      confidence: "medium",
      note: `Derived from savings minus anchor price${filterNote ? `; ${filterNote}` : ""}`,
    });
  }

  if (compareAtToken) {
    signals.push({
      field: "compareAtPrice",
      source: "ad_copy",
      rawMatch: compareAtToken.raw,
      confidence: "high",
    });
  }

  const currencySource =
    advertisedToken ?? compareAtToken ?? (derivedAdvertised ? { currency: derivedAdvertised.currency, raw: derivedAdvertised.raw } : null);
  const currency = currencySource ? currencySource.currency : null;

  if (currency && currencySource) {
    signals.push({
      field: "currency",
      source: "ad_copy",
      rawMatch: currencySource.raw,
      confidence: "high",
    });
  }

  return { advertisedPrice, compareAtPrice, currency, signals };
}

function isValidPromoToken(candidate: string): boolean {
  if (candidate.length < 3 || candidate.length > 20) return false;
  if (!/^[A-Z0-9][A-Z0-9_-]*[A-Z0-9]$/.test(candidate)) return false;
  // Require at least one uppercase letter so bare numbers (e.g. "2026") don't match
  if (!/[A-Z]/.test(candidate)) return false;
  if (PROMO_STOPWORDS.has(candidate)) return false;
  return true;
}

function extractPromoCode(adCopy: string): {
  promoCode: string | null;
  signal: ClaimSignal | null;
} {
  const patterns: RegExp[] = [
    /(?:\b(?:use|enter|apply)\s+(?:promo|coupon|discount|voucher)?\s*code|\b(?:promo|coupon|discount|voucher)\s+code|\b(?:code|promo|coupon|voucher))\s*(?:is|:|=)?\s*["'“”‘’]?([A-Za-z0-9_-]{2,25})["'“”‘’]?/gi,
    /\b(?:apply|enter|use)\s+["'“”‘’]?([A-Za-z0-9_-]{2,25})["'“”‘’]?\s+at\s+checkout\b/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(adCopy)) !== null) {
      const token = match[1];
      if (!token) continue;

      // Skip negated phrasing like "no promo code needed"
      const preceding = adCopy.slice(Math.max(0, match.index - 16), match.index);
      if (/\b(?:no|without)\s+$/i.test(preceding)) {
        continue;
      }

      // Enforce uppercase/alphanumeric token validation (no lowercase English prose words)
      if (isValidPromoToken(token)) {
        return {
          promoCode: token,
          signal: {
            field: "promoCode",
            source: "ad_copy",
            rawMatch: match[0].trim(),
            confidence: "high",
          },
        };
      }
    }
  }

  return { promoCode: null, signal: null };
}

function extractDiscountPct(adCopy: string): {
  discountPct: number | null;
  isUpToDiscount: boolean;
  signal: ClaimSignal | null;
} {
  const upToPattern =
    /\bup\s+to\s+(\d{1,3}(?:\.\d{1,2})?)\s*%(?:\s*(?:off|discount|savings|sitewide|storewide))?\b/i;
  const upToMatch = upToPattern.exec(adCopy);
  if (upToMatch && upToMatch[1]) {
    const pct = Number.parseFloat(upToMatch[1]);
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
      return {
        discountPct: pct,
        isUpToDiscount: true,
        signal: {
          field: "discountPct",
          source: "ad_copy",
          rawMatch: upToMatch[0].trim(),
          confidence: "high",
          note: "Up-to ceiling discount claim",
        },
      };
    }
  }

  const flatPatterns: RegExp[] = [
    /(\d{1,3}(?:\.\d{1,2})?)\s*%\s*(?:off|discount|savings|sitewide|storewide)\b/i,
    /\b(?:save|get|take|enjoy|extra|flat)\s+(\d{1,3}(?:\.\d{1,2})?)\s*%/i,
  ];

  for (const pattern of flatPatterns) {
    const match = pattern.exec(adCopy);
    if (match && match[1]) {
      const pct = Number.parseFloat(match[1]);
      if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
        return {
          discountPct: pct,
          isUpToDiscount: false,
          signal: {
            field: "discountPct",
            source: "ad_copy",
            rawMatch: match[0].trim(),
            confidence: "high",
          },
        };
      }
    }
  }

  return { discountPct: null, isUpToDiscount: false, signal: null };
}

function cleanVariantCandidate(raw: string): string {
  return raw
    .trim()
    .replace(/\s+(?:for|at|with|on|from|to|now|only|just|today|save|get)\b.*$/i, "")
    .replace(/[.,!?;:—–-]+$/, "")
    .trim();
}

function extractVariantFromAdCopy(adCopy: string): {
  variantName: string | null;
  signal: ClaimSignal | null;
} {
  // 1. Explicit "Color: X" (optionally followed by "(Size Y)" or ", Size: Y")
  const colorWithSizeMatch =
    /\b(?:color|colour|shade|finish)\s*:\s*([A-Za-z0-9][A-Za-z0-9 '&/-]{0,40}?)(?:\s*(?:\(\s*(?:size\s*:?\s*)?([A-Za-z0-9-]+)\s*\)|,\s*size\s*:?\s*([A-Za-z0-9-]+)))?(?=[.\n!?;]|(?:\s+(?:—|–|for|at|with|now|only|today)\b)|$)/i.exec(
      adCopy
    );
  if (colorWithSizeMatch && colorWithSizeMatch[1]) {
    const base = cleanVariantCandidate(colorWithSizeMatch[1]);
    const size = colorWithSizeMatch[2] ?? colorWithSizeMatch[3];
    if (base.length > 0) {
      const variantName = size ? `${base} (Size ${size})` : base;
      return {
        variantName,
        signal: {
          field: "variantName",
          source: "ad_copy",
          rawMatch: colorWithSizeMatch[0].trim(),
          confidence: "high",
        },
      };
    }
  }

  // 2. Explicit "Variant: ...", "Flavor: ...", "Pack: ...", "Style: ...", "Size: ..."
  const labelMatch =
    /\b(?:variant|flavor|flavour|scent|pack|style|edition|size)\s*:\s*([A-Za-z0-9][A-Za-z0-9 ()'&/+_-]{0,45}?)(?=[.\n!?;]|(?:\s+(?:—|–|for|at|with|now|only|today)\b)|$)/i.exec(
      adCopy
    );
  if (labelMatch && labelMatch[1]) {
    const cleaned = cleanVariantCandidate(labelMatch[1]);
    if (cleaned.length > 0) {
      return {
        variantName: cleaned,
        signal: {
          field: "variantName",
          source: "ad_copy",
          rawMatch: labelMatch[0].trim(),
          confidence: "high",
        },
      };
    }
  }

  // 3. Prepositional "in <TitleCase Color/Flavor> (Size L)" or "in <TitleCase> / L" or "in 2-Pack"
  const inPackMatch = /\bin\s+(\d{1,3}[-\s]?(?:pack|count|ct))\b/i.exec(adCopy);
  if (inPackMatch && inPackMatch[1]) {
    return {
      variantName: inPackMatch[1].trim(),
      signal: {
        field: "variantName",
        source: "ad_copy",
        rawMatch: inPackMatch[0].trim(),
        confidence: "high",
      },
    };
  }

  const inVariantRe =
    /\bin\s+([A-Z][A-Za-z0-9']*(?:\s+[A-Z][A-Za-z0-9']*){0,3}(?:\s*\(\s*Size\s+[A-Za-z0-9-]+\s*\)|\s*\/\s*[A-Za-z0-9-]+)?)/g;
  let inMatch: RegExpExecArray | null;
  while ((inMatch = inVariantRe.exec(adCopy)) !== null) {
    const rawCandidate = inMatch[1];
    if (!rawCandidate) continue;
    const cleaned = cleanVariantCandidate(rawCandidate);
    if (!cleaned) continue;

    const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (NON_VARIANT_IN_WORDS.has(firstWord)) continue;

    return {
      variantName: cleaned,
      signal: {
        field: "variantName",
        source: "ad_copy",
        rawMatch: inMatch[0].trim(),
        confidence: "high",
      },
    };
  }

  // 4. Standalone pack-count or "Size <X>"
  const packMatch = /\b(\d{1,3}-(?:Pack|Count|ct))\b/i.exec(adCopy);
  if (packMatch && packMatch[1]) {
    return {
      variantName: packMatch[1].trim(),
      signal: {
        field: "variantName",
        source: "ad_copy",
        rawMatch: packMatch[0].trim(),
        confidence: "medium",
      },
    };
  }

  const sizeMatch =
    /\bSize\s+(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|Small|Medium|Large|X-Large|\d{1,2}(?:\.\d)?)\b/i.exec(
      adCopy
    );
  if (sizeMatch && sizeMatch[0]) {
    return {
      variantName: sizeMatch[0].trim(),
      signal: {
        field: "variantName",
        source: "ad_copy",
        rawMatch: sizeMatch[0].trim(),
        confidence: "medium",
      },
    };
  }

  return { variantName: null, signal: null };
}

function parseUrlSafe(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function getParamNormalized(params: URLSearchParams, key: string): string | null {
  const direct = params.get(key);
  if (direct !== null) {
    const trimmed = direct.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const lowerKey = key.toLowerCase();
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase() === lowerKey) {
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

function extractPromoFromUrl(parsedUrl: URL | null): {
  promoCode: string | null;
  signal: ClaimSignal | null;
} {
  if (!parsedUrl) return { promoCode: null, signal: null };

  const discountPathMatch = /\/discount\/([A-Za-z0-9_-]{3,20})(?:\/|$)/i.exec(
    parsedUrl.pathname
  );
  if (discountPathMatch?.[1]) {
    const candidate = decodeURIComponent(discountPathMatch[1]).trim().toUpperCase();
    if (
      /^[A-Z0-9_-]{3,20}$/.test(candidate) &&
      /[A-Z]/.test(candidate) &&
      !PROMO_STOPWORDS.has(candidate)
    ) {
      return {
        promoCode: candidate,
        signal: {
          field: "promoCode",
          source: "landing_url",
          rawMatch: `/discount/${discountPathMatch[1]}`,
          confidence: "high",
          note: "Extracted from Shopify shareable discount link",
        },
      };
    }
  }

  return { promoCode: null, signal: null };
}

function extractVariantFromUrl(parsedUrl: URL | null): {
  variantId: string | null;
  variantIdSignal: ClaimSignal | null;
  variantName: string | null;
  signal: ClaimSignal | null;
} {
  if (!parsedUrl) {
    return {
      variantId: null,
      variantIdSignal: null,
      variantName: null,
      signal: null,
    };
  }

  const params = parsedUrl.searchParams;
  const color = getParamNormalized(params, "color") ?? getParamNormalized(params, "colour");
  const size = getParamNormalized(params, "size");
  const flavor = getParamNormalized(params, "flavor") ?? getParamNormalized(params, "flavour");
  const variant = getParamNormalized(params, "variant");

  let variantId: string | null = null;
  let variantIdSignal: ClaimSignal | null = null;
  const isNumericVariantId = variant !== null && /^\d{4,24}$/.test(variant);

  if (isNumericVariantId && variant) {
    variantId = variant;
    variantIdSignal = {
      field: "variantId",
      source: "landing_url",
      rawMatch: `variant=${variant}`,
      confidence: "high",
      note: "Numeric storefront variant ID parameter",
    };
  }

  if (color && size) {
    const combined = `${color} / ${size}`;
    return {
      variantId,
      variantIdSignal,
      variantName: combined,
      signal: {
        field: "variantName",
        source: "landing_url",
        rawMatch: `color=${color}&size=${size}`,
        confidence: "medium",
      },
    };
  }

  if (variant && !isNumericVariantId) {
    return {
      variantId,
      variantIdSignal,
      variantName: variant,
      signal: {
        field: "variantName",
        source: "landing_url",
        rawMatch: `variant=${variant}`,
        confidence: "medium",
      },
    };
  }

  if (color) {
    return {
      variantId,
      variantIdSignal,
      variantName: color,
      signal: {
        field: "variantName",
        source: "landing_url",
        rawMatch: `color=${color}`,
        confidence: "medium",
      },
    };
  }

  if (flavor) {
    return {
      variantId,
      variantIdSignal,
      variantName: flavor,
      signal: {
        field: "variantName",
        source: "landing_url",
        rawMatch: `flavor=${flavor}`,
        confidence: "medium",
      },
    };
  }

  if (size) {
    return {
      variantId,
      variantIdSignal,
      variantName: `Size ${size}`,
      signal: {
        field: "variantName",
        source: "landing_url",
        rawMatch: `size=${size}`,
        confidence: "medium",
      },
    };
  }

  return { variantId, variantIdSignal, variantName: null, signal: null };
}

const UTM_KEYS: Array<keyof UtmParams> = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "ttclid",
  "gclid",
];

function extractUtmParams(parsedUrl: URL | null): {
  utmParams: UtmParams;
  signal: ClaimSignal | null;
} {
  const utmParams: UtmParams = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    fbclid: null,
    ttclid: null,
    gclid: null,
  };

  if (!parsedUrl) {
    return { utmParams, signal: null };
  }

  const foundPairs: string[] = [];
  for (const key of UTM_KEYS) {
    const value = getParamNormalized(parsedUrl.searchParams, key);
    if (value !== null) {
      utmParams[key] = value;
      foundPairs.push(`${key}=${value}`);
    }
  }

  const signal: ClaimSignal | null =
    foundPairs.length > 0
      ? {
          field: "utmParams",
          source: "landing_url",
          rawMatch: foundPairs.join("&"),
          confidence: "high",
        }
      : null;

  return { utmParams, signal };
}

/**
 * Deterministically extracts structured marketing claims and provenance signals
 * from paid ad copy and its target landing page URL.
 */
export function extractAdClaims(
  adCopy: string,
  landingPageUrl: string
): ExtractedAdClaims {
  const safeAdCopy = typeof adCopy === "string" ? adCopy : "";
  const safeUrl = typeof landingPageUrl === "string" ? landingPageUrl : "";
  const parsedUrl = parseUrlSafe(safeUrl);

  const signals: ClaimSignal[] = [];

  const priceResult = extractPricesAndCurrency(safeAdCopy);
  signals.push(...priceResult.signals);

  const adPromo = extractPromoCode(safeAdCopy);
  const urlPromo = adPromo.promoCode ? null : extractPromoFromUrl(parsedUrl);
  const promoCode = adPromo.promoCode ?? urlPromo?.promoCode ?? null;
  if (adPromo.signal) {
    signals.push(adPromo.signal);
  } else if (urlPromo?.signal) {
    signals.push(urlPromo.signal);
  }

  const discountResult = extractDiscountPct(safeAdCopy);
  if (discountResult.signal) signals.push(discountResult.signal);

  const adVariant = extractVariantFromAdCopy(safeAdCopy);
  const urlVariant = extractVariantFromUrl(parsedUrl);
  const variantId = urlVariant.variantId;
  const variantName = adVariant.variantName ?? urlVariant.variantName ?? null;
  if (urlVariant.variantIdSignal) {
    signals.push(urlVariant.variantIdSignal);
  }
  if (adVariant.signal) {
    signals.push(adVariant.signal);
  } else if (urlVariant.signal) {
    signals.push(urlVariant.signal);
  }

  const utmResult = extractUtmParams(parsedUrl);
  if (utmResult.signal) signals.push(utmResult.signal);

  return ExtractedAdClaimsSchema.parse({
    advertisedPrice: priceResult.advertisedPrice,
    compareAtPrice: priceResult.compareAtPrice,
    currency: priceResult.currency,
    promoCode,
    discountPct: discountResult.discountPct,
    isUpToDiscount: discountResult.isUpToDiscount,
    variantId,
    variantName,
    utmParams: utmResult.utmParams,
    signals,
  });
}
