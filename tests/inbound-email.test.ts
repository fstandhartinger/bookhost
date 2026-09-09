import { expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  parseEmail,
  senderAllowed,
  normalizePattern,
  verifySignature,
} from "@/lib/intake/email";
const secret = "unit-test-secret";
const raw = Buffer.from('{"hello":true}');
const now = 1700000000000;
const signature = (t: number) =>
  `t=${t},v1=${createHmac("sha256", secret)
    .update(t + ".")
    .update(raw)
    .digest("hex")}`;
it("verifies raw body HMAC and rejects expired, future, wrong and missing signatures", () => {
  expect(verifySignature(raw, signature(now / 1000), secret, now)).toBe(true);
  for (const t of [now / 1000 - 301, now / 1000 + 301])
    expect(verifySignature(raw, signature(t), secret, now)).toBe(false);
  expect(
    verifySignature(Buffer.from("changed"), signature(now / 1000), secret, now),
  ).toBe(false);
  expect(verifySignature(raw, signature(now / 1000), "wrong", now)).toBe(false);
  expect(verifySignature(raw, null, secret, now)).toBe(false);
  expect(verifySignature(raw, signature(now / 1000), undefined, now)).toBe(
    false,
  );
});
it("allows members and exact domains but denies strangers and suffix tricks", () => {
  expect(senderAllowed("MEMBER@example.com", ["member@example.com"], [])).toBe(
    true,
  );
  expect(senderAllowed("guest@company.com", [], ["@company.com"])).toBe(true);
  for (const sender of [
    "stranger@example.com",
    "guest@evilcompany.com",
    "guest@sub.company.com",
  ])
    expect(senderAllowed(sender, [], ["@company.com"])).toBe(false);
  expect(normalizePattern(" @Company.com ")).toBe("@company.com");
  expect(() => normalizePattern("*@example.com\nBcc:evil")).toThrow();
});
export function message() {
  const content = Buffer.from(
    "# Document\n\n" +
      "Team documentation needs careful human review. ".repeat(10),
  );
  return {
    message_id: "unit-message",
    to: ["demo@intake.wissen.app.mintapis.com"],
    from: { address: "member@example.com", name: "Member" },
    subject: "Review checklist",
    text: "",
    received_at: new Date().toISOString(),
    attachments: [
      {
        filename: "checklist.md",
        content_type: "text/markdown",
        size: content.length,
        content_base64: content.toString("base64"),
      },
    ],
  };
}
const parse = (m: unknown) => parseEmail(Buffer.from(JSON.stringify(m)));
it("creates attachment documents and plain-text fallback, ignoring HTML", () => {
  expect(parse(message()).files[0].filename).toBe("checklist.md");
  expect(
    parse({
      ...message(),
      attachments: [],
      text: "a".repeat(201),
      html: "<script>bad</script>",
    }).files[0].content.toString(),
  ).toBe("a".repeat(201));
  expect(() =>
    parse({ ...message(), attachments: [], text: "a".repeat(200) }),
  ).toThrow();
});
it("rejects attachment counts, sizes, encoding, unsafe names and types", () => {
  const m = message();
  expect(() =>
    parse({ ...m, attachments: Array(6).fill(m.attachments[0]) }),
  ).toThrow(/five/);
  for (const override of [
    { size: 11 * 1024 * 1024 },
    { size: 1 },
    { content_base64: "@@" },
    { filename: "../bad.md" },
    { content_type: "text/html" },
    { filename: "run.exe" },
  ])
    expect(() =>
      parse({ ...m, attachments: [{ ...m.attachments[0], ...override }] }),
    ).toThrow();
  expect(() => parse({ ...m, text: "x".repeat(15 * 1024 * 1024) })).toThrow(
    /large/,
  );
  expect(() =>
    parse({ ...m, to: [...m.to, "other@intake.wissen.app.mintapis.com"] }),
  ).toThrow();
});

it("validates canonical pad bits and exact decoded length without re-encoding", () => {
  const m = message();
  for (const [encoded, size, valid] of [
    ["YQ==", 1, true],
    ["YWI=", 2, true],
    ["YR==", 1, false],
    ["YWJ=", 2, false],
    ["YQ", 1, false],
    ["YQ==", 2, false],
    ["Y Q==", 1, false],
  ] as const) {
    const input = {
      ...m,
      attachments: [{ ...m.attachments[0], content_base64: encoded, size }],
    };
    if (valid) expect(parse(input).files[0].content.length).toBe(size);
    else expect(() => parse(input)).toThrow();
  }
});
it("accepts Punycode sender domains and rejects unsupported RFC addr-spec forms with a contract error", () => {
  expect(
    parse({ ...message(), from: { address: "author@xn--bcher-kva.xn--p1ai" } })
      .from.address,
  ).toBe("author@xn--bcher-kva.xn--p1ai");
  for (const address of [
    '"quoted"@example.com',
    "person@bücher.de",
    ".dot@example.com",
    "two..dots@example.com",
    "@example.com",
  ])
    expect(() => parse({ ...message(), from: { address } })).toThrow(
      /from.address must be an ASCII RFC 5322/,
    );
});
