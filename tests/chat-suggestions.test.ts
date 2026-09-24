import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<typeof import("@/lib/intake/access")>()),
  workspace: vi.fn(),
}));
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { IntakeError, workspace } from "@/lib/intake/access";
import { suggestedQuestions } from "@/lib/chat/suggestions";
import { GET } from "@/app/api/chat/suggestions/route";

const family = /^(What|How) .+\?$/;

describe("SQ1 suggested question generator", () => {
  it("is deterministic and derives page and section prompts", () => {
    const rows = [{ pageName: "Deploy handbook", section: "Setup" }];
    const first = suggestedQuestions(rows);
    expect(suggestedQuestions(rows)).toEqual(first);
    expect(first).toContain('How is "Setup" documented?');
    expect(first).toContain('What does "Deploy handbook" say about "Setup"?');
    expect(first).toContain('What is "Deploy handbook"?');
    for (const question of first) expect(question).toMatch(family);
    expect(
      suggestedQuestions([{ pageName: "Billing", section: null }]),
    ).toContain('What is "Billing"?');
  });

  it("returns [] for empty input", () => {
    expect(suggestedQuestions([])).toEqual([]);
    expect(suggestedQuestions(undefined as never)).toEqual([]);
  });

  it("caps at four and prefers section-level variety across rows", () => {
    const rows = [
      { pageName: "Deploy handbook", section: "Setup" },
      { pageName: "Deploy handbook", section: "Rollback" },
      { pageName: "Deploy handbook", section: "Monitoring" },
    ];
    const questions = suggestedQuestions(rows);
    expect(questions).toHaveLength(4);
    expect(questions.some((q) => q.includes("Setup"))).toBe(true);
    expect(questions.some((q) => q.includes("Rollback"))).toBe(true);
    expect(questions.some((q) => q.includes("Monitoring"))).toBe(true);
  });

  it("dedupes case-insensitively", () => {
    const questions = suggestedQuestions([
      { pageName: "Deploy", section: null },
      { pageName: "DEPLOY", section: null },
      { pageName: "deploy", section: null },
    ]);
    const lowered = questions.map((q) => q.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
    expect(questions).toEqual(['What is "Deploy"?', 'What does "Deploy" cover?']);
  });

  it("skips names that would fall outside 3-500 chars", () => {
    expect(
      suggestedQuestions([{ pageName: "x".repeat(600), section: null }]),
    ).toEqual([]);
    expect(
      suggestedQuestions([{ pageName: "   ", section: "  " }]),
    ).toEqual([]);
  });

  it("never emits HTML and keeps quotes balanced", () => {
    const questions = suggestedQuestions([
      { pageName: "<h2>Deploy</h2>", section: '<b>He said "hi"</b>' },
    ]);
    for (const question of questions) {
      expect(question).not.toMatch(/[<>]/);
      expect((question.match(/"/g) ?? []).length % 2).toBe(0);
    }
    expect(questions).toContain('What is "Deploy"?');
  });
});

describe("SQ2 suggestions route guards", () => {
  const request = (tenant: string) =>
    new Request(`http://localhost/api/chat/suggestions?tenant=${tenant}`);
  const rows = [{ page_name: "Deploy handbook", section: "Setup" }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
    vi.mocked(workspace).mockResolvedValue({
      id: "tenant",
      team_id: "team-a",
      slug: "demo",
      role: "owner",
      subscription_status: "active",
    } as never);
    vi.mocked(db.query).mockResolvedValue({ rows } as never);
  });

  it("returns 401 for anonymous callers before any workspace work", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET(request("tenant"));
    expect(response.status).toBe(401);
    expect(workspace).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns 403 for signed-in non-owner/admin members", async () => {
    vi.mocked(workspace).mockResolvedValue({
      id: "tenant",
      team_id: "team-a",
      slug: "demo",
      role: "member",
      subscription_status: "active",
    } as never);
    const response = await GET(request("tenant"));
    expect(response.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("uses the same not-found path as workspace()", async () => {
    vi.mocked(workspace).mockRejectedValue(
      new IntakeError("Workspace not found.", 404),
    );
    const response = await GET(request("missing"));
    expect(response.status).toBe(404);
  });

  it("returns the requesting team's questions without any outbound calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const response = await GET(request("tenant"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      questions: [
        'How is "Setup" documented?',
        'What does "Deploy handbook" say about "Setup"?',
        'What is "Deploy handbook"?',
        'What does "Deploy handbook" cover?',
      ],
    });
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(String(sql)).toContain("WHERE team_id=$1");
    expect(params).toEqual(["team-a"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns an honest empty list for an empty index", async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    const response = await GET(request("tenant"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [] });
  });

  it("never 500s on a database error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValue(new Error("db down"));
    const response = await GET(request("tenant"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [] });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("SQ3 tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
    vi.mocked(workspace).mockImplementation(async (_userId, tenantId) => {
      return {
        id: tenantId,
        team_id: tenantId === "tenant-a" ? "team-a" : "team-b",
        slug: tenantId,
        role: "owner",
        subscription_status: "active",
      } as never;
    });
    vi.mocked(db.query).mockImplementation((async (_sql: string, params: unknown[]) => {
      const [teamId] = params as string[];
      return {
        rows:
          teamId === "team-a"
            ? [{ page_name: "Alpha runbook", section: "Alpha setup" }]
            : [{ page_name: "Beta secret", section: "Beta setup" }],
      };
    }) as never);
  });

  it("never leaks another team's page names and queries team_id=$1", async () => {
    const response = await GET(
      new Request("http://localhost/api/chat/suggestions?tenant=tenant-a"),
    );
    const body = (await response.json()) as { questions: string[] };
    expect(body.questions.join(" ")).toContain("Alpha");
    expect(body.questions.join(" ")).not.toContain("Beta");
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(String(sql)).toMatch(/WHERE team_id=\$1/);
    expect(params).toEqual(["team-a"]);
  });
});
