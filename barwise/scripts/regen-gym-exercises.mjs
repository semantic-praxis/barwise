/**
 * Regenerate the compiled-in gym exercise catalog (barwise-fbi;
 * docs/specs/surface-mirroring.spec.md, workstream 4).
 *
 * Reads every .yaml file in packages/learn/exercises/ and emits
 * packages/learn/src/exercise/exercises.generated.json, a map from file
 * name to file text that catalog.ts imports, so the packaged catalog
 * loads without touching the filesystem.
 *
 * JSON rather than a .ts module: the map is data, and as TypeScript its
 * embedded YAML read as code to the source gates (check:source-sites saw
 * the reference model's `orm_version:` as a writer that bypasses the
 * serializer; check:book-citations read a whole file on one line as one
 * citation). The exercise files themselves stay in those gates' scope.
 *
 * Why compiled in: the release assets (barwise-cli-<v>.cjs,
 * barwise-mcp-<v>.cjs, the .vsix's dist/mcp/index.js) are single CJS
 * files. esbuild empties import.meta.url in CJS, so resolving the catalog
 * relative to the module failed in all three, and a single-file asset
 * has no sibling directory to copy a catalog into. Same reasoning as
 * scripts/regen-builtin-artifacts.mjs for the llm prompt artifacts.
 *
 * The text is embedded raw, not parsed: loadExercise stays the one
 * parser, and the drift test (packages/learn/tests/generatedCatalog.test.ts)
 * compares the map with the directory byte for byte. JSON carries no
 * comment, so the provenance note lives here and in catalog.ts.
 *
 * Usage: node scripts/regen-gym-exercises.mjs   (from barwise/)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const learnRoot = resolve(here, "../packages/learn");
const exercisesDir = resolve(learnRoot, "exercises");

const names = readdirSync(exercisesDir).filter((f) => f.endsWith(".yaml")).sort();
const catalog = Object.fromEntries(
  names.map((name) => [name, readFileSync(resolve(exercisesDir, name), "utf8")]),
);
const out = JSON.stringify(catalog, null, 2) + "\n";

const target = resolve(learnRoot, "src/exercise/exercises.generated.json");
writeFileSync(target, out);
console.log(`Wrote ${names.length} catalog file(s) to ${target.replace(resolve(here, ".."), ".")}`);
