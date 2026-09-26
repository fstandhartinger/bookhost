import { createHmac } from "node:crypto";
import { liveEditTenantSecret } from "./bookstack-ticket";

export class BookStackSaveError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}

export class BookStackConflictSavedError extends Error {
  constructor(readonly revisionCount: number) {
    super("The BookStack page changed during Live Edit; changes were preserved in revision history.");
  }
}

export type BookStackSaveInput = {
  tenantId: string;
  tenantSlug: string;
  tenantHost: string;
  pageId: number;
  bookstackUserId: number;
  expectedRevisionCount: number;
  html: string;
};

export function liveEditSaveSignature(input: {
  tenantSlug: string;
  pageId: number;
  bookstackUserId: number;
  expectedRevisionCount: number;
  exp: number;
  html: string;
  secret: string;
}) {
  const htmlToken = Buffer.from(input.html, "utf8").toString("base64url");
  const message = [
    "live-edit-save-v1",
    input.tenantSlug,
    String(input.pageId),
    String(input.bookstackUserId),
    String(input.expectedRevisionCount),
    String(input.exp),
    htmlToken,
  ].join("\n");
  return createHmac("sha256", input.secret).update(message).digest("hex");
}

export async function saveBookStackPage(
  input: BookStackSaveInput,
): Promise<number> {
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      input.tenantHost,
    ) ||
    !Number.isSafeInteger(input.pageId) ||
    input.pageId <= 0 ||
    !Number.isSafeInteger(input.expectedRevisionCount) ||
    input.expectedRevisionCount < 0 ||
    !Number.isSafeInteger(input.bookstackUserId) ||
    input.bookstackUserId <= 0
  ) {
    throw new BookStackSaveError("Invalid Live Edit save target.", false);
  }

  const secret = await liveEditTenantSecret(input.tenantId, input.tenantSlug);
  const exp = Math.floor(Date.now() / 1000) + 30;
  const payload = {
    expectedRevisionCount: input.expectedRevisionCount,
    bookstackUserId: input.bookstackUserId,
    exp,
    html: input.html,
    signature: liveEditSaveSignature({
      tenantSlug: input.tenantSlug,
      pageId: input.pageId,
      bookstackUserId: input.bookstackUserId,
      expectedRevisionCount: input.expectedRevisionCount,
      exp,
      html: input.html,
      secret,
    }),
  };

  let response: Response;
  try {
    response = await fetch(
      `https://${input.tenantHost}/live-edit/save/${input.pageId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new BookStackSaveError("BookStack could not be reached for a Live Edit save.");
  }

  let result: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object")
      result = parsed as Record<string, unknown>;
  } catch {
    // The status below remains the authoritative response.
  }

  if (
    response.status === 409 &&
    result.error === "revision_conflict" &&
    result.preserved === true &&
    Number.isSafeInteger(result.revisionCount)
  ) {
    throw new BookStackConflictSavedError(result.revisionCount as number);
  }
  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429;
    throw new BookStackSaveError(
      `BookStack rejected a Live Edit save (HTTP ${response.status}).`,
      retryable,
    );
  }
  if (!Number.isSafeInteger(result.revisionCount))
    throw new BookStackSaveError("BookStack returned an invalid Live Edit revision count.");
  return result.revisionCount as number;
}
