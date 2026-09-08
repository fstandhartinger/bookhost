// Isolated parser: no credentials inherited, bounded heap, killed by parent at 20s.
import { readFile } from "node:fs/promises";
try {
  const data = await readFile(process.argv[2]);
  const ext = process.argv[3];
  if (!data.length || data.length > 10 * 1024 * 1024)
    throw Error("Choose a non-empty file up to 10 MB.");
  let text, mime;
  if (ext === "md" || ext === "txt") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    mime = ext === "md" ? "text/markdown" : "text/plain";
  } else if (ext === "docx") {
    // Validate actual decompressed bytes before giving the archive to Mammoth.
    const yauzl = await import("yauzl");
    await new Promise((resolve, reject) =>
      yauzl.fromBuffer(
        data,
        { lazyEntries: true, validateEntrySizes: true },
        (error, zip) => {
          if (error) return reject(error);
          let entries = 0,
            total = 0,
            hasDocument = false;
          const fail = (error) => {
            zip.close();
            reject(error);
          };
          zip.on("error", fail);
          zip.on("end", () =>
            hasDocument ? resolve() : reject(Error("Missing document")),
          );
          zip.on("entry", (entry) => {
            if (++entries > 1000 || entry.uncompressedSize > 20 * 1024 * 1024)
              return fail(Error("Archive limit"));
            if (entry.fileName === "word/document.xml") hasDocument = true;
            if (entry.fileName.endsWith("/")) return zip.readEntry();
            zip.openReadStream(entry, (error, stream) => {
              if (error) return fail(error);
              let tail = "";
              stream.on("error", fail);
              stream.on("data", (chunk) => {
                total += chunk.length;
                const xml = tail + chunk.toString("utf8");
                tail = xml.slice(-32);
                if (
                  total > 20 * 1024 * 1024 ||
                  /<!DOCTYPE|<!ENTITY/i.test(xml)
                ) {
                  stream.destroy();
                  fail(Error("Archive expansion/XML limit"));
                }
              });
              stream.on("end", () => zip.readEntry());
            });
          });
          zip.readEntry();
        },
      ),
    );
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: data })).value;
    mime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (ext === "pdf") {
    if (data.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid PDF.");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const info = await parser.getInfo();
      if (info.total > 200) throw Error("PDF exceeds 200 pages.");
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
    mime = "application/pdf";
  } else throw Error("Use a PDF, DOCX, Markdown or TXT file.");
  text = text.replace(/\u0000/g, "").trim();
  if (!text)
    throw Error("No readable text found. Scanned PDFs need OCR first.");
  if (text.length > 60000)
    throw Error(
      "This document is too long. Split it into files of up to 60,000 characters.",
    );
  process.stdout.write(JSON.stringify({ text, mime }));
} catch {
  process.stderr.write(
    "Could not read this file within extraction limits. Use an unencrypted PDF, DOCX or UTF-8 text file.",
  );
  process.exitCode = 1;
}
