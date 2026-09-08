import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
const names = ["impressum", "datenschutz", "agb", "avv"];
export function generateStaticParams() {
  return names.map((name) => ({ name }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return {
    title: names.includes(name)
      ? name.charAt(0).toUpperCase() + name.slice(1)
      : "Legal",
  };
}
export default async function Legal({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  if (!names.includes(name)) notFound();
  const markdown = await readFile(
    path.join(process.cwd(), "content", "legal", `${name}.md`),
    "utf8",
  );
  return (
    <article lang="de" className="legal">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href?.replace(
                /^(impressum|datenschutz|agb|avv)\.md$/,
                "/legal/$1",
              )}
            >
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
