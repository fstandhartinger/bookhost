"use client";
import React, { useCallback, useEffect, useState } from "react";

type Settings = {
  enabled: boolean;
  rollout_status: "none" | "pending" | "ready" | "failed";
  rollout_error: string | null;
};

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}

const STATUS_TEXT: Record<Settings["rollout_status"], string> = {
  none: "",
  pending:
    "Turning on Live Edit for your workspace — this installs a small BookStack extension and briefly restarts your workspace. This can take a few minutes.",
  ready:
    "Live Edit is on. Open any page in BookStack and look for the Live Edit button.",
  failed:
    "Turning on Live Edit failed. You can try again, or contact support if it keeps failing.",
};

export function LiveEditPanel({
  tenants,
}: {
  tenants: { id: string; slug: string }[];
}) {
  const [tenant, setTenant] = useState(tenants[0].id);
  const [data, setData] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result: Settings = await api(
      `/api/live-edit-settings?tenant=${encodeURIComponent(tenant)}`,
    );
    setData(result);
    return result;
  }, [tenant]);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    refresh().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  // The host worker installs the theme route in the background; poll until done.
  useEffect(() => {
    if (data?.rollout_status !== "pending") return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [data?.rollout_status, refresh]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await api("/api/live-edit-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, enabled }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const enabled = data?.enabled ?? false;
  const disabled = busy || !data;

  return (
    <div className="mt-8 space-y-6">
      {tenants.length > 1 && (
        <label className="block">
          Workspace
          <select
            className="mt-2 block rounded border p-3"
            value={tenant}
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
      {error && <p className="price-card border-red-300 text-red-800">{error}</p>}
      <div className="price-card flex items-center justify-between gap-6">
        <div>
          <p className="font-medium">Live Edit (beta)</p>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Lets your team edit a BookStack page together in real time, with
            live cursors — an add-on we built on top of BookStack using an
            open real-time editor overlay, not BookStack&rsquo;s own native
            editor. Saves back as a normal BookStack revision.
          </p>
        </div>
        <button
          type="button"
          className="button-secondary shrink-0"
          disabled={disabled}
          onClick={() => toggle(!enabled)}
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {data && data.rollout_status !== "none" && (
        <p className="text-sm text-slate-600">
          {STATUS_TEXT[data.rollout_status]}
          {data.rollout_status === "failed" && data.rollout_error
            ? ` (${data.rollout_error})`
            : ""}
        </p>
      )}
      <div className="price-card">
        <p className="font-medium">What doesn&rsquo;t work yet</p>
        <p className="mt-1 text-sm text-slate-600">
          Live Edit only opens for pages using BookStack&rsquo;s visual editor
          without drawings, page includes or callout boxes — it tells you why
          when it can&rsquo;t open a page, and BookStack&rsquo;s normal editor
          keeps working for everything.
        </p>
      </div>
    </div>
  );
}
