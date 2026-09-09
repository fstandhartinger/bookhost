// Load the actual TypeScript pipeline on Node 22+, without a build or copied implementation.
import { readFile } from "node:fs/promises";
import ts from "typescript";
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith(".") &&
    context.parentURL?.endsWith(".ts") &&
    !/\.[a-z]+$/i.test(specifier)
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  }
  return nextLoad(url, context);
}
