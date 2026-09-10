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
    expect(limits).toContain("Without an upload");
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
