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
  "variantId",
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
  variantId: z.string().nullable().optional(),
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
  "microdata",
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
 * Deterministic subscription / bundle widget pricing signals extracted from
 * Shopify selling_plan_groups, selling_plan_allocations, or storefront HTML.
 */
export const SubscriptionPricingSchema = z.object({
  detected: z.boolean(),
  lowestPrice: z.number().nullable(),
  maxDiscountPct: z.number().nullable(),
  provider: z.string().nullable(),
});
export type SubscriptionPricing = z.infer<typeof SubscriptionPricingSchema>;

/**
 * Storefront multi-currency / geo-IP localization signals.
 */
export const StorefrontLocalizationSchema = z.object({
  detectedCountry: z.string().nullable(),
  multiCurrencyStore: z.boolean(),
  requestedCurrency: z.string().nullable(),
});
export type StorefrontLocalization = z.infer<typeof StorefrontLocalizationSchema>;

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
  subscriptionPricing: SubscriptionPricingSchema.optional(),
  localization: StorefrontLocalizationSchema.optional(),
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
 * Batch campaign CSV pre-flight audit contracts (POST /api/xray/batch).
 */
export const MAX_BATCH_ITEMS = 25;

export const BatchXRayItemInputSchema = XRayRequestSchema.extend({
  adName: z
    .string()
    .trim()
    .min(1, "Ad name cannot be empty")
    .max(160, "Ad name must be 160 characters or fewer")
    .optional(),
});
export type BatchXRayItemInput = z.infer<typeof BatchXRayItemInputSchema>;

export const BatchXRayRequestSchema = z.object({
  items: z
    .array(BatchXRayItemInputSchema)
    .min(1, "Provide at least 1 ad row to audit")
    .max(MAX_BATCH_ITEMS, `Batch audits are capped at ${MAX_BATCH_ITEMS} rows per run`),
});
export type BatchXRayRequest = z.infer<typeof BatchXRayRequestSchema>;

export const BatchXRayItemResultSchema = z.object({
  index: z.number().int().nonnegative(),
  adName: z.string(),
  ok: z.boolean(),
  report: XRayReportSchema.nullable(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type BatchXRayItemResult = z.infer<typeof BatchXRayItemResultSchema>;

export const BatchXRaySummarySchema = z.object({
  totalRows: z.number().int().nonnegative(),
  succeededCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  warnCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  wafCount: z.number().int().nonnegative(),
  totalDailyBudget: z.number().nonnegative(),
  totalDailyWaste: z.number().nonnegative(),
  totalMonthlyWaste: z.number().nonnegative(),
  totalAtRiskDailySpend: z.number().nonnegative(),
});
export type BatchXRaySummary = z.infer<typeof BatchXRaySummarySchema>;

export const BatchXRayResponseSchema = z.object({
  summary: BatchXRaySummarySchema,
  results: z.array(BatchXRayItemResultSchema),
  slackDigest: z.string(),
  generatedAt: z.string(),
  durationMs: z.number().nonnegative(),
});
export type BatchXRayResponse = z.infer<typeof BatchXRayResponseSchema>;

/**
 * Outbound Slack Incoming Webhook payload validation (POST /api/alerts/slack).
 */
export const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/services/";

export const SlackWebhookRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(5, "Alert message text is required")
    .max(12000, "Alert message text is too long"),
  webhookUrl: z
    .string()
    .trim()
    .url("Enter a valid Slack Incoming Webhook URL")
    .refine(
      (u) => u.startsWith(SLACK_WEBHOOK_PREFIX),
      `Slack webhook URL must start with ${SLACK_WEBHOOK_PREFIX}`
    )
    .optional(),
});
export type SlackWebhookRequest = z.infer<typeof SlackWebhookRequestSchema>;

/**
 * Inbound lead / waitlist capture payload (POST /api/leads).
 */
export const LeadPlanInterestSchema = z.enum(["growth", "agency"]);
export type LeadPlanInterest = z.infer<typeof LeadPlanInterestSchema>;

export const LeadCaptureRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid work email address")
    .max(254, "Email address is too long"),
  companyName: z
    .string()
    .trim()
    .max(120, "Company or agency name must be 120 characters or fewer")
    .optional(),
  scannedUrl: z
    .string()
    .trim()
    .url("Scanned URL must be a valid http:// or https:// URL")
    .max(2000, "Scanned URL is too long")
    .optional(),
  dailyBudget: z.number().finite().min(0).max(1_000_000).optional(),
  dailyWaste: z.number().finite().min(0).max(1_000_000).optional(),
  verdict: OverallVerdictSchema.optional(),
  planInterest: LeadPlanInterestSchema.default("growth"),
  sourceCta: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .default("waste_banner_monitor_cta"),
  notes: z.string().trim().max(500).optional(),
});
export type LeadCaptureRequest = z.infer<typeof LeadCaptureRequestSchema>;

/**
 * Stripe on-site Checkout Session request payload (POST /api/billing/checkout).
 */
export const BillingCheckoutRequestSchema = z.object({
  plan: LeadPlanInterestSchema,
  customerEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(254)
    .optional(),
});
export type BillingCheckoutRequest = z.infer<typeof BillingCheckoutRequestSchema>;
