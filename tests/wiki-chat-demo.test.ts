import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIKI_CHAT_DEMO_TIMING, WikiChatDemo } from "@/components/wiki-chat-demo";

const ANSWER_FRAGMENT = "Fahrräder, E-Bikes und Roller gehören ausschließlich";
const SOURCE_NAME = "Fahrradabstellplätze im Innenhof";

let container: HTMLDivElement;
let root: Root;

function stubMatchMedia(matches: boolean) {
  const query = {
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stubMatchMedia(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("WikiChatDemo landing animation", () => {
  it("immediate renders the full final state, carries the demo attribute and no URLs", async () => {
    await act(async () => {
      root.render(React.createElement(WikiChatDemo, { immediate: true }));
    });
    const demo = container.querySelector("[data-wiki-chat-demo]");
    expect(demo).not.toBeNull();
    const text = demo!.textContent ?? "";
    expect(text).toContain("Where may I leave my two-wheeler?");
    expect(text).toContain(ANSWER_FRAGMENT);
    expect(text).toContain("[1]");
    expect(text).toContain(SOURCE_NAME);
    expect(demo!.outerHTML).not.toContain("http://");
    expect(demo!.outerHTML).not.toContain("https://");
  });

  it("reduced motion renders the final state immediately without the thinking indicator", async () => {
    stubMatchMedia(true);
    await act(async () => {
      root.render(React.createElement(WikiChatDemo));
    });
    const demo = container.querySelector("[data-wiki-chat-demo]")!;
    const text = demo.textContent ?? "";
    expect(text).toContain("Where may I leave my two-wheeler?");
    expect(text).toContain(ANSWER_FRAGMENT);
    expect(text).toContain(SOURCE_NAME);
    expect(demo.querySelector("[data-wiki-chat-demo-thinking]")).toBeNull();
  });

  it("advances question, thinking, answer, sources and loops again", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(React.createElement(WikiChatDemo));
    });
    const demo = container.querySelector("[data-wiki-chat-demo]")!;
    const thinking = () => demo.querySelector("[data-wiki-chat-demo-thinking]");
    const { question, thinking: thinkingMs, answer, hold } = WIKI_CHAT_DEMO_TIMING;
    expect(demo.textContent).toContain("Where may I leave my two-wheeler?");
    expect(thinking()).toBeNull();
    expect(demo.textContent).not.toContain(ANSWER_FRAGMENT);
    expect(demo.textContent).not.toContain(SOURCE_NAME);
    await act(async () => { vi.advanceTimersByTime(question); });
    expect(thinking()).not.toBeNull();
    expect(demo.textContent).not.toContain(ANSWER_FRAGMENT);
    await act(async () => { vi.advanceTimersByTime(thinkingMs); });
    expect(demo.textContent).toContain(ANSWER_FRAGMENT);
    expect(demo.textContent).toContain("[1]");
    expect(demo.textContent).not.toContain(SOURCE_NAME);
    await act(async () => { vi.advanceTimersByTime(answer); });
    expect(demo.textContent).toContain(SOURCE_NAME);
    await act(async () => { vi.advanceTimersByTime(hold); });
    expect(thinking()).toBeNull();
    expect(demo.textContent).not.toContain(ANSWER_FRAGMENT);
    expect(demo.textContent).not.toContain(SOURCE_NAME);
  });
});
