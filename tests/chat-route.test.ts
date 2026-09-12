import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<typeof import("@/lib/intake/access")>()),
  workspace: vi.fn(),
  clientFor: vi.fn(),
}));
vi.mock("@/lib/chat/quota", () => ({ chatQuota: vi.fn(), refundChat: vi.fn() }));
vi.mock("@/lib/chat/ask", () => ({ aiEnabled: vi.fn(), askWiki: vi.fn() }));
import { auth } from "@/auth";
import { clientFor, workspace } from "@/lib/intake/access";
import { chatQuota, refundChat } from "@/lib/chat/quota";
import { aiEnabled, askWiki } from "@/lib/chat/ask";
import { POST } from "@/app/api/chat/route";

const request = (payload: unknown) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
  vi.mocked(workspace).mockResolvedValue({
    id: "tenant",
    team_id: "team",
    slug: "demo",
    role: "owner",
    subscription_status: "active",
  } as never);
  vi.mocked(clientFor).mockResolvedValue({} as never);
  vi.mocked(aiEnabled).mockReturnValue(false);
  vi.mocked(askWiki).mockResolvedValue({
    question: "hello",
    answer: "a",
    sources: [],
    refused: false,
    mode: "extractive",
    terms: [],
  });
});

it("rejects unauthenticated callers before any workspace work", async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  const response = await POST(request({ tenant: "t", question: "hello" }));
  expect(response.status).toBe(401);
  expect(workspace).not.toHaveBeenCalled();
  expect(askWiki).not.toHaveBeenCalled();
});

it("keeps the beta owner/admin only, before the provider is reached", async () => {
  vi.mocked(workspace).mockResolvedValue({
    id: "tenant",
    team_id: "team",
    slug: "demo",
    role: "member",
    subscription_status: "active",
  } as never);
  const response = await POST(request({ tenant: "t", question: "hello" }));
  expect(response.status).toBe(403);
  expect(askWiki).not.toHaveBeenCalled();
  expect(chatQuota).not.toHaveBeenCalled();
});

it("answers extractively without charging the allowance", async () => {
  const response = await POST(request({ tenant: "tenant", question: "hello" }));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.mode).toBe("extractive");
  expect(data.quota).toBeNull();
  expect(chatQuota).not.toHaveBeenCalled();
});

it("reserves and refunds an allowance only when AI synthesis is enabled", async () => {
  vi.mocked(aiEnabled).mockReturnValue(true);
  vi.mocked(chatQuota).mockResolvedValue({
    remaining: 9,
    limit: 10,
    period: "2026-09",
  });
  vi.mocked(askWiki).mockRejectedValue(new Error("provider down"));
  const response = await POST(request({ tenant: "tenant", question: "hello" }));
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(chatQuota).toHaveBeenCalledOnce();
  expect(refundChat).toHaveBeenCalledWith("team", "2026-09");
});

it("validates the question before touching the workspace", async () => {
  const response = await POST(request({ tenant: "tenant", question: "hi" }));
  expect(response.status).toBe(400);
  expect(workspace).not.toHaveBeenCalled();
});
