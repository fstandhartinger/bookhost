#!/bin/sh
set -eu
node scripts/migrate.mjs
# live-edit-server.js wraps Next's own request handler with the WebSocket
# upgrade path Live Edit's Hocuspocus server needs (see server-src/main.ts);
# it replaces Next's auto-generated standalone server.js.
exec node live-edit-server.js
