import { GoogleGenAI } from "@google/genai";
import {
  ExtractedAdClaimsSchema,
  GeminiClaimFallbackSchema,
  type ClaimSignal,
  type ExtractedAdClaims,
  type XRayReport,
} from "@/lib/schemas";

export const GEMINI_MODEL = "gemini-4-hydrogen";

export interface GeminiInteractionsClient {
  interactions: {
    create(params: {
      model: string;
      input: string;
      system_instruction?: string;
      store?: boolean;
      response_format?: {
        type: "text";
        mime_type: "application/json";
        schema: Record<string, unknown>;
      };
    }): Promise<{ output_text?: string | null }>;
  };
}

export class GeminiNotConfiguredError extends Error {
  readonly code = "GEMINI_NOT_CONFIGURED";

  constructor(message = "GEMINI_API_KEY is not configured on the server.") {
    super(message);
    this.name = "GeminiNotConfiguredError";
  }
}

export class GeminiUpstreamError extends Error {
  readonly code = "GEMINI_UPSTREAM_ERROR";
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "GeminiUpstreamError";
    this.status = status;
  }
}

const CLAIM_FALLBACK_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    advertisedPrice: {
      type: ["number", "null"],
      description: "Primary advertised product price, excluding shipping thresholds.",
    },
    compareAtPrice: {
      type: ["number", "null"],
      description: "Original compare-at/regular price if explicitly shown.",
    },
    currency: {
      type: ["string", "null"],
      description: "3-letter ISO currency code such as USD, GBP, EUR, CAD, AUD.",
    },
    promoCode: {
      type: ["string", "null"],
      description: "Explicit uppercase alphanumeric promo code if present, else null.",
    },
    discountPct: {
      type: ["number", "null"],
      description: "Numeric discount percentage if advertised, else null.",
    },
    variantName: {
      type: ["string", "null"],
      description: "Specific color, size, pack, or variant mentioned in the ad copy.",
    },
  },
};

function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Returns true when a server-side GEMINI_API_KEY is present in the environment.
 */
export function isGeminiConfigured(): boolean {
  return getApiKey() !== null;
}

function defaultClientFactory(apiKey: string): GeminiInteractionsClient {
  return new GoogleGenAI({ apiKey }) as unknown as GeminiInteractionsClient;
}

function getClient(
  clientFactory?: (apiKey: string) => GeminiInteractionsClient
): GeminiInteractionsClient {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new GeminiNotConfiguredError();
  }
  return (clientFactory ?? defaultClientFactory)(apiKey);
}

function mapUpstreamError(err: unknown): GeminiUpstreamError {
  if (err instanceof GeminiUpstreamError) {
    return err;
  }
  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitized = rawMessage.replace(/AIza[0-9A-Za-z_-]+|AQ\.[0-9A-Za-z._-]+/g, "[REDACTED]");
  const statusMatch = /\b(400|401|403|404|429|500|503)\b/.exec(sanitized);
  const status = statusMatch ? Number(statusMatch[1]) : 502;
  return new GeminiUpstreamError(sanitized, status);
}

function hasMissingFallbackFields(claims: ExtractedAdClaims): boolean {
  return (
    claims.advertisedPrice === null ||
    claims.promoCode === null ||
    claims.variantName === null
  );
}

/**
 * Optionally enriches ONLY unresolved (null) fields in deterministic ExtractedAdClaims
 * using Gemini structured output. Deterministic matches are never overwritten.
 */
export async function enrichClaimsWithGeminiFallback(
  claims: ExtractedAdClaims,
  adCopy: string,
  landingPageUrl: string,
  options?: { clientFactory?: (apiKey: string) => GeminiInteractionsClient }
): Promise<{ claims: ExtractedAdClaims; usedGemini: boolean }> {
  if (!hasMissingFallbackFields(claims) || !isGeminiConfigured()) {
    return { claims, usedGemini: false };
  }

  const client = getClient(options?.clientFactory);
  const prompt = [
    "Extract any missing structured offer claims from this DTC ad copy and landing URL.",
    "Do NOT invent values; return null for any field not clearly stated.",
    "Ignore free-shipping thresholds when determining advertisedPrice.",
    "",
    `Already extracted deterministically: ${JSON.stringify({
      advertisedPrice: claims.advertisedPrice,
      compareAtPrice: claims.compareAtPrice,
      currency: claims.currency,
      promoCode: claims.promoCode,
      discountPct: claims.discountPct,
      variantName: claims.variantName,
    })}`,
    `Landing URL: ${landingPageUrl}`,
    `Ad Copy: ${adCopy}`,
  ].join("\n");

  let outputText: string | null | undefined;
  try {
    const interaction = await client.interactions.create({
      model: GEMINI_MODEL,
      input: prompt,
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CLAIM_FALLBACK_JSON_SCHEMA,
      },
    });
    outputText = interaction.output_text;
  } catch (err) {
    throw mapUpstreamError(err);
  }

  if (!outputText) {
    return { claims, usedGemini: false };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outputText);
  } catch {
    return { claims, usedGemini: false };
  }

  const patchResult = GeminiClaimFallbackSchema.safeParse(parsedJson);
  if (!patchResult.success) {
    return { claims, usedGemini: false };
  }

  const patch = patchResult.data;
  const nextSignals: ClaimSignal[] = [...claims.signals];
  let updated = false;

  let advertisedPrice = claims.advertisedPrice;
  if (advertisedPrice === null && typeof patch.advertisedPrice === "number" && patch.advertisedPrice >= 0) {
    advertisedPrice = Math.round(patch.advertisedPrice * 100) / 100;
    nextSignals.push({
      field: "advertisedPrice",
      source: "ad_copy",
      rawMatch: String(advertisedPrice),
      confidence: "medium",
      note: `Gemini fallback (${GEMINI_MODEL})`,
    });
    updated = true;
  }

  let compareAtPrice = claims.compareAtPrice;
  if (compareAtPrice === null && typeof patch.compareAtPrice === "number" && patch.compareAtPrice > 0) {
    compareAtPrice = Math.round(patch.compareAtPrice * 100) / 100;
    nextSignals.push({
      field: "compareAtPrice",
      source: "ad_copy",
      rawMatch: String(compareAtPrice),
      confidence: "medium",
      note: `Gemini fallback (${GEMINI_MODEL})`,
    });
    updated = true;
  }

  let currency = claims.currency;
  if (currency === null && typeof patch.currency === "string" && /^[A-Z]{3}$/.test(patch.currency.trim().toUpperCase())) {
    currency = patch.currency.trim().toUpperCase();
    nextSignals.push({
      field: "currency",
      source: "ad_copy",
      rawMatch: currency,
      confidence: "medium",
      note: `Gemini fallback (${GEMINI_MODEL})`,
    });
    updated = true;
  }

  let promoCode = claims.promoCode;
  if (promoCode === null && typeof patch.promoCode === "string") {
    const candidate = patch.promoCode.trim().toUpperCase();
    if (/^[A-Z0-9_-]{3,20}$/.test(candidate)) {
      promoCode = candidate;
      nextSignals.push({
        field: "promoCode",
        source: "ad_copy",
        rawMatch: promoCode,
        confidence: "medium",
        note: `Gemini fallback (${GEMINI_MODEL})`,
      });
      updated = true;
    }
  }

  let discountPct = claims.discountPct;
  if (discountPct === null && typeof patch.discountPct === "number" && patch.discountPct > 0 && patch.discountPct <= 100) {
    discountPct = Math.round(patch.discountPct * 100) / 100;
    nextSignals.push({
      field: "discountPct",
      source: "ad_copy",
      rawMatch: `${discountPct}%`,
      confidence: "medium",
      note: `Gemini fallback (${GEMINI_MODEL})`,
    });
    updated = true;
  }

  let variantName = claims.variantName;
  if (variantName === null && typeof patch.variantName === "string" && patch.variantName.trim().length > 0) {
    variantName = patch.variantName.trim();
    nextSignals.push({
      field: "variantName",
      source: "ad_copy",
      rawMatch: variantName,
      confidence: "medium",
      note: `Gemini fallback (${GEMINI_MODEL})`,
    });
    updated = true;
  }

  if (!updated) {
    return { claims, usedGemini: false };
  }

  const enriched = ExtractedAdClaimsSchema.parse({
    ...claims,
    advertisedPrice,
    compareAtPrice,
    currency,
    promoCode,
    discountPct,
    variantName,
    signals: nextSignals,
  });

  return { claims: enriched, usedGemini: true };
}

/**
 * Queries Gemini remotely for performance-marketing diagnostics or remediation guidance,
 * optionally grounded in the active XRayReport.
 */
export async function queryGeminiInsights(
  input: { prompt: string; report?: XRayReport },
  options?: { clientFactory?: (apiKey: string) => GeminiInteractionsClient }
): Promise<{ answer: string; model: string }> {
  const client = getClient(options?.clientFactory);

  const contextLines = input.report
    ? [
        "Active OfferParity X-Ray Report:",
        `- Overall Status: ${input.report.overallStatus}`,
        `- Landing URL: ${input.report.request.landingPageUrl}`,
        `- Daily Budget: $${input.report.request.dailyBudget}`,
        `- Estimated Daily Waste: $${input.report.waste.estimatedDailyWaste} (30-day: $${input.report.waste.projectedMonthlyWaste})`,
        `- Checks: ${JSON.stringify(
          input.report.checks.map((c) => ({
            id: c.id,
            status: c.status,
            expected: c.expected,
            actual: c.actual,
            remediation: c.remediation,
          }))
        )}`,
      ]
    : ["No active X-Ray report provided; answer as an OfferParity DTC ad-ops assistant."];

  try {
    const interaction = await client.interactions.create({
      model: GEMINI_MODEL,
      system_instruction:
        "You are OfferParity's DTC performance marketing QA assistant. Give concise, concrete, actionable remediation advice grounded strictly in the provided X-Ray report.",
      input: `${contextLines.join("\n")}\n\nUser Question: ${input.prompt}`,
      store: false,
    });

    const answer = interaction.output_text?.trim();
    if (!answer) {
      throw new GeminiUpstreamError("Gemini returned an empty response.", 502);
    }

    return {
      answer,
      model: GEMINI_MODEL,
    };
  } catch (err) {
    throw mapUpstreamError(err);
  }
}
