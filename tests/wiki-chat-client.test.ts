import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FailureNotice } from "@/components/wiki-chat";
import {
  createInflightGuard,
  failureForStatus,
  parseChatAnswer,
  requestAnswer,
  type ChatAnswer,
} from "@/lib/chat/client-error";

const answer: ChatAnswer = {
  question: "How does the example work?",
  answer: "Read the example. [1]",
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
  retrieval: "lexical",
  terms: ["example"],
  quota: { remaining: 2, limit: 3 },
};
const input = { tenant: "example-workspace", question: answer.question };
const statuses = [
  { status: 401, retry: false, href: "/login", message: /sign in/i },
  { status: 402, retry: false, href: "/app", message: /allowance.*billing/i },
  { status: 403, retry: false, href: undefined, message: /owner.*admin/i },
  {
    status: 404,
    retry: false,
    href: "/app",
    message: /workspace is not available/i,
  },
  {
    status: 409,
    retry: false,
    href: "/app",
    message: /status.*billing.*subscription/i,
  },
  { status: 429, retry: true, href: undefined, message: /usage limit/i },
  {
    status: 503,
    retry: true,
    href: "mailto:info@productivity-boost.com",
    message: /temporarily unavailable.*support/i,
  },
  {
    status: 413,
    retry: true,
    href: "mailto:info@productivity-boost.com",
    message: /try again.*support/i,
  },
  {
    status: 500,
    retry: true,
    href: "mailto:info@productivity-boost.com",
    message: /try again.*support/i,
  },
];

describe("chat failure status policy", () => {
  it.each(statuses)(
    "handles $status before reading any body",
    async ({ status, retry, href, message }) => {
      const json = vi
        .fn()
        .mockRejectedValue(new Error("private parser detail"));
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: false, status, json } as unknown as Response);
      const result = await requestAnswer(fetcher, input);
      expect(result).toEqual({ ok: false, failure: failureForStatus(status) });
      const failure = failureForStatus(status);
      expect(failure.message).toMatch(message);
      expect(failure.retry).toBe(retry);
      expect(failure.link?.href).toBe(href);
      expect(json).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("private parser detail");
    },
  );

  it("does not invent a 429 allowance or reset, or suggest waiting for 409", () => {
    expect(failureForStatus(429).message).not.toMatch(
      /allowance|reset|exhaust|\d/,
    );
    expect(failureForStatus(409).message).not.toMatch(/wait|shortly|later/i);
    expect(failureForStatus(777)).toEqual(failureForStatus(413));
  });
});

describe("chat answer validation", () => {
  it.each([
    answer,
    { ...answer, mode: "ai", retrieval: "hybrid" },
    {
      ...answer,
      sources: [],
      refused: true,
      terms: undefined,
      quota: null,
      retrieval: undefined,
    },
    {
      ...answer,
      sources: [{ ...answer.sources[0], section: null, url: null }],
      quota: undefined,
    },
  ])("accepts supported successful answers", (data) => {
    expect(parseChatAnswer(data)).toEqual(data);
  });

  const malformed = [
    null,
    [],
    "answer",
    {},
    { ...answer, question: null },
    { ...answer, answer: {} },
    { ...answer, sources: null },
    { ...answer, sources: {} },
    { ...answer, sources: [null] },
    ...["pageId", "pageName", "section", "url", "excerpt"].map((field) => ({
      ...answer,
      sources: [{ ...answer.sources[0], [field]: {} }],
    })),
    { ...answer, sources: [{ ...answer.sources[0], pageId: Infinity }] },
    { ...answer, refused: "false" },
    { ...answer, mode: {} },
    { ...answer, retrieval: "other" },
    { ...answer, terms: null },
    { ...answer, terms: {} },
    { ...answer, terms: [null] },
    { ...answer, quota: {} },
    { ...answer, quota: { remaining: {}, limit: 3 } },
    { ...answer, quota: { remaining: 2, limit: "3" } },
    { ...answer, quota: { remaining: NaN, limit: 3 } },
    { ...answer, quota: { remaining: 2, limit: Infinity } },
  ];
  it.each(malformed.map((data, index) => ({ data, index })))(
    "rejects malformed rendering field case $index safely",
    async ({ data }) => {
      expect(parseChatAnswer(data)).toBeNull();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, json: async () => data } as Response);
      const result = await requestAnswer(fetcher, input);
      expect(result).toEqual({
        ok: false,
        failure: {
          message:
            "The server reply was incomplete, so the answer could not be shown. Please try again.",
          retry: true,
        },
      });
    },
  );
});

describe("chat request recovery", () => {
  it("returns safe network and JSON messages without automatic retries", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private transport detail"));
    const network = await requestAnswer(fetcher, input);
    expect(network).toMatchObject({
      ok: false,
      failure: {
        retry: true,
        message: expect.stringMatching(/connection.*try again/i),
      },
    });
    expect(JSON.stringify(network)).not.toContain("private");
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(new Response("not-json private internal body"));
    const json = await requestAnswer(fetcher, input);
    expect(json).toMatchObject({
      ok: false,
      failure: {
        retry: true,
        message: expect.stringMatching(/reply could not be read.*try again/i),
      },
    });
    expect(JSON.stringify(json)).not.toMatch(/private|SyntaxError|Unexpected/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["", "  ", "ab", "  ab  ", "a".repeat(501)])(
    "rejects invalid questions without a request (%#)",
    async (question) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(
        await requestAnswer(fetcher, { ...input, question }),
      ).toMatchObject({
        ok: false,
        failure: { retry: false, message: expect.stringMatching(/3 and 500/) },
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["abc", "a".repeat(500)])(
    "accepts the question boundaries (%#)",
    async (question) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(answer));
      expect(
        await requestAnswer(fetcher, { ...input, question: ` ${question} ` }),
      ).toEqual({ ok: true, answer });
      expect(fetcher).toHaveBeenCalledWith("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: input.tenant, question }),
      });
    },
  );

  it("guards synchronously and allows a new attempt only after release", () => {
    const guard = createInflightGuard();
    expect(guard.enter()).toBe(true);
    expect(guard.enter()).toBe(false);
    guard.leave();
    expect(guard.enter()).toBe(true);
    expect(guard.enter()).toBe(false);
  });
});

describe("failure notice static rendering (not mounted interaction evidence)", () => {
  it.each(statuses)(
    "renders an alert and native recovery controls for $status",
    ({ status, retry, href }) => {
      const html = renderToStaticMarkup(
        React.createElement(FailureNotice, {
          failure: failureForStatus(status),
          busy: false,
          onRetry: vi.fn(),
        }),
      );
      expect(html).toContain('role="alert"');
      expect(html.includes('type="button"')).toBe(retry);
      expect(html.includes(">Retry</button>")).toBe(retry);
      if (href) expect(html).toContain(`href="${href}"`);
      else expect(html).not.toContain("<a ");
    },
  );

  it("disables the native Retry button while busy", () => {
    const html = renderToStaticMarkup(
      React.createElement(FailureNotice, {
        failure: failureForStatus(503),
        busy: true,
        onRetry: vi.fn(),
      }),
    );
    expect(html).toContain('disabled=""');
  });
});
