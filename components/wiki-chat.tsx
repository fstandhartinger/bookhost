"use client";
import Link from "next/link";
import { useState } from "react";
type Source = {
  pageId: number;
  pageName: string;
  section: string | null;
  url: string | null;
  excerpt: string;
};
type Answer = {
  question: string;
  answer: string;
  sources: Source[];
  refused: boolean;
  mode: "extractive" | "ai";
  terms?: string[];
  quota?: { remaining: number; limit: number } | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap the question's search terms wherever they appear, so hits stand out. */
function highlight(text: string, terms: string[] | undefined, keyPrefix: string) {
  if (!terms?.length) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const lookup = new Set(terms.map((term) => term.toLowerCase()));
  return text.split(pattern).map((part, index) =>
    lookup.has(part.toLowerCase()) ? (
      <mark key={`${keyPrefix}-${index}`} className="rounded bg-amber-100 px-0.5">
        {part}
      </mark>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{part}</span>
    ),
  );
}
export function WikiChat({
  tenants,
}: {
  tenants: { id: string; slug: string }[];
}) {
  const [tenant, setTenant] = useState(tenants[0].id);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, question }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Request failed. Please try again.");
      setResult(data);
      if (data.quota) setRemaining(data.quota.remaining);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 space-y-6">
      {tenants.length > 1 && (
        <label className="block">
          Workspace
          <select
            className="mt-2 block rounded border p-3"
            value={tenant}
            disabled={busy}
            onChange={(e) => {
              setResult(null);
              setTenant(e.target.value);
            }}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <form onSubmit={ask} className="price-card space-y-4">
        <label className="block text-sm font-medium">
          Your question
          <textarea
            className="mt-2 block min-h-24 w-full rounded-lg border p-3 text-sm"
            value={question}
            maxLength={500}
            required
            minLength={3}
            disabled={busy}
            placeholder="What is our process for…?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <p className="text-xs leading-5 text-slate-500">
          Answers come only from pages your workspace can already read, and name
          the page and section they use.{" "}
          {remaining !== null && `${remaining} questions remaining. `}
          <a href="/app" className="underline">
            Manage billing
          </a>
        </p>
        <p className="text-xs leading-5 text-amber-800">
          Beta restriction: our data processing agreement and transfer
          documentation with the AI provider are not complete yet. Until they
          are, ask only about non-personal example documents. See the{" "}
          <Link className="underline" href="/legal/datenschutz">
            privacy notice
          </Link>
          .
        </p>
        <button className="button" disabled={busy || question.trim().length < 3}>
          {busy ? "Reading your wiki…" : "Ask"}
        </button>
      </form>
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {busy && "Searching your wiki and collecting the matching pages…"}
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {result && (
        <div className="price-card space-y-5">
          <h2 className="text-2xl">Answer</h2>
          {result.mode === "extractive" && !result.refused && (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              AI-written summaries are not enabled yet: the provider agreement
              and transfer documents are still being completed. Until then
              BookHost assembles the matching sentences from your own pages,
              each with its source number, so every claim stays traceable.
            </p>
          )}
          <p className="whitespace-pre-wrap text-base leading-7">
            {result.answer.split(/(\[\d+\])/).map((part, index) => {
              const match = part.match(/^\[(\d+)\]$/);
              const source = match ? result.sources[Number(match[1]) - 1] : null;
              if (!source) return highlight(part, result.terms, `a-${index}`);
              return source.url ? (
                <a
                  key={index}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="align-super text-xs underline"
                  title={`${source.pageName}${source.section ? ` › ${source.section}` : ""}`}
                >
                  {part}
                </a>
              ) : (
                <span key={index} className="align-super text-xs">
                  {part}
                </span>
              );
            })}
          </p>
          {result.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Sources
              </h3>
              <ol className="mt-3 space-y-3">
                {result.sources.map((source, index) => (
                  <li key={`${source.pageId}-${index}`} className="text-sm">
                    <span className="font-medium">
                      [{index + 1}]{" "}
                      {source.url ? (
                        <a
                          className="underline"
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.pageName}
                        </a>
                      ) : (
                        source.pageName
                      )}
                    </span>
                    {source.section && (
                      <span className="text-slate-500"> › {source.section}</span>
                    )}
                    <p className="mt-1 text-slate-600">
                      {highlight(source.excerpt, result.terms, `s-${index}`)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {result.refused && (
            <p className="text-sm text-slate-500">
              No page in this workspace matched the question closely enough, so
              no answer was written.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
