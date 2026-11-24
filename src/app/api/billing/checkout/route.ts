import { NextResponse } from "next/server";
import Stripe from "stripe";
import { resolveStripePriceId } from "@/lib/billing/plans";
import { BillingCheckoutRequestSchema } from "@/lib/schemas";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";

export const dynamic = "force-dynamic";

const CHECKOUT_RATE_LIMIT_RPM = 15;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function resolveAppOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  try {
    const reqUrl = new URL(req.url);
    return reqUrl.origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`billing-checkout:${ip}`, CHECKOUT_RATE_LIMIT_RPM);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many checkout attempts (${limit.limit}/min). Retry in ${limit.retryAfterSeconds}s.`,
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(limit.retryAfterSeconds),
        },
      }
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return NextResponse.json(
      {
        error:
          "On-site Stripe Checkout is not configured yet (missing STRIPE_SECRET_KEY).",
        code: "STRIPE_NOT_CONFIGURED",
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (parseErr) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/billing/checkout:",
      parseErr instanceof Error ? parseErr.message : "invalid json"
    );
    return NextResponse.json(
      { error: "Malformed JSON request body", code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = BillingCheckoutRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Invalid checkout request payload",
        code: "VALIDATION_ERROR",
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { plan, customerEmail } = parsed.data;
  const priceId = resolveStripePriceId(plan);
  const origin = resolveAppOrigin(req);

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "elements",
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      return_url: `${origin}/pricing?checkout=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: {
        plan_tier: plan,
      },
    });

    if (!session.client_secret) {
      console.error(
        "[OfferParity] Stripe Checkout Session missing client_secret:",
        session.id
      );
      return NextResponse.json(
        {
          error: "Stripe Checkout Session did not return a client secret.",
          code: "STRIPE_SESSION_INVALID",
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        clientSecret: session.client_secret,
        sessionId: session.id,
        plan,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      "[OfferParity] Stripe Checkout Session creation failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      {
        error: "Unable to initialize Stripe Checkout session.",
        code: "STRIPE_UPSTREAM_ERROR",
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
