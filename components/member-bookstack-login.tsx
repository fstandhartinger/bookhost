"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RevealPassword } from "./tenant-form";
export type MemberLogin = {
  bookstack_user_id: number | null;
  bookstack_role: string;
  has_password: boolean;
  last_error: string | null;
};
export function MemberBookStackLogin({
  teamId,
  email,
  host,
  login,
}: {
  teamId: string;
  email: string;
  host: string;
  login?: MemberLogin | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="mt-6 border-t pt-5">
      <h3 className="font-semibold">Your BookStack login</h3>
      <p className="mt-2 break-all text-sm">
        Email: <strong>{email}</strong>
      </p>
      <p className="mt-2 text-sm">Role: {login?.bookstack_role || "Editor"}</p>
      {(!login?.bookstack_user_id || login.last_error) && (
        <button
          className="button-secondary mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/bookstack/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ teamId }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating login…" : "Create my BookStack login"}
        </button>
      )}
      {(error || login?.last_error) && (
        <p role="alert" className="error mt-3">
          {error || login?.last_error}
        </p>
      )}
      {login?.bookstack_user_id &&
        (login.has_password ? (
          <RevealPassword endpoint="/api/bookstack/password" teamId={teamId} />
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Use your existing BookStack password or “Forgot password” in
            BookStack.
          </p>
        ))}
      <p className="mt-3 text-sm text-slate-600">
        Change the password after your first sign-in.
      </p>
      <a
        className="button-secondary mt-4"
        href={`https://${host}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open BookStack
      </a>
    </section>
  );
}
