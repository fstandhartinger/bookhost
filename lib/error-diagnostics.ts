import { randomUUID } from "node:crypto";

type Diagnostic = {
  event: string;
  phase: string;
  correlation_id: string;
  team_id?: unknown;
  session_id?: unknown;
  error?: unknown;
};

const DATABASE_CODES = new Set([
  "08006",
  "23503",
  "23505",
  "40001",
  "40P01",
  "57014",
]);

function errorCategory(value: unknown) {
  if (value instanceof TypeError) return "type_error";
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code;
    if (typeof code === "string" && DATABASE_CODES.has(code))
      return `database_${code}`;
    return "error";
  }
  return "unknown";
}

function safeIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return cleaned || undefined;
}

export function correlationId() {
  return randomUUID();
}

/** Log only explicitly allow-listed operational context, never the caught value. */
export function reportError(diagnostic: Diagnostic) {
  const record = {
    event: diagnostic.event,
    phase: diagnostic.phase,
    correlation_id: diagnostic.correlation_id,
    error_category: errorCategory(diagnostic.error),
    ...(safeIdentifier(diagnostic.team_id)
      ? { team_id: safeIdentifier(diagnostic.team_id) }
      : {}),
    ...(safeIdentifier(diagnostic.session_id)
      ? { session_id: safeIdentifier(diagnostic.session_id) }
      : {}),
  };
  console.error(JSON.stringify(record));
}
