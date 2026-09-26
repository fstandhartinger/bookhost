// BookHost Live Edit — browser embed entry point.
//
// This script is injected unconditionally into every page of a BookStack tenant
// that has the Live Edit beta enabled, via BookStack's `app-custom-head` setting
// (a public <script> tag in every page's <head>, already nonce-safe for CSP).
// It therefore MUST NEVER break the host page: every top-level path is wrapped in
// try/catch, unexpected states get a console.warn and the script otherwise
// disappears silently.
//
// Known limitation (phase 1): only WYSIWYG-edited BookStack pages are supported.
// BookStack's page-view component does not expose its editor type, so the server
// makes the authoritative check when the user tries to join. The native edit
// route does expose its editor type and is checked here before polling presence.

import { injectStyles } from "./styles";
import { mountEditor } from "./editor";
import {
  getBookStackEditorType,
  getBookStackPageId,
  getBookStackPageInfo,
} from "./page-info";
import type { JoinResponse, PresenceResponse, TicketResult } from "./types";

// BookHost's control-plane origin. Hardcoded on purpose for this MVP: Live Edit is
// BookHost-specific infrastructure, not a configurable per-tenant knob.
const CONTROL_PLANE_ORIGIN = "https://bookhost.co";

const PRESENCE_POLL_INTERVAL_MS = 10_000;

function warn(...args: unknown[]): void {
  try {
    console.warn("[live-edit]", ...args);
  } catch {
    // console can theoretically be unavailable/overridden; never let logging throw.
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    warn(error);
  }
}

function getPageTitle(): string {
  const raw = typeof document.title === "string" ? document.title : "";
  // BookStack renders titles like "Page Name | Book Name | Site Name". Best-effort:
  // the first segment before a separator is the page title.
  const firstSegment = raw.split(/\s[|–—-]\s/)[0]?.trim();
  return firstSegment || raw || "Untitled page";
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchTicket(pageId: string): Promise<TicketResult> {
  try {
    const url = `${location.origin}/live-edit/ticket/${encodeURIComponent(pageId)}`;
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "error" };
    const data = await parseJsonSafe<{ ticket?: unknown; sig?: unknown }>(response);
    if (data && typeof data.ticket === "string" && typeof data.sig === "string") {
      return { kind: "ok", ticket: data.ticket, sig: data.sig };
    }
    return { kind: "error" };
  } catch (error) {
    warn("ticket request failed", error);
    return { kind: "error" };
  }
}

async function fetchJoin(ticket: string, sig: string): Promise<JoinResponse | null> {
  try {
    const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/live-edit/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, sig }),
    });
    const data = await parseJsonSafe<JoinResponse>(response);
    if (!data || typeof data.ok !== "boolean") return null;
    return data;
  } catch (error) {
    warn("join request failed", error);
    return null;
  }
}

async function fetchPresence(ticket: string, sig: string): Promise<PresenceResponse | null> {
  try {
    const url = `${CONTROL_PLANE_ORIGIN}/api/live-edit/presence?ticket=${encodeURIComponent(ticket)}&sig=${encodeURIComponent(sig)}`;
    const response = await fetch(url, { credentials: "omit" });
    const data = await parseJsonSafe<PresenceResponse>(response);
    if (!data || typeof data.ok !== "boolean") return null;
    return data;
  } catch (error) {
    warn("presence poll failed", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Soft-lock banner mode (BookStack's own `/edit` route).
// ---------------------------------------------------------------------------

function buildSoftLockBanner(): {
  root: HTMLElement;
  countEl: HTMLElement;
  show: (count: number) => void;
  hide: () => void;
} {
  const root = document.createElement("div");
  root.id = "live-edit-softlock-banner";

  const text = document.createElement("span");
  const countEl = document.createElement("span");
  countEl.setAttribute("data-live-edit-count", "");
  text.appendChild(countEl);
  text.appendChild(document.createTextNode(" people are editing this page live — "));

  const link = document.createElement("a");
  link.className = "live-edit-softlock-link";
  link.textContent = "Join instead";
  link.href = location.pathname.replace(/\/edit\/?$/, "");
  text.appendChild(link);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "live-edit-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";

  root.appendChild(text);
  root.appendChild(dismiss);
  document.body.appendChild(root);

  let dismissed = false;
  dismiss.addEventListener("click", () => {
    dismissed = true;
    root.classList.remove("live-edit-visible");
  });

  return {
    root,
    countEl,
    show(count: number) {
      if (dismissed) return;
      countEl.textContent = String(count);
      root.classList.add("live-edit-visible");
    },
    hide() {
      root.classList.remove("live-edit-visible");
      // A fresh non-zero count after the banner drops to zero should be able to
      // reappear even if the user dismissed an earlier one.
      dismissed = false;
    },
  };
}

function initSoftLock(pageId: string): void {
  void (async () => {
    const ticketResult = await fetchTicket(pageId);
    if (ticketResult.kind !== "ok") {
      // No usable ticket (forbidden / not found / transient error): nothing to poll.
      return;
    }
    const { ticket, sig } = ticketResult;
    const banner = buildSoftLockBanner();

    const poll = async () => {
      const presence = await fetchPresence(ticket, sig);
      if (!presence) return;
      if (!presence.ok) {
        warn("presence check failed:", presence.reason);
        banner.hide();
        return;
      }
      if (presence.count > 0) {
        banner.show(presence.count);
      } else {
        banner.hide();
      }
    };

    const intervalId = window.setInterval(() => {
      void poll();
    }, PRESENCE_POLL_INTERVAL_MS);
    window.addEventListener("beforeunload", () => window.clearInterval(intervalId));

    void poll();
  })();
}

// ---------------------------------------------------------------------------
// Join mode (normal page-view route).
// ---------------------------------------------------------------------------

function showInlineMessage(message: string, tone: "neutral" | "warn" = "neutral"): HTMLElement {
  const el = document.createElement("div");
  el.className = "live-edit-inline-message" + (tone === "warn" ? " live-edit-tone-warn" : "");
  const text = document.createElement("span");
  text.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "live-edit-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => el.remove());
  el.appendChild(text);
  el.appendChild(dismiss);
  document.body.appendChild(el);
  return el;
}

function initJoinButton(pageId: string, pageTitle: string): void {
  const button = document.createElement("button");
  button.id = "live-edit-button";
  button.type = "button";
  const dot = document.createElement("span");
  dot.className = "live-edit-dot";
  button.appendChild(dot);
  button.appendChild(document.createTextNode("Live Edit"));
  document.body.appendChild(button);

  let busy = false;

  button.addEventListener("click", () => {
    if (busy) return;
    void (async () => {
      busy = true;
      button.setAttribute("disabled", "true");
      try {
        const ticketResult = await fetchTicket(pageId);

        if (ticketResult.kind === "forbidden") {
          showInlineMessage("You don't have permission to edit this page.", "warn");
          return;
        }
        if (ticketResult.kind === "not_found") {
          // Feature not available for this page/tenant — hide silently, no error shown.
          button.remove();
          return;
        }
        if (ticketResult.kind === "error") {
          warn("could not obtain live edit ticket");
          return;
        }

        const joinResponse = await fetchJoin(ticketResult.ticket, ticketResult.sig);
        if (!joinResponse) {
          warn("join request returned an unexpected response");
          return;
        }
        if (!joinResponse.ok) {
          showInlineMessage(joinResponse.reason, "warn");
          return;
        }

        button.style.display = "none";
        mountEditor({
          wsUrl: joinResponse.wsUrl,
          documentName: joinResponse.documentName,
          joinToken: joinResponse.joinToken,
          canEdit: joinResponse.canEdit,
          userName: joinResponse.userName,
          userColor: joinResponse.userColor,
          pageId,
          pageTitle,
          onClose: () => {
            button.style.display = "";
          },
        });
      } finally {
        busy = false;
        button.removeAttribute("disabled");
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function init(): void {
  safe(() => {
    injectStyles();

    // Signal the bundle loaded and ran, regardless of whether this particular
    // page qualifies for Live Edit below — this is what an e2e test checks first.
    (window as unknown as { __liveEdit?: { version: string } }).__liveEdit = { version: "1" };

    const pageInfoEl = getBookStackPageInfo(document, location.pathname);
    if (!pageInfoEl) return; // not a book page

    const pageId = getBookStackPageId(pageInfoEl, location.pathname);
    if (!pageId) return;

    const pageTitle = getPageTitle();

    if (location.pathname.endsWith("/edit")) {
      if (getBookStackEditorType(pageInfoEl) !== "wysiwyg") return;
      initSoftLock(pageId);
    } else {
      const editorType = getBookStackEditorType(pageInfoEl);
      if (editorType && editorType !== "wysiwyg") return;
      initJoinButton(pageId, pageTitle);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
