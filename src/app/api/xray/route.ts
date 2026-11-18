import { NextResponse } from "next/server";
import { enrichClaimsWithGeminiFallback } from "@/lib/ai/geminiClient";
import { evaluateParity } from "@/lib/diff/parityEngine";
import { calculateWaste } from "@/lib/diff/wasteCalculator";
import { buildMarkdownReport, buildSlackAlert } from "@/lib/exporters/reportFormatters";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import { XRayReportSchema, XRayRequestSchema } from "@/lib/schemas";
import { SsrfBlockedError } from "@/lib/verifier/ssrfGuard";
import { verifyStorefront } from "@/lib/verifier/storefrontVerifier";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function POST(req: Request): Promise<Response> {
  const startedAt = performance.now();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Malformed JSON request body",
        code: "INVALID_JSON",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsedRequest = XRayRequestSchema.safeParse(rawBody);
  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: "Validation failed for X-Ray request",
        code: "VALIDATION_ERROR",
        details: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join(".") || "body",
          message: issue.message,
        })),
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const request = parsedRequest.data;

  try {
    let extractedClaims = extractAdClaims(request.adCopy, request.landingPageUrl);

    if (request.useGeminiFallback) {
      try {
        const enriched = await enrichClaimsWithGeminiFallback(
          extractedClaims,
          request.adCopy,
          request.landingPageUrl
        );
        extractedClaims = enriched.claims;
      } catch (fallbackErr) {
        const reason =
          fallbackErr instanceof Error ? fallbackErr.message : "Gemini fallback unavailable";
        console.warn("[OfferParity] Optional Gemini fallback failed:", reason);
        // Preserve deterministic extraction when optional Gemini fallback fails.
      }
    }

    const storefront = await verifyStorefront({
      landingPageUrl: request.landingPageUrl,
      fixtureId: request.fixtureId,
      promoCode: extractedClaims.promoCode,
    });

    const { checks, overallStatus } = evaluateParity(extractedClaims, storefront);
    const waste = calculateWaste(checks, request.dailyBudget, overallStatus);
    const generatedAt = new Date().toISOString();
    const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);

    const reportBase = {
      request,
      extractedClaims,
      storefront,
      checks,
      overallStatus,
      waste,
      generatedAt,
      durationMs,
    };

    const slackAlert = buildSlackAlert(reportBase);
    const markdownReport = buildMarkdownReport(reportBase);

    const report = XRayReportSchema.parse({
      ...reportBase,
      slackAlert,
      markdownReport,
    });

    return NextResponse.json(report, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          reason: err.reason,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        error: "Unexpected error while running OfferParity X-Ray",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
