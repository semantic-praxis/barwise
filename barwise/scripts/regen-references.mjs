#!/usr/bin/env node
// Regenerate the eval suite's reference models from the recorded
// payloads in packages/promptlab/tests/fixtures/responses/ (barwise-856).
//
// promptlab has carried this as a standing rule since the suite was
// built -- references are generated, never hand-written -- and until
// now nothing implemented it. The rendering itself lives in
// @barwise/promptlab (`renderReference`) so this script and the drift
// test cannot disagree about what a reference should contain; this file
// is only the walk over the manifest and the writes.
//
// Usage: npm run regen:references   (requires `npm run build` first)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVALS = join(root, "packages/promptlab/evals");
const PAYLOADS = join(root, "packages/promptlab/tests/fixtures/responses");

let promptlab;
try {
  promptlab = await import(join(root, "packages/promptlab/dist/index.js"));
} catch {
  console.error("error: packages/promptlab/dist not found; run 'npm run build' first");
  process.exit(1);
}

/** Declared cases, in manifest order. No directory discovery, matching loadSuite. */
function declaredCaseIds() {
  const manifest = readFileSync(join(EVALS, "suite.yaml"), "utf8");
  const ids = [];
  let inCases = false;
  for (const line of manifest.split("\n")) {
    if (/^cases:\s*$/.test(line)) {
      inCases = true;
      continue;
    }
    if (inCases) {
      const m = line.match(/^\s+-\s+(\S+)\.eval\.yaml\s*$/);
      if (m) ids.push(m[1]);
      else if (/^\S/.test(line)) break;
    }
  }
  return ids;
}

let wrote = 0;
const skipped = [];

for (const caseId of declaredCaseIds()) {
  const payloadPath = join(PAYLOADS, `${caseId}.json`);
  if (!existsSync(payloadPath)) {
    // Expected, not an error: a case with no recorded payload has no
    // reference to generate. Named rather than passed over silently,
    // because "which cases still lack a reference" is the question this
    // script is most often run to answer.
    skipped.push(caseId);
    continue;
  }
  const yaml = promptlab.renderReference(readFileSync(payloadPath, "utf8"), caseId);
  writeFileSync(join(EVALS, `${caseId}.reference.orm.yaml`), yaml, "utf8");
  console.log(`wrote ${caseId}.reference.orm.yaml`);
  wrote += 1;
}

console.log(`\n${wrote} reference(s) regenerated.`);
if (skipped.length > 0) {
  console.log(
    `${skipped.length} case(s) have no recorded payload, so no reference: ${skipped.join(", ")}.`,
  );
  console.log(
    "Record one under packages/promptlab/tests/fixtures/responses/ and re-run,"
      + " then add `reference:` to the case file.",
  );
}
