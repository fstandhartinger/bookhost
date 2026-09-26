import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.LIVE_EDIT_JOIN_SECRET = "a".repeat(32);
});

const { signJoinToken, verifyJoinToken, documentNameFor } = await import(
  "@/lib/live-edit/join-token"
);

const base = {
  tenant: "acme",
  pageId: 5,
  documentName: documentNameFor("acme", 5),
  bookstackUserId: 7,
  userName: "Jane",
  userColor: "#1c7ed6",
  canEdit: true,
};

describe("live edit join token", () => {
  it("round-trips a signed token", () => {
    const token = signJoinToken(base);
    const verified = verifyJoinToken(token);
    expect(verified).toMatchObject({ tenant: "acme", pageId: 5, canEdit: true });
  });

  it("rejects a tampered payload", () => {
    const token = signJoinToken(base);
    const [json, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    payload.canEdit = true;
    payload.bookstackUserId = 999; // escalate to a different identity
    const tampered =
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") +
      "." +
      sig;
    expect(verifyJoinToken(tampered)).toBeNull();
  });

  it("rejects garbage and wrong-shape tokens", () => {
    expect(verifyJoinToken("")).toBeNull();
    expect(verifyJoinToken("not-a-token")).toBeNull();
    expect(verifyJoinToken("abc.def")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signJoinToken(base, -10);
    expect(verifyJoinToken(token)).toBeNull();
  });

  it("produces a distinct document name per tenant and page (tenant isolation boundary)", () => {
    expect(documentNameFor("acme", 5)).not.toBe(documentNameFor("other", 5));
    expect(documentNameFor("acme", 5)).not.toBe(documentNameFor("acme", 6));
  });
});
