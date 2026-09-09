import { blogOrigin, getPosts } from "../posts";

export const dynamic = "force-static";
function xml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}
export function GET() {
  const posts = getPosts();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>The Wissen blog</title><link>${blogOrigin}/blog</link>
<description>Hosted BookStack, reviewed document intake and practical operations.</description>
<language>en</language><atom:link href="${blogOrigin}/blog/feed.xml" rel="self" type="application/rss+xml"/>
${posts.map((post) => `<item><title>${xml(post.title)}</title><link>${blogOrigin}/blog/${post.slug}</link><guid isPermaLink="true">${blogOrigin}/blog/${post.slug}</guid><description>${xml(post.description)}</description><pubDate>${new Date(post.date).toUTCString()}</pubDate><dc:creator>${xml(post.author)}</dc:creator>${post.tags.map((tag) => `<category>${xml(tag)}</category>`).join("")}</item>`).join("\n")}
</channel></rss>`;
  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
