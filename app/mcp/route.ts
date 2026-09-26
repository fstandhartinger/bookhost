import { handleMcp } from "@/lib/agents/mcp";

// Reached on workspace hosts (https://<workspace>.bookhost.co/mcp) through a
// dedicated proxy route; every other workspace path is served by BookStack.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handler = (request: Request) => handleMcp(request);
export {
  handler as GET,
  handler as POST,
  handler as OPTIONS,
  handler as DELETE,
};
