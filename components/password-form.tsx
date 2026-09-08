"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function PasswordForm({
  hasPassword = false,
  resetToken,
}: {
  hasPassword?: boolean;
  resetToken?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!hasPassword);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!editing)
    return (
      <button
        className="button-secondary mt-4"
        onClick={() => setEditing(true)}
      >
        Change password
      </button>
    );
  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch(
            resetToken ? "/api/account/reset" : "/api/account/password",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...Object.fromEntries(data),
                token: resetToken,
              }),
            },
          );
          const result = await response.json();
          if (!response.ok) {
            setMessage(result.error || "Please try again");
            return;
          }
          form.reset();
          if (resetToken) router.push("/login?reset=1");
          else {
            setMessage("Password saved. Other sessions have been signed out.");
            router.refresh();
          }
        } catch {
          setMessage("Connection failed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {hasPassword && (
        <label className="block text-sm">
          Current password
          <input
            className="field"
            type="password"
            name="oldPassword"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
      )}
      <label className="block text-sm">
        New password
        <input
          className="field"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={1024}
          required
        />
      </label>
      <p className="text-xs text-slate-600">At least 10 characters.</p>
      <label className="block text-sm">
        Confirm new password
        <input
          className="field"
          type="password"
          name="confirmation"
          autoComplete="new-password"
          minLength={10}
          maxLength={1024}
          required
        />
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : hasPassword ? "Change password" : "Set a password"}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
export function ResetRequestForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("email");
        setBusy(true);
        try {
          const response = await fetch("/api/account/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const result = await response.json();
          setMessage(
            response.ok
              ? "If an account exists, you’ll receive a reset link valid for 30 minutes."
              : result.error,
          );
        } catch {
          setMessage("Connection failed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Work email
        <input
          type="email"
          name="email"
          required
          maxLength={254}
          autoComplete="email"
          className="field"
        />
      </label>
      <button disabled={busy} className="button mt-4">
        {busy ? "Requesting…" : "Send reset link"}
      </button>
      {message && (
        <p className="mt-4" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
