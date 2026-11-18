import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OfferParity — Broken-Offer X-Ray",
  description:
    "Detect price mismatches, out-of-stock hero variants, expired promo codes, and broken UTMs between your paid ads and landing pages.",
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
