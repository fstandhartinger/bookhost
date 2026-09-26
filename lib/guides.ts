import type { Metadata } from "next";
import { PUBLIC_BASE_URL } from "@/lib/config";

/** Evergreen guides. Used by the guide pages, the sitemap, the footer and llms.txt. */
export const guides = [
  {
    slug: "bookstack-vs-confluence",
    short: "BookStack vs Confluence",
    title: "BookStack vs Confluence for small and medium teams",
    description:
      "BookStack vs Confluence for small teams: structure, editing, permissions, integrations, pricing model, data location and migration, with an honest verdict.",
  },
  {
    slug: "self-hosted-vs-managed-bookstack",
    short: "Self-hosted vs managed",
    title: "Self-hosted vs managed BookStack: an honest comparison",
    description:
      "Running BookStack yourself or paying for managed hosting? Compare updates, TLS, mail, backups, restore tests and time cost, with a checklist for self-hosters.",
  },
  {
    slug: "eu-hosted-team-wiki",
    short: "EU-hosted team wiki",
    title: "EU-hosted team wiki: what to check for GDPR",
    description:
      "Choosing an EU-hosted team wiki? Check hosting location, the data processing agreement, sub-processors, backup location, exports and deletion before signing.",
  },
  {
    slug: "bookstack-backup-guide",
    short: "BookStack backup guide",
    title: "How to back up and restore BookStack",
    description:
      "Back up and restore BookStack: database dump, uploads and attachments, the .env APP_KEY, LinuxServer paths, restore steps, restore tests and retention.",
  },
  {
    slug: "bookstack-mcp",
    short: "BookStack MCP for AI agents",
    title:
      "Give Claude, Cursor and ChatGPT access to your team wiki (BookStack MCP)",
    description:
      "Connect AI agents to a BookStack wiki over MCP: which clients work today, how permissions and review of agent edits work, and what still needs OAuth.",
  },
] as const;

export type GuideSlug = (typeof guides)[number]["slug"];

export const GUIDE_REVIEWED = "2026-09-26";

export function guide(slug: GuideSlug) {
  const found = guides.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`Unknown guide: ${slug}`);
  return found;
}

export function guideMetadata(slug: GuideSlug): Metadata {
  const { title, description } = guide(slug);
  const path = `/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      type: "article",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

/** Other guides plus the two operational pages every guide points to. */
export function relatedLinks(slug: GuideSlug) {
  return [
    ...guides
      .filter((entry) => entry.slug !== slug)
      .map((entry) => ({ href: `/${entry.slug}`, title: entry.title })),
    { href: "/migrate", title: "Move your existing BookStack to BookHost" },
    { href: "/reliability", title: "What happens to your data: backups and recovery" },
  ];
}

const organization = {
  "@type": "Organization",
  name: "BookHost",
  url: "https://bookhost.co",
};

export type Faq = { question: string; answer: string };

/** Article + BreadcrumbList, plus FAQPage when the page renders an FAQ. */
export function guideJsonLd(slug: GuideSlug, faqs?: readonly Faq[]) {
  const { title, description } = guide(slug);
  const url = `${PUBLIC_BASE_URL}/${slug}`;
  const data: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      datePublished: GUIDE_REVIEWED,
      dateModified: GUIDE_REVIEWED,
      author: organization,
      publisher: organization,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      image: `${PUBLIC_BASE_URL}/og.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: PUBLIC_BASE_URL },
        { "@type": "ListItem", position: 2, name: title, item: url },
      ],
    },
  ];
  if (faqs?.length) {
    data.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    });
  }
  return data;
}
