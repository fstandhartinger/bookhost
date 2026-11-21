// Types for the vendored logkit (logging standard, AGENTS.md; canonical copy /home/flori/tools/logkit).
import type { IncomingMessage, ServerResponse } from "node:http";
export interface Logger {
  debug(msg: string | Error, fields?: Record<string, unknown>): void;
  info(msg: string | Error, fields?: Record<string, unknown>): void;
  warn(msg: string | Error, fields?: Record<string, unknown>): void;
  error(msg: string | Error, fields?: Record<string, unknown>): void;
  fatal(msg: string | Error, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
  app: string;
}
export function createLogger(opts?: { app?: string; level?: string; base?: Record<string, unknown>; write?: (line: string) => void }): Logger;
export function httpLogger(
  log: Logger,
  opts?: { skip?: Array<string | RegExp>; header?: string; ip?: boolean; ua?: boolean },
): (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;
export function captureConsole(log: Logger): void;
export function installProcessHandlers(log: Logger): void;
export function timed<T>(log: Logger, name: string, fn: () => Promise<T>, fields?: Record<string, unknown>): Promise<T>;
export function scrubText(s: string): string;
export function hashId(value: unknown, kind?: string): string;
