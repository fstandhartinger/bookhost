import type { MetadataRoute } from "next";
import { getPosts } from "@/app/blog/posts";
import { PUBLIC_BASE_URL } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPaths = [
    "",
    "/pricing",
    "/blog",
    "/legal/impressum",
    "/legal/datenschutz",
    "/legal/agb",
    "/legal/avv",
    "/privacy",
    "/terms",
  ];
  return [
    // Static pages have no maintained modification date; do not invent one.
    ...staticPaths.map((path) => ({ url: PUBLIC_BASE_URL + path })),
    ...getPosts().map((post) => ({
      url: `${PUBLIC_BASE_URL}/blog/${post.slug}`,
      lastModified: post.date,
    })),
  ];
}
