/**
 * Every oracle must be able to fail. Each test plants the defect the
 * oracle exists to catch and requires the failing verdict, then shows
 * the clean case passing, so a green trial run is evidence and not a
 * grader that says PASS to everything (the barwise-906 class).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateGate } from "../lib/gate.mjs";
import {
  gradeCommand,
  gradeConsumer,
  gradeHistoryStep,
  gradeImport,
  gradeParity,
  gradeProducedModelValidation,
  gradeRoundTrip,
  gradeSplit,
  gradeStaleness,
} from "../lib/oracles/grade.mjs";

const ok = {
  exit: 0,
  stdout: "",
  stderr: "Imported 3 object types, 2 fact types.\n",
  ms: 10,
  timedOut: false,
};
const manifest = {
  generator: "ddl",
  dialect: "postgres",
  tables: [
    { name: "patient", kind: "entity", importable: true },
    { name: "encounter", kind: "entity", importable: true },
    { name: "zc_class", kind: "lookup", importable: true },
  ],
};

test("gradeImport: a silently dropped table is S1, a named skip is a refusal, a full import passes", () => {
  const dropped = gradeImport(ok, manifest, "import", { objectTypes: 1, names: ["Patient"] });
  assert.equal(dropped.status, "fail");
  assert.equal(dropped.severity, "S1");
  const named = gradeImport(
    { ...ok, stderr: "1 warning(s):\n  - skipped table encounter: no key\n" },
    manifest,
    "import",
    { objectTypes: 1, names: ["Patient"] },
  );
  assert.equal(named.status, "refused");
  const full = gradeImport(ok, manifest, "import", {
    objectTypes: 2,
    names: ["Patient", "Encounter"],
  });
  assert.equal(full.status, "pass");
});

test("gradeImport: an empty model with exit 0 is S3, a crash is S2, a hang is S2", () => {
  assert.equal(gradeImport(ok, manifest, "import", { objectTypes: 0, names: [] }).severity, "S3");
  assert.equal(
    gradeImport(
      { ...ok, exit: 1, stderr: "TypeError: x is undefined\n    at foo (/a/b.js:1:1)\n" },
      manifest,
      "import",
      null,
    ).severity,
    "S2",
  );
  assert.equal(gradeImport({ ...ok, timedOut: true }, manifest, "import", null).severity, "S2");
});

test("gradeImport: for an unsupported format, a named refusal passes as refused and a fabricated model is S1", () => {
  assert.equal(
    gradeImport(
      { ...ok, exit: 1, stderr: "Error: Unknown format oracle; not supported\n" },
      { generator: "ddl", dialect: "oracle", tables: [] },
      "refusal",
      null,
    ).status,
    "refused",
  );
  assert.equal(
    gradeImport(ok, { generator: "ddl", dialect: "oracle", tables: [] }, "refusal", {
      objectTypes: 4,
      names: ["A", "B", "C", "D"],
    }).severity,
    "S1",
  );
  assert.equal(
    gradeImport(ok, { generator: "ddl", dialect: "oracle", tables: [] }, "refusal", {
      objectTypes: 0,
      names: [],
    }).severity,
    "S3",
  );
});

test("gradeRoundTrip: a delta outside the loss set fails, inside passes", () => {
  const loss = { allowed: [{ elementType: "population", kind: "*" }] };
  const bad = gradeRoundTrip({
    deltas: [{ kind: "removed", elementType: "fact_type", name: "A has B" }],
  }, loss);
  assert.equal(bad.status, "fail");
  assert.equal(bad.severity, "S1");
  const good = gradeRoundTrip({
    deltas: [{ kind: "removed", elementType: "population", name: "p" }],
  }, loss);
  assert.equal(good.status, "pass");
});

test("gradeSplit: an object type in no domain is S1; a warned drop is refused; clean is pass", () => {
  assert.equal(gradeSplit(["A", "B"], { x: ["A"] }, "").severity, "S1");
  assert.equal(
    gradeSplit(
      ["A", "B"],
      { x: ["A"], y: ["B"] },
      "Dropped a subset constraint on fact type F in domain x",
    ).status,
    "refused",
  );
  assert.equal(gradeSplit(["A", "B"], { x: ["A"], y: ["B"] }, "").status, "pass");
});

test("gradeHistoryStep: a rename must appear as a synonym candidate; removal and addition alone is S5; nothing is S1", () => {
  const expect = { renamed: { from: "Encounter", to: "Visit" } };
  assert.equal(
    gradeHistoryStep(expect, {
      deltas: [],
      synonymCandidates: [{ removed: "Encounter", added: "Visit" }],
    }).status,
    "pass",
  );
  assert.equal(
    gradeHistoryStep(expect, {
      deltas: [{ kind: "removed", elementType: "object_type", name: "Encounter" }, {
        kind: "added",
        elementType: "object_type",
        name: "Visit",
      }],
      synonymCandidates: [],
    }).severity,
    "S5",
  );
  assert.equal(gradeHistoryStep(expect, { deltas: [], synonymCandidates: [] }).severity, "S1");
  assert.equal(gradeHistoryStep({ addedFactType: "A has B" }, { deltas: [] }).severity, "S1");
  assert.equal(
    gradeHistoryStep({ addedFactType: "A has B" }, {
      deltas: [{ kind: "added", elementType: "fact_type", name: "A has B" }],
    }).status,
    "pass",
  );
});

test("gradeCommand: over budget is S2, an unnamed non-zero exit is S3, a named one is refused", () => {
  assert.equal(
    gradeCommand({ exit: 0, ms: 5000, stderr: "", timedOut: false }, { budgetMs: 1000 }).severity,
    "S2",
  );
  assert.equal(
    gradeCommand({ exit: 1, ms: 5, stderr: "Error: boom\n", timedOut: false }).severity,
    "S3",
  );
  assert.equal(
    gradeCommand({
      exit: 1,
      ms: 5,
      stderr: "Error: dialect oracle is not supported\n",
      timedOut: false,
    }).status,
    "refused",
  );
  assert.equal(
    gradeCommand({ exit: 0, ms: 5, stderr: "", timedOut: false }, { budgetMs: 1000 }).status,
    "pass",
  );
});

test("gradeConsumer and gradeProducedModelValidation fail on a rejected statement and on a structural error", () => {
  assert.equal(
    gradeConsumer({ statements: 3, parsed: 2, failures: [{ error: "syntax" }] }).severity,
    "S1",
  );
  assert.equal(gradeConsumer({ statements: 3, parsed: 3, failures: [] }).status, "pass");
  assert.equal(gradeConsumer({ unavailable: "no uv" }).status, "could_not_answer");
  assert.equal(
    gradeProducedModelValidation({ stderr: "" }, [{ severity: "error", ruleId: "structural/x" }])
      .severity,
    "S1",
  );
  assert.equal(
    gradeProducedModelValidation({ stderr: "" }, [{ severity: "warning" }]).status,
    "pass",
  );
});

test("gradeParity fails on a real difference and ignores path and whitespace noise", () => {
  assert.equal(gradeParity("a\nb", "a\nc", "x").severity, "S1");
  assert.equal(gradeParity("a  \r\nb", "a\nb", "x").status, "pass");
});

test("evaluateGate: a new failure, a stale row and an unclassified row each fail the gate", () => {
  const results = [
    { customer: "C01", tier: "small", sprint: 1, step: "a", status: "fail", severity: "S1" },
    { customer: "C01", tier: "small", sprint: 1, step: "b", status: "pass" },
  ];
  const v1 = evaluateGate(results, { findings: {} });
  assert.equal(v1.fresh.length, 1);
  const v2 = evaluateGate(results, {
    findings: { "C01/small/1/a": { note: "open" }, "C01/small/1/b": { note: "was failing" } },
  });
  assert.equal(v2.fresh.length, 0);
  assert.deepEqual(v2.stale, ["C01/small/1/b"]);
  const v3 = evaluateGate(results, {
    findings: { "C01/small/1/a": { note: "(unclassified) todo" } },
  });
  assert.deepEqual(v3.unclassified, ["C01/small/1/a"]);
  const v4 = evaluateGate(results, {
    findings: { "C01/small/1/a": { note: "open, issue filed" } },
  });
  assert.equal(v4.fresh.length + v4.stale.length + v4.unclassified.length, 0);
});

test("gradeStaleness: a real staleness report passes, a clean one after a change is S1, an unreadable payload refuses", () => {
  const ok = { exit: 1, stdout: "", stderr: "", timedOut: false };
  // The shape lineage status actually emits. The first version of this
  // oracle read a field named `stale` and graded this very payload as a
  // product failure; the test exists because nothing else caught that.
  assert.equal(
    gradeStaleness(ok, { staleArtifacts: [{ artifact: "a.sql" }], freshArtifacts: [] }).status,
    "pass",
  );
  const clean = gradeStaleness(ok, { staleArtifacts: [], freshArtifacts: ["a.sql"] });
  assert.equal(clean.status, "fail");
  assert.equal(clean.severity, "S1");
  // Neither a missing payload nor a differently shaped one may produce a
  // verdict about the product.
  assert.equal(gradeStaleness(ok, null).status, "could_not_answer");
  assert.equal(gradeStaleness(ok, { stale: [] }).status, "could_not_answer");
  assert.equal(
    gradeStaleness({ ...ok, stderr: "no manifest found; run barwise export" }, null).severity,
    "S1",
  );
  assert.equal(
    gradeStaleness({ ...ok, stderr: "TypeError: x\n    at f (/a.js:1:1)" }, null).severity,
    "S2",
  );
});
