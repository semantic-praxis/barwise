#!/usr/bin/env node
/**
 * Measurements behind docs/specs/model-issues-tab.spec.md, over every
 * tracked .orm.yaml in the repository.
 *
 * Usage (after `npm run build`): node packages/core/scripts/fix-planning-audit.mjs
 *
 * 1. Write-back fidelity: how many files survive, byte for byte, a
 *    round trip through OrmYamlSerializer and through the `yaml`
 *    package's Document API, and whether comments survive. This is why
 *    fixes are applied as span edits rather than re-serialization.
 * 2. Diagnostic counts per rule (lenient load, as the editor does),
 *    which is how the spec picks the first fix providers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { OrmYamlSerializer, ValidationEngine } from "../dist/index.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
}).toString().trim();
const files = execFileSync("git", ["ls-files", "*.orm.yaml"], { cwd: repoRoot })
  .toString().trim().split("\n").filter(Boolean);

const hasComment = (text) => /^\s*#/m.test(text);
const changedLines = (a, b) => {
  const x = a.split("\n");
  const y = b.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
};

const serializer = new OrmYamlSerializer();
const engine = new ValidationEngine();
const fidelity = {
  files: files.length,
  serializerLoaded: 0,
  serializerIdentical: 0,
  withComments: 0,
  serializerKeptComments: 0,
  documentIdentical: 0,
  documentChangedLines: 0,
  documentWideIdentical: 0,
  documentWideChangedLines: 0,
};
const ruleCounts = new Map();
let validated = 0;

for (const file of files) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  if (hasComment(text)) fidelity.withComments++;

  try {
    const out = serializer.serialize(serializer.deserialize(text));
    fidelity.serializerLoaded++;
    if (out === text) fidelity.serializerIdentical++;
    if (hasComment(text) && hasComment(out)) fidelity.serializerKeptComments++;
  } catch {
    // Strict load failed; counted by its absence from serializerLoaded.
  }

  const doc = parseDocument(text).toString();
  if (doc === text) fidelity.documentIdentical++;
  else fidelity.documentChangedLines += changedLines(text, doc);
  const wide = parseDocument(text).toString({ lineWidth: 0, minContentWidth: 0 });
  if (wide === text) fidelity.documentWideIdentical++;
  else fidelity.documentWideChangedLines += changedLines(text, wide);

  let model;
  try {
    model = serializer.deserialize(text, { lenient: true });
  } catch {
    continue;
  }
  validated++;
  for (const d of engine.validate(model)) {
    const key = `${d.ruleId} ${d.severity}`;
    ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + 1);
  }
}

console.log(JSON.stringify(fidelity, null, 2));
const total = [...ruleCounts.values()].reduce((a, b) => a + b, 0);
console.log(`\n${total} diagnostics over ${validated} leniently loaded models`);
for (const [key, count] of [...ruleCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(5)} ${key}`);
}
