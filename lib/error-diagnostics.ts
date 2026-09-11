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
export function reportError(diagnostic: Diagnostic): void {
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

  // Keep module initialization, synchronous query failures and rejected writes
  // inside the same detached promise chain. Diagnostics must not break requests.
  void import("./db")
    .then(({ db }) =>
      db.query(
        `INSERT INTO error_reports
          (event, phase, correlation_id, error_category, team_id, session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          record.event,
          record.phase,
          record.correlation_id,
          record.error_category,
          record.team_id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            record.team_id,
          )
            ? record.team_id
            : null,
          record.session_id ?? null,
        ],
      ),
    )
    .catch(() => {});
}
