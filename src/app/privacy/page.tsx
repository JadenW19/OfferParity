import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "OfferParity privacy policy for diagnostic scans and lead submissions.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-200 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-xs font-semibold text-sky-400 hover:underline">
          ← Back to OfferParity
        </Link>
        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        <p className="text-xs text-slate-400">Effective Date: November 23, 2026</p>

        <div className="space-y-4 text-sm leading-relaxed text-slate-300">
          <p>
            OfferParity provides deterministic ad-to-landing-page parity
            diagnostics. When you run a free Broken-Offer X-Ray scan on{" "}
            <code>/</code>, your ad copy and target URL are processed in-memory
            to generate your report and are not sold or shared with third-party
            data brokers.
          </p>
          <p>
            <strong>Lead &amp; Monitoring Requests:</strong> If you submit your
            work email, company name, or Slack webhook details to request hourly
            monitoring, we use that information solely to provision your
            monitoring workspace, send requested alerts, and communicate about
            your account.
          </p>
          <p>
            <strong>Slack Webhooks:</strong> Incoming Webhook URLs provided in
            the UI are used strictly to deliver the requested alert payload to{" "}
            <code>https://hooks.slack.com/services/...</code> and are never
            exposed to other users.
          </p>
          <p>
            To request deletion of your contact details, email{" "}
            <code>support@offerparity.app</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
