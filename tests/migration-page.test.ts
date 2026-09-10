import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }));
(globalThis as { React?: typeof React }).React = React;
import MigrationPage from "@/app/migrate/page";
import RootLayout from "@/app/layout";
import { faqs } from "@/lib/landing-copy";
import sitemap from "@/app/sitemap";

describe("migration marketing page", () => {
  it("renders all five migration sections and both dump commands", () => {
    const html = renderToStaticMarkup(createElement(MigrationPage));
    for (const heading of [
      "What you send us",
      "What we do",
      "What you check afterwards",
      "Timing and switch-over",
      "What we do not migrate today",
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("mysqldump");
    expect(html).toContain("mariadb-dump");
  });

  it("links the migration FAQ to /migrate", () => {
    const migrationFaq = faqs.find(([question]) =>
      question.includes("migrate"),
    );
    expect(migrationFaq?.join(" ")).toContain("/migrate");
  });

  it("lists /migrate in the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://wissen.app.mintapis.com/migrate",
    );
  });

  it("keeps unsupported promises out of the page", () => {
    const text = renderToStaticMarkup(createElement(MigrationPage))
      .replace(/<[^>]*>/g, " ")
      .toLowerCase();
    for (const forbidden of [
      "guaranteed",
      "zero downtime",
      "instant",
      "any size",
      "sla",
    ]) {
      expect(text).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it("includes the migration link in the site footer", () => {
    const html = renderToStaticMarkup(
      createElement(RootLayout, null, createElement("p", null, "fixture")),
    );
    expect(html).toContain('href="/migrate"');
  });
});
