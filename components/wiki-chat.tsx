"use client";
import Link from "next/link";
import React, { useRef, useState } from "react";
import {
  createInflightGuard,
  requestAnswer,
  type ChatAnswer as Answer,
  type ChatFailure,
} from "@/lib/chat/client-error";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap the question's search terms wherever they appear, so hits stand out. */
function highlight(
  text: string,
  terms: string[] | undefined,
  keyPrefix: string,
) {
  if (!terms?.length) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const lookup = new Set(terms.map((term) => term.toLowerCase()));
  return text.split(pattern).map((part, index) =>
    lookup.has(part.toLowerCase()) ? (
      <mark
        key={`${keyPrefix}-${index}`}
        className="rounded bg-amber-100 px-0.5"
      >
        {part}
      </mark>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{part}</span>
    ),
  );
}

export function FailureNotice({
  failure,
  busy,
  onRetry,
}: {
  failure: ChatFailure;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl bg-red-50 p-4 text-red-800"
    >
      <p>{failure.message}</p>
      {(failure.link || failure.retry) && (
        <p className="flex flex-wrap gap-x-4">
          {failure.link && (
            <a className="underline" href={failure.link.href}>
              {failure.link.label}
            </a>
          )}
          {failure.retry && (
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
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
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const inflight = useRef(createInflightGuard());
  async function submit() {
    if (!inflight.current.enter()) return;
    setFailure(null);
    setBusy(true);
    setResult(null);
    try {
      const outcome = await requestAnswer(fetch, { tenant, question });
      if (outcome.ok) {
        setResult(outcome.answer);
        if (outcome.answer.quota) setRemaining(outcome.answer.quota.remaining);
      } else {
        setFailure(outcome.failure);
      }
    } finally {
      inflight.current.leave();
      setBusy(false);
    }
  }
  function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }
  function retry() {
    if (failure?.retry) void submit();
  }
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    ) {
      event.preventDefault();
      if (!busy && question.trim().length >= 3) {
        event.currentTarget.form?.requestSubmit();
      }
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
              setFailure(null);
              setRemaining(null);
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
            onKeyDown={handleKeyDown}
          />
        </label>
        <p className="text-xs text-slate-500">
          Press Enter to ask · Shift+Enter for a new line
        </p>
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
        <button
          className="button"
          disabled={busy || question.trim().length < 3}
        >
          {busy ? "Reading your wiki…" : "Ask"}
        </button>
      </form>
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {busy && "Searching your wiki and collecting the matching pages…"}
      </p>
      {failure && (
        <FailureNotice failure={failure} busy={busy} onRetry={retry} />
      )}
      {result && (
        <div className="price-card space-y-5">
          <h2 className="flex items-center gap-2 text-2xl">
            Answer
            {result.retrieval === "hybrid" && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                semantic search
              </span>
            )}
          </h2>
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
              const source = match
                ? result.sources[Number(match[1]) - 1]
                : null;
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
                      <span className="text-slate-500">
                        {" "}
                        › {source.section}
                      </span>
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
