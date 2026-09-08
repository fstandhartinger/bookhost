import { createHash } from "node:crypto";
const requests = new Map<string, { hits: number; expires: number }>();
export function cancellationRateLimit(ip: string, now = Date.now()) {
  for (const [key, entry] of requests) {
    if (entry.expires <= now) requests.delete(key);
  }
  const key = createHash("sha256").update(ip).digest("hex");
  const entry = requests.get(key) ?? { hits: 0, expires: now + 3_600_000 };
  // Bound memory even under a stream of new addresses.
  if (!requests.has(key) && requests.size >= 10_000) return false;
  entry.hits++;
  requests.set(key, entry);
  return entry.hits <= 5;
}
export function cancellationInput(data: Record<string, unknown>) {
  const email =
    typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const kind = data.kind;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    (kind !== "cancel" && kind !== "withdrawal")
  )
    return null;
  const fields = ["name", "team", "note"] as const;
  if (
    fields.some(
      (field) =>
        data[field] !== undefined &&
        (typeof data[field] !== "string" ||
          (data[field] as string).length > 2000),
    )
  )
    return null;
  const note = fields
    .map((field) =>
      data[field] ? `${field}: ${String(data[field]).trim()}` : "",
    )
    .filter(Boolean)
    .join("\n");
  return { email, kind, note };
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
