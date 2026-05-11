import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup", "/forgot-password", "/legal/"],
        disallow: [
          "/dashboard",
          "/buy",
          "/orders",
          "/topup",
          "/settings",
          "/admin",
          "/api/",
          "/auth/callback",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
