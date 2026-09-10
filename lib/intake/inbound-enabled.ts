import { IntakeError } from "./access";

export class InboundEmailDisabledError extends IntakeError {
  constructor() {
    super("Inbound email intake is disabled.", 403);
  }
}

export function inboundEmailEnabled() {
  return process.env.INBOUND_EMAIL_ENABLED === "true";
}

export function requireInboundEmail(phase: string) {
  if (inboundEmailEnabled()) return;
  console.warn({ event: "inbound_email_disabled", phase });
  throw new InboundEmailDisabledError();
}
