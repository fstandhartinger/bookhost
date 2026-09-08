"use client";
import Link from "next/link";
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
      let response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      let result = await response.json();
      if (response.status === 409 && result.portal) {
        response = await fetch("/api/portal", { method: "POST" });
        result = await response.json();
      }
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
      {endpoint === "/api/checkout" && (
        <p className="mt-3 text-xs text-slate-600">
          By continuing, you agree to the{" "}
          <Link className="underline" href="/legal/agb">
            Terms
          </Link>{" "}
          and{" "}
          <Link className="underline" href="/legal/avv">
            Data Processing Agreement
          </Link>
          .
        </p>
      )}
      {error && (
        <p role="alert" className="error mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
