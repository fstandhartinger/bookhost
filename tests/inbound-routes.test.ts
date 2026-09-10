import { beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
vi.mock("@/lib/intake/inbound", () => ({ acceptEmail: vi.fn() }));
vi.mock("@/lib/intake/email-jobs", () => ({
  drainEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<typeof import("@/lib/intake/access")>()),
  workspace: vi.fn(),
}));
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/intake/access";
import { acceptEmail } from "@/lib/intake/inbound";
import { POST as inbound } from "@/app/api/intake/inbound/route";
import { POST as senders } from "@/app/api/intake/senders/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "true");
  vi.stubEnv("INBOUND_WEBHOOK_SECRET", "test-secret");
  vi.mocked(db.query).mockResolvedValue({ rows: [{ hits: 1 }] } as never);
});
it("rejects unsigned and wrongly signed requests before database admission", async () => {
  for (const signature of [undefined, "t=1,v1=" + "0".repeat(64)]) {
    const r = await inbound(
      new Request("http://localhost/api/intake/inbound", {
        method: "POST",
        body: "{}",
        headers: {
          "content-length": "2",
          ...(signature ? { "x-wissen-signature": signature } : {}),
        },
      }),
    );
    expect(r.status).toBe(401);
  }
  expect(acceptEmail).not.toHaveBeenCalled();
});
it("passes a valid signed document to atomic admission and acknowledges IDs", async () => {
  const raw = JSON.stringify({
    message_id: "route-test",
    to: ["demo@intake.wissen.app.mintapis.com"],
    from: { address: "member@example.com" },
    subject: "Email",
    text: "x".repeat(201),
    attachments: [],
    received_at: new Date().toISOString(),
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac("sha256", "test-secret")
    .update(t + "." + raw)
    .digest("hex")}`;
  vi.mocked(acceptEmail).mockResolvedValue(["item"]);
  const r = await inbound(
    new Request("http://localhost/api/intake/inbound", {
      method: "POST",
      body: raw,
      headers: {
        "x-wissen-signature": sig,
        "content-length": String(Buffer.byteLength(raw)),
      },
    }),
  );
  expect(r.status).toBe(202);
  expect(await r.json()).toEqual({ item_ids: ["item"] });
});
it("requires owner/admin and scopes normalized sender mutations to their team", async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
  const request = () =>
    new Request("http://localhost/api/intake/senders?tenant=tenant", {
      method: "POST",
      headers: { origin: "https://bookhost.co" },
      body: JSON.stringify({ action: "add", pattern: " @Company.com " }),
    });
  vi.mocked(workspace).mockResolvedValue({ team_id: "team", role: "member" });
  expect((await senders(request())).status).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
  vi.mocked(workspace).mockResolvedValue({ team_id: "team", role: "admin" });
  vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
  expect((await senders(request())).status).toBe(200);
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO intake_senders"),
    ["team", "@company.com", "user"],
  );
  const crossOrigin = new Request(
    "http://localhost/api/intake/senders?tenant=tenant",
    { method: "POST", headers: { Origin: "https://evil.invalid" }, body: "{}" },
  );
  expect((await senders(crossOrigin)).status).toBe(403);
});

it("returns retryable 503 when the secret is missing, before reading or querying", async () => {
  vi.stubEnv("INBOUND_WEBHOOK_SECRET", "");
  const request = new Request("http://localhost/api/intake/inbound", {
    method: "POST",
    body: "{}",
  });
  const response = await inbound(request);
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(request.bodyUsed).toBe(false);
  expect(db.query).not.toHaveBeenCalled();
});
it("requires Origin on sender mutations before authentication/database work", async () => {
  const response = await senders(
    new Request("http://localhost/api/intake/senders", {
      method: "POST",
      body: "{}",
    }),
  );
  expect(response.status).toBe(403);
  expect(auth).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
});
it("limits global and IP traffic before reading the body", async () => {
  for (const blockedCall of [1, 2]) {
    vi.mocked(db.query).mockReset();
    if (blockedCall === 2)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ hits: 1 }],
      } as never);
    vi.mocked(db.query).mockResolvedValue({ rows: [{ hits: 31 }] } as never);
    const request = new Request("http://localhost/api/intake/inbound", {
      method: "POST",
      body: "{}",
    });
    const response = await inbound(request);
    expect(response.status).toBe(429);
    expect(request.bodyUsed).toBe(false);
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO rate_limits"),
      [
        expect.stringMatching(
          blockedCall === 1 ? /^inbound-global$/ : /^inbound-ip:/,
        ),
        60,
      ],
    );
  }
});
it("rejects absent and oversized declared lengths without reading", async () => {
  for (const [length, status] of [
    [null, 411],
    [String(15 * 1024 * 1024 + 1), 413],
  ] as const) {
    const headers: Record<string, string> = {
      "x-wissen-signature": "t=1,v1=" + "0".repeat(64),
    };
    if (length) headers["content-length"] = length;
    const request = new Request("http://localhost/api/intake/inbound", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect((await inbound(request)).status).toBe(status);
    expect(request.bodyUsed).toBe(false);
  }
});
it("cancels a stream that exceeds its declared length or the hard body limit", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel,
  });
  const request = new Request("http://localhost/api/intake/inbound", {
    method: "POST",
    body,
    duplex: "half",
    headers: {
      "content-length": "2",
      "x-wissen-signature": "t=1,v1=" + "0".repeat(64),
    },
  } as RequestInit);
  expect((await inbound(request)).status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
});
