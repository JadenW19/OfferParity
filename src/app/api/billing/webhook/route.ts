import { NextResponse } from "next/server";
import Stripe from "stripe";
import { SLACK_WEBHOOK_PREFIX } from "@/lib/schemas";
import {
  provisionPaidWorkspace,
  updateWorkspaceSubscriptionState,
} from "@/lib/storage/watchlistStore";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function resolvePlanFromSubscription(
  sub: Stripe.Subscription
): "growth" | "agency" {
  const agencyPriceId =
    process.env.STRIPE_PRICE_AGENCY_ID?.trim() || "price_1Uf6OBEtiOWkP8V8KvQCd9yh";
  const hasAgencyItem = sub.items.data.some(
    (item) => item.price?.id === agencyPriceId
  );
  if (hasAgencyItem || sub.metadata?.plan_tier === "agency") {
    return "agency";
  }
  return "growth";
}

async function notifyNewSubscriberSlack(
  email: string,
  plan: "growth" | "agency"
): Promise<void> {
  const webhookUrl =
    process.env.LEAD_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl || !webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:tada: *New OfferParity Paid Subscriber:* ${email} subscribed to *${plan.toUpperCase()}*`,
      }),
      redirect: "error",
    });
  } catch (err) {
    console.warn(
      "[OfferParity] Failed to send new-subscriber Slack notice:",
      err instanceof Error ? err.message : "unknown error"
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secretKey || !webhookSecret) {
    return NextResponse.json(
      {
        error: "Stripe webhook handler is not configured.",
        code: "WEBHOOK_NOT_CONFIGURED",
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header", code: "MISSING_SIGNATURE" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const rawBody = await req.text();
  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.warn(
      "[OfferParity] Stripe webhook signature verification failed:",
      err instanceof Error ? err.message : "invalid signature"
    );
    return NextResponse.json(
      { error: "Invalid Stripe webhook signature", code: "INVALID_SIGNATURE" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
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

        if (customerId) {
          await provisionPaidWorkspace({
            email,
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripeCheckoutSessionId: session.id,
          });
          await notifyNewSubscriberSlack(email, plan);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const mappedStatus =
          sub.status === "active" || sub.status === "trialing"
            ? "active"
            : sub.status === "past_due" || sub.status === "unpaid"
              ? "past_due"
              : "canceled";

        await updateWorkspaceSubscriptionState(customerId, {
          status: mappedStatus,
          plan: resolvePlanFromSubscription(sub),
          stripeSubscriptionId: sub.id,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        await updateWorkspaceSubscriptionState(customerId, {
          status: "canceled",
          stripeSubscriptionId: sub.id,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          await updateWorkspaceSubscriptionState(customerId, {
            status: "past_due",
          });
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error(
      "[OfferParity] Error processing Stripe webhook event:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Failed to process webhook event", code: "WEBHOOK_PROCESSING_ERROR" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
