/**
 * The change storm must only contain real changes. A history step that
 * is a no-op (a duplicate constraint, a fact type that already exists,
 * a subtype already declared) would be graded as the product missing a
 * delta, which is how a harness defect gets filed as a product bug --
 * it happened once, on C01's add_mandatory, before these guards existed.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { runCli } from "../lib/exec.mjs";
import { applyChange } from "../lib/generators/history.mjs";
import { gradeHistoryStep } from "../lib/oracles/grade.mjs";
import { CLI_BUNDLE } from "../lib/paths.mjs";

const doc = parse(
  readFileSync(new URL("../customers/C01-hospital/kernel.orm.yaml", import.meta.url), "utf8"),
);
const refuses = (change, pattern) => assert.throws(() => applyChange(doc, change), pattern);

test("a no-op step is refused, not applied", () => {
  refuses(
    { kind: "add_mandatory", fact_type: "Claim is submitted to Payer", role_index: 0 },
    /no-op/,
  );
  refuses({
    kind: "add_fact_type",
    name: "Claim is submitted to Payer",
    between: ["Claim", "Payer"],
  }, /already in the model/);
  refuses(
    { kind: "add_subtype", subtype: "InpatientEncounter", supertype: "Encounter" },
    /already in the model/,
  );
});

test("a step naming something that is not there is refused", () => {
  refuses({ kind: "rename_object_type", from: "NoSuchType", to: "X" }, /no object type/);
  refuses({ kind: "rename_fact_type", from: "No Such Fact", to: "X" }, /no fact type/);
  refuses(
    { kind: "tighten_uniqueness", fact_type: "Claim is submitted to Payer" },
    /no spanning uniqueness/,
  );
  refuses(
    { kind: "add_value_constraint_value", object_type: "Claim", value: "x" },
    /no value constraint/,
  );
  refuses({ kind: "no_such_kind" }, /unknown change kind/);
});

test("a real step changes the model and reports what to expect", () => {
  const renamed = applyChange(doc, { kind: "rename_object_type", from: "Encounter", to: "Visit" });
  assert.deepEqual(renamed.expect.renamed, { from: "Encounter", to: "Visit" });
  assert.ok(renamed.doc.model.object_types.some((o) => o.name === "Visit"));
  assert.ok(!renamed.doc.model.object_types.some((o) => o.name === "Encounter"));

  const added = applyChange(doc, {
    kind: "add_mandatory",
    fact_type: "Claim is submitted to Payer",
    role_index: 1,
  });
  const ft = added.doc.model.fact_types.find((f) => f.name === "Claim is submitted to Payer");
  assert.equal(ft.constraints.filter((c) => c.type === "mandatory").length, 2);
  assert.equal(added.expect.modifiedFactType, "Claim is submitted to Payer");

  const removed = applyChange(doc, { kind: "remove_object_type", name: "TraumaEncounter" });
  assert.ok(!removed.doc.model.object_types.some((o) => o.name === "TraumaEncounter"));
  assert.ok(removed.doc.model.subtype_facts.every((s) => s.subtype !== "ot-trauma-encounter"));
  assert.equal(removed.expect.removedObjectType, "TraumaEncounter");
});

test("applyChange does not mutate the model it was given", () => {
  const before = JSON.stringify(doc);
  applyChange(doc, { kind: "rename_object_type", from: "Encounter", to: "Visit" });
  applyChange(doc, { kind: "remove_object_type", name: "TraumaEncounter" });
  assert.equal(JSON.stringify(doc), before);
});

// The subtype grader matches the name the CLI prints, and twice it was
// built against a delta shape the CLI never emits -- each time with a
// green unit test and a red lane. This runs the real `barwise diff` over
// a real history step, so the fixture cannot drift from the product.
test("the add_subtype expectation is satisfied by the CLI's own diff output", () => {
  assert.ok(existsSync(CLI_BUNDLE), `CLI bundle missing at ${CLI_BUNDLE}; run npm run build`);
  const dir = mkdtempSync(join(tmpdir(), "trial-subtype-"));
  try {
    const step = applyChange(doc, {
      kind: "add_subtype",
      subtype: "Appointment",
      supertype: "Order",
    });
    const before = join(dir, "before.orm.yaml");
    const after = join(dir, "after.orm.yaml");
    writeFileSync(before, stringify(doc, { lineWidth: 0 }));
    writeFileSync(after, stringify(step.doc, { lineWidth: 0 }));
    const d = runCli(["diff", before, after, "--format", "json"]);
    assert.equal(d.exit, 0, d.stderr);
    const diff = JSON.parse(d.stdout);
    assert.equal(gradeHistoryStep(step.expect, diff).status, "pass");
    // And the same expectation against a diff with no change must fail,
    // or the pass above proves nothing.
    const same = runCli(["diff", before, before, "--format", "json"]);
    assert.equal(gradeHistoryStep(step.expect, JSON.parse(same.stdout)).status, "fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the rename expectation is satisfied by the CLI's own name change", () => {
  // Graded against the CLI's real output, for the reason the subtype test
  // above gives. The change storm keeps ids, so since model invariants WS2
  // the rename is one name change; it used to be a synonym candidate.
  const dir = mkdtempSync(join(tmpdir(), "trial-rename-"));
  try {
    const step = applyChange(doc, { kind: "rename_object_type", from: "Encounter", to: "Visit" });
    const before = join(dir, "before.orm.yaml");
    const after = join(dir, "after.orm.yaml");
    writeFileSync(before, stringify(doc, { lineWidth: 0 }));
    writeFileSync(after, stringify(step.doc, { lineWidth: 0 }));
    const d = runCli(["diff", before, after, "--format", "json"]);
    assert.equal(d.exit, 0, d.stderr);
    assert.equal(gradeHistoryStep(step.expect, JSON.parse(d.stdout)).status, "pass");
    const same = runCli(["diff", before, before, "--format", "json"]);
    assert.notEqual(gradeHistoryStep(step.expect, JSON.parse(same.stdout)).status, "pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rename under a fresh id is satisfied by the CLI's own synonym candidate", () => {
  // The other form the grader accepts, against real output too: the same
  // rename with every reference to the object type moved to a new id, as
  // a re-extraction would mint one.
  const dir = mkdtempSync(join(tmpdir(), "trial-rename-fresh-"));
  try {
    const step = applyChange(doc, { kind: "rename_object_type", from: "Encounter", to: "Visit" });
    const oldId = doc.model.object_types.find((ot) => ot.name === "Encounter").id;
    const swap = (v) =>
      v === oldId
        ? `${oldId}-fresh`
        : Array.isArray(v)
        ? v.map(swap)
        : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
        : v;
    const before = join(dir, "before.orm.yaml");
    const after = join(dir, "after.orm.yaml");
    writeFileSync(before, stringify(doc, { lineWidth: 0 }));
    writeFileSync(after, stringify(swap(step.doc), { lineWidth: 0 }));
    const d = runCli(["diff", before, after, "--format", "json"]);
    assert.equal(d.exit, 0, d.stderr);
    const graded = gradeHistoryStep(step.expect, JSON.parse(d.stdout));
    assert.equal(graded.status, "pass", graded.detail);
    assert.match(graded.detail, /synonym candidate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an added fact type takes an id no fact type holds, even after a removal", () => {
  // Counting fact types reused an id once a removal shrank the list, so the
  // file held two fact types under one id and diff read the addition as a
  // change to the earlier one (three S1 findings in the 2026-10-24 run).
  const first = applyChange(doc, {
    kind: "add_fact_type",
    name: "Encounter has Payer",
    between: ["Encounter", "Payer"],
  }).doc;
  const shrunk = structuredClone(first);
  shrunk.model.fact_types.splice(0, 1);
  const second = applyChange(shrunk, {
    kind: "add_fact_type",
    name: "Payer has Encounter",
    between: ["Payer", "Encounter"],
  }).doc;
  const ids = second.model.fact_types.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
