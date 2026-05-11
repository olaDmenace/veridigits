import type { NextConfig } from "next";

/**
 * Standard hardening headers. We do NOT set a strict CSP yet because the
 * design system loads Fontshare (General Sans) + Google Fonts (JetBrains
 * Mono) via <link>, and Supabase Realtime opens wss connections at runtime
 * — both would need explicit allowlisting. Add CSP when we lock font
 * loading to next/font/local.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS only makes sense once we're behind HTTPS in production; Vercel
  // already serves with HSTS on the platform edge, but emitting it from
  // the app makes it portable to other hosts.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Don't ship sourcemaps to production — they expose the unminified
  // source of server actions and our wallet logic.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
