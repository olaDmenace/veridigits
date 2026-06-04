import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getAppUrl } from "@/lib/utils/app-url";
import { WhatsAppSupport } from "@/components/whatsapp-support";
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
  themeColor: "#ffffff",
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
        {/* eslint-disable @next/next/no-page-custom-font -- App Router layout applies fonts globally; one stylesheet link keeps Instrument Sans (UI + display) and JetBrains Mono (numerics/codes) in a single request. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        {/* eslint-enable @next/next/no-page-custom-font */}
      </head>
      <body>
        {children}
        <WhatsAppSupport />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
