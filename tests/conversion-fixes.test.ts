import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PaymentNote } from "@/components/payment-note";

const source = (path: string) => readFile(path, "utf8");

describe("conversion guidance", () => {
  it("explains the trial path on the login page", async () => {
    expect(await source("app/login/page.tsx")).toContain("New to BookHost");
  });

  it("keeps a mobile-visible pricing link in the header", async () => {
    const layout = await source("app/layout.tsx");
    expect(layout).toMatch(/href="\/pricing"[\s\S]{0,180}className="(?!hidden)/);
  });

  it("anchors the FAQ and links the restore checks from the landing page", async () => {
    const page = await source("app/page.tsx");
    expect(page).toContain('id="faq"');
    expect(page).toContain("/blog/how-we-test-every-bookstack-backup-restore");
  });

  it("sets expectations for Stripe billing details", () => {
    const markup = renderToStaticMarkup(createElement(PaymentNote));
    expect(markup).toContain("No card needed");
    expect(markup).toContain("billing address");
  });

  it("uses the configured demo domain in the launch article", async () => {
    expect(
      await source("content/blog/bookstack-hosted-with-reviewed-document-intake.md"),
    ).not.toContain("demo.bookhost.co");
  });
});
