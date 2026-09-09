import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: { query },
  transaction: (fn: (c: unknown) => unknown) => fn({ query }),
}));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
  verifyPassword: vi.fn(async () => true),
  validNewPassword: (p: string) => p.length >= 10 && p.length <= 1024,
  normalizeEmail: (s: unknown) =>
    String(s || "")
      .trim()
      .toLowerCase(),
}));
import { getInvite, inviteProblem, manageTeam, joinTeam } from "@/lib/team";
import { digest } from "@/lib/security";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const invite = {
  id,
  team_id: id,
  role: "member",
  uses: 0,
  max_uses: 1,
  revoked_at: null,
  expires_at: new Date(Date.now() + 86400000),
};
beforeEach(() => query.mockReset());
it("recognizes expiry, revocation, exhaustion and missing links", () => {
  expect(inviteProblem(invite)).toBeNull();
  expect(inviteProblem(undefined)).toContain("not found");
  expect(inviteProblem({ ...invite, expires_at: new Date(0) })).toContain(
    "expired",
  );
  expect(inviteProblem({ ...invite, revoked_at: new Date() })).toContain(
    "revoked",
  );
  expect(inviteProblem({ ...invite, uses: 1 })).toContain("used up");
});
it("looks up only the token hash and rejects malformed tokens", async () => {
  query.mockResolvedValue({ rows: [invite] });
  await getInvite("a".repeat(64));
  expect(query).toHaveBeenCalledWith(expect.any(String), [
    digest("a".repeat(64)),
  ]);
  query.mockClear();
  expect(await getInvite("bad")).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});
it.each(["invite", "remove", "revoke", "role"])(
  "denies member action %s",
  async (action) => {
    query
      .mockResolvedValueOnce({ rows: [{ id, owner_user_id: other }] })
      .mockResolvedValueOnce({ rows: [{ role: "member" }] });
    await expect(manageTeam(id, { teamId: id, action })).rejects.toMatchObject({
      status: 403,
    });
    expect(query).toHaveBeenCalledTimes(2);
  },
);
it("creates 32-byte token and persists only its digest", async () => {
  query
    .mockResolvedValueOnce({ rows: [{ id, owner_user_id: id }] })
    .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
    .mockResolvedValueOnce({ rows: [{ count: "1" }] })
    .mockResolvedValueOnce({ rows: [] });
  const result = await manageTeam(id, {
    teamId: id,
    action: "invite",
    role: "member",
    maxUses: 1,
  });
  const token = result.link!.split("/").pop()!;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(query.mock.calls[3][1]).toEqual([id, digest(token), "member", id, 1]);
});
it("revokes an invite scoped to the authorized team", async () => {
  query
    .mockResolvedValueOnce({ rows: [{ id, owner_user_id: id }] })
    .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
    .mockResolvedValueOnce({ rows: [] });
  await manageTeam(id, { teamId: id, action: "revoke", inviteId: other });
  expect(query.mock.calls[2][1]).toEqual([other, id]);
});
it("rejects a full team before issuing an invitation", async () => {
  query
    .mockResolvedValueOnce({ rows: [{ id, owner_user_id: id }] })
    .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
    .mockResolvedValueOnce({ rows: [{ count: "25" }] });
  await expect(
    manageTeam(id, {
      teamId: id,
      action: "invite",
      role: "member",
      maxUses: 10,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("joins a fresh account, consumes a use and never marks email verified", async () => {
  query
    .mockResolvedValueOnce({ rows: [invite] })
    .mockResolvedValueOnce({ rows: [{ id }] })
    .mockResolvedValueOnce({ rows: [invite] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ count: "1" }] })
    .mockResolvedValueOnce({
      rows: [{ id: other, email: "new@example.com", session_version: 0 }],
    })
    .mockResolvedValue({ rows: [] });
  const user = await joinTeam("a".repeat(64), undefined, {
    email: "new@example.com",
    password: "long-password",
  });
  expect(user.id).toBe(other);
  expect(query.mock.calls[6][0]).not.toContain("email_verified");
  expect(query.mock.calls[7][1]).toEqual([id, other, "member"]);
  expect(query.mock.calls[8][0]).toContain("uses=uses+1");
});
it("rejects capacity 25 for authenticated join without consuming the token", async () => {
  query
    .mockResolvedValueOnce({ rows: [invite] })
    .mockResolvedValueOnce({ rows: [{ id }] })
    .mockResolvedValueOnce({ rows: [invite] })
    .mockResolvedValueOnce({ rows: [{ id: other }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ count: "25" }] });
  await expect(joinTeam("a".repeat(64), other, {})).rejects.toMatchObject({
    status: 409,
  });
  expect(query).toHaveBeenCalledTimes(6);
});
it("rechecks usage after locking to prevent a concurrent second join", async () => {
  query
    .mockResolvedValueOnce({ rows: [invite] })
    .mockResolvedValueOnce({ rows: [{ id }] })
    .mockResolvedValueOnce({ rows: [{ ...invite, uses: 1 }] });
  await expect(joinTeam("a".repeat(64), other, {})).rejects.toMatchObject({
    status: 410,
  });
  expect(query).toHaveBeenCalledTimes(3);
});
