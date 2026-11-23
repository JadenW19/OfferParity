import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for DTC brands and performance marketing agencies. Start free with Broken-Offer X-Ray or upgrade for hourly Slack regression alerts.",
};

const GROWTH_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_GROWTH_LINK?.trim() || "";
const AGENCY_STRIPE_LINK =
  process.env.NEXT_PUBLIC_STRIPE_AGENCY_LINK?.trim() || "";

interface TierCard {
  id: "free" | "growth" | "agency";
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

const TIERS: TierCard[] = [
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/90 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/15 text-sky-300">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">
              OfferParity
            </span>
          </Link>

          <nav aria-label="Primary navigation" className="flex items-center gap-4 text-xs font-semibold">
            <Link href="/" className="text-slate-300 transition hover:text-white">
              Free X-Ray
            </Link>
            <Link href="/bot" className="text-slate-300 transition hover:text-white">
              Bot Allowlist
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-sky-300"
            >
              Pricing
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <section className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sleep Insurance for Paid Media Budgets</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Stop Paying for Clicks to Broken Offers
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Start with the free Broken-Offer X-Ray forever. Upgrade when you want
            hourly automated monitoring and instant Slack alerts the moment a hero
            size sells out or a promo code breaks.
          </p>
        </section>

        <section
          aria-label="Pricing plans"
          className="grid gap-6 lg:grid-cols-3"
        >
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`flex flex-col justify-between rounded-2xl border p-6 ${
                tier.highlighted
                  ? "border-sky-400/60 bg-slate-900/90 shadow-lg shadow-sky-950/30"
                  : "border-slate-800 bg-slate-900/60"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-white">{tier.name}</h2>
                  {tier.badge ? (
                    <span className="rounded-full border border-sky-400/40 bg-sky-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-sky-200">
                      {tier.badge}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    {tier.price}
                  </span>
                  <span className="text-sm text-slate-400">{tier.cadence}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  {tier.audience}
                </p>

                <ul className="mt-6 space-y-2.5 text-xs text-slate-200">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                        aria-hidden="true"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                {tier.external ? (
                  <a
                    href={tier.ctaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                      tier.highlighted
                        ? "bg-sky-500 text-slate-950 hover:bg-sky-400"
                        : "border border-slate-700 bg-slate-950 text-white hover:border-slate-500"
                    }`}
                  >
                    <span>{tier.ctaLabel}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : (
                  <Link
                    href={tier.ctaHref}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                      tier.highlighted
                        ? "bg-sky-500 text-slate-950 hover:bg-sky-400"
                        : "border border-slate-700 bg-slate-950 text-white hover:border-slate-500"
                    }`}
                  >
                    <span>{tier.ctaLabel}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </section>

        <section
          aria-label="Frequently asked questions"
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8"
        >
          <h2 className="text-lg font-bold text-white">
            Frequently Asked Questions
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {FAQS.map((item) => (
              <div key={item.q}>
                <h3 className="text-sm font-semibold text-white">{item.q}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
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
