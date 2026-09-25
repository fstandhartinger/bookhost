"use client";
import React, { useEffect, useState } from "react";

type SemanticState = {
  enabled: boolean;
  source: "operator" | "workspace" | "off";
  killSwitch: boolean;
  chunks: number;
};

function statusText(state: SemanticState) {
  if (state.source === "operator") return "On by operator";
  if (state.enabled)
    return `On — ${state.chunks} passage${state.chunks === 1 ? "" : "s"} indexed`;
  return "Off";
}

export function SemanticToggle({
  tenants,
}: {
  tenants: { id: string; slug: string }[];
}) {
  const [tenant, setTenant] = useState(tenants[0].id);
  const [state, setState] = useState<SemanticState | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setState(null);
    setConfirm(false);
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/chat/semantic?tenantId=${encodeURIComponent(tenant)}`,
        );
        const data = response.ok ? await response.json() : null;
        if (active) {
          if (data) setState(data);
          else setError("The setting could not be loaded. Please try again.");
        }
      } catch {
        if (active)
          setError("The setting could not be loaded. Please try again.");
      }
    })();
    return () => {
      active = false;
    };
  }, [tenant]);
  async function setEnabled(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat/semantic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          enabled,
          confirmNoPersonalData: confirm,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "The change could not be saved. Please try again.",
        );
        return;
      }
      setState(data);
      setConfirm(false);
    } catch {
      setError("The change could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const operatorManaged = state?.source === "operator";
  const unavailable = state !== null && !state.killSwitch && !state.enabled;
  return (
    <section
      className="price-card mt-8 space-y-4"
      aria-labelledby="semantic-toggle-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="semantic-toggle-heading" className="text-lg font-semibold">
          Matching by meaning (beta)
        </h2>
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          {state ? statusText(state) : "Loading…"}
        </p>
      </div>
      {tenants.length > 1 && (
        <label className="block">
          Workspace
          <select
            className="mt-2 block rounded border p-3"
            value={tenant}
            disabled={busy}
            onChange={(e) => setTenant(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-sm leading-6 text-slate-600">
        When on, the text of every page in this workspace is sent to TensorX
        (Ireland) to compute search vectors; the vectors and passage text are
        stored in BookHost&rsquo;s own database on our EU servers and refreshed
        hourly. Switching off deletes them immediately.
      </p>
      {operatorManaged ? (
        <p className="text-sm text-slate-600">
          Matching by meaning is switched on for this workspace by the
          operator and cannot be changed here.
        </p>
      ) : unavailable ? (
        <p className="text-sm text-slate-600">
          Matching by meaning is not available in this deployment.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            This workspace contains no personal data
          </label>
          <div className="flex gap-3">
            {state?.enabled ? (
              <button
                className="button"
                disabled={busy}
                aria-label="Turn off matching by meaning"
                onClick={() => void setEnabled(false)}
              >
                Turn off
              </button>
            ) : (
              <button
                className="button"
                disabled={busy || !confirm}
                aria-label="Turn on matching by meaning"
                onClick={() => void setEnabled(true)}
              >
                Turn on
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
