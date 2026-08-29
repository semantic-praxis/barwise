#!/usr/bin/env node
/**
 * Run the CI gate list locally, in CI's order.
 *
 * The steps are PARSED OUT OF `.github/workflows/ci.yml` rather than
 * restated here. A hand-copied list would be a must-agree copy with
 * nothing keeping it honest, which is the thing CLAUDE.md forbids -- and
 * it would fail in the specific way that motivated this script: silently,
 * by omitting the gate that was about to break.
 *
 * Written after two red pushes in one session, each from a gate that had
 * simply not been run (`fmt:check`, then `knip`). The subsequent
 * "everything" pass was itself missing five more (`filesize`, `dup`,
 * `audit`, `publint`, the bundles), because it too was assembled from
 * memory. Deriving the list is the only version of this that stays true.
 *
 * `--list` prints the gates without running them. A failure does not stop
 * the run: every gate reports, so one pass shows all the breakage rather
 * than the first of it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = resolve(ROOT, "../.github/workflows/ci.yml");

/** `npm ci` installs rather than checks. Everything else CI runs, this runs. */
const SKIP = [/^ci$/];

function gates() {
  const yml = readFileSync(WORKFLOW, "utf8");
  const found = [];
  for (const line of yml.split("\n")) {
    const m = /^\s*(?:- )?run: npm (.+?)\s*$/.exec(line);
    if (!m) continue;
    const args = m[1];
    if (SKIP.some((re) => re.test(args))) continue;
    if (!found.includes(args)) found.push(args);
  }
  if (found.length === 0) {
    throw new Error(`no 'run: npm ...' steps found in ${WORKFLOW}; has the workflow moved?`);
  }
  return found;
}

const list = gates();
if (process.argv.includes("--list")) {
  for (const g of list) console.log(`npm ${g}`);
  process.exit(0);
}

console.log(`Running ${list.length} gates from ci.yml, in order.\n`);
const failed = [];
for (const g of list) {
  process.stdout.write(`  ${g.padEnd(34)} `);
  const started = Date.now();
  const r = spawnSync("npm", g.split(/\s+/), { cwd: ROOT, encoding: "utf8" });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status === 0) {
    console.log(`ok    ${secs}s`);
  } else {
    console.log(`FAIL  ${secs}s`);
    failed.push({ gate: g, out: `${r.stdout ?? ""}${r.stderr ?? ""}` });
  }
}

if (failed.length > 0) {
  for (const f of failed) {
    console.error(`\n${"=".repeat(60)}\nnpm ${f.gate}\n${"=".repeat(60)}`);
    console.error(f.out.trimEnd().split("\n").slice(-25).join("\n"));
  }
  console.error(`\n${failed.length} of ${list.length} gates failed.`);
  process.exit(1);
}
console.log(`\nAll ${list.length} gates passed.`);
