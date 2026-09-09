"use client";
import React, { useState } from "react";
import { TENANT_DOMAIN } from "@/lib/config";
import { useRouter } from "next/navigation";
import { validateSlug } from "@/lib/slug";
export function TenantForm({ teamName }: { teamName: string }) {
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="mt-6 max-w-lg"
      onSubmit={async (event) => {
        event.preventDefault();
        const validation = validateSlug(slug);
        if (validation) {
          setError(validation);
          return;
        }
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const res = await fetch("/api/tenants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, name: data.get("name") }),
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm font-medium" htmlFor="team-name">
        Team name
      </label>
      <input
        id="team-name"
        name="name"
        className="field mb-5"
        required
        defaultValue={teamName}
        maxLength={100}
      />
      <label htmlFor="slug" className="text-sm font-medium">
        Workspace address
      </label>
      <input
        id="slug"
        name="slug"
        className="field"
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase())}
        placeholder="your-team"
        required
        minLength={3}
        maxLength={30}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby="slug-help"
      />
      <p id="slug-help" className="mt-2 break-all text-sm text-slate-500">
        https://<strong className="text-moss">{slug || "your-team"}</strong>.
        {TENANT_DOMAIN}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        3–30 lowercase letters, numbers or hyphens. Your address cannot be
        changed later.
      </p>
      {error && (
        <p role="alert" className="error mt-4">
          {error}
        </p>
      )}
      <button className="button mt-6" disabled={busy}>
        {busy ? "Creating workspace…" : "Create workspace →"}
      </button>
    </form>
  );
}
export function RevealPassword({
  endpoint = "/api/tenants/password",
  teamId,
}: { endpoint?: string; teamId?: string } = {}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <p className="text-sm font-semibold">Your initial BookStack password</p>
      <p className="mt-2 text-sm text-slate-600">
        View it once, save it securely, and change it after your first BookStack
        sign-in. It is removed from this dashboard when revealed.
      </p>
      {password ? (
        <code className="mt-4 block select-all break-all rounded bg-white p-4">
          {password}
        </code>
      ) : (
        <button
          className="button-secondary mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(endpoint, {
                method: "POST",
                ...(teamId
                  ? {
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ teamId }),
                    }
                  : {}),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              setPassword(data.password);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Retrieving…" : "Reveal password once"}
        </button>
      )}
      {error && (
        <p role="alert" className="error mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
