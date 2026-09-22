// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiChat } from "@/components/wiki-chat";
import { requestAnswer, transportFailure } from "@/lib/chat/client-error";

const tenants = [{ id: "synthetic-a", slug: "Example A" }];
const question = "Where is the example?";
const answer = {
  question,
  answer: "Read the example [1].",
  sources: [
    {
      pageId: 1,
      pageName: "Example",
      section: "Setup",
      url: "/books/example/page/setup",
      excerpt: "Read the example.",
    },
  ],
  refused: false,
  mode: "extractive",
};
let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function field() {
  return container.querySelector("textarea")!;
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === text,
  );
}
function status() {
  return container.querySelector('[role="status"]')!;
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function enterQuestion(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!
      .set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pressKey(options: KeyboardEventInit) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(WikiChat, { tenants })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("mounted WikiChat Stop button", () => {
  it("B1 shows a reachable, enabled Stop button only while a question is in flight", async () => {
    const pending = deferred();
    fetcher.mockReturnValue(pending.promise);
    expect(button("Stop")).toBeUndefined();
    expect(button("Ask")).toBeDefined();
    await enterQuestion(question);
    await pressKey({ key: "Enter" });
    expect(fetcher).toHaveBeenCalledOnce();
    const stop = button("Stop")!;
    expect(stop).toBeDefined();
    expect(stop.getAttribute("type")).toBe("button");
    expect(stop.disabled).toBe(false);
    await pressKey({ key: "Enter" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("B2 aborts the request and restores the form with the question kept", async () => {
    const pending = deferred();
    fetcher.mockReturnValue(pending.promise);
    await enterQuestion(question);
    await pressKey({ key: "Enter" });
    const init = fetcher.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const signal = init!.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => button("Stop")!.click());
    expect(signal.aborted).toBe(true);
    expect(field().disabled).toBe(false);
    expect(button("Ask")).toBeDefined();
    expect(button("Stop")).toBeUndefined();
    expect(field().value).toBe(question);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("B3 shows a neutral Stopped status message and no alert after Stop", async () => {
    const pending = deferred();
    fetcher.mockReturnValue(pending.promise);
    await enterQuestion(question);
    await pressKey({ key: "Enter" });
    await act(async () => button("Stop")!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(status().textContent).toContain("Stopped");
    expect(status().textContent).not.toMatch(/quota|counted|allowance/i);
  });

  it("B4 ignores a response that resolves after Stop was clicked", async () => {
    const pending = deferred();
    fetcher.mockReturnValue(pending.promise);
    await enterQuestion(question);
    await pressKey({ key: "Enter" });
    await act(async () => button("Stop")!.click());
    const before = container.textContent;
    await act(async () => pending.resolve(Response.json(answer)));
    expect(container.textContent).toBe(before);
    expect(container.querySelector("h2")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("a")).some(
        (link) => link.getAttribute("href") === answer.sources[0].url,
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain("questions remaining");
  });

  it("B5 asks again after Stop with one new POST and renders its answer", async () => {
    const first = deferred();
    const second = deferred();
    fetcher.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await enterQuestion(question);
    await pressKey({ key: "Enter" });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => button("Stop")!.click());
    expect(status().textContent).toContain("Stopped");
    await pressKey({ key: "Enter" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe("/api/chat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      tenant: tenants[0].id,
      question,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init!.signal as AbortSignal).aborted).toBe(false);
    expect(status().textContent).not.toContain("Stopped");
    await act(async () => second.resolve(Response.json(answer)));
    expect(container.querySelector("h2")?.textContent).toBe("Answer");
    expect(
      Array.from(container.querySelectorAll("a")).some(
        (link) => link.getAttribute("href") === answer.sources[0].url,
      ),
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("B6 requestAnswer signal handling", () => {
  const input = { tenant: tenants[0].id, question };

  it("accepts an optional signal and forwards it to the fetch init", async () => {
    const controller = new AbortController();
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(answer));
    await expect(requestAnswer(mock, input, controller.signal)).resolves.toEqual(
      { ok: true, answer },
    );
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("returns a cancelled outcome when the fetch rejects after an abort", async () => {
    const controller = new AbortController();
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const mock = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    controller.abort();
    await expect(
      requestAnswer(mock, input, controller.signal),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("treats an AbortError rejection as cancelled even without a signal", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const mock = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    await expect(requestAnswer(mock, input)).resolves.toEqual({
      ok: false,
      cancelled: true,
    });
  });

  it("keeps a genuine network error as the transport failure when not aborted", async () => {
    const controller = new AbortController();
    const mock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private transport detail"));
    await expect(
      requestAnswer(mock, input, controller.signal),
    ).resolves.toEqual({ ok: false, failure: transportFailure() });
    expect(controller.signal.aborted).toBe(false);
  });
});
