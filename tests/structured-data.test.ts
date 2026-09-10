import { readFileSync } from "node:fs";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import sanitizeHtml from "sanitize-html";

vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
const state = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: state.auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("404"); } }));
vi.mock("next/font/google", () => ({ Inter: () => ({ className: "font" }) }));
vi.mock("@/lib/analytics/beacon", () => ({ default: () => null }));
vi.mock("@/lib/join-context", () => ({ ACTIVE_TEAM_COOKIE: "team", loginDestination: async () => "/app" }));
vi.mock("@/components/password-login", () => ({ PasswordLogin: () => null }));
vi.mock("@/components/onboarding-checklist", () => ({ OnboardingChecklist: () => null }));
vi.mock("@/components/team-panel", () => ({ TeamPanel: () => null }));
vi.mock("@/components/password-form", () => ({ PasswordForm: () => null }));
vi.mock("@/components/tenant-form", () => ({ TenantForm: () => null, RevealPassword: () => null }));
vi.mock("@/components/refresh-status", () => ({ RefreshStatus: () => null }));
vi.mock("@/lib/invoice-preview", () => ({ invoicePreview: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ markNoticeRead: vi.fn() }));

import Home from "@/app/page";
import Layout, { metadata } from "@/app/layout";
import Blog from "@/app/blog/page";
import BlogArticle, { generateMetadata } from "@/app/blog/[slug]/page";
import Login from "@/app/login/page";
import Dashboard from "@/app/app/page";
import sitemap from "@/app/sitemap";
import { getPosts, blogOrigin } from "@/app/blog/posts";
import { PLAN, PRODUCT_NAME, PUBLIC_BASE_URL } from "@/lib/config";
import { faqs } from "@/lib/landing-copy";

vi.stubGlobal("React", React);

function schemas(node: ReactNode) {
  const html = renderToStaticMarkup(createElement(Layout, null, node));
  return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((match) => JSON.parse(match[1]));
}
function nonempty(value: unknown) {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  if (typeof value === "string") expect(value.trim()).not.toBe("");
  else if (typeof value === "object") Object.values(value!).forEach(nonempty);
}
function organization(value: Record<string, unknown>) {
  expect(value).toMatchObject({ "@type": "Organization", url: PUBLIC_BASE_URL,
    legalName: "productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG",
    address: { "@type": "PostalAddress", streetAddress: "Reichenbergerstr. 2", postalCode: "94036", addressLocality: "Passau", addressCountry: "DE" } });
  const legal = readFileSync("content/legal/impressum.md", "utf8");
  expect(legal).toContain(value.legalName);
  nonempty(value);
}
it("renders the configured monthly net offer and legal provider as valid JSON-LD", () => {
  const all = schemas(Home());
  expect(all).toHaveLength(2);
  const app = all.find((item) => item["@type"] === "SoftwareApplication");
  expect(app).toMatchObject({ "@context": "https://schema.org", name: PRODUCT_NAME,
    applicationCategory: "BusinessApplication", operatingSystem: "Web", url: PUBLIC_BASE_URL,
    description: metadata.description,
    offers: { "@type": "Offer", price: PLAN.price, priceCurrency: PLAN.currency,
      priceSpecification: { "@type": "UnitPriceSpecification", price: PLAN.price,
        priceCurrency: PLAN.currency, valueAddedTaxIncluded: false, billingIncrement: 1,
        unitCode: "MON", unitText: "month", referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" } } } });
  organization(app.provider);
  expect(app.publisher).toEqual(app.provider);
  nonempty(app);
});
it("renders exactly the existing FAQ questions and answers as text", () => {
  const faq = schemas(Home()).find((item) => item["@type"] === "FAQPage");
  expect(faq).toBeDefined();
  expect(faq["@context"]).toBe("https://schema.org");
  expect(faq.mainEntity).toEqual(faqs.map(([q, a]) => ({ "@type": "Question",
    name: sanitizeHtml(q, { allowedTags: [], allowedAttributes: {} }),
    acceptedAnswer: { "@type": "Answer", text: sanitizeHtml(a, { allowedTags: [], allowedAttributes: {} }) } })));
  nonempty(faq);
});
it.each(getPosts())("renders BlogPosting from $slug frontmatter", async (post) => {
  const params = Promise.resolve({ slug: post.slug });
  const all = schemas(await BlogArticle({ params }));
  expect(all).toHaveLength(1);
  const [data] = all;
  const frontmatter = Object.fromEntries(readFileSync(`content/blog/${post.slug}.md`, "utf8")
    .split("---")[1].trim().split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), JSON.parse(line.slice(colon + 1))];
    }));
  expect(data).toMatchObject({ "@context": "https://schema.org", "@type": "BlogPosting",
    headline: frontmatter.title, description: frontmatter.description,
    datePublished: `${frontmatter.date}T00:00:00Z`, dateModified: `${frontmatter.date}T00:00:00Z`,
    author: { "@type": "Person", name: frontmatter.author },
    mainEntityOfPage: { "@type": "WebPage", "@id": (await generateMetadata({ params })).alternates?.canonical } });
  organization(data.publisher);
  nonempty(data);
});
it("lists exactly the published posts on /blog", () => {
  const all = schemas(Blog());
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ "@context": "https://schema.org", "@type": "Blog",
    blogPost: getPosts().map((post) => ({ headline: post.title, url: `${blogOrigin}/blog/${post.slug}` })) });
  all[0].blogPost.forEach((post: object) => expect(Object.keys(post).sort()).toEqual(["headline", "url"]));
  nonempty(all[0]);
});
it("uses frontmatter dates in the sitemap and omits unknown static modification dates", () => {
  const entries = sitemap();
  for (const post of getPosts()) {
    expect(entries.find((entry) => entry.url === `${blogOrigin}/blog/${post.slug}`)?.lastModified).toBe(post.date);
  }
  entries.filter((entry) => !getPosts().some((post) => entry.url.endsWith(`/blog/${post.slug}`)))
    .forEach((entry) => expect(entry.lastModified).toBeUndefined());
});
it("does not leak JSON-LD through the layout onto /login or /app", async () => {
  state.auth.mockResolvedValue(null);
  expect(schemas(await Login({ searchParams: Promise.resolve({}) }))).toEqual([]);
  state.auth.mockResolvedValue({ user: { id: "test", email: "test@example.invalid" } });
  expect(schemas(await Dashboard({ searchParams: Promise.resolve({}) }))).toEqual([]);
});
