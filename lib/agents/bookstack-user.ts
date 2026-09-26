// BookStack API client that acts as the calling agent's own BookStack user.
// Every request carries the agent's token, so BookStack decides what is visible
// or writable. BookHost adds no permission of its own that could widen access.
export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: "denied" | "not_found" | "invalid" | "conflict" | "rate_limited" | "unavailable",
  ) {
    super(message);
  }
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const HOST_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

async function readCapped(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > limit) {
        chunks.push(value.subarray(0, limit - size));
        truncated = true;
        await reader.cancel();
        break;
      }
      size += value.length;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

export class UserBookStack {
  readonly base: string;
  constructor(
    host: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {
    if (host.length > 253 || !HOST_RE.test(host))
      throw new Error("Invalid workspace host.");
    this.base = `https://${host}`;
  }

  async raw(
    path: string,
    init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
    limit = MAX_RESPONSE_BYTES,
  ) {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}/api/${path}`, {
        method: init.method || "GET",
        headers: {
          Authorization: `Token ${this.token}`,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AgentError("The workspace is not reachable right now. Try again shortly.", "unavailable");
    }
    if (!response.ok) {
      // Validation messages are short and describe the request, not page content.
      let detail = "";
      if (response.status === 422) {
        try {
          const body = JSON.parse((await readCapped(response, 8192)).text);
          detail = String(body?.error?.message || "").slice(0, 300);
        } catch {
          detail = "";
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      if (response.status === 401)
        throw new AgentError("BookStack rejected the API token (401). Check the token or create a new one.", "denied");
      if (response.status === 403)
        throw new AgentError("Your BookStack user is not allowed to do this (403).", "denied");
      if (response.status === 404)
        throw new AgentError("Not found, or not visible to your BookStack user.", "not_found");
      if (response.status === 422)
        throw new AgentError(`BookStack rejected the request: ${detail || "validation failed"}`, "invalid");
      if (response.status === 429)
        throw new AgentError("BookStack rate limit reached. Try again shortly.", "rate_limited");
      throw new AgentError("The workspace returned an error. Try again shortly.", "unavailable");
    }
    return { response, ...(await readCapped(response, limit)) };
  }

  async json<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
    const { text, truncated } = await this.raw(path, init);
    if (truncated) throw new AgentError("The workspace response was too large.", "unavailable");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AgentError("The workspace returned an unexpected response.", "unavailable");
    }
  }

  async text(path: string, limit: number) {
    const { text, truncated } = await this.raw(path, {}, limit);
    return { text, truncated };
  }
}
