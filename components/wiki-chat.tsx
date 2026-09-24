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


const MAX_EARLIER_TURNS = 10;

type EarlierTurn = { id: number; answer: Answer };

function answerBody(result: Answer) {
  return (
    <>
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
          No page in this workspace matched the question closely enough, so no
          answer was written.
        </p>
      )}
    </>
  );
}

function SuggestedQuestions({
  tenant,
  busy,
  onPick,
}: {
  tenant: string;
  busy: boolean;
  onPick: (question: string) => void;
}) {
  const [questions, setQuestions] = useState<string[]>([]);
  React.useEffect(() => {
    let active = true;
    setQuestions([]);
    void (async () => {
      try {
        const response = await fetch(
          `/api/chat/suggestions?tenant=${encodeURIComponent(tenant)}`,
        );
        const data = response.ok ? await response.json() : null;
        const list = Array.isArray(data?.questions)
          ? data.questions.filter(
              (item: unknown): item is string => typeof item === "string",
            )
          : [];
        if (active) setQuestions(list.slice(0, 4));
      } catch {
        if (active) setQuestions([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);
  if (busy || questions.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-500">Try asking</p>
      <div className="flex flex-wrap gap-2">
        {questions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="rounded-full border px-3 py-1 text-sm"
            aria-label={`Ask: ${suggestion}`}
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
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
  const [turns, setTurns] = useState<EarlierTurn[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [stopped, setStopped] = useState(false);
  const inflight = useRef(createInflightGuard());
  const abortRef = useRef<AbortController | null>(null);
  const turnId = useRef(0);
  async function submit(value: string = question) {
    if (!inflight.current.enter()) return;
    setFailure(null);
    setStopped(false);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const outcome = await requestAnswer(
        fetch,
        { tenant, question: value },
        controller.signal,
      );
      if (abortRef.current !== controller) return;
      if (outcome.ok) {
        if (result) {
          setTurns(
            [{ id: turnId.current++, answer: result }, ...turns].slice(
              0,
              MAX_EARLIER_TURNS,
            ),
          );
        }
        setResult(outcome.answer);
        if (outcome.answer.quota) setRemaining(outcome.answer.quota.remaining);
      } else if (!("cancelled" in outcome)) {
        setFailure(outcome.failure);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        inflight.current.leave();
        setBusy(false);
      }
    }
  }
  function stop() {
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
    inflight.current.leave();
    setBusy(false);
    setStopped(true);
  }
  function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }
  function askSuggestion(value: string) {
    setQuestion(value);
    void submit(value);
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
              setTurns([]);
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
      <SuggestedQuestions tenant={tenant} busy={busy} onPick={askSuggestion} />
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
          Beta restriction: the final approval of the updated processing
          conditions is still pending. Until then, ask only about non-personal
          example documents. See the{" "}
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
        {busy && (
          <button type="button" className="button" onClick={stop}>
            Stop
          </button>
        )}
      </form>
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {busy
          ? "Searching your wiki and collecting the matching pages…"
          : stopped
            ? "Stopped. Your question is still in the box — edit it or ask again."
            : ""}
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
              AI-written summaries are switched off in this deployment. Until
              they are switched on, BookHost assembles the matching sentences
              from your own pages, each with its source number, so every claim
              stays traceable.
            </p>
          )}
          {answerBody(result)}
        </div>
      )}
      {turns.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl">Earlier in this session</h2>
          {turns.map((turn) => (
            <details key={turn.id} className="price-card">
              <summary className="cursor-pointer font-medium">
                {turn.answer.question}
              </summary>
              <div className="mt-3 space-y-5">{answerBody(turn.answer)}</div>
            </details>
          ))}
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setTurns([])}
          >
            Clear earlier questions
          </button>
        </section>
      )}
    </div>
  );
}
