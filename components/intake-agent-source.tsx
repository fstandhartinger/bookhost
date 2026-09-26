import React from "react";
export type AgentMetadata = {
  kind?: "create" | "update" | "append";
  agent_name?: string;
  token_fingerprint?: string;
  page_id?: number | null;
  page_name?: string | null;
  note?: string;
  proposed_at?: string;
};
function kindLabel(metadata?: AgentMetadata) {
  const page = metadata?.page_name || `page ${metadata?.page_id ?? "?"}`;
  if (metadata?.kind === "create") return "New page";
  if (metadata?.kind === "update") return `Replace page content of ${page}`;
  if (metadata?.kind === "append") return `Append to ${page}`;
  return "Unknown change";
}
// Everything here comes from the agent and is untrusted: React renders it as
// plain text, never as HTML.
export function AgentSource({
  metadata,
  host,
}: {
  metadata?: AgentMetadata;
  host?: string;
}) {
  const existingPage =
    metadata?.kind !== "create" &&
    Number.isSafeInteger(Number(metadata?.page_id)) &&
    Number(metadata?.page_id) > 0
      ? Number(metadata?.page_id)
      : null;
  return (
    <aside className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm break-words space-y-2">
      <p className="font-semibold">
        Proposed by an AI agent — {metadata?.agent_name || "Unknown agent"}
        {metadata?.token_fingerprint
          ? ` (token ${metadata.token_fingerprint})`
          : ""}
      </p>
      <p>
        {kindLabel(metadata)} · proposed{" "}
        {metadata?.proposed_at ? (
          <time dateTime={metadata.proposed_at}>
            {new Date(metadata.proposed_at).toLocaleString()}
          </time>
        ) : (
          "at an unknown time"
        )}
      </p>
      {metadata?.note && (
        <div>
          <p className="font-medium">Agent&rsquo;s note</p>
          <p className="whitespace-pre-wrap">{metadata.note}</p>
        </div>
      )}
      {existingPage && host && (
        <p>
          <a
            className="underline"
            href={`https://${host}/link/${existingPage}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the current page ↗
          </a>
        </p>
      )}
      <p className="text-xs text-slate-600">
        Approving applies exactly this proposal. To change it, reject it and ask
        the agent to propose again.
      </p>
    </aside>
  );
}
