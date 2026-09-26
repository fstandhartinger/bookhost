import { siteLlmsTxt } from "@/lib/llms";
import { requestHost, workspaceForHost } from "@/lib/agents/access";
import { workspaceLlmsTxt } from "@/lib/agents/public-llms";

// https://llmstxt.org — a plain map of the site for language-model readers.
// On a workspace host (reached through the agent proxy route) it describes
// that workspace instead, without revealing anything private.
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const host = requestHost(request);
  if (host) {
    const ws = await workspaceForHost(host);
    if (!ws) return new Response("Not found\n", { status: 404 });
    return new Response(await workspaceLlmsTxt(ws), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=600",
      },
    });
  }
  return new Response(siteLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
