import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const blogOrigin = "https://bookhost.co";
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  content: string;
  readingMinutes: number;
};

// Frontmatter uses YAML's JSON-compatible strings/arrays, with no extra parser.
export function getPosts(): BlogPost[] {
  const directory = path.join(process.cwd(), "content/blog");
  return readdirSync(directory)
    .filter((file) => /^[a-z0-9-]+\.md$/.test(file))
    .map((file) => {
      const source = readFileSync(path.join(directory, file), "utf8");
      const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`Missing blog frontmatter: ${file}`);
      const fields: Record<string, unknown> = {};
      for (const line of match[1].split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator < 1) throw new Error(`Invalid blog frontmatter: ${file}`);
        fields[line.slice(0, separator)] = JSON.parse(
          line.slice(separator + 1),
        );
      }
      for (const field of ["title", "description", "date", "author"]) {
        if (typeof fields[field] !== "string" || !fields[field])
          throw new Error(`Invalid ${field}: ${file}`);
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(fields.date as string) ||
        !Number.isFinite(Date.parse(fields.date as string)) ||
        !Array.isArray(fields.tags) ||
        !fields.tags.every((tag) => typeof tag === "string")
      )
        throw new Error(`Invalid date or tags: ${file}`);
      const content = match[2].trim();
      return {
        slug: file.slice(0, -3),
        title: fields.title as string,
        description: fields.description as string,
        date: fields.date as string,
        author: fields.author as string,
        tags: fields.tags as string[],
        content,
        readingMinutes: Math.max(
          1,
          Math.ceil(content.split(/\s+/).length / 220),
        ),
      };
    })
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
    );
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}
