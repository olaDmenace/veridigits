import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getAppUrl } from "@/lib/utils/app-url";
import "./globals.css";

const APP_URL = getAppUrl();
const DESCRIPTION =
  "Anonymity-first SMS verification. Top up with crypto, receive codes from 5,000+ services across 180+ countries. No KYC, no questions.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Veridigits — Receive SMS without the trace",
    template: "%s · Veridigits",
  },
  description: DESCRIPTION,
  applicationName: "Veridigits",
  keywords: [
    "SMS verification",
    "OTP",
    "crypto payments",
    "anonymous numbers",
    "temporary phone number",
  ],
  openGraph: {
    type: "website",
    siteName: "Veridigits",
    title: "Veridigits — Receive SMS without the trace",
    description: DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Veridigits — Receive SMS without the trace",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF8F3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable @next/next/no-page-custom-font -- App Router layout applies fonts globally; a single stylesheet link keeps the three families (Fraunces variable serif w/ optical sizing, Inter, JetBrains Mono) in one request. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,400;1,9..144,500;1,9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        {/* eslint-enable @next/next/no-page-custom-font */}
      </head>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
