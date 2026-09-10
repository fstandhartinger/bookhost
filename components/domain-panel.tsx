"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
export type DomainRow = {
  host: string;
  status: string;
  verification_token: string;
  last_error: string | null;
  removing: boolean;
};
export function DomainPanel({
  team,
  tenantHost,
  ipv4,
  domains,
}: {
  team: string;
  tenantHost: string;
  ipv4: string;
  domains: DomainRow[];
}) {
  const router = useRouter();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function send(action: "add" | "check" | "remove", value: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/domains${action === "check" ? "/check" : ""}`,
        {
          method: action === "remove" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team, host: value }),
        },
      );
      const result = await response.json();
      setMessage(
        result.error ||
          (action === "remove"
            ? "Removal queued. The address will be released once routing is removed."
            : `Status: ${result.status}`),
      );
      if (response.ok) {
        if (action === "add") setHost("");
        router.refresh();
      }
    } catch {
      setMessage("Request failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="price-card mt-6">
      <h2 className="text-xl">Your own domain</h2>
      <p className="mt-3">
        Add up to three domains you control. Your existing workspace address
        stays available. BookStack may still direct sign-ins and links to that
        address.
      </p>
      <form
        className="mt-4 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send("add", host);
        }}
      >
        <label>
          Domain{" "}
          <input
            required
            maxLength={253}
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="wiki.example.org"
            className="border p-2"
          />
        </label>
        <button
          className="button-secondary"
          disabled={busy || domains.length >= 3}
        >
          Add domain
        </button>
      </form>
      <p role="status" className="mt-3">
        {message}
      </p>
      <ul className="space-y-5">
        {domains.map((domain) => (
          <li key={domain.host} className="border-t pt-4 break-words">
            <h3 className="font-semibold">{domain.host}</h3>
            <p>Status: {domain.removing ? "Removal queued" : domain.status}</p>
            {domain.last_error && <p className="mt-2">{domain.last_error}</p>}
            {!domain.removing && (
              <>
                <p className="mt-3">At your DNS provider, add:</p>
                <p>
                  CNAME <code>{domain.host}</code> → <code>{tenantHost}</code>
                </p>
                {ipv4 && (
                  <p>
                    OR A <code>{domain.host}</code> → <code>{ipv4}</code> (use
                    one routing option).
                  </p>
                )}
                <p>
                  AND TXT <code>_bookhost-verify.{domain.host}</code> →{" "}
                  <code className="break-all">{domain.verification_token}</code>
                </p>
                <p className="mt-2 text-sm">
                  Keep the TXT record. DNS changes can take time. After
                  verification we prepare HTTPS automatically; refresh this page
                  to see activation.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => void send("check", domain.host)}
                  >
                    Check now
                  </button>
                  <button
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => void send("remove", domain.host)}
                  >
                    Remove domain
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
