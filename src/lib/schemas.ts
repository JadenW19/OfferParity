import { z } from "zod";

/**
 * Built-in deterministic demo scenario identifiers.
 */
export const FixtureScenarioIdSchema = z.enum([
  "healthy-offer",
  "expired-promo",
  "oos-price-mismatch",
]);
export type FixtureScenarioId = z.infer<typeof FixtureScenarioIdSchema>;

/**
 * Incoming diagnostic request payload for POST /api/xray.
 */
export const XRayRequestSchema = z.object({
  adCopy: z
    .string()
    .trim()
    .min(5, "Ad copy must be at least 5 characters")
    .max(5000, "Ad copy must be 5,000 characters or fewer"),
  landingPageUrl: z
    .string()
    .trim()
    .url("Enter a valid http:// or https:// landing page URL")
    .refine(
      (u) => /^https?:\/\//i.test(u),
      "Only http:// and https:// URLs are supported"
    ),
  dailyBudget: z
    .number()
    .finite("Daily budget must be a finite number")
    .min(0, "Daily budget cannot be negative")
    .max(1_000_000, "Daily budget cannot exceed $1,000,000"),
  fixtureId: FixtureScenarioIdSchema.optional(),
  useGeminiFallback: z.boolean().optional(),
});
export type XRayRequest = z.infer<typeof XRayRequestSchema>;

/**
 * Individual parity check verdict.
 */
export const CheckStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/**
 * Top-level X-Ray diagnostic verdict.
 */
export const OverallVerdictSchema = z.enum([
  "PASS",
  "WARN",
  "FAIL",
  "WAF_CHALLENGE_MANUAL_CHECK",
]);
export type OverallVerdict = z.infer<typeof OverallVerdictSchema>;

/**
 * Extracted UTM and ad platform click identifier parameters.
 */
export const UtmParamsSchema = z.object({
  utm_source: z.string().nullable(),
  utm_medium: z.string().nullable(),
  utm_campaign: z.string().nullable(),
  utm_content: z.string().nullable(),
  utm_term: z.string().nullable(),
  fbclid: z.string().nullable(),
  ttclid: z.string().nullable(),
  gclid: z.string().nullable(),
});
export type UtmParams = z.infer<typeof UtmParamsSchema>;

/**
 * Provenance record showing where and how an ad claim signal was extracted.
 */
export const ClaimSignalFieldSchema = z.enum([
  "advertisedPrice",
  "compareAtPrice",
  "currency",
  "promoCode",
  "discountPct",
  "variantName",
  "utmParams",
]);
export type ClaimSignalField = z.infer<typeof ClaimSignalFieldSchema>;

export const ClaimSignalSchema = z.object({
  field: ClaimSignalFieldSchema,
  source: z.enum(["ad_copy", "landing_url", "derived"]),
  rawMatch: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().optional(),
});
export type ClaimSignal = z.infer<typeof ClaimSignalSchema>;

/**
 * Structured marketing claims extracted deterministically from ad copy and landing URL.
 */
export const ExtractedAdClaimsSchema = z.object({
  advertisedPrice: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  currency: z.string().nullable(),
  promoCode: z.string().nullable(),
  discountPct: z.number().nullable(),
  isUpToDiscount: z.boolean(),
  variantName: z.string().nullable(),
  utmParams: UtmParamsSchema,
  signals: z.array(ClaimSignalSchema),
});
export type ExtractedAdClaims = z.infer<typeof ExtractedAdClaimsSchema>;

/**
 * Storefront product variant availability and pricing snapshot.
 */
export const StorefrontVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  available: z.boolean(),
  sku: z.string().nullable(),
  optionValues: z.array(z.string()).optional(),
});
export type StorefrontVariant = z.infer<typeof StorefrontVariantSchema>;

/**
 * Verification state for an advertised promo code.
 */
export const PromoStateSchema = z.enum([
  "ACTIVE",
  "EXPIRED",
  "INVALID",
  "MIN_SPEND_UNMET",
  "PAGE_BANNER_MATCH",
  "UNVERIFIED_LIVE_STORE",
]);
export type PromoState = z.infer<typeof PromoStateSchema>;

export const PromoVerificationSchema = z.object({
  code: z.string().nullable(),
  state: PromoStateSchema,
  discountPct: z.number().nullable(),
  discountAmount: z.number().nullable(),
  minSpend: z.number().nullable(),
  expiresAt: z.string().nullable(),
  detail: z.string(),
});
export type PromoVerification = z.infer<typeof PromoVerificationSchema>;

/**
 * Bot-protection / WAF detection state on storefront fetch.
 */
export const WafStatusSchema = z.enum(["NONE", "WAF_CHALLENGE_MANUAL_CHECK"]);
export type WafStatus = z.infer<typeof WafStatusSchema>;

/**
 * Data source used to build the StorefrontSnapshot.
 */
export const StorefrontSourceSchema = z.enum([
  "fixture",
  "shopify_js",
  "json_ld",
  "opengraph",
  "http_only",
]);
export type StorefrontSource = z.infer<typeof StorefrontSourceSchema>;

export const RedirectHopSchema = z.object({
  url: z.string(),
  status: z.number().int(),
});
export type RedirectHop = z.infer<typeof RedirectHopSchema>;

/**
 * Normalized storefront ground-truth snapshot (from fixtures or live HTTP verification).
 */
export const StorefrontSnapshotSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  httpStatus: z.number().int(),
  redirectChain: z.array(RedirectHopSchema),
  wafStatus: WafStatusSchema,
  wafProvider: z.string().nullable().optional(),
  title: z.string().nullable(),
  basePrice: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  currency: z.string().nullable(),
  inStock: z.boolean().nullable(),
  variants: z.array(StorefrontVariantSchema),
  promoVerification: PromoVerificationSchema.nullable(),
  source: StorefrontSourceSchema,
  fetchError: z.string().nullable().optional(),
});
export type StorefrontSnapshot = z.infer<typeof StorefrontSnapshotSchema>;

/**
 * Parity check identifiers evaluated by the diff engine.
 */
export const ParityCheckIdSchema = z.enum([
  "http_health",
  "price_parity",
  "variant_stock",
  "promo_code",
  "discount_math",
  "utm_hygiene",
]);
export type ParityCheckId = z.infer<typeof ParityCheckIdSchema>;

/**
 * Field-by-field parity check outcome with remediation advice.
 */
export const ParityCheckSchema = z.object({
  id: ParityCheckIdSchema,
  label: z.string(),
  status: CheckStatusSchema,
  expected: z.string(),
  actual: z.string(),
  impactWeight: z.number().min(0).max(1),
  remediation: z.string(),
});
export type ParityCheck = z.infer<typeof ParityCheckSchema>;

export const WasteFactorSchema = z.object({
  id: ParityCheckIdSchema,
  label: z.string(),
  weight: z.number().min(0).max(1),
});
export type WasteFactor = z.infer<typeof WasteFactorSchema>;

export const WasteBreakdownSchema = z.object({
  formula: z.string(),
  failingFactors: z.array(WasteFactorSchema),
  warningFactors: z.array(WasteFactorSchema),
});
export type WasteBreakdown = z.infer<typeof WasteBreakdownSchema>;

/**
 * Bounded survival-complement ad spend waste calculation.
 */
export const WasteEstimateSchema = z.object({
  estimatedDailyWaste: z.number().min(0),
  projectedMonthlyWaste: z.number().min(0),
  atRiskDailySpend: z.number().min(0),
  effectiveWasteRate: z.number().min(0).max(1),
  breakdown: WasteBreakdownSchema,
});
export type WasteEstimate = z.infer<typeof WasteEstimateSchema>;

/**
 * Complete OfferParity X-Ray report returned by POST /api/xray.
 */
export const XRayReportSchema = z.object({
  request: XRayRequestSchema,
  extractedClaims: ExtractedAdClaimsSchema,
  storefront: StorefrontSnapshotSchema,
  checks: z.array(ParityCheckSchema),
  overallStatus: OverallVerdictSchema,
  waste: WasteEstimateSchema,
  slackAlert: z.string(),
  markdownReport: z.string(),
  generatedAt: z.string(),
  durationMs: z.number().nonnegative(),
});
export type XRayReport = z.infer<typeof XRayReportSchema>;

/**
 * Pre-loaded scenario metadata shared between fixture registry and UI selector.
 */
export const DemoScenarioPresetSchema = z.object({
  id: FixtureScenarioIdSchema,
  name: z.string(),
  tagline: z.string(),
  expectedVerdict: OverallVerdictSchema,
  adCopy: z.string(),
  landingPageUrl: z.string().url(),
  dailyBudget: z.number().nonnegative(),
});
export type DemoScenarioPreset = z.infer<typeof DemoScenarioPresetSchema>;

/**
 * Structured claim patch returned by optional Gemini fallback extraction.
 */
export const GeminiClaimFallbackSchema = z.object({
  advertisedPrice: z.number().nullable().optional(),
  compareAtPrice: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  promoCode: z.string().nullable().optional(),
  discountPct: z.number().nullable().optional(),
  variantName: z.string().nullable().optional(),
});
export type GeminiClaimFallback = z.infer<typeof GeminiClaimFallbackSchema>;

/**
 * Incoming request payload for POST /api/gemini remote querying.
 */
export const GeminiQueryRequestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Enter a question of at least 3 characters")
    .max(2000, "Question must be 2,000 characters or fewer"),
  report: XRayReportSchema.optional(),
});
export type GeminiQueryRequest = z.infer<typeof GeminiQueryRequestSchema>;
