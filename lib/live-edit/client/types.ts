// Shared types for the Live Edit browser embed. This file is bundled by esbuild
// (see scripts/build-live-edit-embed.mjs) into a single browser IIFE — it is never
// compiled by tsc/Next's own build, but is kept type-clean regardless.

/** The BookStack page-info element BookStack always renders, carrying `page-id` / `editor-type`. */
export interface PageInfo {
  pageId: string;
  pageTitle: string;
}

/** Discriminated result of fetching a ticket from the BookStack theme route. */
export type TicketResult =
  | { kind: "ok"; ticket: string; sig: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "error" };

export interface JoinSuccessResponse {
  ok: true;
  wsUrl: string;
  documentName: string;
  joinToken: string;
  canEdit: boolean;
  userName: string;
  userColor: string;
}

export interface JoinFailureResponse {
  ok: false;
  reason: string;
}

export type JoinResponse = JoinSuccessResponse | JoinFailureResponse;

export interface PresenceOkResponse {
  ok: true;
  count: number;
}

export interface PresenceErrorResponse {
  ok: false;
  reason: string;
}

export type PresenceResponse = PresenceOkResponse | PresenceErrorResponse;

/** Options needed to mount the full collaborative editor overlay. */
export interface EditorMountOptions {
  wsUrl: string;
  documentName: string;
  joinToken: string;
  canEdit: boolean;
  userName: string;
  userColor: string;
  pageId: string;
  pageTitle: string;
  /** Called once teardown (provider.destroy() + DOM removal) has finished. */
  onClose: () => void;
}
