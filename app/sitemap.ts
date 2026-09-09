import type { MetadataRoute } from "next";
import { getPosts } from "@/app/blog/posts";
import { baseUrl } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/pricing",
    "/blog",
    ...getPosts().map((post) => `/blog/${post.slug}`),
    "/legal/impressum",
    "/legal/datenschutz",
    "/legal/agb",
    "/legal/avv",
  ].map((path) => ({ url: baseUrl() + path }));
}
