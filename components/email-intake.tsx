"use client";
import { useCallback, useEffect, useState } from "react";
type Settings = {
  address: string;
  enabled: boolean;
  can_manage: boolean;
  senders: { id: string; pattern: string }[];
  members: string[];
  rejected: number;
};
export function EmailIntake({ tenant }: { tenant: string }) {
  const [data, setData] = useState<Settings | null>(null);
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/intake/senders?tenant=${tenant}`);
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "Could not load email settings.");
    setData(value);
  }, [tenant]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  async function change(action: string, value: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/intake/senders?tenant=${tenant}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pattern: value }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setPattern("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="price-card mt-8 min-w-0" aria-label="E-mail intake">
      <h2 className="text-2xl">Send documents by e-mail</h2>
      {error && (
        <p role="alert" className="mt-3 text-red-800">
          {error}
        </p>
      )}
      {data && (
        <>
          {!data.enabled && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900">
              E-mail intake is being enabled for your workspace. This address is
              a preview; delivery is not available yet.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="min-w-0 break-all">{data.address}</code>
            <button
              className="button-secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.address);
                  setCopied(true);
                } catch {
                  setError("Copy the address above manually.");
                }
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
          <p className="mt-4">Only senders on your list are accepted</p>
          <p className="mt-2 text-sm text-slate-600">
            Send up to 5 PDF, DOCX, Markdown or text attachments (10 MB each; 15
            MB per request including encoding). Without attachments, include
            more than 200 characters of plain text. Every document needs human
            review before publication.
          </p>
          <p className="mt-3 text-sm">
            Rejected e-mails: <strong>{data.rejected}</strong>
          </p>
          <details className="mt-4">
            <summary>
              Allowed senders · {data.members.length + data.senders.length}
            </summary>
            <p className="mt-3 text-sm text-slate-600">
              Team members are always allowed. Domain rules accept that exact
              domain, excluding subdomains.
            </p>
            <ul className="mt-3 space-y-2">
              {data.members.map((email) => (
                <li className="break-all" key={email}>
                  {email}{" "}
                  <span className="text-sm text-slate-500">(team member)</span>
                </li>
              ))}
              {data.senders.map((s) => (
                <li className="flex flex-wrap gap-3" key={s.id}>
                  <span className="break-all">{s.pattern}</span>
                  {data.can_manage && (
                    <button
                      className="text-sm underline"
                      disabled={busy}
                      aria-label={`Remove ${s.pattern}`}
                      onClick={() => change("remove", s.pattern)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {data.can_manage ? (
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void change("add", pattern);
                }}
              >
                <label className="min-w-0 flex-1">
                  Email address or domain
                  <input
                    className="mt-2 block w-full rounded-lg border p-3"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    required
                    maxLength={254}
                    placeholder="colleague@example.com or @example.com"
                  />
                </label>
                <button className="button" disabled={busy}>
                  Add sender
                </button>
              </form>
            ) : (
              <p className="mt-3 text-sm">An owner or admin can add senders.</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
