export type ChatSource = {
  pageId: number;
  pageName: string;
  section: string | null;
  url: string | null;
  excerpt: string;
};

export type ChatAnswer = {
  question: string;
  answer: string;
  sources: ChatSource[];
  refused: boolean;
  mode: "extractive" | "ai";
  retrieval?: "lexical" | "hybrid";
  terms?: string[];
  quota?: { remaining: number; limit: number } | null;
};

export type ChatLink = { href: string; label: string };

export type ChatFailure = {
  message: string;
  retry: boolean;
  link?: ChatLink;
};

export type AskOutcome =
  | { ok: true; answer: ChatAnswer }
  | { ok: false; failure: ChatFailure }
  | { ok: false; cancelled: true };

const SUPPORT_LINK: ChatLink = {
  href: "mailto:info@productivity-boost.com",
  label: "Contact support",
};

export const TRANSPORT_FAILURE =
  "The connection failed. Check your internet connection, then try again.";
export const UNREADABLE_FAILURE =
  "The server reply could not be read. Please try again; if it continues, contact support.";
export const MALFORMED_FAILURE =
  "The server reply was incomplete, so the answer could not be shown. Please try again.";
export const QUESTION_FAILURE =
  "Enter a question between 3 and 500 characters.";
export const USAGE_LIMIT_FAILURE =
  "A usage limit was reached. Please try again later.";

export function failureForStatus(status: number): ChatFailure {
  switch (status) {
    case 401:
      return {
        message:
          "Your session has expired. Sign in again to keep asking questions.",
        retry: false,
        link: { href: "/login", label: "Sign in" },
      };
    case 402:
      return {
        message:
          "This workspace's question allowance needs attention. Check the plan and billing to continue.",
        retry: false,
        link: { href: "/app", label: "Manage billing" },
      };
    case 403:
      return {
        message:
          "Only workspace owners and admins can ask the wiki in this beta. Please ask a workspace owner or admin to try.",
        retry: false,
      };
    case 404:
      return {
        message:
          "This workspace is not available. Switch to another workspace or open Your workspace.",
        retry: false,
        link: { href: "/app", label: "Your workspace" },
      };
    case 409:
      return {
        message:
          "This workspace cannot answer questions right now. Check its status and billing, including whether the subscription is active.",
        retry: false,
        link: { href: "/app", label: "Check status and billing" },
      };
    case 429:
      return { message: USAGE_LIMIT_FAILURE, retry: true };
    case 503:
      return {
        message:
          "The knowledge service is temporarily unavailable. Please try again shortly; if it continues, contact support.",
        retry: true,
        link: SUPPORT_LINK,
      };
    default:
      return {
        message:
          "The question could not be answered. Please try again; if it continues, contact support.",
        retry: true,
        link: SUPPORT_LINK,
      };
  }
}

export function transportFailure(): ChatFailure {
  return { message: TRANSPORT_FAILURE, retry: true };
}

export function unreadableFailure(): ChatFailure {
  return { message: UNREADABLE_FAILURE, retry: true };
}

export function malformedFailure(): ChatFailure {
  return { message: MALFORMED_FAILURE, retry: true };
}

export function questionFailure(): ChatFailure {
  return { message: QUESTION_FAILURE, retry: false };
}

export function createInflightGuard() {
  let held = false;
  return {
    enter() {
      if (held) return false;
      held = true;
      return true;
    },
    leave() {
      held = false;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validSource(value: unknown): value is ChatSource {
  if (!isRecord(value)) return false;
  return (
    typeof value.pageId === "number" &&
    Number.isFinite(value.pageId) &&
    typeof value.pageName === "string" &&
    stringOrNull(value.section) &&
    stringOrNull(value.url) &&
    typeof value.excerpt === "string"
  );
}

export function parseChatAnswer(data: unknown): ChatAnswer | null {
  if (!isRecord(data)) return null;
  if (typeof data.question !== "string") return null;
  if (typeof data.answer !== "string") return null;
  if (!Array.isArray(data.sources) || !data.sources.every(validSource))
    return null;
  if (typeof data.refused !== "boolean") return null;
  if (data.mode !== "extractive" && data.mode !== "ai") return null;
  if (
    data.retrieval !== undefined &&
    data.retrieval !== "lexical" &&
    data.retrieval !== "hybrid"
  )
    return null;
  if (
    data.terms !== undefined &&
    (!Array.isArray(data.terms) ||
      !data.terms.every((term) => typeof term === "string"))
  )
    return null;
  if (data.quota !== undefined && data.quota !== null) {
    if (
      !isRecord(data.quota) ||
      typeof data.quota.remaining !== "number" ||
      !Number.isFinite(data.quota.remaining) ||
      typeof data.quota.limit !== "number" ||
      !Number.isFinite(data.quota.limit)
    )
      return null;
  }
  return data as unknown as ChatAnswer;
}

export async function requestAnswer(
  fetchImpl: typeof fetch,
  input: { tenant: string; question: string },
  signal?: AbortSignal,
): Promise<AskOutcome> {
  const question = input.question.trim();
  if (question.length < 3 || question.length > 500)
    return { ok: false, failure: questionFailure() };
  let response: Response;
  try {
    response = await fetchImpl("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant: input.tenant, question }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      return { ok: false, cancelled: true };
    return { ok: false, failure: transportFailure() };
  }
  if (!response.ok)
    return { ok: false, failure: failureForStatus(response.status) };
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, failure: unreadableFailure() };
  }
  const answer = parseChatAnswer(data);
  if (!answer) return { ok: false, failure: malformedFailure() };
  return { ok: true, answer };
}
