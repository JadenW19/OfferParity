"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { EmbeddedCheckoutModal } from "@/components/EmbeddedCheckoutModal";
import { trackEvent } from "@/lib/analytics";
import type { LeadPlanInterest } from "@/lib/schemas";

const HAS_EMBEDDED_CHECKOUT = Boolean(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
);

interface PricingCtaButtonProps {
  tierId: "free" | LeadPlanInterest;
  ctaLabel: string;
  ctaHref: string;
  external: boolean;
  highlighted: boolean;
  onSelectPlan?: (plan: LeadPlanInterest) => void;
}

function PricingCtaButton({
  tierId,
  ctaLabel,
  ctaHref,
  external,
  highlighted,
  onSelectPlan,
}: PricingCtaButtonProps) {
  const buttonClass = `inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
    highlighted
      ? "bg-[var(--accent-primary)] text-[var(--accent-ink)] hover:bg-[var(--accent-primary-hover)]"
      : "border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
  }`;

  if (tierId !== "free" && HAS_EMBEDDED_CHECKOUT && onSelectPlan) {
    return (
      <button
        type="button"
        onClick={() => {
          trackEvent("pricing_cta_clicked", {
            plan: tierId,
            mode: "embedded_checkout",
          });
          onSelectPlan(tierId);
        }}
        className={buttonClass}
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  if (external) {
    return (
      <a
        href={ctaHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          trackEvent("pricing_cta_clicked", {
            plan: tierId,
            mode: "payment_link",
          })
        }
        className={buttonClass}
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    );
  }

  return (
    <Link href={ctaHref} className={buttonClass}>
      <span>{ctaLabel}</span>
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export interface PricingTierCardData {
  id: "free" | LeadPlanInterest;
  name: string;
  price: string;
  cadence: string;
  audience: string;
  badge?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  external: boolean;
  highlighted: boolean;
}

export function PricingGridWithCheckout({
  tiers,
}: {
  tiers: PricingTierCardData[];
}) {
  const [activePlan, setActivePlan] = useState<LeadPlanInterest | null>(null);
  const [checkoutSuccessPlan, setCheckoutSuccessPlan] = useState<string | null>(
    null
  );

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "success") {
        setCheckoutSuccessPlan(params.get("plan") ?? "selected");
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <>
      {checkoutSuccessPlan ? (
        <div
          role="status"
          className="mx-auto flex max-w-2xl items-center gap-2.5 rounded-2xl border border-[var(--status-pass-border)] bg-[var(--status-pass-bg)] px-4 py-3 text-xs font-medium text-[var(--status-pass-text)]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Subscription confirmed for the{" "}
            <strong className="uppercase">{checkoutSuccessPlan}</strong> plan!
            Check your email for your Stripe receipt and onboarding steps.
          </span>
        </div>
      ) : null}

      <section aria-label="Pricing plans" className="grid gap-6 lg:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className={`flex flex-col justify-between rounded-2xl border p-6 ${
              tier.highlighted
                ? "border-[var(--text-primary)] bg-[var(--bg-surface)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-surface)]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {tier.name}
                </h2>
                {tier.badge ? (
                  <span className="rounded-full border border-[var(--accent-soft-border)] bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent-soft-text)]">
                    {tier.badge}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-mono text-4xl font-bold tracking-tight text-[var(--text-primary)]">
                  {tier.price}
                </span>
                <span className="text-sm text-[var(--text-muted)]">
                  {tier.cadence}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                {tier.audience}
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-[var(--text-primary)]">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-pass-text)]"
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8">
              <PricingCtaButton
                tierId={tier.id}
                ctaLabel={tier.ctaLabel}
                ctaHref={tier.ctaHref}
                external={tier.external}
                highlighted={tier.highlighted}
                onSelectPlan={(plan) => setActivePlan(plan)}
              />
            </div>
          </div>
        ))}
      </section>

      <EmbeddedCheckoutModal
        key={activePlan ?? "closed"}
        plan={activePlan}
        onClose={() => setActivePlan(null)}
      />
    </>
  );
}
