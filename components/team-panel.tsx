"use client";
import { QUOTAS } from "@/lib/quotas";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Member = {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
  bookstack_login_status?: "ready" | "pending" | "error";
};
type Invite = {
  id: string;
  role: string;
  uses: number;
  max_uses: number;
  expires_at: string;
};
export function TeamPanel({
  teamId,
  userId,
  role,
  members,
  invites,
  revocations = [],
}: {
  teamId: string;
  userId: string;
  role: string;
  members: Member[];
  invites: Invite[];
  revocations?: { user_id: string; email: string; revocation_error: string }[];
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(data: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, ...data }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      if (result.link) setLink(result.link);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="price-card mt-8">
      <h2 className="text-2xl">Team</h2>
      <p className="mt-2 text-sm text-slate-600">
        {members.length} / {QUOTAS.members} dashboard members (including the
        owner). Invitations expire after 7 days. Teammates get their own
        BookStack login automatically.
      </p>
      <ul className="mt-4 divide-y">
        {members.map((m) => (
          <li
            key={m.user_id}
            className="flex flex-wrap items-center gap-3 py-3"
          >
            <span className="min-w-0 break-all">{m.email}</span>
            <span className="badge">{m.role}</span>
            {role === "owner" && (
              <span className="badge">
                BookStack login: {m.bookstack_login_status || "pending"}
              </span>
            )}
            <span className="text-sm text-slate-500">
              Since {m.created_at.slice(0, 10)}
            </span>
            {m.role !== "owner" && m.user_id !== userId && (
              <>
                {role === "owner" && (
                  <select
                    aria-label={`Role for ${m.email}`}
                    disabled={busy}
                    value={m.role}
                    onChange={(e) =>
                      void action({
                        action: "role",
                        userId: m.user_id,
                        role: e.target.value,
                      })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                <button
                  disabled={busy}
                  className="text-sm underline"
                  onClick={() => {
                    if (window.confirm(`Remove ${m.email} from this team?`))
                      void action({ action: "remove", userId: m.user_id });
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {revocations.map((r) => (
        <div key={r.user_id} role="alert" className="mt-4">
          <p>
            BookStack access removal incomplete: {r.email}. {r.revocation_error}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action({ action: "retry-revocation", userId: r.user_id })
            }
          >
            Retry access removal
          </button>
        </div>
      ))}
      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action({
            action: "invite",
            role: f.get("role"),
            maxUses: Number(f.get("maxUses")),
          });
        }}
      >
        <label>
          Invitation role
          <select name="role" className="block">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          Uses
          <select name="maxUses" className="block">
            <option value="1">1 person</option>
            <option value="10">10 people</option>
          </select>
        </label>
        <button
          className="button"
          disabled={busy || members.length >= QUOTAS.members}
        >
          Create invitation link
        </button>
      </form>
      {link && (
        <div className="mt-4 rounded-lg bg-teal-50 p-4">
          <p className="text-sm">
            Copy this link now. It will not be shown again after you leave this
            page. Anyone with it can join with the selected role.
          </p>
          <input
            aria-label="Invitation link"
            className="mt-2 w-full"
            readOnly
            value={link}
          />
          <button
            className="button-secondary mt-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setMessage("Link copied.");
              } catch {
                setMessage("Select and copy the link above.");
              }
            }}
          >
            Copy link
          </button>
        </div>
      )}
      <h3 className="mt-6 font-semibold">Open invitations</h3>
      {!invites.length && <p className="mt-2 text-sm">No open invitations.</p>}
      <ul>
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap gap-3 py-2">
            <span>
              {i.role} · {i.max_uses - i.uses} uses left · Expires{" "}
              {i.expires_at.slice(0, 10)}
            </span>
            <button
              className="underline"
              disabled={busy}
              onClick={() => void action({ action: "revoke", inviteId: i.id })}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-3">
        {message}
      </p>
    </section>
  );
}
