import type { Metadata, Viewport } from "next";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable @next/next/no-page-custom-font -- App Router layout applies fonts globally; General Sans is not on Google Fonts so next/font/google is not viable. */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f%5B%5D=general-sans@400,500,600,700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        {/* eslint-enable @next/next/no-page-custom-font */}
      </head>
      <body>{children}</body>
    </html>
  );
}
