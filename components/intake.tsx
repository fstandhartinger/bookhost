"use client";
import { useCallback, useEffect, useState } from "react";
import { EmailSource, type EmailMetadata } from "./intake-email-source";
import { EmailIntake } from "./email-intake";
import { cleanHtml } from "@/lib/intake/html";
import type { Destination } from "@/lib/intake/bookstack";
type Item = {
  id: string;
  filename: string;
  source?: string;
  status: string;
  draft_title: string;
  error?: string;
};
type Review = Item & {
  source_metadata?: EmailMetadata;
  target_book_id: number;
  target_chapter_id: number | null;
  target_book_name: string;
  target_chapter_name: string | null;
  source_preview: string;
  draft_html: string;
  draft_tags: string[];
  can_publish: boolean;
  url: string | null;
};
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}
export function Intake({
  tenants,
}: {
  tenants: { id: string; slug: string }[];
}) {
  const [tenant, setTenant] = useState(tenants[0].id);
  const [items, setItems] = useState<Item[]>([]);
  const [books, setBooks] = useState<Destination[]>([]);
  const [chapters, setChapters] = useState<Destination[]>([]);
  const [book, setBook] = useState("");
  const [newBookName, setNewBookName] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [targetBook, setTargetBook] = useState("");
  const [targetChapter, setTargetChapter] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const data = await api(`/api/intake?tenant=${tenant}`);
    setItems(data.items);
    setRemaining(data.quota.remaining);
    if (data.destination_error) setError(data.destination_error);
    setBooks(data.books);
    setChapters(data.chapters);
    setBook((current) =>
      current === "new" ||
      data.books.some((b: Destination) => String(b.id) === current)
        ? current
        : String(data.books[0]?.id || "new"),
    );
  }, [tenant]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReview(null);
    setError("");
    refresh()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        items.some((i) => ["queued", "drafting", "approved"].includes(i.status))
      ) {
        void refresh().catch(() => {});
        if (
          review &&
          ["queued", "drafting", "approved"].includes(review.status)
        )
          void open(review.id).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [items, review, refresh]);
  async function open(id: string) {
    const data = await api(`/api/intake/${id}`);
    setReview(data);
    setTargetBook(String(data.target_book_id));
    setTargetChapter(String(data.target_chapter_id || ""));
    setTitle(data.draft_title || "");
    setHtml(data.draft_html || "");
    setTags((data.draft_tags || []).join(", "));
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setBusy("Uploading your document…");
    try {
      const data = await api(`/api/intake?tenant=${tenant}`, {
        method: "POST",
        body: new FormData(form),
      });
      await open(data.id);
      await refresh();
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function decide(action: "publish" | "reject") {
    setReviewError("");
    if (!review) return;
    setBusy(
      action === "publish" ? "Publishing to BookStack…" : "Rejecting draft…",
    );
    setError("");
    try {
      await api(`/api/intake/${review.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          title,
          html,
          book_id: Number(targetBook),
          chapter_id: targetChapter ? Number(targetChapter) : null,
        }),
      });
      await open(review.id);
      await refresh();
    } catch (e) {
      setReviewError((e as Error).message);
      await open(review.id).catch(() => {});
    } finally {
      setBusy("");
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
            disabled={!!busy || loading}
            onChange={(e) => {
              setBook("");
              setNewBookName("");
              setBooks([]);
              setItems([]);
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
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {busy ||
          (loading
            ? "Loading your workspace…"
            : "1. Upload → 2. Review → 3. Publish")}
      </p>
      <EmailIntake key={tenant} tenant={tenant} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-6">
          <form onSubmit={upload} className="price-card space-y-5">
            <h2 className="text-xl">1. Upload a document</h2>
            <p className="text-sm">
              {remaining} drafts remaining ·{" "}
              <a href="/app" className="underline">
                Manage billing
              </a>
            </p>
            <fieldset disabled={!!busy || loading} className="space-y-5">
              <input type="hidden" name="tenant_id" value={tenant} />
              <label className="block text-sm font-medium">
                Document
                <input
                  className="mt-2 block w-full text-sm"
                  type="file"
                  name="file"
                  accept=".pdf,.docx,.md,.txt"
                  onChange={(e) =>
                    setNewBookName(
                      (e.target.files?.[0]?.name || "")
                        .replace(/\.[^.]+$/, "")
                        .slice(0, 255),
                    )
                  }
                  required
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                PDF, DOCX, Markdown or TXT · up to 10 MB and 60,000 characters.
                Text is sent to Chutes for AI drafting and stored for review.
                The original file is not retained. Scanned PDFs need OCR first.
              </p>
              <label className="block text-sm font-medium">
                Book
                <select
                  className="mt-2 block w-full rounded-lg border p-3"
                  name="book_id"
                  value={book}
                  onChange={(e) => setBook(e.target.value)}
                  required
                >
                  <option value="new">Create a new book…</option>
                  {books.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {book === "new" && (
                <label className="block text-sm font-medium">
                  New book name
                  <input
                    name="new_book_name"
                    value={newBookName}
                    onChange={(e) => setNewBookName(e.target.value)}
                    maxLength={255}
                    placeholder="Defaults to the document filename"
                    className="mt-2 block w-full rounded-lg border p-3"
                  />
                </label>
              )}
              <label className="block text-sm font-medium">
                Chapter (optional)
                <select
                  key={book}
                  className="mt-2 block w-full rounded-lg border p-3"
                  name="chapter_id"
                  disabled={book === "new"}
                >
                  <option value="">Directly in this book</option>
                  {chapters
                    .filter((c) => String(c.book_id) === book)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              {!loading && !books.length && (
                <p className="text-sm">
                  Your first upload creates a book. Review the suggested page
                  before publishing.
                </p>
              )}
              <button className="button w-full" disabled={!book}>
                Draft page
              </button>
            </fieldset>
          </form>
          <div className="price-card">
            <h2 className="text-xl">Recent documents</h2>
            <p className="mt-2 text-xs text-slate-500">
              Latest 50 documents in this workspace
            </p>
            {!items.length && (
              <p className="mt-4 text-sm text-slate-500">
                Your uploaded documents will appear here.
              </p>
            )}
            <ul className="mt-4 divide-y">
              {items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    disabled={!!busy}
                    className="w-full py-4 text-left"
                    onClick={() => {
                      setError("");
                      open(i.id).catch((e) => setError(e.message));
                    }}
                  >
                    <span className="block break-words font-medium">
                      {i.draft_title || i.filename}
                    </span>
                    <span className="mt-1 block text-xs capitalize text-slate-500">
                      {i.source === "email" ? "E-mail · " : ""}
                      {i.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="price-card min-w-0">
          {!review ? (
            <div className="py-12 text-center">
              <h2 className="text-2xl">2. Review your suggestion</h2>
              <p className="mx-auto mt-3 max-w-md text-slate-500">
                Upload a document or open a recent draft. Nothing is published
                until a team owner or admin approves it.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="text-2xl">Review draft</h2>
                <span className="badge">{review.status}</span>
              </div>
              <p className="break-words text-sm text-slate-500">
                Source: {review.source === "email" ? "E-mail · " : ""}
                {review.filename}
              </p>
              {review.source === "email" && (
                <EmailSource metadata={review.source_metadata} />
              )}
              <p className="text-sm">
                Destination:{" "}
                {review.target_book_name || `Book ${review.target_book_id}`}
                {review.target_chapter_name
                  ? ` / ${review.target_chapter_name}`
                  : ""}
              </p>
              {review.source_preview && (
                <details>
                  <summary>Compare source (first 2,000 characters)</summary>
                  <pre className="whitespace-pre-wrap text-sm p-3">
                    {review.source_preview}
                  </pre>
                </details>
              )}
              {["draft", "failed"].includes(review.status) && (
                <div className="space-y-3">
                  <label className="block">
                    Destination book
                    <select
                      className="block w-full border p-3"
                      value={targetBook}
                      onChange={(e) => {
                        setTargetBook(e.target.value);
                        setTargetChapter("");
                      }}
                    >
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    Chapter
                    <select
                      className="block w-full border p-3"
                      value={targetChapter}
                      onChange={(e) => setTargetChapter(e.target.value)}
                    >
                      <option value="">Directly in book</option>
                      {chapters
                        .filter((c) => String(c.book_id) === targetBook)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              {reviewError && (
                <p role="alert" className="text-red-800">
                  {reviewError}
                </p>
              )}
              {review.error && (
                <p
                  role="alert"
                  className="rounded bg-amber-50 p-4 text-sm text-amber-900"
                >
                  {review.error}
                </p>
              )}
              {["queued", "uploaded", "drafting"].includes(review.status) && (
                <p>
                  Draft generation is in progress. This view updates
                  automatically.
                </p>
              )}
              {review.status === "approved" && (
                <p>
                  Publication is in progress or needs verification. Check
                  BookStack before creating another draft; contact support if
                  this status persists.
                </p>
              )}
              {review.draft_html && (
                <>
                  <label className="block text-sm font-medium">
                    Page title
                    <input
                      maxLength={250}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={
                        !!busy || !["draft", "failed"].includes(review.status)
                      }
                      className="mt-2 block w-full rounded-lg border p-3"
                    />
                  </label>
                  <label className="block text-sm">
                    Tags (3–6, comma separated)
                    <input
                      className="block w-full border p-3"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      disabled={
                        !!busy || !["draft", "failed"].includes(review.status)
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {review.draft_tags.map((t) => (
                      <span key={t} className="badge">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border bg-white p-5">
                    <p className="mb-4 text-xs uppercase tracking-wider text-slate-500">
                      Page preview
                    </p>
                    <article
                      className="intake-preview"
                      contentEditable={
                        !busy && ["draft", "failed"].includes(review.status)
                      }
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label="Edit formatted page"
                      aria-multiline="true"
                      onBlur={(e) =>
                        setHtml(cleanHtml(e.currentTarget.innerHTML))
                      }
                      dangerouslySetInnerHTML={{ __html: cleanHtml(html) }}
                    />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Edit page HTML
                    </summary>
                    <label className="mt-3 block text-xs text-slate-500">
                      Only safe formatting is retained.
                      <textarea
                        aria-label="Page HTML"
                        className="mt-2 block min-h-64 w-full rounded-lg border p-3 font-mono text-xs text-slate-800"
                        value={html}
                        onChange={(e) => setHtml(e.target.value)}
                        disabled={
                          !!busy || !["draft", "failed"].includes(review.status)
                        }
                      />
                    </label>
                  </details>
                </>
              )}
              {(review.status === "draft" ||
                (review.status === "failed" && review.draft_html)) && (
                <>
                  <p className="rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    AI can make mistakes. Check the summary, facts and reviewer
                    checklist before publishing. Publishing creates a normal
                    page visible according to your BookStack book’s permissions.
                  </p>
                  {!review.can_publish && (
                    <p className="text-sm">
                      A team owner or admin must publish this draft.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {review.can_publish && (
                      <button
                        disabled={!!busy || !title.trim()}
                        className="button"
                        onClick={() => decide("publish")}
                      >
                        Publish to BookStack
                      </button>
                    )}
                    <button
                      className="button-secondary"
                      disabled={!!busy}
                      onClick={() => decide("reject")}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
              {review.status === "failed" && (
                <button
                  className="button-secondary"
                  disabled={!!busy}
                  onClick={() => decide("reject")}
                >
                  Reject
                </button>
              )}
              {review.url && (
                <a
                  className="button"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={review.url}
                >
                  Open published page ↗
                </a>
              )}
              {review.status === "rejected" && (
                <p>
                  This document was rejected. Upload a new version to start
                  again.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
