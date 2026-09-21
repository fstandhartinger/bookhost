import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiChat } from "@/components/wiki-chat";

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
async function enterQuestion(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!
      .set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pressKey(options: KeyboardEventInit) {
  let dispatched = false;
  await act(async () => {
    dispatched = field().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }),
    );
  });
  return dispatched;
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

describe("mounted WikiChat Enter-to-submit", () => {
  it("A1 submits the form once with a POST body containing the question", async () => {
    fetcher.mockResolvedValue(Response.json(answer));
    await enterQuestion(question);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await pressKey({ key: "Enter" })).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      tenant: tenants[0].id,
      question,
    });
  });

  it("A2 Shift+Enter keeps the newline default and does not submit", async () => {
    await enterQuestion(question);
    expect(await pressKey({ key: "Enter", shiftKey: true })).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("A3 Enter during IME composition or keyCode 229 does not submit", async () => {
    await enterQuestion(question);
    expect(await pressKey({ key: "Enter", isComposing: true })).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await pressKey({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("A4 blocks short questions and duplicate submits while a request is pending", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    fetcher.mockReturnValue(pending);
    await enterQuestion(" ab ");
    await pressKey({ key: "Enter" });
    expect(fetcher).not.toHaveBeenCalled();
    await enterQuestion(question);
    expect(await pressKey({ key: "Enter" })).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    await pressKey({ key: "Enter" });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => resolve(Response.json(answer)));
    expect(await pressKey({ key: "Enter" })).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("A5 renders the Enter and Shift+Enter hint", () => {
    expect(container.textContent).toContain("Press Enter to ask");
    expect(container.textContent).toContain("Shift+Enter for a new line");
  });
});
