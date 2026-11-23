import type { Metadata } from "next";
import Link from "next/link";
import { Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "OfferParityBot Allowlist Guide",
  description:
    "How OfferParityBot/1.0 verifies public product pages and how DTC brands can allowlist it in Cloudflare or DataDome.",
};

export default function BotPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 px-4 py-2 backdrop-blur">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-ink)]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-bold text-[var(--text-primary)]">OfferParity</span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              Free X-Ray
            </Link>
            <Link href="/pricing" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              Pricing
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
        <div className="space-y-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-soft-text)]">
            Storefront Security &amp; WAF Allowlisting
          </p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
            OfferParityBot/1.0 Verification Guide
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            OfferParity uses a deterministic, read-only HTTP client to verify
            advertised prices, promo codes, and variant stock on public product
            landing pages.
          </p>
        </div>

        <section className="space-y-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 text-xs leading-relaxed text-[var(--text-muted)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            User-Agent &amp; Request Behavior
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3 font-mono text-[var(--text-primary)]">
            OfferParityBot/1.0 (+https://offerparity.app; deterministic-ad-verifier)
          </pre>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Public Pages Only:</strong> Reads only the requested product
              landing page HTML and public Shopify <code>/products/&lt;handle&gt;.js</code>{" "}
              endpoints. Never accesses checkout, cart PII, or admin endpoints.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Strict Caps:</strong> Enforces an 8-second timeout, max 3
              redirect hops, and a 2 MB response cap.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">No False Failures:</strong> If a WAF (Cloudflare, DataDome,
              PerimeterX) issues a challenge, OfferParity returns{" "}
              <code>WAF_CHALLENGE_MANUAL_CHECK</code> rather than reporting fake
              wasted ad spend.
            </li>
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 text-xs leading-relaxed text-[var(--text-muted)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Cloudflare WAF Custom Rule (Skip / Allowlist)
          </h2>
          <p>
            If your storefront blocks automated parity checks, add a Cloudflare
            WAF Custom Rule scoped to product pages:
          </p>
          <pre className="overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface-subtle)] p-3 font-mono text-[var(--text-primary)]">
            {`(http.user_agent contains "OfferParityBot/1.0") and (http.request.uri.path contains "/products/")`}
          </pre>
          <p>
            Set the action to <strong className="text-[var(--text-primary)]">Skip</strong> (Super Bot Fight Mode /
            Managed Rules) for that expression.
          </p>
        </section>
      </main>
    </div>
  );
}
