import type { Metadata } from "next";
import "./globals.css";

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://offerparity.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "OfferParity — Broken-Offer X-Ray",
    template: "%s | OfferParity",
  },
  description:
    "Detect price mismatches, out-of-stock hero variants, expired promo codes, and broken UTMs between your paid ads and landing pages.",
  openGraph: {
    type: "website",
    title: "OfferParity — Broken-Offer X-Ray",
    description:
      "Prove live wasted ad spend in under 15 seconds. Deterministic ad-to-checkout parity verification for DTC brands and agencies.",
    siteName: "OfferParity",
  },
  twitter: {
    card: "summary_large_image",
    title: "OfferParity — Broken-Offer X-Ray",
    description:
      "Detect price mismatches, out-of-stock hero variants, expired promo codes, and broken UTMs before they burn ad budget.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
