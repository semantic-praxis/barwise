/**
 * The trial gate's `--write` (docs/specs/findings-gaps-closed.spec.md, WS3).
 * The writer is additive and the one exception to the baseline helper
 * (baselines-merge-on-write, decision 2), so what it does is pinned here,
 * in a temporary directory: it keeps the rows of scopes that did not run
 * and rows no longer open, sorts by id, leaves a classified row alone, and
 * says all of that in one summary line.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify, loadCatalog } from "../lib/classify.mjs";
import { runGate } from "../lib/gate.mjs";

const step = (name, status, extra = {}) => ({
  customer: "C01",
  tier: "small",
  sprint: 1,
  step: name,
  status,
  detail: "planted",
  ...extra,
});

/** Run the gate with console.log captured; returns the exit code and the lines. */
function run(args) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { code: runGate(args), lines };
  } finally {
    console.log = log;
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-gate-write-"));
  const resultsFile = join(dir, "results.json");
  const baselinePath = join(dir, "trial-baseline.json");
  const newStep = step("zz-new-step", "fail", { severity: "S1" });
  assert.equal(classify(newStep, loadCatalog()), null, "the planted step must match no class");
  writeFileSync(
    resultsFile,
    JSON.stringify({
      results: [newStep, step("zz-kept", "fail", { severity: "S1" }), step("zz-stale", "pass")],
    }),
  );
  const classifiedRow = { severity: "S1", issue: "barwise-aaa", note: "a real note", detail: "d" };
  // Written in reverse id order, so a writer that does not sort is visible.
  const rows = {
    "C01/small/1/zz-unclassified": {
      note: "(unclassified) todo",
      issue: null,
      detail: "d",
    },
    "C01/small/1/zz-stale": { severity: "S1", issue: "barwise-bbb", note: "was failing" },
    "C01/small/1/zz-kept": classifiedRow,
  };
  writeFileSync(baselinePath, JSON.stringify({ findings: rows }, null, 2) + "\n");
  return { dir, resultsFile, baselinePath, classifiedRow };
}

test("trial gate --write keeps a no-longer-open row, sorts by id, and prints what it kept, added and left [adr:baselines-merge-on-write#findings-order]", () => {
  const { dir, resultsFile, baselinePath, classifiedRow } = fixture();
  try {
    const first = run({ write: true, baselinePath, resultsFile });
    const summary = first.lines.filter((l) => l.startsWith("trial gate: ") && /kept/.test(l));
    assert.equal(summary.length, 1, `one summary line, got:\n${first.lines.join("\n")}`);
    // kept = the classified row and the stale one (both carry a note and an
    // issue); unclassified = the planted placeholder plus the new row.
    assert.equal(
      summary[0],
      "trial gate: 2 verdict(s) kept, 1 new (0 matched a catalog class), 2 still unclassified, "
        + "1 no longer open (kept; remove by hand): C01/small/1/zz-stale",
    );
    const written = JSON.parse(readFileSync(baselinePath, "utf8")).findings;
    const ids = Object.keys(written);
    assert.deepEqual(ids, [...ids].sort(), "rows are written sorted by id");
    assert.equal(ids.length, 4, "the new row is added and none is dropped");
    assert.ok(written["C01/small/1/zz-stale"], "the row no longer open is still there");
    assert.deepEqual(
      written["C01/small/1/zz-kept"],
      classifiedRow,
      "a classified row is untouched",
    );
    const counts = /^trial gate: (\d+) verdict\(s\) kept, \d+ new \(\d+ matched[^)]*\), (\d+) still/
      .exec(summary[0]);
    assert.equal(
      Number(counts[1]) + Number(counts[2]),
      ids.length,
      "kept plus unclassified is the rows written",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trial gate --write prints the same summary when the run adds no row [adr:baselines-merge-on-write#findings-order]", () => {
  const { dir, resultsFile, baselinePath } = fixture();
  try {
    run({ write: true, baselinePath, resultsFile });
    const before = readFileSync(baselinePath, "utf8");
    const again = run({ write: true, baselinePath, resultsFile });
    const summary = again.lines.filter((l) => /verdict\(s\) kept/.test(l));
    assert.equal(summary.length, 1, `a second write still reports:\n${again.lines.join("\n")}`);
    assert.match(summary[0], /2 verdict\(s\) kept, 0 new \(0 matched/);
    assert.match(summary[0], /1 no longer open \(kept; remove by hand\): C01\/small\/1\/zz-stale/);
    assert.equal(readFileSync(baselinePath, "utf8"), before, "a second write changes nothing");
    const dry = run({ write: false, baselinePath, resultsFile });
    assert.ok(
      !dry.lines.some((l) => /verdict\(s\) kept/.test(l)),
      "without --write nothing is summarised",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
