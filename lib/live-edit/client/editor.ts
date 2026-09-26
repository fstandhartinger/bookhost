// Mounts the full collaborative editor overlay: Yjs doc + HocuspocusProvider +
// Tiptap core Editor (vanilla, no @tiptap/react — this is injected into a foreign
// page, no framework can be assumed present).

import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { EditorMountOptions } from "./types";

const lowlight = createLowlight(common);

interface AwarenessUser {
  clientId: number;
  name?: string;
  color?: string;
  [key: string]: unknown;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Mounts the full-viewport collaborative editor overlay and returns nothing;
 * `options.onClose` is invoked once teardown (provider destroy + DOM removal)
 * has completed, so the caller (embed.ts) can e.g. re-show the floating button.
 */
export function mountEditor(options: EditorMountOptions): void {
  const {
    wsUrl,
    documentName,
    joinToken,
    canEdit,
    userName,
    userColor,
    pageTitle,
    onClose,
  } = options;

  const ydoc = new Y.Doc();
  let provider: HocuspocusProvider | null = null;
  let editor: Editor | null = null;
  let closed = false;

  const overlay = document.createElement("div");
  overlay.id = "live-edit-overlay";

  const header = document.createElement("div");
  header.className = "live-edit-header";

  const title = document.createElement("div");
  title.className = "live-edit-title";
  title.textContent = pageTitle || "Untitled page";

  const betaLabel = document.createElement("span");
  betaLabel.className = "live-edit-beta-label";
  betaLabel.textContent = "Live Edit (beta)";

  header.appendChild(title);
  header.appendChild(betaLabel);

  if (!canEdit) {
    const viewOnlyLabel = document.createElement("span");
    viewOnlyLabel.className = "live-edit-viewonly-label";
    viewOnlyLabel.textContent = "(view only)";
    header.appendChild(viewOnlyLabel);
  }

  const collaborators = document.createElement("div");
  collaborators.className = "live-edit-collaborators";
  header.appendChild(collaborators);

  const closeButton = document.createElement("button");
  closeButton.className = "live-edit-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close Live Edit");
  closeButton.textContent = "×";
  header.appendChild(closeButton);

  const editorRoot = document.createElement("div");
  editorRoot.id = "live-edit-editor-root";

  const saveNotice = document.createElement("div");
  saveNotice.id = "live-edit-save-notice";
  saveNotice.setAttribute("role", "status");
  saveNotice.setAttribute("aria-live", "polite");
  saveNotice.hidden = true;

  overlay.appendChild(header);
  overlay.appendChild(saveNotice);
  overlay.appendChild(editorRoot);
  document.body.appendChild(overlay);

  function renderCollaborators(): void {
    try {
      const users = (editor?.storage as { collaborationCaret?: { users: AwarenessUser[] } } | undefined)
        ?.collaborationCaret?.users;
      if (!users) return;
      collaborators.innerHTML = "";
      // Cap the visible chips so a very busy page doesn't blow out the header.
      const visible = users.slice(0, 8);
      for (const user of visible) {
        const chip = document.createElement("span");
        chip.className = "live-edit-avatar";
        const color = typeof user.color === "string" && /^#[0-9a-fA-F]{6}$/.test(user.color) ? user.color : "#888";
        chip.style.backgroundColor = color;
        const name = typeof user.name === "string" && user.name ? user.name : "?";
        chip.title = name;
        chip.textContent = initials(name);
        collaborators.appendChild(chip);
      }
    } catch (error) {
      console.warn("[live-edit] failed to render collaborators", error);
    }
  }

  function teardown(): void {
    if (closed) return;
    closed = true;
    try {
      editor?.destroy();
    } catch (error) {
      console.warn("[live-edit] editor teardown failed", error);
    }
    try {
      provider?.destroy();
    } catch (error) {
      console.warn("[live-edit] provider teardown failed", error);
    }
    try {
      overlay.remove();
    } catch (error) {
      console.warn("[live-edit] overlay removal failed", error);
    }
    try {
      onClose();
    } catch (error) {
      console.warn("[live-edit] onClose handler failed", error);
    }
  }

  closeButton.addEventListener("click", teardown);

  try {
    provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentName,
      document: ydoc,
      token: joinToken,
      onAuthenticationFailed: ({ reason }) => {
        console.warn("[live-edit] authentication failed:", reason);
      },
      onDisconnect: () => {
        console.warn("[live-edit] disconnected from live edit session");
      },
    });

    provider.on("stateless", ({ payload }: { payload: string }) => {
      try {
        const message = JSON.parse(payload) as {
          type?: string;
          message?: string;
        };
        if (message.type === "bookhost-live-edit-save-ok") {
          saveNotice.hidden = true;
          return;
        }
        if (
          message.type === "bookhost-live-edit-save-error" ||
          message.type === "bookhost-live-edit-save-conflict"
        ) {
          saveNotice.textContent =
            message.message || "Live Edit could not confirm this save.";
          saveNotice.hidden = false;
          saveNotice.classList.toggle(
            "live-edit-save-conflict",
            message.type === "bookhost-live-edit-save-conflict",
          );
          if (message.type === "bookhost-live-edit-save-conflict") {
            editor?.setEditable(false);
            provider?.destroy();
          }
        }
      } catch (error) {
        console.warn("[live-edit] invalid save status message", error);
      }
    });

    provider.awareness?.on("update", renderCollaborators);
    provider.awareness?.on("change", renderCollaborators);

    editor = new Editor({
      element: editorRoot,
      editable: canEdit,
      extensions: [
        StarterKit.configure({
          // Yjs (via the Collaboration extension) owns undo/redo history and the
          // underline mark comes from the standalone Underline extension below;
          // code blocks come from CodeBlockLowlight instead of the default.
          undoRedo: false,
          underline: false,
          codeBlock: false,
        }),
        Underline,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Image,
        CodeBlockLowlight.configure({ lowlight }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({
          provider,
          user: { name: userName, color: userColor },
        }),
      ],
    });

    // Render once immediately (covers the local user before any remote awareness event fires).
    renderCollaborators();
  } catch (error) {
    console.warn("[live-edit] failed to initialize collaborative editor", error);
    teardown();
  }
}
