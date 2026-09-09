// Re-score stored drafts after checker fixes without spending another model call.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { scoreDraft } from "./faithfulness.mjs";
const root = new URL("./", import.meta.url);
const hash = (content) => createHash("sha256").update(content).digest("hex");
const expectations = JSON.parse(
  await readFile(new URL("expectations.json", root), "utf8"),
);
for (const file of (await readdir(new URL("results/", root))).filter((file) =>
  file.endsWith(".json"),
)) {
  const path = new URL(`results/${file}`, root);
  const result = JSON.parse(await readFile(path, "utf8"));
  for (const row of result.rows) {
    const expected = expectations.find((item) => item.id === row.document);
    const source = await readFile(new URL(expected.file, root), "utf8");
    if (hash(source) !== row.sourceHash)
      throw new Error(`Source changed: ${row.document}`);
    if (row.draft) {
      row.originalAssessment ??= {
        score: row.score,
        faithfulness: row.faithfulness,
      };
      Object.assign(row, scoreDraft(source, row.draft, expected));
    }
  }
  result.scorerHash = hash(await readFile(new URL("faithfulness.mjs", root)));
  result.expectationsHash = hash(
    await readFile(new URL("expectations.json", root)),
  );
  result.rescoringNote =
    "Both runs scored with identical final checker; fixes ignore ordinary capitalization at HTML block boundaries and also check tags. Original assessments preserved. No new inference calls.";
  await writeFile(path, JSON.stringify(result, null, 2) + "\n");
  console.log(
    result.label,
    result.rows
      .map((row) => `${row.document}/${row.model}: ${row.score}`)
      .join("\n"),
  );
}
