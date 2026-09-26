import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security";
import {
  agentSettings,
  localTokenCheck,
  parseToken,
  requestHost,
  workspaceForHost,
  type AgentIdentity,
  type AgentWorkspace,
  type ParsedToken,
  type WriteMode,
} from "./access";
import { logActivity } from "./activity";
import { AgentError, UserBookStack } from "./bookstack-user";
import { boundedBody, IntakeError } from "@/lib/intake/access";
import { toolsFor, UNTRUSTED, type ToolContext } from "./tools";

// Stateless MCP server over Streamable HTTP (JSON responses, no SSE stream,
// no session ids). Spec: https://modelcontextprotocol.io/specification
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const LATEST = SUPPORTED_PROTOCOL_VERSIONS[0];
const MAX_BODY = 512 * 1024;
const MAX_BATCH = 5;
const MAX_RESOURCE_CHARS = 200_000;

export const LIMITS = {
  perMinute: 120,
  perHour: 1500,
  writesPerHour: 60,
  authFailuresPer15Min: 30,
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};
type Deps = { fetcher?: typeof fetch };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

function reply(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { "Content-Type": "application/json" }),
      "Cache-Control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}
const rpcError = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

// Validation of a token against BookStack is cached briefly per workspace and
// token; revocations and the kill switch are checked in the database on every
// request and are not affected by this cache.
const validated = new Map<string, number>();
const VALID_MS = 60_000;

// Failed authentication is counted per client address and per token id, so
// guessing secrets for one token id from many addresses is limited as well.
const failureKeys = (ip: string | null, tenantId: string, tokenId?: string) => [
  ...(ip ? [`mcp:authfail:${ip}`] : []),
  ...(tokenId ? [`mcp:authfail:tok:${tenantId}:${tokenId}`] : []),
];
async function authFailureBlocked(keys: string[]) {
  if (!keys.length) return false;
  const rows = (
    await db.query(
      "SELECT hits FROM rate_limits WHERE key=ANY($1) AND expires_at>now()",
      [keys],
    )
  ).rows;
  return rows.some((row) => row.hits >= LIMITS.authFailuresPer15Min);
}
async function recordAuthFailure(keys: string[]) {
  for (const key of keys)
    await rateLimit(key, LIMITS.authFailuresPer15Min, 900);
}

function unauthorized(message: string, ws?: AgentWorkspace) {
  return reply(rpcError(null, -32001, message), 401, {
    "WWW-Authenticate": `Bearer realm="BookHost${ws ? ` ${ws.slug}` : ""}", error="invalid_token", error_description="Use Authorization: Bearer <BookStack token id>:<token secret>"`,
  });
}

function instructions(ws: AgentWorkspace, mode: WriteMode) {
  const writes =
    mode === "off"
      ? "This workspace allows read access only."
      : mode === "propose"
        ? "Page changes you make (create_page, update_page, append_to_page, propose_change) become proposals that a workspace owner or admin reviews before anything is published."
        : "Page changes you make are applied directly as your BookStack user and appear in the page's revision history. Use propose_change when a human should review first.";
  return `BookHost workspace ${ws.host}. You act as the BookStack user that owns your API token and see exactly what that user may see. ${writes} ${UNTRUSTED}`;
}

function modeNote(mode: WriteMode) {
  return mode === "propose"
    ? " In this workspace the change becomes a proposal for human review."
    : mode === "direct"
      ? " In this workspace the change is applied directly."
      : "";
}

export async function handleMcp(
  request: Request,
  deps: Deps = {},
): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });
  const host = requestHost(request);
  const ws = host ? await workspaceForHost(host) : null;
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(
      ws
        ? `This is the MCP endpoint of the BookHost workspace ${ws.host}. Connect an MCP client with Streamable HTTP and a BookStack API token. Setup: https://bookhost.co/agents\n`
        : "Not found\n",
      {
        status: ws ? 405 : 404,
        headers: {
          Allow: "POST, OPTIONS",
          "Content-Type": "text/plain; charset=utf-8",
          ...CORS,
        },
      },
    );
  }
  if (request.method !== "POST")
    return reply(rpcError(null, -32600, "Method not allowed"), 405, {
      Allow: "POST, OPTIONS",
    });
  if (!ws)
    return reply(
      rpcError(null, -32004, "No BookHost workspace at this address."),
      404,
    );
  if (!ws.running)
    return reply(
      rpcError(null, -32005, "This workspace is not running."),
      503,
      { "Retry-After": "300" },
    );

  const settings = await agentSettings(ws.id);
  if (!settings.access_enabled)
    return reply(
      rpcError(
        null,
        -32003,
        "Agent access is switched off for this workspace by its owner.",
      ),
      403,
    );

  const ip = clientIp(request);
  const token = parseToken(request.headers.get("authorization"));
  const failures = failureKeys(ip, ws.id, token?.tokenId);
  if (await authFailureBlocked(failures))
    return reply(
      rpcError(
        null,
        -32029,
        "Too many failed authentication attempts. Try again later.",
      ),
      429,
      { "Retry-After": "900" },
    );
  if (!token) {
    await recordAuthFailure(failures);
    return unauthorized(
      "Missing or malformed token. Send Authorization: Bearer <BookStack token id>:<token secret>.",
      ws,
    );
  }
  const local = await localTokenCheck(ws, token);
  if (!local.ok) {
    if (local.authFailure) await recordAuthFailure(failures);
    await logActivity({
      tenantId: ws.id,
      agentId: null,
      fingerprint: token.fingerprint,
      tool: "auth",
      status: "denied",
      latencyMs: 0,
    });
    return reply(rpcError(null, -32003, local.reason), 403);
  }
  const identity = local.identity;

  if (
    !(await rateLimit(`mcp:m:${ws.id}:${token.key}`, LIMITS.perMinute, 60)) ||
    !(await rateLimit(`mcp:h:${ws.id}:${token.key}`, LIMITS.perHour, 3600))
  ) {
    await logActivity({
      tenantId: ws.id,
      agentId: identity.agentId,
      fingerprint: token.fingerprint,
      tool: "request",
      status: "rate_limited",
      latencyMs: 0,
    });
    return reply(
      rpcError(
        null,
        -32029,
        "Rate limit reached for this token. Slow down and retry shortly.",
      ),
      429,
      { "Retry-After": "60" },
    );
  }

  const version = request.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version))
    return reply(
      rpcError(
        null,
        -32600,
        `Unsupported MCP-Protocol-Version: ${version.slice(0, 20)}`,
      ),
      400,
    );
  let text: string;
  try {
    // Streams with a byte budget and stops reading once it is exceeded.
    text = await (await boundedBody(request, MAX_BODY)).text();
  } catch (error) {
    if (error instanceof IntakeError && error.status === 413)
      return reply(rpcError(null, -32600, "Request too large."), 413);
    return reply(rpcError(null, -32700, "Parse error"), 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(rpcError(null, -32700, "Parse error"), 400);
  }

  const client = new UserBookStack(ws.host, local.upstream, deps.fetcher);
  // Every request proves the token against the workspace's own BookStack.
  // A token from another workspace fails here, because each BookStack instance
  // has its own token table.
  const cacheKey = `${ws.id}:${token.key}`;
  if ((validated.get(cacheKey) || 0) < Date.now()) {
    try {
      await client.json("books?count=1");
      validated.set(cacheKey, Date.now() + VALID_MS);
      if (validated.size > 5000) validated.clear();
    } catch (error) {
      if (error instanceof AgentError && error.code === "denied") {
        await recordAuthFailure(failures);
        await logActivity({
          tenantId: ws.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: "auth",
          status: "denied",
          latencyMs: 0,
        });
        return unauthorized(
          "BookStack rejected this token for this workspace. The token needs the 'Access system API' permission and must belong to this workspace.",
          ws,
        );
      }
      return reply(
        rpcError(
          null,
          -32005,
          "The workspace is not reachable right now. Try again shortly.",
        ),
        503,
        { "Retry-After": "30" },
      );
    }
  }

  const ctx: ToolContext = {
    workspace: ws,
    client,
    mode: settings.write_mode,
    identity,
    fingerprint: token.fingerprint,
  };
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length)
    return reply(rpcError(null, -32600, "Invalid Request"), 400);
  // Batches (protocol 2025-03-26) are bounded explicitly, never truncated.
  if (messages.length > MAX_BATCH)
    return reply(
      rpcError(null, -32600, `Batches are limited to ${MAX_BATCH} messages.`),
      400,
    );
  const responses: unknown[] = [];
  for (const message of messages) {
    const result = await dispatch(message, ctx, token, identity);
    if (result) responses.push(result);
  }
  if (!responses.length) return reply(null, 202);
  return reply(Array.isArray(body) ? responses : responses[0]);
}

async function dispatch(
  message: unknown,
  ctx: ToolContext,
  token: ParsedToken,
  identity: AgentIdentity,
) {
  if (
    !message ||
    typeof message !== "object" ||
    (message as JsonRpcRequest).jsonrpc !== "2.0" ||
    typeof (message as JsonRpcRequest).method !== "string"
  )
    return rpcError(null, -32600, "Invalid Request");
  const msg = message as JsonRpcRequest;
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : LATEST;
      return ok({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : LATEST,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        serverInfo: {
          name: `bookhost-${ctx.workspace.slug}`,
          title: `BookHost wiki ${ctx.workspace.host}`,
          version: "1.0.0",
          websiteUrl: "https://bookhost.co/agents",
        },
        instructions: instructions(ctx.workspace, ctx.mode),
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: toolsFor(ctx.mode).map((t) => ({
          name: t.name,
          title: t.title,
          description:
            t.kind === "write" && t.name !== "propose_change"
              ? t.description + modeNote(ctx.mode)
              : t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, ...t.annotations },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args =
        params.arguments &&
        typeof params.arguments === "object" &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      const tool = toolsFor(ctx.mode).find((t) => t.name === name);
      const started = Date.now();
      if (!tool) {
        const known = toolsFor("direct").some((t) => t.name === name);
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: known ? name : "unknown",
          status: "denied",
          latencyMs: 0,
        });
        return known
          ? ok({
              content: [
                {
                  type: "text",
                  text: `The tool ${name} is not available: this workspace's agent write mode is "${ctx.mode}".`,
                },
              ],
              isError: true,
            })
          : rpcError(msg.id, -32602, `Unknown tool: ${name.slice(0, 60)}`);
      }
      if (
        tool.kind !== "read" &&
        !(await rateLimit(
          `mcp:w:${ctx.workspace.id}:${token.key}`,
          LIMITS.writesPerHour,
          3600,
        ))
      ) {
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: name,
          status: "rate_limited",
          latencyMs: 0,
        });
        return ok({
          content: [
            {
              type: "text",
              text: `Write limit reached (${LIMITS.writesPerHour} per hour for this token). Try again later.`,
            },
          ],
          isError: true,
        });
      }
      try {
        const result = await tool.run(args, ctx);
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: name,
          target: result.target,
          status: result.status || "ok",
          latencyMs: Date.now() - started,
        });
        return ok({
          content: [{ type: "text", text: result.text }],
          isError: false,
        });
      } catch (error) {
        const known = error instanceof AgentError;
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: name,
          status:
            known && error.code === "denied"
              ? "denied"
              : known && error.code === "rate_limited"
                ? "rate_limited"
                : "error",
          latencyMs: Date.now() - started,
        });
        if (!known) console.error("Agent tool failed", name);
        return ok({
          content: [
            {
              type: "text",
              text: known
                ? error.message
                : "The tool failed. Try again shortly.",
            },
          ],
          isError: true,
        });
      }
    }
    case "resources/templates/list":
      return ok({
        resourceTemplates: [
          {
            uriTemplate: "bookstack://page/{page_id}",
            name: "BookStack page",
            title: "BookStack page as Markdown",
            mimeType: "text/markdown",
            description: "A wiki page by id. " + UNTRUSTED,
          },
        ],
      });
    case "resources/list": {
      const started = Date.now();
      try {
        const pages = await ctx.client.json<{
          data: {
            id: number;
            name: string;
            draft?: boolean;
            updated_at: string;
          }[];
        }>("pages?count=50&sort=-updated_at");
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: "resources/list",
          status: "ok",
          latencyMs: Date.now() - started,
        });
        return ok({
          resources: pages.data
            .filter((p) => !p.draft)
            .map((p) => ({
              uri: `bookstack://page/${p.id}`,
              name: p.name,
              mimeType: "text/markdown",
              annotations: { lastModified: p.updated_at },
            })),
        });
      } catch (error) {
        return rpcError(
          msg.id,
          -32603,
          error instanceof AgentError ? error.message : "Could not list pages.",
        );
      }
    }
    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      const match = /^bookstack:\/\/page\/(\d{1,9})$/.exec(uri);
      if (!match) return rpcError(msg.id, -32002, "Resource not found");
      const started = Date.now();
      try {
        const id = Number(match[1]);
        const page = await ctx.client.json<{ id: number; draft?: boolean }>(
          `pages/${id}`,
        );
        if (page.draft) throw new AgentError("Not found", "not_found");
        const exported = await ctx.client.text(
          `pages/${id}/export/markdown`,
          MAX_RESOURCE_CHARS * 4,
        );
        let text = exported.text;
        if (exported.truncated || text.length > MAX_RESOURCE_CHARS)
          text = `${text.slice(0, MAX_RESOURCE_CHARS)}\n\n[Truncated by BookHost after ${MAX_RESOURCE_CHARS} characters. Use read_page with max_chars, or open the page in BookStack for the full text.]`;
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: "resources/read",
          target: `page:${id}`,
          status: "ok",
          latencyMs: Date.now() - started,
        });
        return ok({
          contents: [{ uri, mimeType: "text/markdown", text }],
        });
      } catch (error) {
        await logActivity({
          tenantId: ctx.workspace.id,
          agentId: identity.agentId,
          fingerprint: token.fingerprint,
          tool: "resources/read",
          status: "error",
          latencyMs: Date.now() - started,
        });
        return rpcError(
          msg.id,
          -32002,
          error instanceof AgentError ? error.message : "Resource not found",
        );
      }
    }
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return rpcError(
        msg.id,
        -32601,
        `Method not found: ${msg.method.slice(0, 60)}`,
      );
  }
}
