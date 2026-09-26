import { siteLlmsFullTxt } from "@/lib/llms";

// https://llmstxt.org — the full documentation as one plain-text file.
export const dynamic = "force-static";
export function GET() {
  return new Response(siteLlmsFullTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
