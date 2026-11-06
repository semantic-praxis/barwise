#!/usr/bin/env node
/**
 * check:findings -- the rules about audit findings, over every baseline at
 * once (docs/specs/audit-finding-reader.spec.md, WS1;
 * docs/adr/findings-close-by-mechanism.md#mechanism-closes and
 * #person-classifies; docs/adr/must-agree-copies.md#every-candidate-verdict).
 *
 * scripts/lib/findings.mjs reads the five baselines into one shape. This
 * gate holds three rules over them:
 *   - an `open` row names an issue the tracker has and has not closed, so a
 *     finding cannot point at a fixed issue and read as handled;
 *   - no row keeps its writer's placeholder, and a recorded verdict has a
 *     note saying why;
 *   - a row's classification is in its audit's declared vocabulary.
 * And the trial catalog's issues are held to the first rule, because the
 * catalog is where trial rows get their issue.
 *
 * "Closed" is `status === "closed"`, the judgement adr-judge.mjs makes for
 * ADR gap issues: claiming an issue (in_progress) keeps it live.
 *
 * Exit 0 every row holds, 1 a finding (each named), 2 could not answer: a
 * baseline, the catalog or the tracker could not be read, or a row could
 * not be mapped (docs/adr/gate-refusal-contract.md).
 *
 * `--root <dir>` reads another tree, for this gate's own tests.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGovernanceReader } from "./lib/adr-facts.mjs";
import { opt } from "./lib/args.mjs";
import { readFindings, SOURCE_FILES } from "./lib/findings.mjs";

const refuse = (why) => {
  console.error(`check:findings: cannot answer -- ${why}`);
  process.exit(2);
};

let root, findings, catalog;
try {
  root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  ({ findings, catalog } = readFindings(root));
} catch (err) {
  refuse(err.message);
}

const refusals = [];
const reader = await createGovernanceReader(root, { needsWorkflow: false, refusals });
const issues = reader.issues();
if (issues === null) refuse(refusals.join("; "));

const dead = (id) => {
  const issue = issues.get(id);
  if (issue === undefined) return "is not in the tracker";
  if (issue.status === "closed") return "is closed";
  return null;
};

const problems = [];
for (const f of findings) {
  const where = `${SOURCE_FILES[f.source]}: ${f.id}`;
  if (f.state === "unclassified") {
    problems.push(`${where}: still has its writer's placeholder; record a verdict`);
    continue;
  }
  if (!f.note) problems.push(`${where}: records a verdict with no note saying why`);
  if (f.vocabulary !== null && !f.vocabulary.has(f.classification)) {
    problems.push(
      `${where}: "${f.classification}" is not one of ${[...f.vocabulary].sort().join(", ")}`,
    );
  }
  if (f.state === "open") {
    if (f.issue === null) {
      problems.push(`${where}: says tracked but names no issue; write tracked:<issue>`);
    } else {
      const why = dead(f.issue);
      if (why) problems.push(`${where}: names ${f.issue}, which ${why}`);
    }
  }
}
for (const c of catalog) {
  if (c.issue === null) continue;
  const why = dead(c.issue);
  if (why) {
    problems.push(
      `trial/findings/catalog.json: class ${c.id} names ${c.issue}, which ${why}; `
        + "a row of this class would be red when it fires",
    );
  }
}

if (problems.length > 0) {
  console.error(`check:findings: FAIL -- ${problems.length} finding(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "A finding closes by a mechanism (docs/adr/findings-close-by-mechanism.md): record a"
      + " verdict from the audit's vocabulary, or point the row at a live issue.",
  );
  process.exit(1);
}

const by = (state) => findings.filter((f) => f.state === state).length;
console.log(
  `check:findings: ${findings.length} row(s) in ${Object.keys(SOURCE_FILES).length} baselines`
    + ` (${by("open")} open, ${by("classified")} classified), ${catalog.length} catalog classes;`
    + " every open row names a live issue and every verdict is in its vocabulary. OK",
);
