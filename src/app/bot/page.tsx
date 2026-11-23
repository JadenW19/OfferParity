import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "OfferParityBot Allowlist Guide",
  description:
    "How OfferParityBot/1.0 verifies public product pages and how DTC brands can allowlist it in Cloudflare or DataDome.",
};

export default function BotPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/90 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-500/15 text-sky-300">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-bold text-white">OfferParity</span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <Link href="/" className="text-slate-300 hover:text-white">
              Free X-Ray
            </Link>
            <Link href="/pricing" className="text-slate-300 hover:text-white">
              Pricing
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Storefront Security &amp; WAF Allowlisting</span>
          </div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            OfferParityBot/1.0 Verification Guide
          </h1>
          <p className="text-sm text-slate-300">
            OfferParity uses a deterministic, read-only HTTP client to verify
            advertised prices, promo codes, and variant stock on public product
            landing pages.
          </p>
        </div>

        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-xs leading-relaxed text-slate-300">
          <h2 className="text-base font-semibold text-white">
            User-Agent &amp; Request Behavior
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-sky-300">
            OfferParityBot/1.0 (+https://offerparity.app; deterministic-ad-verifier)
          </pre>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Public Pages Only:</strong> Reads only the requested product
              landing page HTML and public Shopify <code>/products/&lt;handle&gt;.js</code>{" "}
              endpoints. Never accesses checkout, cart PII, or admin endpoints.
            </li>
            <li>
              <strong>Strict Caps:</strong> Enforces an 8-second timeout, max 3
              redirect hops, and a 2 MB response cap.
            </li>
            <li>
              <strong>No False Failures:</strong> If a WAF (Cloudflare, DataDome,
              PerimeterX) issues a challenge, OfferParity returns{" "}
              <code>WAF_CHALLENGE_MANUAL_CHECK</code> rather than reporting fake
              wasted ad spend.
            </li>
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-xs leading-relaxed text-slate-300">
          <h2 className="text-base font-semibold text-white">
            Cloudflare WAF Custom Rule (Skip / Allowlist)
          </h2>
          <p>
            If your storefront blocks automated parity checks, add a Cloudflare
            WAF Custom Rule scoped to product pages:
          </p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-emerald-300">
            {`(http.user_agent contains "OfferParityBot/1.0") and (http.request.uri.path contains "/products/")`}
          </pre>
          <p className="text-slate-400">
            Set the action to <strong>Skip</strong> (Super Bot Fight Mode /
            Managed Rules) for that expression.
          </p>
        </section>
      </main>
    </div>
  );
}
