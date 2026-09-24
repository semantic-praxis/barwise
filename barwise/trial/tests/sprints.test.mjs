/**
 * The sprints a run executes. `--sprint 4.5` used to pass validation and
 * run nothing, because the late-requirement sprint was dispatched only on
 * `includes(4)`, which left the previous results for the gate to read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { plannedSprints } from "../lib/run.mjs";

const plan = (s) => [...plannedSprints(s)].sort((a, b) => a - b);

test("plannedSprints: 4.5 runs with 4, and alone when asked for alone", () => {
  assert.deepEqual(plan([4]), [4, 4.5]);
  assert.deepEqual(plan([4.5]), [4.5]);
  assert.deepEqual(plan([2, 4.5]), [2, 4.5]);
  // Asking for both runs 4.5 once, not twice.
  assert.deepEqual(plan([4, 4.5]), [4, 4.5]);
  assert.deepEqual(plan([1, 3, 4, 5, 6]), [1, 3, 4, 4.5, 5, 6]);
  assert.deepEqual(plan([1, 3]), [1, 3]);
});
