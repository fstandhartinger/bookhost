import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

const DATENSCHUTZ = "content/legal/datenschutz.md";
const PRIVACY_EN = "app/privacy/page.tsx";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}
function insertNames(sql: string): string[] {
  return [...sql.matchAll(/INSERT\s+INTO\s+events\s*\(\s*name\s*[,)]\s*[\s\S]*?(?:VALUES\s*\(|SELECT\s+)'([^']+)'/gi)].map(
    (m) => m[1],
  );
}
function tsInsertNames(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const sql = ts.isTemplateExpression(node) ? node.getText(ast) : node.text;
      for (const name of insertNames(sql)) names.push(name);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return names;
}
function sqlEventLiterals(file: string): string[] {
  const sql = readFileSync(file, "utf8");
  const names = new Set<string>(insertNames(sql));
  for (const m of sql.matchAll(/:=\s*'([a-z_]+)'/g)) names.add(m[1]);
  for (const m of sql.matchAll(/\b(?:THEN|ELSE)\s+'([a-z_]+)'/g)) names.add(m[1]);
  return [...names];
}
function checkVocabulary(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/CHECK\s*\(\s*name\s+IN\s*\(([^)]+)\)/gi)].flatMap(
    (m) => [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]),
  );
}
// event name -> [German keyword in datenschutz.md, English keyword in privacy page]
const KEYWORDS: Record<string, [string, string]> = {
  demo_click: ["Demo-Klicks", "demo clicks"],
  checkout_start: ["Checkout-Starts", "checkout starts"],
  trial_started: ["erfolgreiche Trials", "successful trials"],
  paid_conversion: ["erste bezahlte Rechnung", "first paid invoice"],
  workspace_created: ["angelegte Workspaces", "workspaces created"],
  intake_draft: ["Dokumententwürfe", "document drafts"],
  intake_published: ["Dokumententwürfe", "document drafts"],
  bookstack_opened: ["Aufrufe des Arbeitsbereichs", "workspace opens"],
  onboarding_step_done: ["Einrichtungsschritte", "onboarding steps"],
  inbound_rejected: ["abgelehnte eingehende E-Mails", "rejected inbound e-mails"],
};
it("every stored event is disclosed in the German and English privacy texts", () => {
  const emitted = new Set<string>();
  for (const file of [...sources("app"), ...sources("lib")])
    for (const name of tsInsertNames(file)) emitted.add(name);
  for (const file of [
    "db/migrations/012_analytics.sql",
    "db/migrations/019_team_onboarding.sql",
  ])
    for (const name of sqlEventLiterals(file)) emitted.add(name);
  expect(emitted.size).toBeGreaterThan(0);
  // Every emitted name must be allowed by the in-force CHECK constraint.
  const latestCheck = readdirSync("db/migrations")
    .filter((n) => n.endsWith(".sql"))
    .filter((n) =>
      readFileSync(`db/migrations/${n}`, "utf8").includes("events_name_check"),
    )
    .filter((n) => checkVocabulary(`db/migrations/${n}`).length)
    .sort()
    .at(-1)!;
  const vocabulary = new Set(checkVocabulary(`db/migrations/${latestCheck}`));
  expect([...emitted].filter((name) => !vocabulary.has(name))).toEqual([]);
  // The keyword map must track the emitted set exactly (fail closed both ways).
  expect(Object.keys(KEYWORDS).sort()).toEqual([...emitted].sort());
  const de = readFileSync(DATENSCHUTZ, "utf8").toLowerCase();
  const en = readFileSync(PRIVACY_EN, "utf8").toLowerCase();
  for (const [name, [deKeyword, enKeyword]] of Object.entries(KEYWORDS)) {
    expect(
      de.includes(deKeyword.toLowerCase()),
      `${name}: German keyword "${deKeyword}" missing in ${DATENSCHUTZ}`,
    ).toBe(true);
    expect(
      en.includes(enKeyword.toLowerCase()),
      `${name}: English keyword "${enKeyword}" missing in ${PRIVACY_EN}`,
    ).toBe(true);
  }
});
it("the functional theme browser storage is disclosed", () => {
  const de = readFileSync(DATENSCHUTZ, "utf8").toLowerCase();
  const en = readFileSync(PRIVACY_EN, "utf8").toLowerCase();
  expect(
    de.includes("farbschema"),
    `German keyword "Farbschema" missing in ${DATENSCHUTZ}`,
  ).toBe(true);
  expect(
    en.includes("theme"),
    `English keyword "theme" missing in ${PRIVACY_EN}`,
  ).toBe(true);
});
