import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/lib/live-edit/bookstack-ticket", () => ({
  liveEditTenantSecret: vi.fn().mockResolvedValue("tenant-test-secret"),
}));

import { liveEditTenantSecret } from "@/lib/live-edit/bookstack-ticket";
import {
  BookStackConflictSavedError,
  BookStackSaveError,
  liveEditSaveSignature,
  saveBookStackPage,
} from "@/lib/live-edit/bookstack-save";

const input = {
  tenantId: "tenant-id",
  tenantSlug: "acme",
  tenantHost: "wiki.example.org",
  pageId: 42,
  bookstackUserId: 7,
  expectedRevisionCount: 12,
  html: "<p>Grüße from Live Edit</p>",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(liveEditTenantSecret).mockResolvedValue("tenant-test-secret");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("BookStack Live Edit saves", () => {
  it("signs the exact tenant, page, editor, revision, expiry and HTML bytes", () => {
    const htmlToken = Buffer.from(input.html, "utf8").toString("base64url");
    const message = [
      "live-edit-save-v1",
      input.tenantSlug,
      String(input.pageId),
      String(input.bookstackUserId),
      String(input.expectedRevisionCount),
      "1761500000",
      htmlToken,
    ].join("\n");
    const expected = createHmac("sha256", "test-key")
      .update(message)
      .digest("hex");
    expect(
      liveEditSaveSignature({
        ...input,
        exp: 1761500000,
        secret: "test-key",
      }),
    ).toBe(expected);
  });

  it("uses the tenant save route and returns the new revision count", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ revisionCount: 13 }), { status: 200 }),
    );
    await expect(
      saveBookStackPage(input),
    ).resolves.toBe(13);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://wiki.example.org/live-edit/save/42");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      expectedRevisionCount: 12,
      bookstackUserId: 7,
      html: input.html,
    });
    expect(body.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports a conflict only after BookStack preserved it as a revision", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "revision_conflict",
          preserved: true,
          revisionCount: 14,
        }),
        { status: 409 },
      ),
    );
    await expect(saveBookStackPage(input)).rejects.toBeInstanceOf(
      BookStackConflictSavedError,
    );
  });

  it("does not treat an unpreserved conflict as a completed save", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "revision_conflict" }), {
        status: 409,
      }),
    );
    const error = await saveBookStackPage(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BookStackSaveError);
    expect(error).toMatchObject({ retryable: false });
  });

  it("classifies server errors as retryable without logging page content", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const error = await saveBookStackPage(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BookStackSaveError);
    expect(error).toMatchObject({ retryable: true });
  });
});
