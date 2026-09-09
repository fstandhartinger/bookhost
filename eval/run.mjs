import { register } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { scoreDraft } from "./faithfulness.mjs";
register("./loader.mjs", import.meta.url);
const { buildPrompt } = await import("../lib/intake/content.ts");
const { generateDraft } = await import("../lib/intake/draft.ts");
const root = new URL("./", import.meta.url);
const expectations = JSON.parse(
  await readFile(new URL("expectations.json", root), "utf8"),
);
const models = [
  ...new Set(
    (
      process.env.INTAKE_MODELS ||
      "google/gemma-4-31B-turbo-TEE,deepseek-ai/DeepSeek-V3.2-TEE"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
if (!process.env.CHUTES_API_KEY)
  throw new Error("CHUTES_API_KEY is required (never stored in results).");
if (!models.length || expectations.length * models.length > 12)
  throw new Error(
    "Maximum 12 calls per run; choose at most two models for six documents.",
  );
const result = {
  scorerHash: createHash("sha256")
    .update(await readFile(new URL("faithfulness.mjs", root)))
    .digest("hex"),
  expectationsHash: createHash("sha256")
    .update(await readFile(new URL("expectations.json", root)))
    .digest("hex"),
  timestamp: new Date().toISOString(),
  label: process.env.EVAL_LABEL || "evaluation",
  models,
  pipelineHash: createHash("sha256")
    .update(await readFile(new URL("../lib/intake/content.ts", root)))
    .update(await readFile(new URL("../lib/intake/draft.ts", root)))
    .update(await readFile(new URL("../lib/intake/prompt.ts", root)))
    .digest("hex"),
  rows: [],
};
await mkdir(new URL("results/", root), { recursive: true });
const output = new URL(
  `results/${result.timestamp.replace(/[:.]/g, "-")}.json`,
  root,
);
let stop = false;
for (const expected of expectations) {
  const source = await readFile(new URL(expected.file, root), "utf8");
  for (const model of models) {
    if (stop) break;
    const start = performance.now();
    let tokens = null,
      status = null;
    let row;
    try {
      const draft = await generateDraft(source, {
        model,
        onResponse: (response) => {
          tokens = response.tokens;
          status = response.status;
          if (status === 429) stop = true;
        },
      });
      row = {
        document: expected.id,
        model,
        ...scoreDraft(source, draft, expected),
        draft,
      };
    } catch {
      row = {
        document: expected.id,
        model,
        score: 0,
        error:
          status === 429
            ? "rate-limited; stopped without retry"
            : "draft generation failed",
      };
    }
    row.latencyMs = Math.round(performance.now() - start);
    row.tokens = tokens;
    row.status = status;
    row.systemPrompt = buildPrompt(source)[0].content;
    row.sourceHash = createHash("sha256").update(source).digest("hex");
    result.rows.push(row);
    await writeFile(output, JSON.stringify(result, null, 2) + "\n");
    console.log(
      `${expected.id} | ${model} | score ${row.score} | ${row.latencyMs} ms | ${tokens ?? "unknown"} tokens`,
    );
  }
}
console.table(
  result.rows.map(({ document, model, score, latencyMs, tokens }) => ({
    document,
    model,
    score,
    latencyMs,
    tokens,
  })),
);
console.log(`Results: ${fileURLToPath(output)}`);
if (stop || result.rows.some((row) => row.error)) process.exitCode = 1;
