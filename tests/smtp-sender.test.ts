import { afterEach, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { smtpSender } from "../lib/config";

afterEach(() => vi.unstubAllEnvs());

async function serialized(from: string) {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail({ from, to: "user@example.org", subject: "t", text: "t" });
  const header = /^From: (.*)$/m.exec(info.message.toString())?.[1];
  return { envelope: info.envelope.from, header };
}

it.each([
  "noreply@mail.bookhost.co",
  "BookHost <noreply@mail.bookhost.co>",
  "Book Host Team <NoReply@Mail.BookHost.co>",
])("accepted sender %s is what the mailer actually sends from", async (value) => {
  vi.stubEnv("SMTP_HOST", "fixture.invalid");
  vi.stubEnv("SMTP_FROM", value);
  const sender = smtpSender();
  expect(sender).toBe(value);
  const { envelope, header } = await serialized(sender!);
  expect(String(envelope).toLowerCase()).toMatch(/@mail\.bookhost\.co$/);
  expect(header?.toLowerCase()).toMatch(/@mail\.bookhost\.co>?$/);
});

it.each([
  "outside@example.org (BookHost <x@mail.bookhost.co>",
  "x@bookhost.co (BookHost <x@mail.bookhost.co>",
  'outside@example.org "BookHost <x@mail.bookhost.co>',
  "BookHost ( <x@mail.bookhost.co>",
  '"BookHost" <x@mail.bookhost.co>',
  "BookHost: <x@mail.bookhost.co>",
  "a@example.org <x@mail.bookhost.co>",
])("rejects ambiguous display syntax %s", (value) => {
  vi.stubEnv("SMTP_HOST", "fixture.invalid");
  vi.stubEnv("SMTP_FROM", value);
  expect(smtpSender()).toBeUndefined();
});
