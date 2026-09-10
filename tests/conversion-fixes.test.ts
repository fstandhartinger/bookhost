import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(path, "utf8");

describe("conversion guidance", () => {
  it("explains the trial path on the login page", async () => {
    expect(await source("app/login/page.tsx")).toContain("New to BookHost");
  });

  it("keeps a mobile-visible pricing link in the header", async () => {
    const layout = await source("app/layout.tsx");
    expect(layout).toMatch(
      /href="\/pricing"[\s\S]{0,180}className="(?!hidden)/,
    );
  });

  it("anchors the FAQ and links the restore checks from the landing page", async () => {
    const page = await source("app/page.tsx");
    expect(page).toContain('id="faq"');
    expect(page).toContain("/blog/how-we-test-every-bookstack-backup-restore");
  });

  it("sets expectations for Stripe billing details", async () => {
    const paymentNote = await source("components/payment-note.tsx");
    expect(paymentNote).toContain("No card needed");
    expect(paymentNote).toMatch(/billing\s+address/);
  });

  it("links the live demo host from the launch article", async () => {
    const article = await source(
      "content/blog/bookstack-hosted-with-reviewed-document-intake.md",
    );
    const { DEMO_URL } = await import("@/lib/config");
    // The article must link the demo that is actually served, never a stale host.
    expect(article).toContain(DEMO_URL);
    expect(article).not.toContain("demo.wissen.app.mintapis.com");
  });
});

it("warns on the upload panel that the AI beta is limited to non-personal documents", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile("components/intake.tsx", "utf8"),
  );
  expect(source).toContain("Beta restriction");
  expect(source).toMatch(/without personal data/);
  expect(source).toContain("/legal/datenschutz");
});

it("advertises the custom domain on pricing and in the FAQ", async () => {
  const fs = await import("node:fs/promises");
  const pricing = await fs.readFile("components/pricing.tsx", "utf8");
  const copy = await fs.readFile("lib/landing-copy.ts", "utf8");
  expect(pricing).toContain("Your own domain");
  expect(copy).toContain("Can we use our own domain?");
  expect(copy).toMatch(/bookhost\.co address keeps working/);
});
