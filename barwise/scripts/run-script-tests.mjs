#!/usr/bin/env node
/**
 * The gate-test runner, with a count it can be held to.
 *
 * `node --test` reports the tests that REGISTERED. `test()` calls register as
 * the module executes, so a module-scope failure partway down a file means
 * every test below it never registers -- and the runner cannot report what was
 * never declared. Measured: nine tests written across two files, six reported,
 * `# tests 6 / # pass 5 / # fail 1`, exit 1. That summary is arithmetically
 * complete and factually partial, and nothing in it says so (barwise-1027,
 * docs/specs/test-run-completeness.spec.md).
 *
 * The incident behind the issue is that row at scale -- 41 reported where 99
 * were written -- caught only because a human happened to remember a number
 * from minutes earlier. The exit code was non-zero, so CI was red; the defect
 * is what the human then concluded from a plausible-looking summary.
 *
 * So this wrapper gives the runner the third answer the other gates already
 * have (`docs/specs/gate-refusal-contract.spec.md`): pass, fail, and COULD NOT
 * ANSWER. A count that does not match its manifest is the third, because the
 * pass and fail numbers describe a suite other than the one on disk.
 *
 * PER FILE, not in total. A total is a shadow that diverges exactly where it
 * matters: one file truncating by four while another gains four leaves the
 * total correct and the run incomplete. Measured, per-file costs nothing --
 * 39.6s parallel against 42.6s combined, since one file dominates either way.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { REPO_ROOT } from "./lib/tracked.mjs";

const REFUSED = 2;
const FAILED = 1;

const TESTS_DIR = resolve(REPO_ROOT, "barwise", "scripts", "tests");
const MANIFEST = join(TESTS_DIR, "expected-counts.json");
const WRITE = process.argv.includes("--write");
const MANIFEST_COMMENT =
  "Registered test count per gate-test file, from scripts/run-script-tests.mjs. "
  + "`node --test` reports the tests that REGISTERED, so a module-scope failure "
  + "partway down a file silently drops every test below it and still prints a "
  + "complete-looking summary (barwise-1027). A mismatch here exits 2 -- could "
  + "not answer -- because the run's own pass and fail numbers describe a "
  + "different suite. Adding or removing a test means updating this file in the "
  + "same commit: `npm run test:scripts -- --write`, which refuses to record a "
  + "run that failed or printed no summary. "
  + "Spec: docs/specs/test-run-completeness.spec.md.";

/** Every gate-test file, by basename, sorted so output order is stable. */
function testFiles() {
  return readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
}

/**
 * Run one file and report what it said about itself.
 *
 * Output is buffered rather than inherited because the children run in
 * parallel: interleaved output from three suites is unreadable, and a developer
 * looking at a failure needs the same text `node --test` would have given them.
 */
function runFile(file) {
  return new Promise((resolveRun) => {
    // `NODE_TEST_CONTEXT` is how `node --test` recognises that it is already
    // inside a test run; with it set, a child prints
    // "run() is being called recursively ... skipping running files" and no
    // summary at all. Each child here IS a fresh top-level run, so inheriting
    // that marker is simply wrong -- and the failure it causes is the one this
    // script exists to refuse, so without this the wrapper would report
    // "could not be counted" for a suite that is perfectly fine.
    const { NODE_TEST_CONTEXT: _nested, ...env } = process.env;
    const child = spawn(process.execPath, ["--test", join(TESTS_DIR, file)], {
      cwd: resolve(REPO_ROOT, "barwise"),
      env,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      resolveRun({ file, out, code, ...summarise(out) });
    });
  });
}

/**
 * The counts a run reported, or `undefined` when it reported none.
 *
 * `undefined` is not zero. A child that died before printing a summary has told
 * us nothing, and treating that as "zero tests" would let a crashed run satisfy
 * a manifest entry of 0 -- the same could-not-answer-reads-as-an-answer defect
 * this file exists to remove.
 */
function summarise(out) {
  const read = (label) => {
    const m = out.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return m === null ? undefined : Number(m[1]);
  };
  return { tests: read("tests"), fail: read("fail") };
}

function loadManifest() {
  if (!existsSync(MANIFEST)) {
    return undefined;
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8")).counts ?? {};
}

function refuse(lines) {
  process.stderr.write(`run-script-tests: ${lines.join("\n  ")}\n`);
  process.exit(REFUSED);
}

const files = testFiles();
if (files.length === 0) {
  // An empty listing is the reading that looks like success: zero files means
  // zero failures means green, over a suite nobody ran.
  refuse([
    "no *.test.mjs found under scripts/tests/.",
    "Refusing rather than reporting a pass over an empty suite.",
  ]);
}

const results = await Promise.all(files.map(runFile));
for (const r of results) process.stdout.write(r.out);

if (WRITE) {
  // A writer that records whatever ran is how this manifest would come to
  // certify the very truncation it exists to detect: plant a module-scope
  // throw, run --write, and the short count becomes the expected one.
  const unusable = results.filter((r) => r.tests === undefined || (r.fail ?? 0) > 0);
  if (unusable.length > 0) {
    refuse([
      "refusing to record counts from a run that did not come back clean.",
      ...unusable.map((r) =>
        `${r.file}: ${r.tests === undefined ? "no summary printed" : `${r.fail} failing`}`
      ),
      "A truncated or failing run would bake its short count into the manifest.",
    ]);
  }
  const counts = Object.fromEntries(results.map((r) => [r.file, r.tests]));
  writeFileSync(
    MANIFEST,
    JSON.stringify({ $comment: MANIFEST_COMMENT, counts }, null, 2) + "\n",
  );
  console.log(
    `run-script-tests: recorded ${results.map((r) => `${r.file}=${r.tests}`).join(", ")}`,
  );
  process.exit(0);
}

const expected = loadManifest();
if (expected === undefined) {
  refuse([
    `no manifest at scripts/tests/${basename(MANIFEST)}.`,
    "Without it there is no count to hold this run to, and a truncated run",
    "would read as a pass. Generate it with `npm run test:scripts -- --write`.",
  ]);
}

const problems = [];
for (const r of results) {
  if (r.tests === undefined) {
    problems.push(`${r.file}: printed no summary, so its run cannot be counted`);
    continue;
  }
  if (!(r.file in expected)) {
    problems.push(
      `${r.file}: not in the manifest, so its ${r.tests} test(s) ran unchecked.`
        + " Add it with --write.",
    );
    continue;
  }
  if (r.tests !== expected[r.file]) {
    problems.push(
      `${r.file}: ${r.tests} test(s) registered, manifest says ${expected[r.file]}.`
        + (r.tests < expected[r.file]
          ? " Registration stopped early, or tests were removed -- the pass/fail"
            + " numbers above describe a different suite."
          : " Tests were added; record them with --write in the same commit."),
    );
  }
}
for (const file of Object.keys(expected)) {
  if (!files.includes(file)) {
    problems.push(`${file}: in the manifest but no longer on disk. Remove it with --write.`);
  }
}

if (problems.length > 0) {
  refuse(["the suite on disk is not the suite that ran:", ...problems]);
}

const failed = results.reduce((n, r) => n + (r.fail ?? 0), 0);
const total = results.reduce((n, r) => n + r.tests, 0);
if (failed > 0) {
  console.error(`\nrun-script-tests: ${failed} failing of ${total}, all counts verified.`);
  process.exit(FAILED);
}
console.log(
  `\nrun-script-tests: ${total} test(s) across ${files.length} file(s), `
    + `every count matching the manifest.`,
);
