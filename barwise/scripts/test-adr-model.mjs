#!/usr/bin/env node
/**
 * test:adr-model -- run scripts/tests/adr-model.test.mjs with @barwise/core
 * built, and refuse to call a run with skipped cases a pass
 * (docs/specs/adr-conformance-model.spec.md, WS3).
 *
 * That file skips every case when core is not built, so test:scripts,
 * which runs before the build, holds it to its count without running it.
 * This runs it after the build. A plain `node --test` would exit 0 with
 * every case skipped, a gate passing without seeing its input; so the
 * reading is the run's own skip count, not whether a file exists: a build
 * that is there but will not import skips too, and is refused here.
 *
 * Exit 0 every case ran and passed, 1 a case failed, 2 could not answer
 * (core will not load, a case skipped, or the run produced no counts).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The cases build sandbox repositories and run check-adr-model over them,
// so a git that fails or answers emptily fails cases, which this runner
// reports as a finding (the fault matrix's git-empty and git-absent
// axes, gate-contract-enforced WS1). tracked.mjs refuses at import when
// git cannot name the repository root, which is the precondition here.
import "./lib/tracked.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const refuse = (message) => {
  console.error(`test:adr-model: cannot answer: ${message}`);
  process.exit(2);
};

try {
  await import(pathToFileURL(join(here, "..", "packages", "core", "dist", "index.js")).href);
} catch (err) {
  refuse(
    `@barwise/core will not load (${err instanceof Error ? err.message : err}); npm run build:core`,
  );
}

const run = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", join(here, "tests", "adr-model.test.mjs")],
  { encoding: "utf8" },
);
// A child that never started has no output to print: refuse first.
if (run.error || run.signal) refuse(`the run did not finish (${run.error?.message ?? run.signal})`);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
const count = (name) => {
  const m = new RegExp(`^# ${name} (\\d+)$`, "m").exec(run.stdout);
  return m === null ? null : Number(m[1]);
};
// TAP from node --test prints `# tests N` and `# skipped N`.
const [tests, skipped, failed] = [count("tests"), count("skipped"), count("fail")];
if (tests === null || skipped === null || failed === null) refuse("the run printed no test counts");
if (tests === 0) refuse("the run registered no tests");
// A failure is a finding, and wins over a skip beside it.
if (failed > 0 || run.status !== 0 && skipped === 0) process.exit(1);
if (skipped > 0) refuse(`${skipped} of ${tests} case(s) skipped, so this run did not judge them`);
process.exit(run.status === 0 ? 0 : 1);
