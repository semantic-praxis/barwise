/**
 * Regenerate the compiled-in eval suite (barwise-fke).
 *
 * Reads the suite's files in packages/promptlab/evals/ (every .yaml and
 * .md; not history.jsonl, which is the repository's run record, not part
 * of the suite) and emits packages/promptlab/src/evalcase/suite.generated.json,
 * a map from file name to file text that loadSuite.ts imports, so the
 * packaged suite loads without touching the filesystem.
 *
 * Why compiled in: the CLI release asset (barwise-cli-<v>.cjs) is a
 * single CJS file. esbuild empties import.meta.url in CJS, so resolving
 * evals/ relative to the module failed there, and a single-file asset has
 * no directory beside it to hold one. The gym catalog is compiled in for
 * the same reason (scripts/regen-gym-exercises.mjs, barwise-fbi).
 *
 * The text is embedded raw, not parsed: loadSuite stays the one parser,
 * and the drift test (packages/promptlab/tests/generatedSuite.test.ts)
 * compares the map with the directory byte for byte. JSON rather than a
 * .ts module because the map is data; as TypeScript, its embedded models
 * read as code to check:source-sites.
 *
 * Usage: node barwise/scripts/regen-eval-suite.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const promptlabRoot = resolve(here, "../packages/promptlab");
const evalsDir = resolve(promptlabRoot, "evals");

const names = readdirSync(evalsDir).filter((f) => /\.(yaml|md)$/.test(f)).sort();
const suite = Object.fromEntries(
  names.map((name) => [name, readFileSync(resolve(evalsDir, name), "utf8")]),
);

const target = resolve(promptlabRoot, "src/evalcase/suite.generated.json");
writeFileSync(target, JSON.stringify(suite, null, 2) + "\n");
console.log(`Wrote ${names.length} suite file(s) to ${target.replace(resolve(here, ".."), ".")}`);
