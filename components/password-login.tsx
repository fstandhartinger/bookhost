"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
export function PasswordLogin() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const result = await signIn("credentials", {
            email: data.get("email"),
            password: data.get("password"),
            redirect: false,
          });
          if (result?.error)
            setError(
              result.code === "rate_limited"
                ? "Too many attempts. Try again in 15 minutes."
                : "E-mail or password is incorrect",
            );
          else window.location.assign("/app");
        } catch {
          setError("Unable to sign in. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        Work email
        <input
          className="field"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
        />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          className="field"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          maxLength={1024}
        />
      </label>
      <button disabled={busy} className="button w-full">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <a className="block text-sm underline" href="/login/reset">
        Forgot password?
      </a>
    </form>
  );
}
