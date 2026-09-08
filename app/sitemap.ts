import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/pricing",
    "/legal/impressum",
    "/legal/datenschutz",
    "/legal/agb",
    "/legal/avv",
  ].map((path) => ({ url: baseUrl() + path }));
}
