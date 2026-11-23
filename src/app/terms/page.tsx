import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "OfferParity terms of service.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-200 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-xs font-semibold text-sky-400 hover:underline">
          ← Back to OfferParity
        </Link>
        <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
        <p className="text-xs text-slate-400">Effective Date: November 23, 2026</p>

        <div className="space-y-4 text-sm leading-relaxed text-slate-300">
          <p>
            OfferParity provides read-only landing page parity diagnostics and
            estimated ad-spend waste calculations for informational and QA
            purposes. OfferParity does not automatically pause, edit, or manage
            your paid media campaigns.
          </p>
          <p>
            <strong>Authorized Scanning:</strong> You agree to submit only
            landing page URLs you own, manage on behalf of a client, or are
            otherwise authorized to inspect. Automated abuse, SSRF probing, or
            high-volume scraping against third-party storefronts is prohibited.
          </p>
          <p>
            <strong>Paid Subscriptions:</strong> Growth and Agency plans are
            billed monthly and may be canceled at any time prior to the next
            billing cycle.
          </p>
        </div>
      </div>
    </div>
  );
}
