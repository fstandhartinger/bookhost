"use client";
import React, { useCallback, useEffect, useState } from "react";
import { clientConfigs, WRITE_MODE_TEXT } from "@/lib/agent-docs";

type WriteMode = keyof typeof WRITE_MODE_TEXT;
type Agent = {
  id: string;
  name: string;
  role_name: string;
  status: "pending" | "active" | "revoke_requested" | "revoked" | "failed";
  error: string | null;
  created_at: string;
  revoked_at: string | null;
  token_hint: string;
};
type Activity = {
  id: string;
  tool: string;
  target: string | null;
  status: string;
  latency_ms: number;
  created_at: string;
  token_fingerprint: string;
  agent_name: string | null;
};
export type AgentsOverview = {
  workspace: { id: string; host: string; mcp_url: string; llms_url: string };
  settings: {
    write_mode: WriteMode;
    access_enabled: boolean;
    disabled_at: string | null;
  };
  agents: Agent[];
  roles: { id: number; name: string; description: string }[];
  roles_error: string | null;
  activity: Activity[];
};

const MODES = Object.keys(WRITE_MODE_TEXT) as WriteMode[];
const AGENT_STATUS: Record<Agent["status"], string> = {
  pending: "Setting up…",
  active: "Active",
  revoke_requested: "Revoking…",
  revoked: "Revoked",
  failed: "Failed",
};
const CLIENT_STATUS = {
  supported: "Supported",
  bridge: "Via bridge",
  "not-yet": "Not yet supported",
} as const;
const DANGER_BADGE = "badge bg-red-100 text-red-800";
const WAIT_BADGE = "badge bg-amber-100 text-amber-900";
const MUTED_BADGE = "badge bg-slate-100 text-slate-600";

function agentBadge(status: Agent["status"]) {
  if (status === "failed") return DANGER_BADGE;
  if (status === "pending" || status === "revoke_requested") return WAIT_BADGE;
  if (status === "revoked") return MUTED_BADGE;
  return "badge";
}
function activityBadge(status: string) {
  if (status === "ok") return "badge";
  if (status === "proposed") return WAIT_BADGE;
  return DANGER_BADGE;
}
const when = (value: string) => new Date(value).toLocaleString();

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  return (
    <button
      type="button"
      className="button-secondary"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy manually"
          : "Copy"}
    </button>
  );
}

// Renders "page:12" as a link to the page; any other target stays text.
function Target({ target, host }: { target: string | null; host: string }) {
  if (!target) return <>—</>;
  const page = /^page:(\d+)$/.exec(target);
  if (!page) return <>{target}</>;
  return (
    <a
      className="underline"
      href={`https://${host}/link/${page[1]}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {target}
    </a>
  );
}

export function AgentsPanel({
  tenants,
}: {
  tenants: { id: string; slug: string }[];
}) {
  const [tenant, setTenant] = useState(tenants[0].id);
  const [data, setData] = useState<AgentsOverview | null>(null);
  const [mode, setMode] = useState<WriteMode>("propose");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [newToken, setNewToken] = useState<{
    name: string;
    token: string;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const result: AgentsOverview = await api(
      `/api/agents?tenant=${encodeURIComponent(tenant)}`,
    );
    setData(result);
    return result;
  }, [tenant]);
  useEffect(() => {
    let active = true;
    setData(null);
    setNewToken(null);
    setError("");
    setMessage("");
    refresh()
      .then((result) => {
        if (active) setMode(result.settings.write_mode);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  // Agents are set up and revoked by the host worker; poll until it is done.
  const waiting = !!data?.agents.some((a) =>
    ["pending", "revoke_requested"].includes(a.status),
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);
  async function post(
    body: Record<string, unknown>,
    progress: string,
    done: string,
  ) {
    setBusy(progress);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant, ...body }),
      });
      setMessage(done);
      await refresh().catch(() => {});
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }
  async function saveMode() {
    if (
      mode === "direct" &&
      !window.confirm(
        "Allow agents to write straight to BookStack without review? BookStack permissions still apply.",
      )
    )
      return;
    await post(
      { action: "set_mode", mode },
      "Saving write mode…",
      `Write mode saved: ${WRITE_MODE_TEXT[mode].label}.`,
    );
  }
  async function createAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const agentName = name.trim();
    const result = await post(
      { action: "create_agent", name: agentName, role_id: Number(roleId) },
      "Creating agent…",
      `Agent “${agentName}” created.`,
    );
    if (result?.token) {
      setNewToken({ name: agentName, token: result.token });
      setName("");
    }
  }
  async function revoke(agent: Agent) {
    if (
      !window.confirm(
        `Revoke “${agent.name}”? Its token stops working and cannot be restored.`,
      )
    )
      return;
    await post(
      { action: "revoke_agent", agent_id: agent.id },
      "Revoking agent…",
      `Agent “${agent.name}” is being revoked.`,
    );
  }
  async function setAccess(enabled: boolean) {
    if (
      !enabled &&
      !window.confirm(
        "Turn off all agent access? Every agent request is refused immediately and all agent tokens created here are revoked.",
      )
    )
      return;
    await post(
      { action: "set_access", enabled },
      enabled ? "Turning agent access on…" : "Turning agent access off…",
      enabled
        ? "Agent access is on. Create new agents to connect again."
        : "Agent access is off. All agent tokens are being revoked.",
    );
    if (!enabled) setNewToken(null);
  }

  const settings = data?.settings;
  const enabled = settings?.access_enabled ?? true;
  const disabled = !!busy || !data;
  return (
    <div className="mt-8 space-y-8">
      {tenants.length > 1 && (
        <label className="block">
          Workspace
          <select
            className="mt-2 block rounded border p-3"
            value={tenant}
            disabled={!!busy}
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
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {busy || message || (!data && !error ? "Loading agent access…" : "")}
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {settings && !enabled && (
        <div
          role="status"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
        >
          <p className="font-semibold">
            Agent access is off
            {settings.disabled_at ? ` since ${when(settings.disabled_at)}` : ""}
            . All agent tokens created here are revoked.
          </p>
          <p className="mt-2 text-sm">
            Turning access back on does not restore old tokens; create new
            agents afterwards.
          </p>
          <button
            type="button"
            className="button-secondary mt-4"
            disabled={disabled}
            onClick={() => void setAccess(true)}
          >
            Turn agent access back on
          </button>
        </div>
      )}
      {data && (
        <>
          <section
            className="price-card min-w-0 space-y-4"
            aria-labelledby="agents-connect"
          >
            <h2 id="agents-connect" className="text-2xl">
              Connect
            </h2>
            <div>
              <p className="text-sm font-medium">MCP server URL</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="min-w-0 break-all">
                  {data.workspace.mcp_url}
                </code>
                <CopyButton
                  text={data.workspace.mcp_url}
                  label="Copy MCP server URL"
                />
              </div>
            </div>
            <p className="break-all text-sm">
              Workspace guide for agents:{" "}
              <a
                className="underline"
                href={data.workspace.llms_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {data.workspace.llms_url}
              </a>
            </p>
            <p className="text-sm text-slate-600">
              Every client sends an agent token as a Bearer token. Create one
              under Agents below, then set up your client:
            </p>
            <div className="divide-y rounded-xl border">
              {clientConfigs(data.workspace.mcp_url).map((c) => (
                <details key={c.id} className="min-w-0 p-4">
                  <summary className="cursor-pointer font-medium">
                    {c.name}{" "}
                    <span
                      className={
                        c.status === "supported"
                          ? "badge"
                          : c.status === "bridge"
                            ? WAIT_BADGE
                            : MUTED_BADGE
                      }
                    >
                      {CLIENT_STATUS[c.status]}
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-slate-600">{c.summary}</p>
                  {c.snippet && (
                    <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">
                      <code>{c.snippet}</code>
                    </pre>
                  )}
                  <p className="mt-3 flex flex-wrap gap-3 text-sm">
                    {c.docs.map((d) => (
                      <a
                        key={d.href}
                        className="underline"
                        href={d.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {d.label} ↗
                      </a>
                    ))}
                  </p>
                </details>
              ))}
            </div>
            <p className="text-sm">
              <a className="underline" href="https://bookhost.co/agents">
                Full agent guide, tools and troubleshooting
              </a>
            </p>
          </section>

          <section
            className="price-card space-y-4"
            aria-labelledby="agents-mode"
          >
            <h2 id="agents-mode" className="text-2xl">
              Write mode
            </h2>
            <fieldset disabled={disabled} className="space-y-3">
              <legend className="text-sm text-slate-600">
                What happens when an agent writes to the wiki. Reading always
                follows the agent&rsquo;s BookStack role.
              </legend>
              {MODES.map((m) => (
                <label
                  key={m}
                  className="flex items-start gap-3 rounded-xl border p-4"
                >
                  <input
                    type="radio"
                    name="write_mode"
                    className="mt-1"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span>
                    <span className="block font-medium">
                      {WRITE_MODE_TEXT[m].label}
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">
                      {WRITE_MODE_TEXT[m].text}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="button"
                disabled={disabled || mode === settings?.write_mode}
                onClick={() => void saveMode()}
              >
                Save write mode
              </button>
              <span className="text-sm text-slate-600">
                Saved: {settings && WRITE_MODE_TEXT[settings.write_mode].label}
              </span>
            </div>
          </section>

          <section
            className="price-card min-w-0 space-y-5"
            aria-labelledby="agents-list"
          >
            <h2 id="agents-list" className="text-2xl">
              Agents
            </h2>
            {newToken && (
              <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
                <p className="font-semibold">Token for “{newToken.name}”</p>
                <div className="flex flex-wrap items-center gap-3">
                  <code
                    className="min-w-0 break-all rounded bg-white p-2"
                    data-testid="agent-token"
                  >
                    {newToken.token}
                  </code>
                  <CopyButton text={newToken.token} label="Copy agent token" />
                </div>
                <p className="text-sm">
                  Copy it now — BookHost cannot show it again. It becomes usable
                  within about a minute, once the agent&rsquo;s BookStack user
                  is set up.
                </p>
                <p className="text-sm font-medium">
                  Claude Code, ready to paste:
                </p>
                <pre className="whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs">
                  <code>{`export BOOKHOST_TOKEN="${newToken.token}"
claude mcp add --transport http --scope user bookhost ${data.workspace.mcp_url} \\
  --header "Authorization: Bearer $BOOKHOST_TOKEN"`}</code>
                </pre>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setNewToken(null)}
                >
                  I have copied the token
                </button>
              </div>
            )}
            <form onSubmit={createAgent} className="space-y-4">
              <fieldset
                disabled={disabled || !enabled || !data.roles.length}
                className="grid gap-4 sm:grid-cols-2"
              >
                <label className="block text-sm font-medium">
                  Agent name
                  <input
                    className="mt-2 block w-full rounded-lg border p-3"
                    value={name}
                    maxLength={60}
                    required
                    placeholder="e.g. Claude Code – docs cleanup"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  BookStack role
                  <select
                    className="mt-2 block w-full rounded-lg border p-3"
                    value={roleId}
                    required
                    aria-describedby="agents-role-hint"
                    onChange={(e) => setRoleId(e.target.value)}
                  >
                    <option value="">Choose a role…</option>
                    {data.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p
                  id="agents-role-hint"
                  className="text-xs text-slate-500 sm:col-span-2"
                >
                  Pick the least-privileged role that lets the agent do its job.
                  The Admin role is never offered.
                </p>
                <div className="sm:col-span-2">
                  <button className="button" disabled={!name.trim() || !roleId}>
                    Create agent
                  </button>
                </div>
              </fieldset>
              {data.roles_error && (
                <p role="alert" className="text-sm text-red-800">
                  {data.roles_error}
                </p>
              )}
              {!enabled && (
                <p className="text-sm text-slate-600">
                  Turn agent access back on to create agents.
                </p>
              )}
            </form>
            {!data.agents.length ? (
              <p className="text-sm text-slate-500">No agents yet.</p>
            ) : (
              <ul className="divide-y">
                {data.agents.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                  >
                    <span className="min-w-0 break-words font-medium">
                      {a.name}
                    </span>
                    <span className="text-sm text-slate-600">
                      {a.role_name}
                    </span>
                    <span className={agentBadge(a.status)}>
                      {AGENT_STATUS[a.status] || a.status}
                    </span>
                    <span className="text-sm text-slate-500">
                      Created{" "}
                      <time dateTime={a.created_at}>{when(a.created_at)}</time>
                    </span>
                    <code className="text-xs text-slate-500">
                      Token {a.token_hint}
                    </code>
                    {["pending", "active", "failed"].includes(a.status) && (
                      <button
                        type="button"
                        className="text-sm underline"
                        disabled={disabled}
                        aria-label={`Revoke ${a.name}`}
                        onClick={() => void revoke(a)}
                      >
                        Revoke
                      </button>
                    )}
                    {a.status === "failed" && a.error && (
                      <p className="w-full text-sm text-red-800">{a.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {enabled && (
            <section
              className="rounded-3xl border-2 border-red-200 bg-red-50 p-7 sm:p-9"
              aria-labelledby="agents-kill"
            >
              <h2 id="agents-kill" className="text-2xl text-red-900">
                Kill switch
              </h2>
              <p className="mt-2 text-sm text-red-900">
                Refuses every agent request for this workspace immediately and
                revokes every agent token created here.
              </p>
              <button
                type="button"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60"
                disabled={disabled}
                onClick={() => void setAccess(false)}
              >
                Turn off all agent access
              </button>
            </section>
          )}

          <section
            className="price-card min-w-0 space-y-4"
            aria-labelledby="agents-activity"
          >
            <h2 id="agents-activity" className="text-2xl">
              Activity
            </h2>
            <p className="text-sm text-slate-600">
              The last 100 agent requests. Metadata only — BookHost does not log
              page content, search terms or tokens.
            </p>
            {!data.activity.length ? (
              <p className="text-sm text-slate-500">No agent activity yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="py-2 pr-4">
                        Time
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Agent
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Tool
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Target
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Result
                      </th>
                      <th scope="col" className="py-2 text-right">
                        Latency
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.activity.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 pr-4 whitespace-nowrap">
                          <time dateTime={e.created_at}>
                            {when(e.created_at)}
                          </time>
                        </td>
                        <td className="py-2 pr-4">
                          {e.agent_name ||
                            `Own BookStack token ${e.token_fingerprint}`}
                        </td>
                        <td className="py-2 pr-4">
                          <code>{e.tool}</code>
                        </td>
                        <td className="py-2 pr-4">
                          <Target
                            target={e.target}
                            host={data.workspace.host}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <span className={activityBadge(e.status)}>
                            {e.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {e.latency_ms} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
