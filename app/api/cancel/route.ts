import { db } from "@/lib/db";
import { clientIp, sameOrigin } from "@/lib/security";
import {
  cancellationInput,
  cancellationRateLimit,
  escapeHtml,
} from "@/lib/cancellation";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const ip = clientIp(request);
  if (!ip)
    return Response.json({ error: "Missing client IP" }, { status: 400 });
  if (!cancellationRateLimit(ip))
    return Response.json(
      {
        error:
          "Too many requests. Please retry in one hour or email info@productivity-boost.com.",
      },
      { status: 429, headers: { ...headers, "Retry-After": "3600" } },
    );
  if (Number(request.headers.get("content-length") || 0) > 16_384)
    return Response.json(
      { error: "Request too large" },
      { status: 413, headers },
    );
  try {
    const text = await request.text();
    if (text.length > 16_384)
      return Response.json(
        { error: "Request too large" },
        { status: 413, headers },
      );
    let raw;
    try {
      raw = request.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
    } catch {
      return Response.json({ error: "Invalid form" }, { status: 400, headers });
    }
    const data = raw && typeof raw === "object" ? cancellationInput(raw) : null;
    if (!data)
      return Response.json(
        {
          error:
            "Enter a valid email and select cancellation or withdrawal. Optional fields may contain up to 2,000 characters each.",
        },
        { status: 400, headers },
      );
    const result = await db.query(
      "INSERT INTO cancellation_requests(email,note,kind) VALUES($1,$2,$3) RETURNING id,created_at",
      [data.email, data.note, data.kind],
    );
    const row = result.rows[0];
    const received = new Date(row.created_at).toISOString();
    const declaration =
      data.kind === "withdrawal"
        ? "I withdraw my contract. / Ich widerrufe meinen Vertrag."
        : "I cancel my subscription at the earliest possible date. / Ich kündige zum nächstmöglichen Termin.";
    const message =
      "We will implement your request in the Stripe customer portal within 2 working days and confirm it by email. Your declaration takes effect according to the applicable contract and law from its receipt; processing time does not postpone receipt. / Wir setzen Ihre Erklärung innerhalb von 2 Werktagen im Stripe-Kundenportal um und bestätigen sie per E-Mail. Maßgeblich ist der Eingang Ihrer Erklärung; die Bearbeitungszeit verschiebt ihn nicht.";
    const receipt = `Wissen — Request received / Eingangsbestätigung\nReference: ${row.id}\nReceived (UTC): ${received}\nEmail: ${data.email}\n${declaration}\n${data.note}\n\n${message}\n\nproductivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG\nReichenbergerstr. 2, 94036 Passau\ninfo@productivity-boost.com`;
    if (request.headers.get("accept")?.includes("application/json"))
      return Response.json(
        {
          id: row.id,
          received_at: received,
          kind: data.kind,
          message,
          receipt,
        },
        { status: 201, headers },
      );
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request received · Wissen</title><style>body{font:16px/1.7 system-ui;background:#f8faf7;color:#172921;max-width:760px;margin:48px auto;padding:24px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#285b43;display:inline-block;margin:12px 24px 12px 0}</style></head><body><main><h1>Request received / Erklärung eingegangen</h1><pre>${escapeHtml(receipt)}</pre><a download="wissen-confirmation.txt" href="data:text/plain;charset=utf-8,${escapeHtml(encodeURIComponent(receipt))}">Download confirmation / Bestätigung speichern</a><a href="/">Back to Wissen</a></main></body></html>`,
      {
        status: 201,
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Your request could not be saved. Please retry or email info@productivity-boost.com.",
      },
      { status: 503, headers },
    );
  }
}
