import { execFile } from "node:child_process";
import { join } from "node:path";
export function extractFile(
  path: string,
  filename: string,
): Promise<{ text: string; mime: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--max-old-space-size=256",
        join(process.cwd(), "scripts/intake-extract.mjs"),
        path,
        filename.split(".").pop()?.toLowerCase() || "",
      ],
      {
        timeout: 20000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        env: { NODE_ENV: "production" },
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              "Could not read this file within extraction limits. Use an unencrypted PDF, DOCX or UTF-8 text file.",
            ),
          );
        else {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Invalid extraction result."));
          }
        }
      },
    );
  });
}
