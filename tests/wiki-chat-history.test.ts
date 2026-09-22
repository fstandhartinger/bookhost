// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiChat } from "@/components/wiki-chat";

const tenants = [
  { id: "synthetic-a", slug: "Example A" },
  { id: "synthetic-b", slug: "Example B" },
];
function makeAnswer(n: number, refused = false) {
  return {
    question: `Question ${n}?`,
    answer: refused ? "" : `Answer ${n} cites [1].`,
    sources: refused
      ? []
      : [
          {
            pageId: n,
            pageName: `Page ${n}`,
            section: `Section ${n}`,
            url: `/books/book-${n}/page/page-${n}`,
            excerpt: `Excerpt ${n}.`,
          },
        ],
    refused,
    mode: "extractive",
  };
}
let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function field() {
  return container.querySelector("textarea")!;
}
function workspace() {
  return container.querySelector("select")!;
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === text,
  );
}
function heading(text: string) {
  return Array.from(container.querySelectorAll("h2")).find(
    (node) => node.textContent === text,
  );
}
function latestCard() {
  return heading("Answer")?.closest("div") ?? null;
}
function earlierSection() {
  return heading("Earlier in this session")?.closest("section") ?? null;
}
function earlierDetails() {
  return Array.from(earlierSection()?.querySelectorAll("details") ?? []);
}
function summaries() {
  return earlierDetails().map(
    (details) => details.querySelector("summary")!.textContent,
  );
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
async function submitForm() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function ask(n: number, refused = false) {
  fetcher.mockResolvedValueOnce(Response.json(makeAnswer(n, refused)));
  await enterQuestion(`Question ${n}?`);
  await submitForm();
}
async function changeWorkspace(value: string) {
  await act(async () => {
    workspace().value = value;
    workspace().dispatchEvent(new Event("change", { bubbles: true }));
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

describe("mounted WikiChat session history", () => {
  it("H1 shows the latest answer under Answer and the previous turn with its sources under Earlier in this session", async () => {
    await ask(1);
    await ask(2);
    const latest = latestCard()!;
    expect(latest).not.toBeNull();
    expect(latest.textContent).toContain("Answer 2 cites");
    expect(latest.textContent).not.toContain("Answer 1 cites");
    const latestCitation = Array.from(latest.querySelectorAll("a")).find(
      (link) => link.textContent === "[1]",
    )!;
    expect(latestCitation.getAttribute("href")).toBe(
      "/books/book-2/page/page-2",
    );
    const section = earlierSection()!;
    expect(section).not.toBeNull();
    const items = earlierDetails();
    expect(items).toHaveLength(1);
    expect(summaries()).toEqual(["Question 1?"]);
    expect(items[0].hasAttribute("open")).toBe(false);
    await act(async () => {
      items[0].setAttribute("open", "");
    });
    expect(items[0].hasAttribute("open")).toBe(true);
    expect(items[0].textContent).toContain("Answer 1 cites");
    const citation = Array.from(items[0].querySelectorAll("a")).find(
      (link) => link.textContent === "[1]",
    )!;
    expect(citation.getAttribute("href")).toBe("/books/book-1/page/page-1");
    expect(citation.getAttribute("target")).toBe("_blank");
    expect(citation.getAttribute("rel")).toBe("noopener noreferrer");
    const sourceItem = items[0].querySelector("ol li")!;
    expect(sourceItem.textContent).toContain("[1]");
    const sourceLink = sourceItem.querySelector("a")!;
    expect(sourceLink.textContent).toBe("Page 1");
    expect(sourceLink.getAttribute("href")).toBe("/books/book-1/page/page-1");
    expect(sourceItem.textContent).toContain("Section 1");
    expect(sourceItem.textContent).toContain("Excerpt 1.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("H2 keeps at most 10 earlier turns, newest first, oldest dropped", async () => {
    for (let n = 1; n <= 12; n++) await ask(n);
    expect(latestCard()!.textContent).toContain("Answer 12 cites");
    const items = earlierDetails();
    expect(items).toHaveLength(10);
    expect(summaries()).toEqual(
      Array.from({ length: 10 }, (_, index) => `Question ${11 - index}?`),
    );
    expect(earlierSection()!.textContent).not.toContain("Question 1?");
    expect(items[0].textContent).toContain("Answer 11 cites");
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it("H3 records refused answers, ignores errors and Stop, and keeps everything visible in flight", async () => {
    await ask(1);
    await ask(2, true);
    expect(latestCard()!.textContent).toMatch(/no page.*matched/i);
    expect(summaries()).toEqual(["Question 1?"]);
    fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 500 }));
    await enterQuestion("Question 3?");
    await submitForm();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(summaries()).toEqual(["Question 1?"]);
    expect(latestCard()!.textContent).toMatch(/no page.*matched/i);
    const stopped = deferred();
    fetcher.mockReturnValueOnce(stopped.promise);
    await enterQuestion("Question 4?");
    await submitForm();
    expect(summaries()).toEqual(["Question 1?"]);
    expect(latestCard()!.textContent).toMatch(/no page.*matched/i);
    await act(async () => button("Stop")!.click());
    expect(summaries()).toEqual(["Question 1?"]);
    expect(latestCard()!.textContent).toMatch(/no page.*matched/i);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await ask(5);
    expect(latestCard()!.textContent).toContain("Answer 5 cites");
    expect(summaries()).toEqual(["Question 2?", "Question 1?"]);
    expect(earlierDetails()[0].textContent).toMatch(/no page.*matched/i);
    const pending = deferred();
    fetcher.mockReturnValueOnce(pending.promise);
    await enterQuestion("Question 6?");
    await submitForm();
    expect(summaries()).toEqual(["Question 2?", "Question 1?"]);
    expect(latestCard()!.textContent).toContain("Answer 5 cites");
    await act(async () => pending.resolve(Response.json(makeAnswer(6))));
    expect(latestCard()!.textContent).toContain("Answer 6 cites");
    expect(summaries()).toEqual([
      "Question 5?",
      "Question 2?",
      "Question 1?",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(field().value).toBe("Question 6?");
  });

  it("H4 clears only the earlier turns with a button that is hidden without turns and disabled while busy", async () => {
    expect(button("Clear earlier questions")).toBeUndefined();
    await ask(1);
    expect(button("Clear earlier questions")).toBeUndefined();
    await ask(2);
    const clear = button("Clear earlier questions")!;
    expect(clear).toBeDefined();
    expect(clear.getAttribute("type")).toBe("button");
    expect(clear.disabled).toBe(false);
    const pending = deferred();
    fetcher.mockReturnValueOnce(pending.promise);
    await enterQuestion("Question 3?");
    await submitForm();
    expect(button("Clear earlier questions")!.disabled).toBe(true);
    await act(async () => pending.resolve(Response.json(makeAnswer(3))));
    expect(button("Clear earlier questions")!.disabled).toBe(false);
    expect(summaries()).toEqual(["Question 2?", "Question 1?"]);
    await act(async () => button("Clear earlier questions")!.click());
    expect(earlierSection()).toBeNull();
    expect(button("Clear earlier questions")).toBeUndefined();
    expect(latestCard()!.textContent).toContain("Answer 3 cites");
  });

  it("H5 clears the latest answer and all earlier turns on workspace switch", async () => {
    await ask(1);
    await ask(2);
    expect(summaries()).toEqual(["Question 1?"]);
    await changeWorkspace(tenants[1].id);
    expect(heading("Answer")).toBeUndefined();
    expect(earlierSection()).toBeNull();
    expect(container.textContent).not.toContain("Answer 1 cites");
    expect(container.textContent).not.toContain("Answer 2 cites");
    expect(button("Clear earlier questions")).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await ask(3);
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string).tenant).toBe(
      tenants[1].id,
    );
    expect(latestCard()!.textContent).toContain("Answer 3 cites");
    expect(earlierSection()).toBeNull();
  });

  it("H6 keeps state in memory only and posts only tenant and question", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/wiki-chat.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie/,
    );
    await ask(1);
    await ask(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      tenant: tenants[0].id,
      question: "Question 1?",
    });
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
      tenant: tenants[0].id,
      question: "Question 2?",
    });
  });
});
