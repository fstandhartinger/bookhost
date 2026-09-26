// Per-document connection counts, used only for the soft-lock banner ("N
// people are editing live"). Deliberately has zero Yjs/Hocuspocus imports:
// Next's own webpack build bundles any file a route imports into its own
// server chunk, which would otherwise create a second, separately
// instantiated copy of the Hocuspocus singleton (and a second Yjs module
// instance — Yjs explicitly warns this "breaks constructor checks") next to
// the one actually handling WebSocket connections in live-edit-server.js.
// `globalThis` is the same object across both bundles in one Node process,
// so it's the one thing safe to share this way.
declare global {
  var __liveEditPresence: Map<string, number> | undefined;
}

function store() {
  globalThis.__liveEditPresence ??= new Map<string, number>();
  return globalThis.__liveEditPresence;
}

export function presenceJoin(documentName: string) {
  const map = store();
  map.set(documentName, (map.get(documentName) || 0) + 1);
}

export function presenceLeave(documentName: string) {
  const map = store();
  const next = (map.get(documentName) || 0) - 1;
  if (next <= 0) map.delete(documentName);
  else map.set(documentName, next);
}

export function presenceCount(documentName: string) {
  return store().get(documentName) || 0;
}
