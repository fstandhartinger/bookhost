"use client";
import { useState } from "react";
export function JoinForm({
  token,
  email,
}: {
  token: string;
  email?: string | null;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(e.currentTarget);
        try {
          const res = await fetch(`/api/join/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: data.get("email"),
              password: data.get("password"),
            }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error);
          window.location.assign(body.url);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please try again.");
          setBusy(false);
        }
      }}
    >
      {!email && (
        <>
          <label className="block">
            Email
            <input
              className="mt-1 w-full"
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
          <label className="block">
            Password
            <input
              className="mt-1 w-full"
              type="password"
              name="password"
              minLength={10}
              maxLength={1024}
              autoComplete="current-password"
              required
            />
          </label>
          <p className="text-sm text-slate-600">
            Use at least 10 characters for a new account, or enter your existing
            Wissen password. If you use another sign-in method,{" "}
            <a
              className="underline"
              href={`/login?callbackUrl=${encodeURIComponent("/join/" + token)}`}
            >
              sign in first
            </a>{" "}
            and reopen this link.
          </p>
        </>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Joining…" : email ? `Join as ${email}` : "Join team"}
      </button>
      <p role="alert">{error}</p>
    </form>
  );
}
