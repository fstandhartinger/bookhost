import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_URL } from "@/lib/config";
import type { Faq } from "@/lib/guides";

type RelatedLink = { href: string; title: string };

export function GuidePage({
  eyebrow,
  title,
  lede,
  updated,
  children,
  related,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  updated: string;
  children: ReactNode;
  related: RelatedLink[];
}) {
  const reviewed = new Date(`${updated}T00:00:00Z`).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  );
  return (
    <>
      <nav aria-label="Breadcrumb" className="mx-auto max-w-3xl px-6 pt-8 text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link className="text-moss underline" href="/">
              Home
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>Guides</li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-ink">
            {title}
          </li>
        </ol>
      </nav>
      <article className="section mx-auto max-w-3xl">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <p className="mt-5 text-sm text-muted">
          Last reviewed <time dateTime={updated}>{reviewed}</time>.
        </p>

        <div className="prose-guide mt-12">{children}</div>

        <section className="cta-panel mt-16" aria-labelledby="guide-cta-heading">
          <h2 id="guide-cta-heading">Try BookHost free for 14 days</h2>
          <p className="mt-4 text-muted">
            Get your own hosted BookStack workspace with daily backups and
            security updates handled for you; no card is needed for the trial.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="button" href="/pricing">
              Start free trial
            </Link>
            <a className="button-secondary" href={DEMO_URL}>
              Open live demo
            </a>
          </div>
        </section>

        <nav className="mt-16" aria-labelledby="related-guides-heading">
          <h2 id="related-guides-heading">Related guides</h2>
          <ul className="mt-5 space-y-3">
            {related.map((link) => (
              <li key={link.href}>
                <Link className="text-moss underline" href={link.href}>
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>
    </>
  );
}

/** Visible FAQ; pass the same array to guideJsonLd for the FAQPage markup. */
export function GuideFaq({ faqs }: { faqs: readonly Faq[] }) {
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading">Frequently asked questions</h2>
      {faqs.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </div>
      ))}
    </section>
  );
}

export function GuideSources({
  sources,
}: {
  sources: readonly { href: string; label: string }[];
}) {
  return (
    <section aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      <p className="text-sm text-muted">
        Third-party details were checked against these pages on 25 September
        2026. Vendors change plans and features, so check the current version
        before you decide.
      </p>
      <ul>
        {sources.map((source) => (
          <li key={source.href}>
            <a className="text-moss underline" href={source.href} rel="noopener">
              {source.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
