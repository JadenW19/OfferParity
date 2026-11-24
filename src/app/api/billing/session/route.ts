import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getWorkspaceBySessionId,
  getWorkspaceItems,
  provisionPaidWorkspace,
  toPublicWorkspaceView,
} from "@/lib/storage/watchlistStore";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id query parameter", code: "VALIDATION_ERROR" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  let workspace = await getWorkspaceBySessionId(sessionId);

  if (!workspace) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      return NextResponse.json(
        { error: "Workspace not found for checkout session.", code: "NOT_FOUND" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    try {
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (
        session.status !== "complete" &&
        session.payment_status !== "paid"
      ) {
        return NextResponse.json(
          {
            error: "Checkout session is not completed yet.",
            code: "CHECKOUT_INCOMPLETE",
          },
          { status: 409, headers: NO_STORE_HEADERS }
        );
      }

      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (!customerId) {
        return NextResponse.json(
          { error: "Stripe customer ID missing on session.", code: "CUSTOMER_MISSING" },
          { status: 409, headers: NO_STORE_HEADERS }
        );
      }

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);
      const email =
        session.customer_details?.email ||
        session.customer_email ||
        "customer@offerparity.app";
      const plan: "growth" | "agency" =
        session.metadata?.plan_tier === "agency" ? "agency" : "growth";

      workspace = await provisionPaidWorkspace({
        email,
        plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeCheckoutSessionId: session.id,
      });
    } catch (err) {
      console.error(
        "[OfferParity] Failed to hydrate checkout session:",
        err instanceof Error ? err.message : "unknown error"
      );
      return NextResponse.json(
        { error: "Unable to verify Stripe checkout session.", code: "STRIPE_UPSTREAM_ERROR" },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }
  }

  const items = await getWorkspaceItems(workspace.id);
  return NextResponse.json(
    {
      ok: true,
      managementToken: workspace.managementToken,
      workspace: toPublicWorkspaceView(workspace, items),
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}
