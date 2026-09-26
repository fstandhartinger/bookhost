// Custom server: wraps Next's own request handler with one addition — a
// WebSocket upgrade path for Live Edit's embedded Hocuspocus server. Next.js
// API routes cannot handle WS upgrades, and Live Edit's design (see
// PLAN.md / REPORT.md) deliberately embeds Hocuspocus in this single existing
// process rather than adding a second Coolify service, matching the app's
// existing single-process constraint (in-process cron dedup, rate limits).
//
// Bundled by scripts/build-server.mjs into ./live-edit-server.js (own source
// only; node_modules stays external — see that script for why) and run via
// scripts/entrypoint.sh instead of Next's auto-generated standalone server.js.
import { createServer } from "node:http";
import type { Socket } from "node:net";
import next from "next";
import crossws from "crossws/adapters/node";
import type { Hocuspocus, WebSocketLike } from "@hocuspocus/server";
import {
  hocuspocusServer,
  waitForLiveEditFlush,
} from "@/lib/live-edit/hocuspocus";

// Hocuspocus doesn't publicly export the ClientConnection class its own
// handleConnection() returns; derive the type from that method instead of
// re-declaring it by hand.
type HocuspocusConnection = ReturnType<Hocuspocus["handleConnection"]>;

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";
const LIVE_EDIT_WS_PATH = "/live-edit-ws";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const hocuspocus = hocuspocusServer();

  const ws = crossws({
    hooks: {
      open: (peer) => {
        const connection = hocuspocus.handleConnection(
          peer.websocket as unknown as WebSocketLike,
          peer.request,
        );
        peer.context.hocuspocus = connection;
      },
      message: (peer, message) => {
        (peer.context.hocuspocus as HocuspocusConnection | undefined)?.handleMessage(
          message.uint8Array(),
        );
      },
      close: (peer, details) => {
        (peer.context.hocuspocus as HocuspocusConnection | undefined)?.handleClose({
          code: details.code ?? 1000,
          reason: details.reason ?? "",
        });
      },
      error: (peer, error) => {
        console.error("[live-edit-ws] peer error", error);
      },
    },
  });

  const server = createServer((req, res) => handle(req, res));

  server.on("upgrade", (request, socket: Socket, head) => {
    const url = request.url || "";
    if (!url.startsWith(LIVE_EDIT_WS_PATH)) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(request, socket, head);
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (Live Edit WS at ${LIVE_EDIT_WS_PATH})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[live-edit] ${signal}: saving active documents before shutdown`);
    const forceExit = setTimeout(() => process.exit(1), 30_000);
    server.close();
    void waitForLiveEditFlush(25_000).finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
