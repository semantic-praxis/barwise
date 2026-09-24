/**
 * The results join must not let one step occupy two rows. It did: a
 * full re-run of an already-run tier kept every prior sprint-4.5 row
 * (4.5 is not in the integer sprint list the filter asks) and appended
 * the fresh one beside it, so the gate's step count read 1044 where the
 * lane has 916 steps. It stayed green throughout, because every
 * duplicated row passed and the ratchet counts failures -- which is the
 * shape this lane exists to catch, in the lane itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeResults, resultKey } from "../lib/results.mjs";

const row = (customer, sprint, step, extra = {}) => ({ customer, sprint, step, ...extra });

test("a re-run replaces a prior row rather than joining it", () => {
  const kept = [row("C01", 4.5, "late:diff", { status: "pass", detail: "from the prior run" })];
  const fresh = [row("C01", 4.5, "late:diff", { status: "fail", severity: "S1" })];
  const merged = mergeResults(kept, fresh);
  assert.equal(merged.length, 1, "the step must occupy one row, not two");
  assert.equal(merged[0].status, "fail", "the fresh row must win, not the kept one");
});

test("a fractional sprint number is not a special case", () => {
  // The defect was specific to 4.5 only because that is the sprint the
  // integer filter missed. The join must not care what the number is.
  for (const sprint of [1, 4, 4.5, 6]) {
    const merged = mergeResults(
      [row("C01", sprint, "s", { status: "pass" })],
      [row("C01", sprint, "s", { status: "fail" })],
    );
    assert.equal(merged.length, 1, `sprint ${sprint} duplicated`);
    assert.equal(merged[0].status, "fail", `sprint ${sprint} kept the stale row`);
  }
});

test("rows for a customer or step this run did not touch survive", () => {
  const kept = [row("C02", 1, "import:ddl", { status: "fail" }), row("C01", 1, "other")];
  const fresh = [row("C01", 1, "import:ddl", { status: "pass" })];
  const merged = mergeResults(kept, fresh);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(resultKey), [
    "C01/1/import:ddl",
    "C01/1/other",
    "C02/1/import:ddl",
  ], "the file must be ordered by key so a re-run does not churn it");
});

test("a repeated merge is a fixed point", () => {
  // Running the lane twice with no change must not grow the file.
  const once = mergeResults([], [row("C01", 4.5, "late:diff", { status: "pass" })]);
  const twice = mergeResults(once, [row("C01", 4.5, "late:diff", { status: "pass" })]);
  assert.equal(twice.length, once.length, "a second identical run grew the results file");
});
