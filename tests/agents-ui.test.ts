// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// E-mail intake settings are unrelated to agent proposals.
vi.mock("@/components/email-intake", () => ({ EmailIntake: () => null }));
import { Intake } from "@/components/intake";
import { AgentsPanel } from "@/components/agents-panel";

const tenants = [{ id: "tenant-a", slug: "example" }];
let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
type Route = (url: string, init?: RequestInit) => unknown;

function mockFetch(route: Route) {
  fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const result = route(String(input), init);
    if (result instanceof Response) return result;
    return Response.json(result ?? {});
  });
  vi.stubGlobal("fetch", fetcher);
}
function posts(url: string) {
  return fetcher.mock.calls
    .filter(([u, init]) => String(u) === url && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init!.body)));
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
}
async function click(element: Element | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function type(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function mount(element: React.ReactElement) {
  await act(async () => root.render(element));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("agent proposal review", () => {
  const proposal = {
    id: "item-1",
    filename: "Agent proposal: Onboarding",
    source: "agent",
    status: "draft",
    draft_title: "Onboarding",
    draft_html: "<h2>Welcome</h2><p>New section</p>",
    draft_tags: [],
    error: null,
    target_book_id: 1,
    target_chapter_id: null,
    target_book_name: "Handbook",
    target_chapter_name: null,
    source_metadata: {
      kind: "append",
      agent_name: "Docs bot",
      token_fingerprint: "ab12cd",
      page_id: 12,
      page_name: "Onboarding",
      note: "<b>Please</b> merge",
      proposed_at: "2026-09-26T10:00:00Z",
    },
    source_preview: "## Welcome\n\nNew section",
    can_publish: true,
    url: null,
    host: "example.bookhost.co",
  };
  beforeEach(() => {
    mockFetch((url) => {
      if (url.startsWith("/api/intake?tenant="))
        return {
          items: [proposal],
          books: [{ id: 1, name: "Handbook" }],
          chapters: [],
          quota: { remaining: 5 },
        };
      if (url === "/api/intake/item-1") return proposal;
      return {};
    });
  });

  it("shows the agent aside, hides editing and approves exactly the proposal", async () => {
    await mount(React.createElement(Intake, { tenants }));
    const item = Array.from(container.querySelectorAll("li button")).find((b) =>
      b.textContent?.includes("Agent · "),
    );
    await click(item);
    const text = container.textContent || "";
    expect(text).toContain("Proposed by an AI agent — Docs bot (token ab12cd)");
    expect(text).toContain("Append to Onboarding");
    // The untrusted note is plain text, never HTML.
    expect(text).toContain("<b>Please</b> merge");
    expect(container.querySelector("aside b")).toBeNull();
    expect(
      container.querySelector('a[href="https://example.bookhost.co/link/12"]'),
    ).toBeTruthy();
    expect(text).not.toContain("Destination book");
    expect(container.querySelector('[aria-label="Page HTML"]')).toBeNull();
    expect(container.querySelector('[role="textbox"]')).toBeNull();
    // Only the upload form's selects remain.
    expect(
      container.querySelectorAll(".price-card.min-w-0 select"),
    ).toHaveLength(0);
    expect(
      container.querySelector('[aria-label="Proposed page content"]')
        ?.innerHTML,
    ).toBe("<h2>Welcome</h2><p>New section</p>");
    expect(button("Publish to BookStack")).toBeUndefined();
    await click(button("Approve and apply"));
    expect(posts("/api/intake/item-1")).toEqual([{ action: "publish" }]);
  });
});

describe("agents panel", () => {
  const overview = () => ({
    workspace: {
      id: "tenant-a",
      host: "example.bookhost.co",
      mcp_url: "https://example.bookhost.co/mcp",
      llms_url: "https://example.bookhost.co/llms.txt",
    },
    settings: {
      write_mode: "propose",
      access_enabled: true,
      disabled_at: null,
    },
    agents: [],
    roles: [{ id: 3, name: "Editor", description: "" }],
    roles_error: null,
    activity: [
      {
        id: "1",
        tool: "read_page",
        target: "page:12",
        status: "ok",
        latency_ms: 42,
        created_at: "2026-09-26T10:00:00Z",
        token_fingerprint: "ffee00",
        agent_name: null,
      },
    ],
  });
  beforeEach(() => {
    mockFetch((url, init) => {
      if (url === "/api/agents" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.action === "create_agent")
          return Response.json(
            {
              agent: { id: "a1", name: body.name },
              token: "TOKENID:SECRET",
            },
            { status: 201 },
          );
        return { ok: true };
      }
      if (url.startsWith("/api/agents?tenant=")) return overview();
      return {};
    });
  });

  it("renders activity metadata with page links", async () => {
    await mount(React.createElement(AgentsPanel, { tenants }));
    expect(container.textContent).toContain("Own BookStack token ffee00");
    expect(
      container.querySelector('a[href="https://example.bookhost.co/link/12"]')
        ?.textContent,
    ).toBe("page:12");
  });

  it("shows the token once after create and hides it on dismiss and reload", async () => {
    await mount(React.createElement(AgentsPanel, { tenants }));
    const name = Array.from(container.querySelectorAll("input")).find(
      (i) => i.maxLength === 60,
    )!;
    await type(name, "Docs bot");
    await choose(
      container.querySelector('select[aria-describedby="agents-role-hint"]')!,
      "3",
    );
    await act(async () => {
      name.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(posts("/api/agents")).toEqual([
      {
        tenant: "tenant-a",
        action: "create_agent",
        name: "Docs bot",
        role_id: 3,
      },
    ]);
    expect(
      container.querySelector('[data-testid="agent-token"]')?.textContent,
    ).toBe("TOKENID:SECRET");
    expect(container.textContent).toContain(
      "Copy it now — BookHost cannot show it again.",
    );
    expect(container.textContent).toContain(
      'export BOOKHOST_TOKEN="TOKENID:SECRET"',
    );
    await click(button("I have copied the token"));
    expect(container.textContent).not.toContain("TOKENID:SECRET");

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(React.createElement(AgentsPanel, { tenants }));
    expect(container.textContent).not.toContain("TOKENID:SECRET");
  });

  it("kill switch asks for confirmation, then turns access off", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await mount(React.createElement(AgentsPanel, { tenants }));
    await click(button("Turn off all agent access"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(posts("/api/agents")).toEqual([]);
    confirm.mockReturnValue(true);
    await click(button("Turn off all agent access"));
    expect(posts("/api/agents")).toEqual([
      { tenant: "tenant-a", action: "set_access", enabled: false },
    ]);
  });
});
