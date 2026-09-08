import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api/", "/welcome", "/login"],
    },
    sitemap: `${baseUrl()}/sitemap.xml`,
  };
}
