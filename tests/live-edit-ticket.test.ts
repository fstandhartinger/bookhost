import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "tenant-shared-secret";
let dbRow: Record<string, unknown> | undefined;

vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: dbRow ? [dbRow] : [] })) },
}));
vi.mock("@/lib/intake/crypto", () => ({
  decrypt: vi.fn(() => SECRET),
}));

const { verifyBookStackTicket, TicketError } = await import(
  "@/lib/live-edit/bookstack-ticket"
);

function makeTicket(overrides: Record<string, unknown> = {}, secret = SECRET) {
  const payload = {
    tenant: "acme",
    pageId: 5,
    bookstackUserId: 7,
    userName: "Jane",
    userEmail: "jane@example.com",
    canEdit: true,
    editorType: "wysiwyg",
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
  // Mirrors ops/provisioner/themes/live-edit/functions.php: sign the raw
  // JSON string, then base64url-encode it for transport.
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  const ticket = Buffer.from(raw, "utf8").toString("base64url");
  return { ticket, sig };
}

beforeEach(() => {
  dbRow = {
    hmac_secret_enc: "v1:whatever",
    enabled: true,
    rollout_status: "ready",
  };
});

describe("BookStack-issued Live Edit ticket verification", () => {
  it("accepts a correctly signed, unexpired ticket", async () => {
    const { ticket, sig } = makeTicket();
    const claim = await verifyBookStackTicket(ticket, sig);
    expect(claim.tenant).toBe("acme");
    expect(claim.canEdit).toBe(true);
  });

  it("rejects a ticket signed with the wrong tenant's secret", async () => {
    const { ticket, sig } = makeTicket({}, "wrong-secret");
    await expect(verifyBookStackTicket(ticket, sig)).rejects.toBeInstanceOf(
      TicketError,
    );
  });

  it("rejects a tampered ticket claiming edit rights it wasn't signed for", async () => {
    const { ticket, sig } = makeTicket({ canEdit: false });
    // Flip canEdit after signing — a real privilege-escalation attempt.
    const payload = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
    payload.canEdit = true;
    const forged = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    await expect(verifyBookStackTicket(forged, sig)).rejects.toBeInstanceOf(
      TicketError,
    );
  });

  it("rejects an expired ticket", async () => {
    const { ticket, sig } = makeTicket({
      exp: Math.floor(Date.now() / 1000) - 5,
    });
    await expect(verifyBookStackTicket(ticket, sig)).rejects.toThrow(
      /expired/,
    );
  });

  it("rejects a ticket for a workspace with no Live Edit secret on file", async () => {
    dbRow = undefined;
    const { ticket, sig } = makeTicket();
    await expect(verifyBookStackTicket(ticket, sig)).rejects.toThrow(
      /not set up/,
    );
  });

  it("rejects when the workspace has since turned Live Edit off", async () => {
    dbRow = { hmac_secret_enc: "v1:x", enabled: false, rollout_status: "ready" };
    const { ticket, sig } = makeTicket();
    await expect(verifyBookStackTicket(ticket, sig)).rejects.toThrow(
      /turned off/,
    );
  });

  it("rejects a ticket while the rollout is still in progress", async () => {
    dbRow = { hmac_secret_enc: "v1:x", enabled: true, rollout_status: "pending" };
    const { ticket, sig } = makeTicket();
    await expect(verifyBookStackTicket(ticket, sig)).rejects.toThrow(
      /turned off/,
    );
  });

  it("rejects malformed input without touching the database", async () => {
    await expect(verifyBookStackTicket(null, null)).rejects.toBeInstanceOf(
      TicketError,
    );
    await expect(
      verifyBookStackTicket("not base64 json!!", "zz"),
    ).rejects.toBeInstanceOf(TicketError);
    await expect(
      verifyBookStackTicket("x".repeat(5000), "aa"),
    ).rejects.toBeInstanceOf(TicketError);
  });
});
