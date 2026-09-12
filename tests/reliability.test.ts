import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import PricingPage from "@/app/pricing/page";
import sitemap from "@/app/sitemap";
import { baseUrl } from "@/lib/config";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

// Resolve at test time so a missing route produces individual RED failures.
const route = "../app/reliability/page";
const loadPage = () => import(route);
const html = async () =>
  renderToStaticMarkup(createElement((await loadPage()).default));
const section = (markup: string, id: string) => {
  const match = markup.match(
    new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`),
  );
  expect(match, `Missing section ${id}`).not.toBeNull();
  return match![1];
};

describe("public reliability evidence", () => {
  it("renders the page with all four sections", async () => {
    const markup = await html();
    expect(markup).toContain("What happens to your data");
    for (const [id, heading] of [
      ["backups", "What we back up, and how often"],
      ["restore-checks", "How we check a restore"],
      ["recovery", "When something goes wrong"],
      ["limits", "What we do not promise today"],
    ])
      expect(section(markup, id)).toContain(heading);
    expect(markup.match(/<h2[ >]/g)).toHaveLength(4);
  });

  it("dates the restore evidence and preserves the first test's HTTP gap", async () => {
    const checks = section(await html(), "restore-checks");
    expect(checks).toMatch(/datetime="2026-09-09"/i);
    expect(checks).toContain(
      "HTTP retrieval was not verified in this first test",
    );
    for (const proof of ["byte-for-byte", "SHA-256", "HTTP 200", "21 files"])
      expect(checks).toContain(proof);
  });

  // The cancellation route is legally required to be easy to find. It lives in
  // the footer; leaving it out of the sitemap made it the one public page search
  // engines were never told about.
  it("lists the cancellation route in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${baseUrl()}/cancel`);
    expect(urls).toContain(`${baseUrl()}/legal/agb`);
  });

  // The wiki chat beta reaches the same external model without any upload, so
  // "without an upload nothing goes to Chutes" stopped being true the night it
  // shipped. Both pages must say what actually leaves the workspace.
  it("says that the wiki chat beta also sends passages to the external model", async () => {
    const reliability = readFileSync("app/reliability/page.tsx", "utf8");
    expect(reliability).not.toContain("this feature sends nothing to Chutes");
    expect(reliability).toContain("it needs no upload");
    expect(reliability).toContain("without personal data");
    const home = readFileSync("app/page.tsx", "utf8");
    // JSX wraps the sentence across lines; compare on the collapsed text.
    const flat = home.replace(/\s+/g, " ");
    expect(flat).toContain("to the same external model as intake");
    expect(flat).toContain("use them only on workspaces without personal data");
  });

  // A customer reading both pages found the contradiction before we did: the
  // hero sold the beta as available while /reliability told them to keep real
  // data out of it. Whichever way that is resolved, the two must agree.
  it("carries the intake data-protection caveat where the beta is advertised", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toContain("Document intake (beta) available now.");
    expect(page).toContain("use non-personal example documents only");
    expect(page).toContain('href="/reliability#limits"');
    const reliability = readFileSync("app/reliability/page.tsx", "utf8");
    expect(reliability).toContain("non-personal example documents");
    expect(reliability).toContain('id="limits"');
  });

  // The rotation is our only claim no competitor makes, so it has to survive
  // edits — and it must not quietly grow into "we check every backup".
  it("states the nightly rotation together with the limit that it is a rotation", async () => {
    const checks = section(await html(), "restore-checks");
    expect(checks).toMatch(/datetime="2026-09-11"/i);
    expect(checks).toContain("scheduled nightly");
    expect(checks).toContain(
      "rotation, not a check of every backup of every workspace every night",
    );
    const post = readFileSync(
      "content/blog/how-we-test-every-bookstack-backup-restore.md",
      "utf8",
    );
    expect(post).toContain("It is now scheduled nightly");
    expect(post).toContain(
      "not a check of every backup of every workspace every night",
    );
  });

  it("links from the landing backup benefit alongside the existing blog link", () => {
    const markup = renderToStaticMarkup(createElement(Home));
    const benefit = markup.match(
      /<article[^>]*>(?:(?!<\/article>)[\s\S])*Backups with a way back[\s\S]*?<\/article>/,
    )?.[0];
    expect(benefit).toContain('href="/reliability"');
    expect(benefit).toContain(
      'href="/blog/how-we-test-every-bookstack-backup-restore"',
    );
  });

  it("links from Daily backups on the pricing page alongside the blog", async () => {
    const markup = renderToStaticMarkup(
      await PricingPage({ searchParams: Promise.resolve({}) }),
    );
    const item = markup.match(/<li>Daily backups[\s\S]*?<\/li>/)?.[0];
    expect(item).toContain('href="/reliability"');
    expect(item).toContain(
      'href="/blog/how-we-test-every-bookstack-backup-restore"',
    );
  });

  it("links from the shared footer", () => {
    const footer = readFileSync("app/layout.tsx", "utf8").split("<footer")[1];
    expect(footer).toContain('href="/reliability"');
  });

  it("includes the public canonical URL in the sitemap", () => {
    expect(sitemap().map(({ url }) => url)).toContain(
      `${baseUrl()}/reliability`,
    );
  });

  it("avoids unsupported marketing claims in visible text and metadata", async () => {
    const text =
      (await html()).replace(/<[^>]*>/g, " ") +
      JSON.stringify((await loadPage()).metadata);
    for (const forbidden of [
      "99.9",
      "99,9",
      "guaranteed uptime",
      "SLA",
      "ISO 27001",
      "bank-level",
      "military-grade",
    ])
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("states the current backup location, missing second copy and availability limit", async () => {
    const limits = section(await html(), "limits");
    expect(limits).toContain("same server as the workspaces");
    expect(limits).toContain(
      "A copy at a second location is in preparation and is not yet in operation",
    );
    expect(limits).toContain(
      "We do not offer a contractual availability commitment",
    );
  });

  it("labels the live upload beta and explains the actual data transfer", async () => {
    const limits = section(await html(), "limits");
    expect(limits).toContain("Document intake is available in beta");
    expect(limits).not.toContain("AI processing remains disabled");
    expect(limits).toContain("Each upload sends extracted text, not the original file, to Chutes");
    // The "without an upload nothing is sent" sentence was removed when the
    // wiki chat beta made it untrue. What has to stay is what is actually sent.
    expect(limits).not.toContain("Without an upload");
    expect(limits).toContain("it needs no upload");
    expect(limits).toContain('href="/legal/datenschutz"');
  });

  it("provides page-specific title, description, canonical and Open Graph", async () => {
    const { metadata } = await loadPage();
    expect(metadata.title).toBe("What happens to your data");
    expect(metadata.description).toMatch(/backups.*restore.*limits/i);
    expect(metadata.alternates.canonical).toBe(`${baseUrl()}/reliability`);
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      url: metadata.alternates.canonical,
      type: "website",
    });
    expect(metadata.openGraph.images).toContain("/og.png");
  });
});
