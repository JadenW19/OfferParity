import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

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

const COLOR_SCHEME_INIT_SCRIPT = `(function(){try{var m=document.querySelector('meta[name="color-scheme"]');if(m){m.content=localStorage.getItem("color-scheme")||"dark";}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="dark" />
        <script
          dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
