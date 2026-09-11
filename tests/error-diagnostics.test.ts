import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/error-diagnostics";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query } }));

const diagnostic = {
  event: "intake_failed",
  phase: "persist",
  correlation_id: "correlation-123",
  team_id: "12345678-1234-1234-1234-123456789abc",
  session_id: "session/123",
  error: new Error("private customer content"),
};
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("persistent error diagnostics", () => {
  it("writes only the sanitized diagnostic fields with parameterized SQL", async () => {
    expect(reportError(diagnostic)).toBeUndefined();
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    const [sql, values] = query.mock.calls[0];
    expect(sql.replace(/\s+/g, " ").trim()).toBe(
      "INSERT INTO error_reports (event, phase, correlation_id, error_category, team_id, session_id) VALUES ($1, $2, $3, $4, $5, $6)",
    );
    expect(values).toEqual([
      "intake_failed", "persist", "correlation-123", "error",
      diagnostic.team_id, "session_123",
    ]);
  });

  it("preserves console.error fields and their exact order", () => {
    reportError(diagnostic);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      '{"event":"intake_failed","phase":"persist","correlation_id":"correlation-123","error_category":"error","team_id":"12345678-1234-1234-1234-123456789abc","session_id":"session_123"}',
    );
  });

  it.each(["invalid/team", "", undefined, 123, "12345678-1234-1234-1234-123456789abz"])(
    "stores invalid team_id %s as NULL", async (team_id) => {
      reportError({ ...diagnostic, team_id });
      await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
      expect(query.mock.calls[0][1][4]).toBeNull();
    },
  );

  it("stores missing optional identifiers as NULL and keeps them out of the log", async () => {
    reportError({ ...diagnostic, team_id: undefined, session_id: undefined });
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(query.mock.calls[0][1].slice(4)).toEqual([null, null]);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      '{"event":"intake_failed","phase":"persist","correlation_id":"correlation-123","error_category":"error"}',
    );
  });

  it.each(["synchronous throw", "rejected promise"])(
    "swallows database failure (%s) without throwing or unhandled rejection", async (mode) => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      query.mockImplementation(() => {
        if (mode === "synchronous throw") throw new Error("database unavailable");
        return Promise.reject(new Error("database unavailable"));
      });
      try {
        expect(() => expect(reportError(diagnostic)).toBeUndefined()).not.toThrow();
        await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
        await nextTurn();
        await nextTurn();
        expect(unhandled).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledOnce();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    },
  );

  it("returns void before a pending database write finishes", async () => {
    let finish!: () => void;
    query.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    try {
      expect(reportError(diagnostic)).toBeUndefined();
      await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    } finally {
      finish();
    }
  });
});
