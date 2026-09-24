import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiChat } from "@/components/wiki-chat";

const tenants = [{ id: "synthetic-a", slug: "Example A" }, { id: "synthetic-b", slug: "Example B" }];
const question = "Where is the example?";
const answer = {
  question,
  answer: "Read the example [1].",
  sources: [{ pageId: 1, pageName: "Example", section: "Setup", url: "/books/example/page/setup", excerpt: "Read the example." }],
  refused: false,
  mode: "extractive",
  quota: { remaining: 4, limit: 5 },
};
let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function chatCalls() {
  return fetcher.mock.calls;
}
function field() { return container.querySelector("textarea")!; }
function workspace() { return container.querySelector("select")!; }
function retry() { return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry"); }
async function enterQuestion() {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), question);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
async function changeWorkspace(value: string) {
  await act(async () => {
    workspace().value = value;
    workspace().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
type FetchCall = Parameters<typeof fetch>;
function withoutSignal([url, init]: FetchCall) {
  const { signal, ...rest } = init ?? {};
  return [url, rest, signal instanceof AbortSignal] as const;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      if (String(input).startsWith("/api/chat/suggestions"))
        return Promise.resolve(Response.json({ questions: [] }));
      return (fetcher(input as never, init as never) ??
        Promise.reject(new Error("no chat mock"))) as Promise<Response>;
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(WikiChat, { tenants })));
  await enterQuestion();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("mounted WikiChat controlled responses", () => {
  it.each([
    [401, /session.*expired.*sign in/i, false, "/login"],
    [402, /allowance.*plan and billing/i, false, "/app"],
    [403, /owners and admins.*owner or admin/i, false, null],
    [404, /workspace is not available.*another workspace/i, false, "/app"],
    [409, /status and billing.*subscription is active/i, false, "/app"],
    [429, /usage limit.*try again later/i, true, null],
    [503, /temporarily unavailable.*contact support/i, true, "mailto:info@productivity-boost.com"],
    [400, /could not be answered.*try again.*support/i, true, "mailto:info@productivity-boost.com"],
    [500, /could not be answered.*try again.*support/i, true, "mailto:info@productivity-boost.com"],
  ] as const)("safe guidance for %s", async (status, message, retryable, href) => {
    fetcher.mockResolvedValue(new Response("RAW_RESPONSE_MARKER", { status }));
    await submit();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toMatch(message);
    expect(container.textContent).not.toContain("RAW_RESPONSE_MARKER");
    expect(Boolean(retry())).toBe(retryable);
    expect(alert.querySelector("a")?.getAttribute("href") ?? null).toBe(href);
    if (status === 429) expect(alert.textContent).not.toMatch(/reset|midnight|\d/);
    if (status === 409) expect(alert.textContent).not.toMatch(/wait|later|shortly/);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(chatCalls()).toHaveLength(1);
    expect(field().value).toBe(question);
    expect(workspace().value).toBe(tenants[0].id);
    expect(field().disabled).toBe(false);
  });

  it.each([
    ["malformed", /reply was incomplete/i],
    ["invalid JSON", /reply could not be read/i],
    ["network", /connection failed.*internet connection/i],
  ] as const)("safe mounted %s failure", async (kind, message) => {
    if (kind === "network") fetcher.mockRejectedValue(new Error("RAW_ERROR_MARKER"));
    else fetcher.mockResolvedValue(new Response(kind === "malformed" ? '{"answer":"RAW_ERROR_MARKER"}' : "RAW_ERROR_MARKER"));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(message);
    expect(container.textContent).not.toMatch(/RAW_ERROR_MARKER|SyntaxError|Unexpected/);
    expect(retry()).toBeDefined();
    expect(chatCalls()).toHaveLength(1);
  });

  it("requires explicit retry, preserves input, guards duplicate submits and renders cited success", async () => {
    let resolve!: (response: Response) => void;
    const deferred = new Promise<Response>((done) => { resolve = done; });
    fetcher.mockResolvedValueOnce(new Response("RAW_RESPONSE_MARKER", { status: 429 })).mockReturnValueOnce(deferred);
    await changeWorkspace(tenants[1].id);
    await submit();
    expect(chatCalls()).toHaveLength(1);
    await act(async () => {
      retry()!.click();
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(chatCalls()).toHaveLength(2);
    const firstCall = withoutSignal(chatCalls()[0]);
    const secondCall = withoutSignal(chatCalls()[1]);
    expect(firstCall).toEqual(secondCall);
    expect(firstCall[2]).toBe(true);
    expect(secondCall[2]).toBe(true);
    expect(JSON.parse(chatCalls()[1][1]!.body as string)).toEqual({ tenant: tenants[1].id, question });
    expect(field().disabled).toBe(true);
    expect(workspace().disabled).toBe(true);
    expect(container.querySelector("form button")!.hasAttribute("disabled")).toBe(true);
    await act(async () => resolve(Response.json(answer)));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const citation = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "[1]")!;
    expect(citation.getAttribute("href")).toBe(answer.sources[0].url);
    expect(citation.target).toBe("_blank");
    expect(citation.rel).toBe("noopener noreferrer");
    expect(field().value).toBe(question);
    expect(field().disabled).toBe(false);
    expect(workspace().disabled).toBe(false);
    expect(container.textContent).toContain("non-personal example documents");
    expect(chatCalls()).toHaveLength(2);
  });

  it("clears result, quota and failure across workspace changes and sends the selected tenant", async () => {
    fetcher.mockResolvedValueOnce(Response.json(answer)).mockResolvedValueOnce(new Response("RAW_RESPONSE_MARKER", { status: 503 })).mockResolvedValueOnce(Response.json(answer));
    await submit();
    expect(container.textContent).toContain("4 questions remaining");
    expect(container.querySelector("h2")?.textContent).toBe("Answer");
    await changeWorkspace(tenants[1].id);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).not.toContain("questions remaining");
    expect(chatCalls()).toHaveLength(1);
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(JSON.parse(chatCalls()[1][1]!.body as string).tenant).toBe(tenants[1].id);
    await changeWorkspace(tenants[0].id);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(retry()).toBeUndefined();
    expect(container.textContent).not.toContain("questions remaining");
    expect(field().value).toBe(question);
    expect(chatCalls()).toHaveLength(2);
    await submit();
    expect(JSON.parse(chatCalls()[2][1]!.body as string).tenant).toBe(tenants[0].id);
  });
});
