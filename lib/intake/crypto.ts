import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const value = process.env.INTAKE_KMS_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Intake encryption is not configured.");
  return Buffer.from(value, "hex");
}
// v1: nonce (12), ciphertext, authentication tag (16), base64. AAD binds to tenant slug.
export function encrypt(value: string, slug: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(slug));
  return (
    "v1:" +
    Buffer.concat([
      nonce,
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64")
  );
}
export function decrypt(value: string, slug: string) {
  if (!value.startsWith("v1:"))
    throw new Error("Invalid encrypted credential.");
  const raw = Buffer.from(value.slice(3), "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  cipher.setAAD(Buffer.from(slug));
  cipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([
    cipher.update(raw.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
