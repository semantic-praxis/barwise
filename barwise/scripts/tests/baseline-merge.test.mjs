/**
 * Unit tests for the baseline merge rule.
 *
 * `gates.test.mjs` drives the three writers end to end, which is what proves
 * the repository's own 90 verdicts survive a rewrite. These tests cover the
 * helper's contract directly, because two parts of it are not reachable
 * through any current caller and would otherwise be guards with no test:
 *
 *   - a falsy preserved value against a non-empty placeholder. Every caller
 *     today either rejects a falsy human field in `--check` (spec-status's
 *     `!row.note`, corrections' `CAUGHT_BY` membership) or has `""` as its own
 *     placeholder, so `key in prior` and `prior[key] || placeholder` cannot be
 *     told apart from outside. A mutation swapping them came back UNCAUGHT
 *     against the script-level tests, which is how this file came to exist.
 *   - the `unclassified` bucket, which no committed baseline populates because
 *     all three are fully classified.
 *
 * Spec: docs/specs/baseline-write-preserves-verdicts.spec.md.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeBaselineRows, mergeSummary, readExistingRows } from "../lib/baseline-merge.mjs";

/** A throwaway baseline file with the given contents. */
function baselineFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-baseline-"));
  const path = join(dir, "baseline.json");
  writeFileSync(path, contents);
  return { path, dir };
}

const PRESERVE = { verdict: "TODO", note: "TODO: classify" };

test("a still-detected row keeps every human-owned field", () => {
  const { rows, kept, added } = mergeBaselineRows({
    fresh: { a: { message: "fresh message" } },
    existing: { a: { message: "stale message", verdict: "real", note: "why" } },
    preserve: PRESERVE,
  });
  assert.equal(rows.a.verdict, "real");
  assert.equal(rows.a.note, "why");
  assert.equal(kept, 1);
  assert.equal(added, 0);
});

test("a derived field is refreshed from the detector, not preserved", () => {
  // The detector owns `message`; the human owns `verdict`. Preserving the
  // derived half too would pin a row's evidence to whenever it was first seen.
  const { rows } = mergeBaselineRows({
    fresh: { a: { message: "fresh message" } },
    existing: { a: { message: "stale message", verdict: "real", note: "why" } },
    preserve: PRESERVE,
  });
  assert.equal(rows.a.message, "fresh message");
});

test("a falsy preserved value survives a non-empty placeholder", () => {
  // The reason this file exists. `prior[key] || preserve[key]` passes every
  // script-level test and loses an empty note here, so the distinction between
  // "absent" and "falsy" is asserted where it is observable rather than
  // asserted nowhere and described in a comment.
  const { rows, kept } = mergeBaselineRows({
    fresh: { a: { message: "m" } },
    existing: { a: { message: "m", verdict: "real", note: "" } },
    preserve: PRESERVE,
  });
  assert.equal(rows.a.note, "", "an empty note is a value, not a missing field");
  assert.equal(kept, 1, "a row with one real verdict and one empty note was judged");
});

test("a new id gets the placeholder and counts as added", () => {
  const { rows, kept, added } = mergeBaselineRows({
    fresh: { a: { message: "m" }, b: { message: "n" } },
    existing: { a: { message: "m", verdict: "real", note: "why" } },
    preserve: PRESERVE,
  });
  assert.equal(rows.b.verdict, "TODO");
  assert.equal(rows.b.note, "TODO: classify");
  assert.equal(kept, 1);
  assert.equal(added, 1);
});

test("a row still holding the placeholder counts as unclassified, never as kept", () => {
  // Counting it as preserved would overstate what the file holds: nobody has
  // judged it. The three buckets have to add up to the row count, which is
  // what makes the summary line readable as an accounting.
  const { kept, added, unclassified, rows } = mergeBaselineRows({
    fresh: { a: { message: "m" }, b: { message: "n" }, c: { message: "o" } },
    existing: {
      a: { message: "m", verdict: "real", note: "why" },
      b: { message: "n", verdict: "TODO", note: "TODO: classify" },
    },
    preserve: PRESERVE,
  });
  assert.equal(kept, 1);
  assert.equal(unclassified, 1);
  assert.equal(added, 1);
  assert.equal(kept + added + unclassified, Object.keys(rows).length);
});

test("a partly classified row counts as kept", () => {
  // Every human field at the placeholder, not any: a verdict recorded without
  // an annotation is still a judgment.
  const { kept, unclassified } = mergeBaselineRows({
    fresh: { a: { message: "m" } },
    existing: { a: { message: "m", verdict: "real", note: "TODO: classify" } },
    preserve: PRESERVE,
  });
  assert.equal(kept, 1);
  assert.equal(unclassified, 0);
});

test("a row the detector no longer produces is reported, not written", () => {
  const { rows, dropped } = mergeBaselineRows({
    fresh: { a: { message: "m" } },
    existing: {
      a: { message: "m", verdict: "real", note: "why" },
      gone: { message: "x", verdict: "real", note: "why" },
    },
    preserve: PRESERVE,
  });
  assert.deepEqual(Object.keys(rows), ["a"]);
  assert.deepEqual(dropped, ["gone"]);
});

test("rows come out sorted by id, whatever order the detector emitted them in", () => {
  // Without this the file's order is the detector's traversal order, and a
  // rerun reshuffles it: regenerating the correction baseline moved 73 of its
  // 74 rows while changing nothing.
  const { rows } = mergeBaselineRows({
    fresh: { zeta: { message: "z" }, alpha: { message: "a" }, mid: { message: "m" } },
    existing: {},
    preserve: PRESERVE,
  });
  assert.deepEqual(Object.keys(rows), ["alpha", "mid", "zeta"]);
});

test("an empty existing baseline is a first write, not an error", () => {
  const { rows, kept, added, dropped } = mergeBaselineRows({
    fresh: { a: { message: "m" } },
    existing: {},
    preserve: PRESERVE,
  });
  assert.equal(rows.a.verdict, "TODO");
  assert.equal(kept, 0);
  assert.equal(added, 1);
  assert.deepEqual(dropped, []);
});

test("the summary names every non-zero bucket and omits the rest", () => {
  // A successful merge and a silent clobber printed the same sentence before
  // this line existed, which is the defect one level down from the gate
  // refusal contract: one value for two situations.
  assert.equal(
    mergeSummary({ kept: 74, added: 0, dropped: [], unclassified: 0 }),
    "74 verdict(s) kept",
  );
  assert.equal(
    mergeSummary({ kept: 74, added: 1, dropped: ["x"], unclassified: 2 }),
    "74 verdict(s) kept, 1 new, 2 still unclassified, 1 no longer detected",
  );
});

test("readExistingRows treats an absent file as a first write", () => {
  const { dir } = baselineFile("{}");
  try {
    assert.deepEqual(readExistingRows(join(dir, "does-not-exist.json"), "records"), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readExistingRows THROWS on a malformed file rather than reporting no rows", () => {
  // The case a defensive catch would swallow, and the reason this is not one:
  // "could not read the file" read as "the file has no rows" means the next
  // write clobbers every verdict in a baseline that is merely unparsed. That is
  // the defect this module exists to prevent, wearing a catch as a disguise.
  const { path, dir } = baselineFile('{"records": {"a": ');
  try {
    assert.throws(() => readExistingRows(path, "records"), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readExistingRows THROWS on a read error that is not ENOENT", () => {
  // The guard the malformed-JSON test above does NOT reach: `JSON.parse` sits
  // outside the try, so a truncated file throws whatever the catch does. Only a
  // failing READ exercises it, and the distinction matters -- returning `{}` for
  // an unreadable file is "this baseline has no rows", so the next write
  // clobbers every verdict in a file nobody could open. A directory gives a
  // portable EISDIR without needing to manipulate permissions (which root
  // ignores, so a chmod probe would pass for the wrong reason in CI).
  const { dir } = baselineFile("{}");
  try {
    assert.throws(() => readExistingRows(dir, "records"), (err) => {
      assert.notEqual(err.code, "ENOENT", "the probe must not be an absent file");
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readExistingRows returns the named key, and {} when the file omits it", () => {
  const { path, dir } = baselineFile(JSON.stringify({ records: { a: { note: "n" } } }));
  try {
    assert.deepEqual(readExistingRows(path, "records"), { a: { note: "n" } });
    assert.deepEqual(readExistingRows(path, "checks"), {}, "a missing key is a first write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
