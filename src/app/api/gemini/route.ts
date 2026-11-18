import { NextResponse } from "next/server";
import {
  GEMINI_MODEL,
  GeminiNotConfiguredError,
  GeminiUpstreamError,
  isGeminiConfigured,
  queryGeminiInsights,
} from "@/lib/ai/geminiClient";
import { GeminiQueryRequestSchema } from "@/lib/schemas";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      configured: isGeminiConfigured(),
      model: GEMINI_MODEL,
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}

export async function POST(req: Request): Promise<Response> {
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

  const parsed = GeminiQueryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed for Gemini query request",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join(".") || "body",
          message: issue.message,
        })),
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const result = await queryGeminiInsights(parsed.data);
    return NextResponse.json(result, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err) {
    if (err instanceof GeminiNotConfiguredError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
        },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }

    if (err instanceof GeminiUpstreamError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
        },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        error: "Unexpected error while querying Gemini API",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
