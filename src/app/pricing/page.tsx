import type { Metadata } from "next";
import Link from "next/link";
import { Zap } from "lucide-react";
import {
  PricingGridWithCheckout,
  type PricingTierCardData,
} from "@/components/PricingTierActions";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for DTC brands and performance marketing agencies. Start free with Broken-Offer X-Ray or upgrade for hourly Slack regression alerts.",
};

const GROWTH_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_GROWTH_LINK?.trim() || "";
const AGENCY_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_AGENCY_LINK?.trim() || "";

const TIERS: PricingTierCardData[] = [
  {
    id: "free",
    name: "Broken-Offer X-Ray",
    price: "$0",
    cadence: "forever",
    audience: "Instant pre-flight & live ad diagnostics with zero login walls.",
    features: [
      "Unlimited single-ad X-Ray checks",
      "Up to 25-row Batch CSV Pre-Flight audits",
      "6-point deterministic parity diff & waste math",
      "Shareable QA permalinks & Markdown/JSON exports",
      "1-click Slack Incoming Webhook test delivery",
    ],
    ctaLabel: "Run Free X-Ray",
    ctaHref: "/",
    external: false,
    highlighted: false,
  },
  {
    id: "growth",
    name: "Growth Brand",
    price: "$99",
    cadence: "/month",
    audience: "For mid-market DTC brands protecting active paid traffic 24/7.",
    features: [
      "1 brand workspace",
      "Up to 25 active ad URLs monitored hourly",
      "Regression-only Slack & email alerts (zero noise)",
      "Transient 5xx damping to eliminate false alarms",
      "30-day audit history & weekly spend-protected digest",
    ],
    ctaLabel: GROWTH_STRIPE_LINK
      ? "Start Growth Plan ($99/mo)"
      : "Request Growth Onboarding",
    ctaHref: GROWTH_STRIPE_LINK || "/?monitor=growth",
    external: Boolean(GROWTH_STRIPE_LINK),
    highlighted: false,
  },
  {
    id: "agency",
    name: "Agency",
    price: "$249",
    cadence: "/month",
    audience: "For DTC performance agencies managing 5–20 client ad accounts.",
    badge: "Most Popular",
    features: [
      "Up to 10 client brand workspaces",
      "Up to 250 active ad URLs monitored hourly",
      "Per-client Slack webhook routing",
      "Bulk CSV Watchlist sync for campaign launches",
      "Priority OfferParityBot WAF allowlist onboarding",
    ],
    ctaLabel: AGENCY_STRIPE_LINK
      ? "Start Agency Plan ($249/mo)"
      : "Request Agency Onboarding",
    ctaHref: AGENCY_STRIPE_LINK || "/?monitor=agency",
    external: Boolean(AGENCY_STRIPE_LINK),
    highlighted: true,
  },
];

const FAQS = [
  {
    q: "Do I need to connect Meta, TikTok, or Google Ads OAuth?",
    a: "No. OfferParity reads your ad copy and destination URLs via paste or CSV export. There is zero write-OAuth risk and zero risk of resetting ad platform learning phases.",
  },
  {
    q: "How does OfferParity verify prices and variant stock?",
    a: "Deterministically in pure code—checking Shopify /products/<handle>.js variant matrices, schema.org/Product JSON-LD, Microdata, OpenGraph tags, and HTTP redirect chains. Zero LLM guessing.",
  },
  {
    q: "What happens if a client storefront uses Cloudflare or DataDome?",
    a: "OfferParity detects bot challenges cleanly as WAF_CHALLENGE_MANUAL_CHECK instead of firing false failure alarms, and provides a 1-minute allowlist rule for OfferParityBot/1.0.",
  },
  {
    q: "How fast does OfferParity pay for itself?",
    a: "Catching a single out-of-stock hero variant on a $500/day campaign saves ~$425/day—more than a full year on the Growth plan in under 6 hours.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 px-4 py-2 backdrop-blur">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-ink)]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
              OfferParity
            </span>
          </Link>

          <nav aria-label="Primary navigation" className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/" className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]">
              Free X-Ray
            </Link>
            <Link href="/watchlist" className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]">
              Watchlist
            </Link>
            <Link href="/bot" className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]">
              Bot Allowlist
            </Link>
            <Link
              href="/pricing"
              className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent-soft-text)]"
            >
              Pricing
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <section className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-soft-text)]">
            Pricing · Sleep Insurance for Paid Media
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
            Stop Paying for Clicks to Broken Offers
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Start with the free Broken-Offer X-Ray forever. Upgrade when you want
            hourly automated monitoring and instant Slack alerts the moment a hero
            size sells out or a promo code breaks.
          </p>
        </section>

        <PricingGridWithCheckout tiers={TIERS} />

        <section
          aria-label="Frequently asked questions"
          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 sm:p-8"
        >
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            Frequently Asked Questions
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {FAQS.map((item) => (
              <div key={item.q}>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{item.q}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
