import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private pages are not blocked here but answer with X-Robots-Tag: noindex (next.config.ts): a robots block kept
      // Google from seeing that, so /app/agents was "indexed though blocked by robots.txt".
      disallow: ["/api/"],
    },
    sitemap: `${baseUrl()}/sitemap.xml`,
  };
}
