import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MigrationPage from "@/app/migrate/page";
import RootLayout from "@/app/layout";
import { faqs } from "@/lib/landing-copy";
import sitemap from "@/app/sitemap";

describe("migration marketing page", () => {
  it("renders all five migration sections and both dump commands", () => {
    const html = renderToStaticMarkup(<MigrationPage />);
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
    const html = renderToStaticMarkup(<MigrationPage />).toLowerCase();
    for (const forbidden of [
      "guaranteed",
      "zero downtime",
      "instant",
      "any size",
      "sla",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("includes the migration link in the site footer", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>fixture</p>
      </RootLayout>,
    );
    expect(html).toContain('href="/migrate"');
  });
});
