import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://offerparity.app";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/bot", "/privacy", "/terms"],
        disallow: ["/api/", "/dashboard/"],
      },
    ],
    sitemap: `${baseUrl.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
