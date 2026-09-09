import React from "react";
export type EmailMetadata = {
  from?: { name?: string; address?: string };
  subject?: string;
  received_at?: string;
};
export function EmailSource({ metadata }: { metadata?: EmailMetadata }) {
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm break-words space-y-2">
      <p className="font-semibold">
        Received by e-mail — verify the sender before publishing
      </p>
      <p>
        From: {metadata?.from?.name || "Unknown name"} &lt;
        {metadata?.from?.address || "Unknown address"}&gt;
      </p>
      <p>Subject: {metadata?.subject || "(No subject)"}</p>
      <p>
        Received:{" "}
        {metadata?.received_at ? (
          <time dateTime={metadata.received_at}>
            {new Date(metadata.received_at).toLocaleString()}
          </time>
        ) : (
          "Unknown"
        )}
      </p>
    </aside>
  );
}
