import React, { type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailureNotice, WikiChat } from "@/components/wiki-chat";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [
        hooks.values[index],
        (value: unknown) => {
          hooks.values[index] = value;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index];
    },
  };
});

type Props = {
  children?: ReactNode;
  value?: string;
  disabled?: boolean;
  href?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  failure?: { retry: boolean };
  onRetry?: () => void;
};
const tenants = [
  { id: "example-a", slug: "example-a" },
  { id: "example-b", slug: "example-b" },
];
const answer = {
  question: "Where is the example?",
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
  terms: ["example"],
  quota: { remaining: 4, limit: 5 },
};
function render() {
  hooks.cursor = 0;
  return WikiChat({ tenants });
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!React.isValidElement<Props>(node)) return [];
  return [
    node,
    ...React.Children.toArray(node.props.children).flatMap(elements),
  ];
}
function element(type: unknown) {
  const found = elements(render()).find((node) => node.type === type);
  expect(found).toBeDefined();
  return found!;
}
function submit() {
  element("form").props.onSubmit!({ preventDefault: vi.fn() });
}
function question(value: string) {
  element("textarea").props.onChange!({ target: { value } });
}
async function settled() {
  await vi.waitFor(() =>
    expect(element("textarea").props.disabled).toBe(false),
  );
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WikiChat handler unit tests with mocked hooks (not mounted DOM or keyboard evidence)", () => {
  it("requires explicit Retry, blocks same-tick duplicate submissions, and renders successful citations", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockReturnValueOnce(pending);
    vi.stubGlobal("fetch", fetcher);
    question(answer.question);
    submit();
    await settled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(element("textarea").props.value).toBe(answer.question);
    expect(element("select").props.value).toBe("example-a");
    const retry = element(FailureNotice).props.onRetry!;
    retry();
    retry();
    submit();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(element("textarea").props.disabled).toBe(true);
    expect(element("select").props.disabled).toBe(true);
    expect(element("button").props.disabled).toBe(true);
    resolve(Response.json(answer));
    await settled();
    expect(elements(render()).some((node) => node.type === FailureNotice)).toBe(
      false,
    );
    const links = elements(render()).filter(
      (node) => node.type === "a" && node.props.href === answer.sources[0].url,
    );
    expect(links).toHaveLength(2);
    expect(links[0].props.children).toBe("[1]");
    expect(links[1].props.children).toBe("Example");
    expect(element("textarea").props.value).toBe(answer.question);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 402, 403, 404, 409])(
    "does not submit via Retry for nonretryable %i",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("failure", { status }));
      vi.stubGlobal("fetch", fetcher);
      question(answer.question);
      submit();
      await settled();
      expect(element(FailureNotice).props.failure?.retry).toBe(false);
      element(FailureNotice).props.onRetry!();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each(["  ", "ab", "x".repeat(501)])(
    "validates edited questions on Retry (%#)",
    async (invalid) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("synthetic network rejection"));
      vi.stubGlobal("fetch", fetcher);
      question(answer.question);
      submit();
      await settled();
      question(invalid);
      element(FailureNotice).props.onRetry!();
      await settled();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(element(FailureNotice).props.failure?.retry).toBe(false);
      expect(element("textarea").props.value).toBe(invalid);
    },
  );

  it("clears result, failure and quota on workspace changes without another request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(answer))
      .mockResolvedValueOnce(new Response("failure", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    question(answer.question);
    submit();
    await settled();
    expect(
      elements(render()).some(
        (node) => node.props.href === answer.sources[0].url,
      ),
    ).toBe(true);
    expect(
      elements(render()).flatMap((node) =>
        React.Children.toArray(node.props.children),
      ),
    ).toContain("4 questions remaining. ");
    element("select").props.onChange!({ target: { value: "example-b" } });
    expect(
      elements(render()).some(
        (node) => node.props.href === answer.sources[0].url,
      ),
    ).toBe(false);
    expect(
      elements(render()).flatMap((node) =>
        React.Children.toArray(node.props.children),
      ),
    ).not.toContain("4 questions remaining. ");
    submit();
    await settled();
    expect(element(FailureNotice).props.failure?.retry).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).tenant).toBe(
      "example-b",
    );
    element("select").props.onChange!({ target: { value: "example-a" } });
    expect(elements(render()).some((node) => node.type === FailureNotice)).toBe(
      false,
    );
    expect(element("textarea").props.value).toBe(answer.question);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
