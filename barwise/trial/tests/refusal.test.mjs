/**
 * "A gate that cannot see its input must not print PASS"
 * (docs/specs/gate-refusal-contract.spec.md). The lane has four ways to
 * be unable to answer -- an unknown tier, no such customer, a tier that
 * was never generated, and no results to gate -- and each must exit 2,
 * not 0 (which would read as "the product is fine") and not 1 (which is
 * this lane's code for "a finding regressed").
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("../lib/", import.meta.url));
const run = (script, ...args) =>
  spawnSync(process.execPath, [join(LIB, script), ...args], { encoding: "utf8" });

test("an unknown tier is refused, and names the tiers", () => {
  const r = run("run.mjs", "offline", "--tier", "no-such-tier");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /small, medium, enterprise/);
});

test("no such customer is refused, and says where it looked", () => {
  const r = run("run.mjs", "offline", "--customer", "C99");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no customer packages/);
});

test("a tier that was never generated is refused, and names the command that makes it", () => {
  // Make the condition rather than hoping for it. The first version of
  // this test asserted against whichever tiers happened to exist, so it
  // passed or failed on the order the suite ran in, and it graded a
  // generated tier as "the refusal branch was not exercised".
  const generated = fileURLToPath(
    new URL("../customers/C01-hospital/generated/medium", import.meta.url),
  );
  const parked = existsSync(generated)
    ? join(mkdtempSync(join(tmpdir(), "trial-tier-")), "medium")
    : null;
  if (parked) renameSync(generated, parked);
  try {
    const r = run("run.mjs", "offline", "--customer", "C01", "--tier", "medium");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /trial:generate/);
  } finally {
    if (parked) renameSync(parked, generated);
  }
});

test("gating a tier with no results is refused, not reported as a pass", () => {
  const results = fileURLToPath(new URL("../results/small.json", import.meta.url));
  const parked = existsSync(results)
    ? join(mkdtempSync(join(tmpdir(), "trial-")), "small.json")
    : null;
  if (parked) renameSync(results, parked);
  try {
    const r = run("gate.mjs", "--tier", "small");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no results/);
    assert.doesNotMatch(r.stdout, /PASS/);
  } finally {
    if (parked) renameSync(parked, results);
  }
});

// Two more ways the lane could not answer but said nothing, both from a
// Copilot review of PR #509.

test("an unknown sprint is refused, not run as an empty no-op over stale results", () => {
  // `--sprint typo` became [NaN]: no sprint matched, the previous results
  // file stayed on disk, and the gate read it and passed. A typo has to
  // refuse, or the lane certifies a run it never made.
  const r = run("run.mjs", "offline", "--tier", "small", "--sprint", "typo");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown sprint/i);
  assert.match(r.stderr, /known sprints are/i);
});

test("a sprint outside the known set is refused even when it is a number", () => {
  const r = run("run.mjs", "offline", "--tier", "small", "--sprint", "9");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown sprint/i);
});

/**
 * Run the gate over a results fixture, leaving the tree as it was found.
 * results/ is gitignored, so on a clean checkout it does not exist; the
 * first version of the authoring test wrote into it unguarded and failed
 * with ENOENT before the refusal was reached.
 */
function gateOver(rows) {
  const results = fileURLToPath(new URL("../results/small.json", import.meta.url));
  const madeDir = !existsSync(dirname(results));
  const parked = existsSync(results)
    ? join(mkdtempSync(join(tmpdir(), "trial-gate-")), "small.json")
    : null;
  if (parked) renameSync(results, parked);
  mkdirSync(dirname(results), { recursive: true });
  try {
    writeFileSync(results, JSON.stringify({ results: rows }));
    return run("gate.mjs", "--tier", "small");
  } finally {
    rmSync(results, { force: true });
    if (parked) renameSync(parked, results);
    if (madeDir) rmSync(dirname(results), { recursive: true, force: true });
  }
}

const row = (step, extra) => ({ customer: "C01", tier: "small", sprint: 6, step, ...extra });

test("an authoring failure refuses the gate instead of passing with a printed note", () => {
  // A persona rubric that no longer passes on its own kernel means the
  // customer package is invalid, so the lane cannot say anything about the
  // product. The row was printed as AUTHORING and then ignored, and the
  // same run reported PASS and exited 0.
  const r = gateOver([
    row("fixture:kernel", {
      status: "fail",
      severity: "authoring",
      detail: "the persona rubric does not pass on its own kernel",
    }),
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /AUTHORING/);
  assert.doesNotMatch(r.stdout, /-> PASS/);
});

test("a step the lane could not answer refuses the gate instead of passing", () => {
  const r = gateOver([
    row("fixture:blind", { status: "could_not_answer", detail: "no importer to read it back" }),
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /NEW BLIND/);
  assert.match(r.stdout, /COULD NOT ANSWER/);
});

test("a regression outranks a blind spot: the gate exits 1, not 2", () => {
  // A found regression is a definite answer and the more actionable one;
  // reporting it as "could not answer" hides it behind uncertainty.
  const r = gateOver([
    row("fixture:blind", { status: "could_not_answer", detail: "no importer" }),
    row("fixture:regressed", { status: "fail", severity: "S1", detail: "silently dropped" }),
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NEW FINDING/);
  assert.match(r.stdout, /NEW BLIND/);
});
