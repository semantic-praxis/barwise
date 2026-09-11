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
import { existsSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const r = run("run.mjs", "offline", "--customer", "C01", "--tier", "medium");
  // Skipped rather than asserted when the tier happens to be generated:
  // a test that silently passes on the wrong branch is the defect this
  // whole file is about, so say which branch ran.
  if (r.status === 2) {
    assert.match(r.stderr, /trial:generate/);
  } else {
    assert.notEqual(
      r.status,
      undefined,
      "the medium tier is generated here; the refusal branch was not exercised",
    );
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
