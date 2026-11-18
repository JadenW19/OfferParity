import { NextResponse } from "next/server";
import { XRayRequestSchema } from "@/lib/schemas";
import {
  checkRateLimit,
  getClientIp,
  getConfiguredSingleRpm,
} from "@/lib/security/rateLimiter";
import { SsrfBlockedError } from "@/lib/verifier/ssrfGuard";
import { runSingleXRay } from "@/lib/xrayRunner";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`xray:${ip}`, getConfiguredSingleRpm());
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded (${limit.limit} requests/min). Retry in ${limit.retryAfterSeconds}s.`,
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(limit.retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (parseErr) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/xray:",
      parseErr instanceof Error ? parseErr.message : "invalid json"
    );
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

  try {
    const report = await runSingleXRay(parsedRequest.data);
    return NextResponse.json(report, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "X-RateLimit-Remaining": String(limit.remaining),
      },
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

    console.error(
      "[OfferParity] Unexpected error in POST /api/xray:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      {
        error: "Unexpected error while running OfferParity X-Ray",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
