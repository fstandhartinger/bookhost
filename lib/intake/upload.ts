import busboy from "busboy";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntakeError } from "./access";
import { MAX_FILE } from "./content";
export async function streamUpload(request: Request) {
  if (!request.body) throw new IntakeError("Choose a document.");
  if (Number(request.headers.get("content-length")) > MAX_FILE + 65536)
    throw new IntakeError("Request is too large.", 413);
  const dir = await mkdtemp(join(tmpdir(), "wissen-intake-"));
  const path = join(dir, "source");
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const parser = busboy({
      headers: { "content-type": request.headers.get("content-type") || "" },
      limits: {
        files: 1,
        fields: 12,
        fieldSize: 512,
        fileSize: MAX_FILE,
        parts: 16,
      },
    });
    let filename = "";
    let tooLarge = false;
    let bytes = 0;
    let writing: Promise<void> = Promise.resolve();
    const fields: Record<string, string> = {};
    parser.on("field", (name, value, info) => {
      if (info.valueTruncated) tooLarge = true;
      fields[name] = value;
    });
    parser.on("file", (name, file, info) => {
      filename = info.filename;
      if (name !== "file") tooLarge = true;
      file.on("limit", () => {
        tooLarge = true;
      });
      writing = pipeline(file, createWriteStream(path, { mode: 0o600 }));
      writing.catch(() => parser.destroy(new Error("File write failed")));
    });
    let malformed = false;
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
      parser.on(event, () => {
        malformed = true;
      });
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > MAX_FILE + 65536
            ? new IntakeError("Request is too large.", 413)
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream,
      ),
      limiter,
      parser,
      { signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]) },
    );
    await writing;
    if (tooLarge) throw new IntakeError("Request is too large.", 413);
    if (malformed)
      throw new IntakeError("Unexpected form data. Reload the page and try again.", 400);
    if (!filename) throw new IntakeError("Choose a document.");
    return { path, filename, fields, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
