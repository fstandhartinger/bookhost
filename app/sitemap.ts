import type { MetadataRoute } from "next";
import { getPosts } from "@/app/blog/posts";
import { baseUrl } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/pricing",
    "/reliability",
    "/blog",
    ...getPosts().map((post) => `/blog/${post.slug}`),
    "/legal/impressum",
    "/legal/datenschutz",
    "/legal/agb",
    "/legal/avv",
    "/privacy",
    "/terms",
  ].map((path) => ({ url: baseUrl() + path }));
}
