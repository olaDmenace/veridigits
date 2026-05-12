import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/utils/app-url";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getAppUrl();
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
