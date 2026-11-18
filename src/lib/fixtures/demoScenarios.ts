import type {
  DemoScenarioPreset,
  FixtureScenarioId,
  PromoVerification,
  StorefrontSnapshot,
} from "@/lib/schemas";

export const DEMO_SCENARIO_PRESETS: DemoScenarioPreset[] = [
  {
    id: "healthy-offer",
    name: "Healthy Offer",
    tagline:
      "Lumina 32oz Insulated Bottle in Obsidian Black — Active HYDRATE20 promo, in stock, complete UTMs",
    expectedVerdict: "PASS",
    adCopy:
      "Stay cold for 36 hours. Lumina 32oz Insulated Bottle in Obsidian Black — Now $36.00 (was $45.00, 20% OFF). Use code HYDRATE20 at checkout! Free shipping on orders over $75.",
    landingPageUrl:
      "https://demo.offerparity.app/products/lumina-32oz-bottle?variant=obsidian-black&utm_source=meta&utm_medium=paid_social&utm_campaign=q4_lumina_launch",
    dailyBudget: 600,
  },
  {
    id: "expired-promo",
    name: "Expired Promo Code",
    tagline:
      "Veloce Recovery Boots — Ad promises 25% OFF with code BFCM25, but promo expired on 2026-11-05",
    expectedVerdict: "FAIL",
    adCopy:
      "Recover faster after every run. Veloce Recovery Boots — 25% OFF today! Now $149.25 (reg $199.00) with code BFCM25 at checkout.",
    landingPageUrl:
      "https://demo.offerparity.app/products/veloce-recovery-boots?utm_source=meta&utm_medium=paid_social&utm_campaign=bfcm_veloce_retargeting",
    dailyBudget: 1200,
  },
  {
    id: "oos-price-mismatch",
    name: "Out-of-Stock Variant & Price Mismatch",
    tagline:
      "Kova Merino Trail Hoodie — Alpine Olive / L sold out, live price $84.00 vs $68.00 ad, missing utm_campaign",
    expectedVerdict: "FAIL",
    adCopy:
      "Ultralight warmth for cold-weather miles. Kova Merino Trail Hoodie in Alpine Olive (Size L) — just $68.00 today.",
    landingPageUrl:
      "https://demo.offerparity.app/products/kova-merino-hoodie?variant=alpine-olive-l&utm_source=meta&utm_medium=paid_social",
    dailyBudget: 850,
  },
];

const PRESET_BY_ID: Record<FixtureScenarioId, DemoScenarioPreset> = {
  "healthy-offer": DEMO_SCENARIO_PRESETS[0]!,
  "expired-promo": DEMO_SCENARIO_PRESETS[1]!,
  "oos-price-mismatch": DEMO_SCENARIO_PRESETS[2]!,
};

/**
 * Return the preset definition for a canonical demo scenario ID.
 */
export function getDemoScenarioPreset(
  id: FixtureScenarioId
): DemoScenarioPreset {
  return PRESET_BY_ID[id];
}

interface FixtureDefinition {
  title: string;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  inStock: boolean;
  variants: StorefrontSnapshot["variants"];
  promos: Record<string, PromoVerification>;
  defaultPromoCode: string | null;
}

const FIXTURE_DEFINITIONS: Record<FixtureScenarioId, FixtureDefinition> = {
  "healthy-offer": {
    title: "Lumina 32oz Insulated Bottle",
    basePrice: 45.0,
    compareAtPrice: 45.0,
    currency: "USD",
    inStock: true,
    variants: [
      {
        id: "lumina-obsidian-black",
        title: "Obsidian Black",
        price: 45.0,
        compareAtPrice: 45.0,
        available: true,
        sku: "LUM-32-OB",
        optionValues: ["Obsidian Black"],
      },
      {
        id: "lumina-arctic-white",
        title: "Arctic White",
        price: 45.0,
        compareAtPrice: 45.0,
        available: true,
        sku: "LUM-32-AW",
        optionValues: ["Arctic White"],
      },
    ],
    defaultPromoCode: "HYDRATE20",
    promos: {
      HYDRATE20: {
        code: "HYDRATE20",
        state: "ACTIVE",
        discountPct: 20,
        discountAmount: null,
        minSpend: null,
        expiresAt: null,
        detail:
          "Promo code HYDRATE20 is active for 20% off ($45.00 -> $36.00).",
      },
    },
  },
  "expired-promo": {
    title: "Veloce Recovery Boots",
    basePrice: 199.0,
    compareAtPrice: 199.0,
    currency: "USD",
    inStock: true,
    variants: [
      {
        id: "veloce-std-ml",
        title: "Standard / M-L",
        price: 199.0,
        compareAtPrice: null,
        available: true,
        sku: "VEL-REC-ML",
        optionValues: ["Standard", "M-L"],
      },
    ],
    defaultPromoCode: "BFCM25",
    promos: {
      BFCM25: {
        code: "BFCM25",
        state: "EXPIRED",
        discountPct: 25,
        discountAmount: null,
        minSpend: null,
        expiresAt: "2026-11-05",
        detail: "Promo code BFCM25 expired on 2026-11-05.",
      },
    },
  },
  "oos-price-mismatch": {
    title: "Kova Merino Trail Hoodie",
    basePrice: 84.0,
    compareAtPrice: null,
    currency: "USD",
    inStock: true,
    variants: [
      {
        id: "kova-alpine-olive-l",
        title: "Alpine Olive / L",
        price: 84.0,
        compareAtPrice: null,
        available: false,
        sku: "KOV-MH-AOL",
        optionValues: ["Alpine Olive", "L"],
      },
      {
        id: "kova-charcoal-s",
        title: "Charcoal / S",
        price: 84.0,
        compareAtPrice: null,
        available: true,
        sku: "KOV-MH-CHS",
        optionValues: ["Charcoal", "S"],
      },
    ],
    defaultPromoCode: null,
    promos: {},
  },
};

function inferScenarioIdFromDemoUrl(
  rawUrl: string
): FixtureScenarioId | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase() !== "demo.offerparity.app") {
      return null;
    }

    const path = parsed.pathname.toLowerCase();
    if (path.includes("lumina") || path.includes("healthy-offer")) {
      return "healthy-offer";
    }
    if (path.includes("veloce") || path.includes("expired-promo")) {
      return "expired-promo";
    }
    if (path.includes("kova") || path.includes("oos-price-mismatch")) {
      return "oos-price-mismatch";
    }
    return null;
  } catch {
    return null;
  }
}

function resolveFixturePromo(
  definition: FixtureDefinition,
  promoCode?: string | null
): PromoVerification | null {
  const requested = promoCode?.trim().toUpperCase() || null;
  const codeToLookup = requested ?? definition.defaultPromoCode;

  if (!codeToLookup) {
    return null;
  }

  const matched = definition.promos[codeToLookup];
  if (matched) {
    return { ...matched };
  }

  return {
    code: codeToLookup,
    state: "INVALID",
    discountPct: null,
    discountAmount: null,
    minSpend: null,
    expiresAt: null,
    detail: `Promo code ${codeToLookup} is not recognized on this storefront.`,
  };
}

/**
 * Resolve a deterministic StorefrontSnapshot when `fixtureId` is provided
 * or when `landingPageUrl` targets `demo.offerparity.app`.
 */
export function resolveFixtureSnapshot(input: {
  fixtureId?: FixtureScenarioId;
  landingPageUrl: string;
  promoCode?: string | null;
}): StorefrontSnapshot | null {
  const scenarioId =
    input.fixtureId ?? inferScenarioIdFromDemoUrl(input.landingPageUrl);

  if (!scenarioId) {
    return null;
  }

  const definition = FIXTURE_DEFINITIONS[scenarioId];
  const promoVerification = resolveFixturePromo(definition, input.promoCode);

  return {
    url: input.landingPageUrl,
    finalUrl: input.landingPageUrl,
    httpStatus: 200,
    redirectChain: [],
    wafStatus: "NONE",
    wafProvider: null,
    title: definition.title,
    basePrice: definition.basePrice,
    compareAtPrice: definition.compareAtPrice,
    currency: definition.currency,
    inStock: definition.inStock,
    variants: definition.variants.map((variant) => ({
      ...variant,
      optionValues: variant.optionValues ? [...variant.optionValues] : undefined,
    })),
    promoVerification,
    source: "fixture",
    fetchError: null,
  };
}
