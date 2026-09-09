import type { Metadata } from "next";
import Link from "next/link";
import { blogOrigin, formatDate, getPosts } from "./posts";

const title = "The BookHost blog";
const description =
  "Practical notes on hosted BookStack, reviewed document intake and the work behind reliable team knowledge.";
export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: `${blogOrigin}/blog`,
    types: { "application/rss+xml": `${blogOrigin}/blog/feed.xml` },
  },
  openGraph: {
    title,
    description,
    type: "website",
    url: `${blogOrigin}/blog`,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function Blog() {
  return (
    <section className="section mx-auto max-w-3xl">
      <p className="eyebrow">NOTES FROM BOOKHOST</p>
      <h1>The BookHost blog</h1>
      <p className="lede">
        Practical notes on BookStack, thoughtful document review and the work
        behind your team’s wiki.
      </p>
      <a
        href="/blog/feed.xml"
        className="mt-6 inline-block text-sm text-moss underline"
      >
        Subscribe via RSS ↗
      </a>
      <div className="mt-12 space-y-6">
        {getPosts().map((post) => (
          <article
            key={post.slug}
            className="rounded-2xl border border-ink/15 bg-white p-6 sm:p-8"
          >
            <p className="text-sm text-slate-600">
              <time dateTime={post.date}>{formatDate(post.date)}</time> ·{" "}
              {post.readingMinutes} min read
            </p>
            <h2 className="mt-3 text-2xl md:text-3xl">
              <Link className="hover:underline" href={`/blog/${post.slug}`}>
                {post.title}
              </Link>
            </h2>
            <p className="mt-4 leading-relaxed text-slate-600">
              {post.description}
            </p>
            <p className="mt-4 text-sm text-slate-600">By {post.author}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span className="badge" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href={`/blog/${post.slug}`}
              className="mt-6 inline-block text-sm font-semibold text-moss"
            >
              Read article <span aria-hidden="true">↗</span>
              <span className="sr-only">: {post.title}</span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
