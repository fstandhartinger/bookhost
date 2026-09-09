import { createHmac, timingSafeEqual } from "node:crypto";
import { IntakeError } from "./access";
export const EMAIL_LIMIT = 15 * 1024 * 1024;
import { TENANT_DOMAIN } from "../config";
export const EMAIL_DOMAIN = `intake.${TENANT_DOMAIN}`;
export function verifySignature(
  raw: Buffer,
  header: string | null,
  secret: string | undefined,
  now = Date.now(),
) {
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header || "");
  if (!secret || !match || Math.abs(now / 1000 - Number(match[1])) > 300)
    return false;
  return timingSafeEqual(
    createHmac("sha256", secret)
      .update(match[1] + ".")
      .update(raw)
      .digest(),
    Buffer.from(match[2], "hex"),
  );
}
export function normalizePattern(value: string) {
  const pattern = value.trim().toLowerCase();
  if (
    pattern.length > 254 ||
    !/^(?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]+)?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(
      pattern,
    )
  )
    throw new IntakeError(
      "Enter an email address or domain such as @company.com.",
    );
  return pattern;
}
export function senderAllowed(
  email: string,
  members: string[],
  patterns: string[],
) {
  const address = email.toLowerCase();
  return (
    members.some((m) => m.toLowerCase() === address) ||
    patterns.some(
      (p) =>
        p === address ||
        (p.startsWith("@") && address.slice(address.lastIndexOf("@")) === p),
    )
  );
}
export function parseEmail(raw: Buffer) {
  // JSON is untrusted even when delivered by an authenticated transport.
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new IntakeError("Invalid JSON.");
  }
  if (
    !body ||
    typeof body.message_id !== "string" ||
    !body.message_id.trim() ||
    body.message_id.length > 998 ||
    !Array.isArray(body.to) ||
    body.to.length !== 1 ||
    typeof body.to[0] !== "string" ||
    typeof body.from?.address !== "string" ||
    typeof body.subject !== "string" ||
    body.subject.length > 998 ||
    typeof body.text !== "string" ||
    typeof body.received_at !== "string" ||
    !Number.isFinite(Date.parse(body.received_at)) ||
    (body.from.name !== undefined &&
      (typeof body.from.name !== "string" || body.from.name.length > 255)) ||
    (body.html !== undefined && typeof body.html !== "string") ||
    !Array.isArray(body.attachments)
  )
    throw new IntakeError("Invalid email fields.");
  let address: string;
  try {
    address = normalizePattern(body.from.address);
    const local = address.split("@")[0];
    if (
      !local ||
      local.length > 64 ||
      local.startsWith(".") ||
      local.endsWith(".") ||
      local.includes("..")
    )
      throw new Error();
  } catch {
    throw new IntakeError(
      "from.address must be an ASCII RFC 5322 dot-atom addr-spec; use Punycode for IDN domains.",
    );
  }
  const recipient = body.to[0].toLowerCase();
  const tenantDomainPattern = TENANT_DOMAIN.split(".").map((part) => part.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")).join("\\.");
  const match = new RegExp(`^([a-z0-9]+(?:-[a-z0-9]+)*)@intake\\.${tenantDomainPattern}$`).exec(recipient);
  if (!match) throw new IntakeError("Workspace not found.", 404);
  if (body.attachments.length > 5)
    throw new IntakeError("At most five attachments are accepted.", 413);
  let total = Buffer.byteLength(body.text) + Buffer.byteLength(body.html || "");
  const files: { filename: string; mime: string; content: Buffer }[] = [];
  const types: Record<string, string[]> = {
    pdf: ["application/pdf"],
    docx: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    md: ["text/markdown", "text/plain"],
    txt: ["text/plain"],
  };
  for (const a of body.attachments) {
    if (
      !a ||
      typeof a.filename !== "string" ||
      !a.filename ||
      a.filename.length > 255 ||
      /[/\\\x00-\x1f]/.test(a.filename) ||
      typeof a.content_base64 !== "string" ||
      !Number.isSafeInteger(a.size) ||
      a.size <= 0
    )
      throw new IntakeError("Invalid attachment.");
    const ext = a.filename.split(".").pop()!.toLowerCase();
    if (!types[ext]?.includes(a.content_type))
      throw new IntakeError("Use PDF, DOCX, Markdown or text attachments.");
    if (
      a.size > 10 * 1024 * 1024 ||
      a.content_base64.length > Math.ceil((10 * 1024 * 1024) / 3) * 4
    )
      throw new IntakeError("Attachment is too large.", 413);
    const encoded = a.content_base64;
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new IntakeError("Invalid base64.");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const decodedLength = (encoded.length / 4) * 3 - padding;
    // Check unused pad bits too, without allocating a re-encoded copy.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (
      padding &&
      alphabet.indexOf(encoded[encoded.length - padding - 1]) &
        (padding === 2 ? 15 : 3)
    )
      throw new IntakeError("Invalid base64.");
    if (decodedLength !== a.size)
      throw new IntakeError("Attachment size mismatch.");
    const content = Buffer.from(encoded, "base64");
    if (content.length !== a.size)
      throw new IntakeError("Attachment size mismatch.");
    total += content.length;
    files.push({ filename: a.filename, mime: a.content_type, content });
  }
  if (total > EMAIL_LIMIT) throw new IntakeError("Email is too large.", 413);
  if (!files.length) {
    if (body.text.trim().length <= 200)
      throw new IntakeError(
        "A text-only email must contain more than 200 characters.",
      );
    files.push({
      filename: "email.md",
      mime: "text/markdown",
      content: Buffer.from(body.text),
    });
  }
  return {
    message_id: body.message_id,
    slug: match[1],
    from: { address, name: body.from.name || "" },
    subject: body.subject,
    received_at: body.received_at,
    files,
  };
}
