"use client";
import { useState } from "react";
export function ActionButton({
  endpoint = "/api/checkout",
  children = "Start free trial",
  className = "button",
}: {
  endpoint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error || "Please try again.");
      window.location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button className={className} onClick={act} disabled={busy}>
        {busy ? "Opening secure checkout…" : children}
        {!busy && <span aria-hidden="true"> ↗</span>}
      </button>
      {error && (
        <p role="alert" className="error mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
