import type { LeadPlanInterest } from "@/lib/schemas";

export interface OfferParityBillingPlan {
  id: LeadPlanInterest;
  name: string;
  priceUsd: number;
  intervalLabel: string;
  defaultPriceId: string;
  maxBrands: number;
  maxWatchlistItems: number;
  summary: string;
}

export const BILLING_PLANS: Record<LeadPlanInterest, OfferParityBillingPlan> = {
  growth: {
    id: "growth",
    name: "OfferParity Growth",
    priceUsd: 99,
    intervalLabel: "/month",
    defaultPriceId: "price_1Uf6O4EtiOWkP8V8hjojfta9",
    maxBrands: 1,
    maxWatchlistItems: 25,
    summary: "1 brand · up to 25 active ad URLs monitored hourly in Slack",
  },
  agency: {
    id: "agency",
    name: "OfferParity Agency",
    priceUsd: 249,
    intervalLabel: "/month",
    defaultPriceId: "price_1Uf6OBEtiOWkP8V8KvQCd9yh",
    maxBrands: 10,
    maxWatchlistItems: 250,
    summary: "Up to 10 client brands · up to 250 active ad URLs monitored hourly",
  },
};

export function resolveStripePriceId(plan: LeadPlanInterest): string {
  if (plan === "agency") {
    return (
      process.env.STRIPE_PRICE_AGENCY_ID?.trim() ||
      BILLING_PLANS.agency.defaultPriceId
    );
  }
  return (
    process.env.STRIPE_PRICE_GROWTH_ID?.trim() ||
    BILLING_PLANS.growth.defaultPriceId
  );
}
