import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rowCount: 1 })) },
}));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<object>()),
  workspace: vi.fn(),
}));
vi.mock("@/lib/intake/extract", () => ({ extractFile: vi.fn() }));
vi.mock("@/lib/intake/draft", () => ({ generateDraft: vi.fn() }));
import { db } from "@/lib/db";
import { enqueue } from "@/lib/intake/jobs";
import { requireInboundEmail } from "@/lib/intake/inbound-enabled";
import { extractFile } from "@/lib/intake/extract";
import { generateDraft } from "@/lib/intake/draft";
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("rechecks the switch at deferred processing time and releases resources", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "true");
  const cleanup = vi.fn(async () => {});
  const release = vi.fn();
  const done = new Promise<void>((resolve) => {
    enqueue(
      "item",
      "user",
      "tenant",
      "/unused",
      "test.md",
      cleanup,
      () => {
        release();
        resolve();
      },
      true,
      () => requireInboundEmail("processing"),
    );
  });
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
  await done;
  expect(extractFile).not.toHaveBeenCalled();
  expect(generateDraft).not.toHaveBeenCalled();
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("SET status='queued'"),
    ["item"],
  );
  expect(db.query).not.toHaveBeenCalledWith(
    expect.stringContaining("SET status='failed'"),
    expect.anything(),
  );
  expect(cleanup).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

it("pauses after extraction without generating or discarding the queued email", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "true");
  vi.mocked(extractFile).mockImplementationOnce(async () => {
    vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
    return { text: "source retained for retry", mime: "text/plain" };
  });
  await new Promise<void>((resolve) => {
    enqueue(
      "item",
      "user",
      "tenant",
      "/unused",
      "test.md",
      async () => {},
      resolve,
      true,
      () => requireInboundEmail("processing"),
    );
  });
  expect(extractFile).toHaveBeenCalledOnce();
  expect(generateDraft).not.toHaveBeenCalled();
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("SET status='queued'"),
    ["item"],
  );
  expect(db.query).not.toHaveBeenCalledWith(
    expect.stringContaining("SET status='failed'"),
    expect.anything(),
  );
});
