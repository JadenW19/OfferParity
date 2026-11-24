import type {
  ExtractedAdClaims,
  OverallVerdict,
  ParityCheck,
  StorefrontSnapshot,
  StorefrontVariant,
} from "@/lib/schemas";

const PRICE_TOLERANCE = 0.01;
const DISCOUNT_TOLERANCE_PP = 2;

const VARIANT_LABEL_STOPWORDS = new Set([
  "size",
  "color",
  "colour",
  "variant",
  "style",
  "option",
  "edition",
]);

const SIZE_ALIASES: Record<string, string> = {
  xsmall: "xs",
  small: "s",
  medium: "m",
  large: "l",
  xlarge: "xl",
  xxlarge: "xxl",
  "2xl": "xxl",
  "3xl": "xxxl",
};

const PURE_SIZE_VARIANT_PATTERN =
  /^(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl|2xl|3xl|4xl|xsmall|small|medium|large|xlarge|xxlarge|one\s*size|os|\d{1,2}(?:\.\d)?)$/i;

function isPureSizeVariant(title: string): boolean {
  return PURE_SIZE_VARIANT_PATTERN.test(title.trim());
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(amount: number, currency: string | null): string {
  const code = currency ? currency.toUpperCase() : "USD";
  const prefix =
    code === "USD" || code === "CAD" || code === "AUD"
      ? "$"
      : code === "GBP"
        ? "£"
        : code === "EUR"
          ? "€"
          : `${code} `;
  const suffix = code === "CAD" || code === "AUD" ? ` ${code}` : "";
  return `${prefix}${amount.toFixed(2)}${suffix}`;
}

function tokenizeVariantText(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !VARIANT_LABEL_STOPWORDS.has(token));

  return rawTokens.map((token) => SIZE_ALIASES[token] ?? token);
}

/**
 * Matches an advertised hero variant by exact numeric/string ID first (`?variant=4419283712`),
 * then falls back to normalized token matching on variant title/options.
 */
function matchHeroVariant(
  claims: Pick<ExtractedAdClaims, "variantId" | "variantName">,
  variants: StorefrontVariant[]
): StorefrontVariant | null {
  if (variants.length === 0) {
    return null;
  }

  if (claims.variantId) {
    const exactIdMatch = variants.find(
      (variant) => variant.id.trim() === claims.variantId?.trim()
    );
    if (exactIdMatch) {
      return exactIdMatch;
    }
  }

  const variantName = claims.variantName;
  if (!variantName) {
    return null;
  }

  const adTokens = Array.from(new Set(tokenizeVariantText(variantName)));
  if (adTokens.length === 0) {
    return null;
  }

  let bestMatch: StorefrontVariant | null = null;
  let bestScore = -1;

  for (const variant of variants) {
    const variantTokens = new Set(
      tokenizeVariantText([variant.title, ...(variant.optionValues ?? [])].join(" "))
    );

    const allAdTokensMatch = adTokens.every((token) => variantTokens.has(token));
    if (!allAdTokensMatch) {
      continue;
    }

    // Prefer exact token-set matches (fewer extra tokens on the storefront variant).
    const extraTokens = Math.max(0, variantTokens.size - adTokens.length);
    const score = 1000 - extraTokens * 10 + (variant.available ? 1 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = variant;
    }
  }

  return bestMatch;
}

function resolveBaseLivePrice(
  storefront: StorefrontSnapshot,
  matchedVariant: StorefrontVariant | null
): number | null {
  if (matchedVariant) {
    return matchedVariant.price;
  }
  return storefront.basePrice;
}

function resolveEffectivePrice(
  baseLivePrice: number | null,
  storefront: StorefrontSnapshot
): { effectivePrice: number | null; promoApplied: boolean } {
  if (baseLivePrice === null) {
    return { effectivePrice: null, promoApplied: false };
  }

  const promo = storefront.promoVerification;
  if (!promo || (promo.state !== "ACTIVE" && promo.state !== "PAGE_BANNER_MATCH")) {
    return { effectivePrice: roundCurrency(baseLivePrice), promoApplied: false };
  }

  if (promo.minSpend !== null && baseLivePrice < promo.minSpend) {
    return { effectivePrice: roundCurrency(baseLivePrice), promoApplied: false };
  }

  if (promo.discountAmount !== null && promo.discountAmount > 0) {
    return {
      effectivePrice: Math.max(0, roundCurrency(baseLivePrice - promo.discountAmount)),
      promoApplied: true,
    };
  }

  if (promo.discountPct !== null && promo.discountPct > 0) {
    return {
      effectivePrice: Math.max(0, roundCurrency(baseLivePrice * (1 - promo.discountPct / 100))),
      promoApplied: true,
    };
  }

  return { effectivePrice: roundCurrency(baseLivePrice), promoApplied: false };
}

function evaluateHttpHealth(storefront: StorefrontSnapshot): ParityCheck {
  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    const providerNote = storefront.wafProvider ? `, ${storefront.wafProvider}` : "";
    return {
      id: "http_health",
      label: "Landing Page & HTTP Health",
      status: "WARN",
      expected: "HTTP 200 OK without bot challenge",
      actual: `WAF challenge detected (HTTP ${storefront.httpStatus}${providerNote}) — manual check required`,
      impactWeight: 0,
      remediation:
        "Verify the landing page manually in a browser; bot protection blocked automated inspection.",
    };
  }

  if (storefront.httpStatus >= 400 || storefront.httpStatus < 100) {
    const errorSuffix = storefront.fetchError ? ` (${storefront.fetchError})` : "";
    return {
      id: "http_health",
      label: "Landing Page & HTTP Health",
      status: "FAIL",
      expected: "HTTP 2xx reachable landing page",
      actual: `HTTP ${storefront.httpStatus}${errorSuffix}`,
      impactWeight: 1.0,
      remediation:
        "Fix the broken destination URL or restore the landing page before sending paid traffic.",
    };
  }

  if (storefront.redirectChain.length > 2) {
    return {
      id: "http_health",
      label: "Landing Page & HTTP Health",
      status: "WARN",
      expected: "Direct landing or <= 2 redirect hops",
      actual: `HTTP ${storefront.httpStatus} after ${storefront.redirectChain.length} redirect hops`,
      impactWeight: 0.15,
      remediation:
        "Update the ad destination URL to point directly to the canonical final URL to reduce redirect latency.",
    };
  }

  const hopCount = storefront.redirectChain.length;
  return {
    id: "http_health",
    label: "Landing Page & HTTP Health",
    status: "PASS",
    expected: "HTTP 2xx with <= 2 redirect hops",
    actual: `HTTP ${storefront.httpStatus} (${hopCount} redirect${hopCount === 1 ? "" : "s"})`,
    impactWeight: 0,
    remediation: "No action needed.",
  };
}

function evaluatePriceParity(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot,
  matchedVariant: StorefrontVariant | null
): ParityCheck {
  const adCurrency = claims.currency ? claims.currency.toUpperCase() : null;
  const liveCurrency = storefront.currency ? storefront.currency.toUpperCase() : null;
  const baseLivePrice = resolveBaseLivePrice(storefront, matchedVariant);
  const { effectivePrice, promoApplied } = resolveEffectivePrice(baseLivePrice, storefront);

  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "WARN",
      expected:
        claims.advertisedPrice !== null
          ? formatMoney(claims.advertisedPrice, adCurrency)
          : "Storefront price readable",
      actual: "Unverified (WAF challenge blocked price extraction)",
      impactWeight: 0,
      remediation: "Confirm live storefront pricing and currency manually in a browser.",
    };
  }

  if (adCurrency && liveCurrency && adCurrency !== liveCurrency) {
    const adDisplay =
      claims.advertisedPrice !== null ? formatMoney(claims.advertisedPrice, adCurrency) : adCurrency;
    const liveDisplay =
      effectivePrice !== null ? formatMoney(effectivePrice, liveCurrency) : liveCurrency;

    if (storefront.source !== "fixture") {
      const countryNote = storefront.localization?.detectedCountry
        ? ` (server market: ${storefront.localization.detectedCountry})`
        : "";
      const storeTypeNote = storefront.localization?.multiCurrencyStore
        ? "on a multi-currency store"
        : `from cloud scanner region${countryNote}`;
      return {
        id: "price_parity",
        label: "Price & Currency Parity",
        status: "WARN",
        expected: `Currency ${adCurrency} (${adDisplay})`,
        actual: `Geo-IP / market currency difference: storefront served ${liveCurrency} (${liveDisplay}) ${storeTypeNote}`,
        impactWeight: 0.05,
        remediation: `Verify ${adCurrency} localized pricing from the target ad market (cloud scanner received ${liveCurrency} pricing).`,
      };
    }

    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "FAIL",
      expected: `Currency ${adCurrency} (${adDisplay})`,
      actual: `Currency mismatch: storefront uses ${liveCurrency} (${liveDisplay})`,
      impactWeight: 0.4,
      remediation: `Align ad currency (${adCurrency}) and localized storefront market/currency (${liveCurrency}) before scaling spend.`,
    };
  }

  if (claims.advertisedPrice === null) {
    if (adCurrency && !liveCurrency) {
      return {
        id: "price_parity",
        label: "Price & Currency Parity",
        status: "WARN",
        expected: `Currency ${adCurrency}`,
        actual: "Storefront currency metadata missing",
        impactWeight: 0.1,
        remediation: "Ensure storefront exposes structured ISO currency metadata.",
      };
    }

    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "PASS",
      expected: "No specific price promised in ad copy",
      actual:
        effectivePrice !== null
          ? `Storefront price is ${formatMoney(effectivePrice, liveCurrency ?? adCurrency)}`
          : "No price advertised",
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  const displayCurrency = liveCurrency ?? adCurrency;
  const expectedPriceStr = formatMoney(claims.advertisedPrice, adCurrency ?? liveCurrency);

  if (effectivePrice === null) {
    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "WARN",
      expected: expectedPriceStr,
      actual: "Unable to extract live price from storefront",
      impactWeight: 0.15,
      remediation:
        "Verify structured Product JSON-LD or OpenGraph price tags exist on the landing page.",
    };
  }

  const effectivePriceStr = formatMoney(effectivePrice, displayCurrency);
  const priceDiff = roundCurrency(effectivePrice - claims.advertisedPrice);

  // If checkout promo could not be verified on a live store, check whether the base price + claimed discount reconciles.
  if (
    priceDiff > PRICE_TOLERANCE &&
    claims.promoCode !== null &&
    (!storefront.promoVerification ||
      storefront.promoVerification.state === "UNVERIFIED_LIVE_STORE")
  ) {
    const impliedDiscounted =
      claims.discountPct !== null
        ? roundCurrency(effectivePrice * (1 - claims.discountPct / 100))
        : null;
    if (
      impliedDiscounted !== null &&
      impliedDiscounted - claims.advertisedPrice <= PRICE_TOLERANCE
    ) {
      return {
        id: "price_parity",
        label: "Price & Currency Parity",
        status: "WARN",
        expected: expectedPriceStr,
        actual: `Base price ${effectivePriceStr}; ${expectedPriceStr} depends on unverified promo ${claims.promoCode}`,
        impactWeight: 0.1,
        remediation: `Verify in cart that promo code ${claims.promoCode} reduces ${effectivePriceStr} to ${expectedPriceStr}.`,
      };
    }
  }

  if (priceDiff > PRICE_TOLERANCE) {
    const subPricing = storefront.subscriptionPricing;
    if (subPricing?.detected) {
      if (
        subPricing.lowestPrice !== null &&
        subPricing.lowestPrice - claims.advertisedPrice <= PRICE_TOLERANCE
      ) {
        return {
          id: "price_parity",
          label: "Price & Currency Parity",
          status: "PASS",
          expected: expectedPriceStr,
          actual: `${formatMoney(subPricing.lowestPrice, displayCurrency)} via ${subPricing.provider ?? "Subscribe & Save"} (one-time: ${effectivePriceStr})`,
          impactWeight: 0,
          remediation: "No action needed.",
        };
      }

      return {
        id: "price_parity",
        label: "Price & Currency Parity",
        status: "WARN",
        expected: expectedPriceStr,
        actual: `One-time price is ${effectivePriceStr}, but ${subPricing.provider ?? "Subscribe & Save"} widget detected`,
        impactWeight: 0.1,
        remediation: `Verify that the live ${subPricing.provider ?? "subscription/bundle"} selector honors ${expectedPriceStr}.`,
      };
    }

    const promoNote =
      claims.promoCode && storefront.promoVerification?.state === "EXPIRED"
        ? ` (promo ${claims.promoCode} expired)`
        : "";
    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "FAIL",
      expected: expectedPriceStr,
      actual: `Live price is ${effectivePriceStr} (+${formatMoney(priceDiff, displayCurrency)} higher)${promoNote}`,
      impactWeight: 0.4,
      remediation: `Update ad copy to ${effectivePriceStr} or restore storefront pricing/active promo to ${expectedPriceStr}.`,
    };
  }

  if (adCurrency && !liveCurrency) {
    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "WARN",
      expected: `${expectedPriceStr} (${adCurrency})`,
      actual: `Price ${effectivePriceStr} matches, but storefront currency metadata is missing`,
      impactWeight: 0.1,
      remediation: `Expose explicit ${adCurrency} currency metadata in Product JSON-LD/OpenGraph tags.`,
    };
  }

  if (priceDiff < -PRICE_TOLERANCE) {
    return {
      id: "price_parity",
      label: "Price & Currency Parity",
      status: "PASS",
      expected: expectedPriceStr,
      actual: `Live price ${effectivePriceStr} is lower than advertised (${formatMoney(Math.abs(priceDiff), displayCurrency)} cheaper)`,
      impactWeight: 0,
      remediation: "Consider updating ad creative to highlight the lower live price.",
    };
  }

  const promoSuffix = promoApplied ? ` (after ${storefront.promoVerification?.code ?? "promo"})` : "";
  return {
    id: "price_parity",
    label: "Price & Currency Parity",
    status: "PASS",
    expected: expectedPriceStr,
    actual: `${effectivePriceStr}${promoSuffix}`,
    impactWeight: 0,
    remediation: "No action needed.",
  };
}

function evaluateVariantStock(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot,
  matchedVariant: StorefrontVariant | null
): ParityCheck {
  const claimedVariantDesc = claims.variantName
    ? `"${claims.variantName}"${claims.variantId ? ` (ID ${claims.variantId})` : ""}`
    : claims.variantId
      ? `ID ${claims.variantId}`
      : null;
  const expectedStr = claimedVariantDesc
    ? `Hero variant ${claimedVariantDesc} in stock`
    : "Product in stock";

  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return {
      id: "variant_stock",
      label: "Variant & Inventory Availability",
      status: "WARN",
      expected: expectedStr,
      actual: "Unverified (WAF challenge blocked inventory inspection)",
      impactWeight: 0,
      remediation: "Verify variant stock availability manually in a browser.",
    };
  }

  const allVariantsOos =
    storefront.variants.length > 0 && storefront.variants.every((variant) => !variant.available);
  if (storefront.inStock === false || allVariantsOos) {
    return {
      id: "variant_stock",
      label: "Variant & Inventory Availability",
      status: "FAIL",
      expected: expectedStr,
      actual: "All product variants are out of stock",
      impactWeight: 1.0,
      remediation:
        "Pause ads pointing to this out-of-stock product or route traffic to an in-stock SKU.",
    };
  }

  if (claimedVariantDesc !== null) {
    if (storefront.variants.length > 0) {
      if (matchedVariant) {
        if (!matchedVariant.available) {
          const inStockCount = storefront.variants.filter((v) => v.available).length;
          if (
            claims.variantName === null &&
            claims.variantId !== null &&
            inStockCount > 0 &&
            isPureSizeVariant(matchedVariant.title)
          ) {
            return {
              id: "variant_stock",
              label: "Variant & Inventory Availability",
              status: "WARN",
              expected: expectedStr,
              actual: `Pre-selected ?variant=${claims.variantId} ("${matchedVariant.title}") is OUT OF STOCK, but ${inStockCount}/${storefront.variants.length} other sizes remain in stock`,
              impactWeight: 0.1,
              remediation: `Consider updating the ad's ?variant= parameter to an in-stock default size (ad copy did not promise "${matchedVariant.title}").`,
            };
          }

          return {
            id: "variant_stock",
            label: "Variant & Inventory Availability",
            status: "FAIL",
            expected: expectedStr,
            actual: `Matched variant "${matchedVariant.title}" is OUT OF STOCK`,
            impactWeight: 0.75,
            remediation: `Restock "${matchedVariant.title}" or switch ad creative and URL to an available variant.`,
          };
        }

        return {
          id: "variant_stock",
          label: "Variant & Inventory Availability",
          status: "PASS",
          expected: expectedStr,
          actual: `Matched variant "${matchedVariant.title}" is in stock`,
          impactWeight: 0,
          remediation: "No action needed.",
        };
      }

      const truncationNote =
        storefront.variants.length >= 250
          ? `${storefront.variants.length}+ variants — Shopify .js limit reached`
          : `${storefront.variants.length} variants checked`;
      return {
        id: "variant_stock",
        label: "Variant & Inventory Availability",
        status: "WARN",
        expected: expectedStr,
        actual: `No storefront variant matched ${claimedVariantDesc} (${truncationNote})`,
        impactWeight: 0.2,
        remediation:
          "Confirm the advertised color/size or ?variant= ID exists on the landing page.",
      };
    }

    return {
      id: "variant_stock",
      label: "Variant & Inventory Availability",
      status: "WARN",
      expected: expectedStr,
      actual:
        storefront.inStock === true
          ? `Product is in stock, but variant-level data for ${claimedVariantDesc} is unavailable`
          : `Inventory metadata unavailable for ${claimedVariantDesc}`,
      impactWeight: 0.1,
      remediation:
        "Verify variant-level availability on the live product page (non-Shopify metadata lacks variant matrix).",
    };
  }

  const availableCount = storefront.variants.filter((variant) => variant.available).length;
  if (storefront.inStock === true || availableCount > 0) {
    return {
      id: "variant_stock",
      label: "Variant & Inventory Availability",
      status: "PASS",
      expected: expectedStr,
      actual:
        storefront.variants.length > 0
          ? `${availableCount}/${storefront.variants.length} variants in stock`
          : "Product in stock",
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  return {
    id: "variant_stock",
    label: "Variant & Inventory Availability",
    status: "WARN",
    expected: expectedStr,
    actual: "Stock status not exposed in storefront metadata",
    impactWeight: 0.1,
    remediation: "Verify product availability manually on the landing page.",
  };
}

function evaluatePromoCode(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot
): ParityCheck {
  if (claims.promoCode === null) {
    return {
      id: "promo_code",
      label: "Promo Code Verification",
      status: "PASS",
      expected: "No promo code claimed",
      actual: "No promo code in ad copy",
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return {
      id: "promo_code",
      label: "Promo Code Verification",
      status: "WARN",
      expected: `Promo code ${claims.promoCode} active`,
      actual: "Unverified (WAF challenge blocked promo verification)",
      impactWeight: 0,
      remediation: `Manually test promo code ${claims.promoCode} in the store checkout.`,
    };
  }

  const promo = storefront.promoVerification;
  if (!promo || promo.state === "UNVERIFIED_LIVE_STORE") {
    return {
      id: "promo_code",
      label: "Promo Code Verification",
      status: "WARN",
      expected: `Promo code ${claims.promoCode} active`,
      actual: promo
        ? `Unverified on live store: ${promo.detail}`
        : `Checkout promo ${claims.promoCode} could not be verified without cart mutation`,
      impactWeight: 0.15,
      remediation: `Test code ${claims.promoCode} manually in cart/checkout to confirm discount eligibility.`,
    };
  }

  if (promo.state === "ACTIVE" || promo.state === "PAGE_BANNER_MATCH") {
    return {
      id: "promo_code",
      label: "Promo Code Verification",
      status: "PASS",
      expected: `Promo code ${claims.promoCode} active`,
      actual: `${promo.state}: ${promo.detail}`,
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  const remediationByState: Record<"EXPIRED" | "INVALID" | "MIN_SPEND_UNMET", string> = {
    EXPIRED: `Reactivate ${claims.promoCode} in store promotions or swap ad copy to a current active code.`,
    INVALID: `Fix typo or create promo code ${claims.promoCode} in your storefront admin before continuing spend.`,
    MIN_SPEND_UNMET: `Disclose the minimum spend threshold for ${claims.promoCode} in the ad copy or lower the threshold.`,
  };

  return {
    id: "promo_code",
    label: "Promo Code Verification",
    status: "FAIL",
    expected: `Promo code ${claims.promoCode} active at checkout`,
    actual: `${promo.state}: ${promo.detail}`,
    impactWeight: 0.45,
    remediation: remediationByState[promo.state],
  };
}

function evaluateDiscountMath(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot,
  matchedVariant: StorefrontVariant | null
): ParityCheck {
  if (claims.discountPct === null) {
    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "PASS",
      expected: "No percentage discount claimed",
      actual: "No discount % claim in ad",
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  const qualifier = claims.isUpToDiscount ? "Up to " : "";
  const expectedStr = `${qualifier}${claims.discountPct}% off`;

  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "WARN",
      expected: expectedStr,
      actual: "Unverified (WAF challenge blocked discount calculation)",
      impactWeight: 0,
      remediation: "Verify advertised discount math manually against live checkout pricing.",
    };
  }

  const baseLivePrice = resolveBaseLivePrice(storefront, matchedVariant);
  const { effectivePrice } = resolveEffectivePrice(baseLivePrice, storefront);
  const compareAt =
    matchedVariant?.compareAtPrice ?? storefront.compareAtPrice ?? claims.compareAtPrice;
  const currency = storefront.currency ?? claims.currency;

  if (
    claims.promoCode !== null &&
    (!storefront.promoVerification ||
      storefront.promoVerification.state === "UNVERIFIED_LIVE_STORE")
  ) {
    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "WARN",
      expected: expectedStr,
      actual: `Cannot verify final discount % while promo ${claims.promoCode} is unverified on live store`,
      impactWeight: 0.1,
      remediation: `Confirm in checkout that ${claims.promoCode} delivers the promised ${expectedStr}.`,
    };
  }

  const subPricing = storefront.subscriptionPricing;
  if (subPricing?.detected) {
    const subPctFromPrice =
      compareAt !== null &&
      compareAt > 0 &&
      subPricing.lowestPrice !== null &&
      subPricing.lowestPrice < compareAt
        ? ((compareAt - subPricing.lowestPrice) / compareAt) * 100
        : null;
    const bestSubPct = Math.max(
      subPricing.maxDiscountPct ?? 0,
      subPctFromPrice ?? 0
    );

    if (bestSubPct > 0 && claims.discountPct - bestSubPct <= DISCOUNT_TOLERANCE_PP) {
      return {
        id: "discount_math",
        label: "Discount Math Accuracy",
        status: "PASS",
        expected: expectedStr,
        actual: `${subPricing.provider ?? "Subscribe & Save"} offers ${bestSubPct.toFixed(1)}% off`,
        impactWeight: 0,
        remediation: "No action needed.",
      };
    }

    if (
      compareAt === null ||
      compareAt <= 0 ||
      effectivePrice === null ||
      claims.discountPct - Math.max(0, ((compareAt - effectivePrice) / compareAt) * 100) >
        DISCOUNT_TOLERANCE_PP
    ) {
      return {
        id: "discount_math",
        label: "Discount Math Accuracy",
        status: "WARN",
        expected: expectedStr,
        actual: `${subPricing.provider ?? "Subscribe & Save"} widget detected; static one-time metadata does not expose the full ${expectedStr} bundle/subscription discount`,
        impactWeight: 0.1,
        remediation:
          "Verify dynamic Subscribe & Save or multi-pack bundle discount tiers manually in a browser.",
      };
    }
  }

  if (compareAt === null || compareAt <= 0 || effectivePrice === null) {
    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "WARN",
      expected: expectedStr,
      actual: "Insufficient compare-at or live price data to verify discount percentage",
      impactWeight: 0.05,
      remediation:
        "Provide a clear compare-at anchor price on the landing page to substantiate the percentage-off claim.",
    };
  }

  const actualPct = Math.max(0, ((compareAt - effectivePrice) / compareAt) * 100);
  const overstatementPp = claims.discountPct - actualPct;

  if (
    actualPct === 0 &&
    claims.advertisedPrice === null &&
    claims.compareAtPrice === null
  ) {
    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "WARN",
      expected: expectedStr,
      actual: `Storefront static metadata shows ${formatMoney(effectivePrice, currency)} with no discounted compare-at price`,
      impactWeight: 0.1,
      remediation:
        "Verify subscribe-and-save, bundle, or dynamic widget pricing manually on the live landing page.",
    };
  }

  if (overstatementPp > DISCOUNT_TOLERANCE_PP) {
    const actualDesc = `Actual discount is ${actualPct.toFixed(1)}% (${formatMoney(compareAt, currency)} -> ${formatMoney(effectivePrice, currency)})`;
    if (claims.isUpToDiscount) {
      return {
        id: "discount_math",
        label: "Discount Math Accuracy",
        status: "WARN",
        expected: expectedStr,
        actual: `${actualDesc} — below "Up to ${claims.discountPct}%" ceiling`,
        impactWeight: 0.1,
        remediation:
          "Ensure the featured hero SKU or a prominent variant actually reaches the advertised ceiling discount.",
      };
    }

    return {
      id: "discount_math",
      label: "Discount Math Accuracy",
      status: "FAIL",
      expected: expectedStr,
      actual: `${actualDesc}, overstated by ${overstatementPp.toFixed(1)}pp`,
      impactWeight: 0.25,
      remediation: `Update ad copy to ${actualPct.toFixed(0)}% off or adjust storefront pricing so discount math matches within 2 percentage points.`,
    };
  }

  return {
    id: "discount_math",
    label: "Discount Math Accuracy",
    status: "PASS",
    expected: expectedStr,
    actual: `Actual discount is ${actualPct.toFixed(1)}% (${formatMoney(compareAt, currency)} -> ${formatMoney(effectivePrice, currency)})`,
    impactWeight: 0,
    remediation: "No action needed.",
  };
}

function evaluateUtmHygiene(claims: ExtractedAdClaims): ParityCheck {
  const { utm_source, utm_medium, utm_campaign } = claims.utmParams;
  const missing: string[] = [];

  if (!utm_source?.trim()) missing.push("utm_source");
  if (!utm_medium?.trim()) missing.push("utm_medium");
  if (!utm_campaign?.trim()) missing.push("utm_campaign");

  if (missing.length === 0) {
    return {
      id: "utm_hygiene",
      label: "UTM & Attribution Hygiene",
      status: "PASS",
      expected: "utm_source, utm_medium, and utm_campaign present",
      actual: `Present (source=${utm_source}, medium=${utm_medium}, campaign=${utm_campaign})`,
      impactWeight: 0,
      remediation: "No action needed.",
    };
  }

  return {
    id: "utm_hygiene",
    label: "UTM & Attribution Hygiene",
    status: "WARN",
    expected: "utm_source, utm_medium, and utm_campaign present",
    actual: `Missing ${missing.join(", ")}`,
    impactWeight: 0.1,
    remediation: `Append ${missing.map((key) => `${key}=<value>`).join("&")} to the landing URL to preserve attribution.`,
  };
}

function deriveOverallStatus(
  checks: ParityCheck[],
  storefront: StorefrontSnapshot
): OverallVerdict {
  if (storefront.wafStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return "WAF_CHALLENGE_MANUAL_CHECK";
  }
  if (checks.some((check) => check.status === "FAIL")) {
    return "FAIL";
  }
  if (checks.some((check) => check.status === "WARN")) {
    return "WARN";
  }
  return "PASS";
}

/**
 * Compares extracted ad claims against the storefront ground-truth snapshot
 * across 6 deterministic parity checks and derives the overall X-Ray verdict.
 */
export function evaluateParity(
  claims: ExtractedAdClaims,
  storefront: StorefrontSnapshot
): { checks: ParityCheck[]; overallStatus: OverallVerdict } {
  const matchedVariant = matchHeroVariant(claims, storefront.variants);

  const checks: ParityCheck[] = [
    evaluateHttpHealth(storefront),
    evaluatePriceParity(claims, storefront, matchedVariant),
    evaluateVariantStock(claims, storefront, matchedVariant),
    evaluatePromoCode(claims, storefront),
    evaluateDiscountMath(claims, storefront, matchedVariant),
    evaluateUtmHygiene(claims),
  ];

  const overallStatus = deriveOverallStatus(checks, storefront);
  return { checks, overallStatus };
}
