// Injects a single scoped <style> tag for every visual piece of the Live Edit embed.
// All rules are scoped under `.live-edit-` / `#live-edit-` prefixes so nothing collides
// with BookStack's own CSS. No external stylesheet is loaded.

const STYLE_ELEMENT_ID = "live-edit-styles";

const CSS = `
#live-edit-button {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 999px;
  background: #1c3faa;
  color: #fff;
  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
#live-edit-button:hover { opacity: 0.92; }
#live-edit-button[disabled] { cursor: default; opacity: 0.7; }
#live-edit-button .live-edit-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5be37a;
  display: inline-block;
}

.live-edit-inline-message {
  position: fixed;
  right: 20px;
  bottom: 72px;
  z-index: 2147483000;
  max-width: 280px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #2a2a2a;
  color: #fff;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.live-edit-inline-message.live-edit-tone-warn {
  background: #7a4b00;
}
.live-edit-inline-message .live-edit-dismiss {
  margin-left: 10px;
  cursor: pointer;
  background: none;
  border: none;
  color: inherit;
  font-weight: 700;
  opacity: 0.8;
}

#live-edit-softlock-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2147483000;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background: #fff3cd;
  color: #664d03;
  border-bottom: 1px solid #ffe69c;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
#live-edit-softlock-banner.live-edit-visible { display: flex; }
#live-edit-softlock-banner a.live-edit-softlock-link {
  color: #1c3faa;
  font-weight: 700;
  text-decoration: underline;
}
#live-edit-softlock-banner .live-edit-dismiss {
  cursor: pointer;
  background: none;
  border: none;
  color: inherit;
  font-weight: 700;
  opacity: 0.7;
}

#live-edit-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483600;
  display: flex;
  flex-direction: column;
  background: #fff;
  font: 400 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #1a1a1a;
}

#live-edit-overlay .live-edit-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #e2e2e2;
  background: #f7f8fb;
  flex-shrink: 0;
}
#live-edit-overlay .live-edit-title {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#live-edit-overlay .live-edit-beta-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #1c3faa;
  background: #e5eaff;
  padding: 2px 8px;
  border-radius: 999px;
}
#live-edit-overlay .live-edit-viewonly-label {
  font-size: 11px;
  font-weight: 700;
  color: #7a4b00;
  background: #fff3cd;
  padding: 2px 8px;
  border-radius: 999px;
}
#live-edit-overlay .live-edit-collaborators {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
#live-edit-overlay .live-edit-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
  margin-left: -6px;
}
#live-edit-overlay .live-edit-close {
  cursor: pointer;
  border: none;
  background: #ececec;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  font-size: 16px;
  line-height: 1;
  color: #333;
}
#live-edit-overlay .live-edit-close:hover { background: #e0e0e0; }

#live-edit-editor-root {
  flex: 1;
  overflow: auto;
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
#live-edit-editor-root .ProseMirror {
  outline: none;
  min-height: 100%;
}
#live-edit-editor-root .ProseMirror table {
  border-collapse: collapse;
  margin: 0;
  overflow: hidden;
  table-layout: fixed;
  width: 100%;
}
#live-edit-editor-root .ProseMirror td,
#live-edit-editor-root .ProseMirror th {
  border: 1px solid #d7d7d7;
  padding: 6px 8px;
  vertical-align: top;
}
#live-edit-editor-root .ProseMirror pre {
  background: #1a1a1a;
  color: #f4f4f4;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
}

/* Remote cursor decorations rendered by @tiptap/extension-collaboration-caret.
   These class names are the extension's own defaults — do not rename. */
.collaboration-carets__caret {
  border-left: 1.5px solid;
  margin-left: -1.5px;
  margin-right: -1.5px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}
.collaboration-carets__label {
  position: absolute;
  top: -1.4em;
  left: -1.5px;
  font-size: 11px;
  font-weight: 700;
  line-height: normal;
  white-space: nowrap;
  color: #fff;
  padding: 1px 6px;
  border-radius: 3px;
  user-select: none;
}
`;

/** Injects the shared <style> tag once. Safe to call multiple times. */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
