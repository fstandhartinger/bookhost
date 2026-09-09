import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export async function LegalDocument({ name }: { name: string }) {
  const markdown = await readFile(
    path.join(process.cwd(), "content", "legal", `${name}.md`),
    "utf8",
  );
  return (
    <article lang="de" className="legal">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="legal-table" tabIndex={0} role="region" aria-label="Tabelle">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href?.replace(/^(impressum|datenschutz|agb|avv)\.md$/, "/legal/$1")}>
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
