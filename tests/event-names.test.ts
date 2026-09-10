import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}
function allowed(sql: string) {
  return [...sql.matchAll(/CHECK\s*\(\s*name\s+IN\s*\(([^)]+)\)/gi)].flatMap(
    (m) => [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]),
  );
}
it("022 preserves every historical event and every source event INSERT", () => {
  const required = new Set<string>();
  for (const name of readdirSync("db/migrations").filter(
    (n) => n.endsWith(".sql") && n < "022",
  )) {
    for (const value of allowed(readFileSync(`db/migrations/${name}`, "utf8")))
      required.add(value);
  }
  let inserts = 0;
  for (const file of [...sources("lib"), ...sources("app")]) {
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        const sql = ts.isTemplateExpression(node)
          ? node.getText(ast)
          : node.text;
        if (/INSERT\s+INTO\s+events\s*\(/i.test(sql)) {
          inserts++;
          const match = sql.match(
            /INSERT\s+INTO\s+events\s*\(\s*name\s*[,)]\s*[\s\S]*?(?:VALUES\s*\(|SELECT\s+)'([^']+)'/i,
          );
          // Fail closed for dynamic/reordered INSERTs: extend extraction when adding one.
          expect(
            match,
            `${file}: event INSERT must expose a literal name`,
          ).not.toBeNull();
          if (match) required.add(match[1]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(inserts).toBeGreaterThan(0);
  expect(required.has("inbound_rejected")).toBe(true);
  const actual = new Set(
    allowed(readFileSync("db/migrations/022_event_names.sql", "utf8")),
  );
  expect([...required].filter((name) => !actual.has(name))).toEqual([]);
});
