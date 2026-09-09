import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BlogCta from "@/components/blog-cta";
import { blogOrigin, formatDate, getPosts } from "../posts";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return getPosts().map(({ slug }) => ({ slug }));
}
async function getPost(params: Props["params"]) {
  const { slug } = await params;
  const post = getPosts().find((entry) => entry.slug === slug);
  if (!post) notFound();
  return post;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost(params);
  const url = `${blogOrigin}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author }],
    alternates: {
      canonical: url,
      types: { "application/rss+xml": `${blogOrigin}/blog/feed.xml` },
    },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      publishedTime: `${post.date}T00:00:00Z`,
      authors: [post.author],
      tags: post.tags,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "BookHost — hosted BookStack with reviewed document intake",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: ["/og.png"],
    },
  };
}
export default async function BlogArticle({ params }: Props) {
  const post = await getPost(params);
  const url = `${blogOrigin}/blog/${post.slug}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: `${post.date}T00:00:00Z`,
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: "BookHost", url: blogOrigin },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    image: `${blogOrigin}/og.png`,
    inLanguage: "en",
    keywords: post.tags.join(", "),
  };
  return (
    <div className="mx-auto max-w-3xl py-12 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
      <Link className="text-sm text-moss underline" href="/blog">
        ← All articles
      </Link>
      <article>
        <header className="mt-8">
          <div className="mb-5 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
          <h1 className="break-words text-4xl md:text-5xl">{post.title}</h1>
          <p className="mt-6 text-sm leading-relaxed text-slate-600">
            By {post.author} ·{" "}
            <time dateTime={post.date}>{formatDate(post.date)}</time> ·{" "}
            {post.readingMinutes} min read
          </p>
        </header>
        <div className="legal py-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div
                  className="legal-table"
                  tabIndex={0}
                  role="region"
                  aria-label="Article table"
                >
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {post.content}
          </ReactMarkdown>
        </div>
      </article>
      <BlogCta />
    </div>
  );
}
