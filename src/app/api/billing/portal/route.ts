import { NextResponse } from "next/server";
import Stripe from "stripe";
import { BillingPortalRequestSchema } from "@/lib/schemas";
import {
  getWorkspaceBySessionId,
  getWorkspaceByToken,
} from "@/lib/storage/watchlistStore";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function resolveAppOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function POST(req: Request): Promise<Response> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return NextResponse.json(
      { error: "Stripe billing portal is not configured.", code: "STRIPE_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (err) {
    console.warn(
      "[OfferParity] Malformed JSON on POST /api/billing/portal:",
      err instanceof Error ? err.message : "invalid json"
    );
    return NextResponse.json(
      { error: "Malformed JSON request body", code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = BillingPortalRequestSchema.safeParse(rawBody);
  if (!parsed.success || (!parsed.data.workspaceToken && !parsed.data.sessionId)) {
    return NextResponse.json(
      { error: "Provide workspaceToken or sessionId", code: "VALIDATION_ERROR" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const workspace = parsed.data.workspaceToken
    ? await getWorkspaceByToken(parsed.data.workspaceToken)
    : await getWorkspaceBySessionId(parsed.data.sessionId!);

  if (!workspace?.stripeCustomerId) {
    return NextResponse.json(
      {
        error: "No active Stripe subscription customer found for this workspace.",
        code: "CUSTOMER_NOT_FOUND",
      },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const stripe = new Stripe(secretKey);
    const origin = resolveAppOrigin(req);
    const returnUrl = `${origin}/watchlist?token=${encodeURIComponent(workspace.managementToken)}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: returnUrl,
    });

    return NextResponse.json(
      { url: portalSession.url },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      "[OfferParity] Stripe Billing Portal creation failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Unable to create Stripe Billing Portal session.", code: "STRIPE_UPSTREAM_ERROR" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
