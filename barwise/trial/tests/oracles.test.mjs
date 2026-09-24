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
  gradeAcceptance,
  gradeCommand,
  gradeConsumer,
  gradeHistoryStep,
  gradeImport,
  gradeParity,
  gradeProducedModelValidation,
  gradeRoundTrip,
  gradeSplit,
  gradeStaleness,
  gradeWroteOutput,
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
    gradeProducedModelValidation({ exit: 0, stderr: "" }, [{
      severity: "error",
      ruleId: "structural/x",
    }])
      .severity,
    "S1",
  );
  assert.equal(
    gradeProducedModelValidation({ exit: 0, stderr: "" }, [{ severity: "warning" }]).status,
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
  // Every row here has a reproduction, so these cases isolate the three
  // conditions the test names; the reproduction rule has its own test.
  const repro = { hasReproduction: () => true };
  const v1 = evaluateGate(results, { findings: {} }, repro);
  assert.equal(v1.fresh.length, 1);
  const v2 = evaluateGate(results, {
    findings: {
      "C01/small/1/a": { note: "open", issue: "barwise-aaa" },
      "C01/small/1/b": { note: "was failing", issue: "barwise-bbb" },
    },
  }, repro);
  assert.equal(v2.fresh.length, 0);
  assert.deepEqual(v2.stale, ["C01/small/1/b"]);
  const v3 = evaluateGate(results, {
    findings: { "C01/small/1/a": { note: "(unclassified) todo", issue: null } },
  }, repro);
  assert.deepEqual(v3.unclassified, ["C01/small/1/a"]);
  const v4 = evaluateGate(results, {
    findings: { "C01/small/1/a": { note: "open, issue filed", issue: "barwise-aaa" } },
  }, repro);
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

// The fourteen tests below were written from a Copilot review of PR #509.
// Every one of them plants an input the oracle used to certify as a pass
// without having read it -- the barwise-906 class the header names, found
// this time in the graders themselves rather than in a product gate.

test("gradeCommand: only the documented non-zero outcome is accepted, not every non-zero exit", () => {
  const base = { stdout: "", ms: 5, timedOut: false };
  const expectedNonZero = /no path/i;
  // The documented outcome: the product declined for the stated reason.
  assert.equal(
    gradeCommand({ ...base, exit: 1, stderr: "no path between A and B" }, { expectedNonZero })
      .status,
    "refused",
  );
  // A real error exiting 1 with no stack trace. `allowNonZero: true` made
  // this a pass, which is what the replacement exists to stop.
  const other = gradeCommand({ ...base, exit: 1, stderr: "could not open model" }, {
    expectedNonZero,
  });
  assert.equal(other.status, "fail");
  assert.equal(other.severity, "S3");
  assert.equal(gradeCommand({ ...base, exit: 0 }, { expectedNonZero }).status, "pass");
});

test("gradeRoundTrip: a payload with no deltas array cannot certify a round trip", () => {
  const loss = { allowed: [] };
  assert.equal(gradeRoundTrip({ deltas: [] }, loss).status, "pass");
  // Each of these read as "a diff with nothing in it" and passed.
  assert.equal(gradeRoundTrip(null, loss).status, "could_not_answer");
  assert.equal(gradeRoundTrip({ error: "diff failed" }, loss).status, "could_not_answer");
  assert.equal(gradeRoundTrip({ deltas: "not an array" }, loss).status, "could_not_answer");
  assert.equal(
    gradeRoundTrip({ deltas: [{ kind: "added", elementType: "objectType", name: "X" }] }, loss)
      .severity,
    "S1",
  );
});

test("gradeHistoryStep: an unreadable diff refuses rather than reporting the change invisible", () => {
  const expect = { removedObjectType: "Tenant" };
  assert.equal(gradeHistoryStep(expect, null).status, "could_not_answer");
  assert.equal(gradeHistoryStep(expect, { error: "boom" }).status, "could_not_answer");
  // The same empty-deltas input IS a product verdict once the diff is
  // readable -- the distinction the guard exists to preserve.
  assert.equal(gradeHistoryStep(expect, { deltas: [] }).severity, "S1");
});

test("gradeHistoryStep: the added subtype must be exactly the pair the expectation names", () => {
  // The shape `barwise diff --format json` emits for a subtype delta:
  // the endpoints only inside `name`. Both earlier versions of this test
  // used a shape the CLI never emits (an invented "X < Y" name, then
  // core's in-memory endpoint objects), so each passed while the lane
  // failed; tests/history.test.mjs now pins this shape against the CLI.
  const expect = { addedSubtype: { subtype: "VerifiedUser", supertype: "User" } };
  const delta = (sub, sup) => ({
    kind: "added",
    elementType: "subtype_fact",
    name: `${sub} is a subtype of ${sup}`,
    breakingLevel: "safe",
    changeDescriptions: [],
  });
  assert.equal(
    gradeHistoryStep(expect, { deltas: [delta("VerifiedUser", "User")] }).status,
    "pass",
  );
  // Near-misses a substring matcher accepted. The last is the sharpest:
  // the expected supertype "User" is a substring of the subtype's own
  // name, so a delta mentioning only VerifiedUser satisfied both checks.
  for (
    const [sub, sup] of [
      ["VerifiedUserAudit", "User"],
      ["VerifiedUser", "UserGroup"],
      ["Contractor", "Party"],
      ["VerifiedUser", "Account"],
    ]
  ) {
    const r = gradeHistoryStep(expect, { deltas: [delta(sub, sup)] });
    assert.equal(r.status, "fail", `${sub} < ${sup} must not satisfy VerifiedUser < User`);
    assert.equal(r.severity, "S1");
  }
});

test("gradeSplit: a shared object type is a loss only when no mapping declares the seam", () => {
  const names = ["Patient", "Encounter"];
  assert.equal(
    gradeSplit(names, { a: ["Patient"], b: ["Encounter"] }, "", new Set()).status,
    "pass",
  );
  assert.equal(gradeSplit(names, { a: ["Patient"] }, "", new Set()).severity, "S1");
  // `project split` replicates a type across a seam on purpose and emits a
  // context mapping naming its owner (docs/CLI.md). Declared, that is the
  // design -- requiring "exactly one domain" failed 12 correct splits.
  const declared = gradeSplit(
    names,
    { a: ["Patient", "Encounter"], b: ["Encounter"] },
    "",
    new Set(["Encounter"]),
  );
  assert.equal(declared.status, "pass");
  assert.match(declared.detail, /shared across a seam/);
  // Undeclared, it is a seam nothing records -- the half that can fail.
  const silent = gradeSplit(
    names,
    { a: ["Patient", "Encounter"], b: ["Encounter"] },
    "",
    new Set(),
  );
  assert.equal(silent.status, "fail");
  assert.equal(silent.severity, "S1");
  assert.match(silent.detail, /no context mapping/);
});

test("gradeStaleness: a report that found no manifest cannot answer the staleness question", () => {
  const ok = { exit: 0, stdout: "", stderr: "", timedOut: false };
  // The JSON form of "no manifest": both lists empty and manifestFound false.
  // It satisfies the staleArtifacts shape check and then read as a product
  // that tracked nothing, which is an S1 against the wrong party.
  assert.equal(
    gradeStaleness(ok, { staleArtifacts: [], freshArtifacts: [], manifestFound: false }).status,
    "could_not_answer",
  );
  assert.equal(
    gradeStaleness(ok, { staleArtifacts: [], freshArtifacts: ["a.sql"], manifestFound: true })
      .severity,
    "S1",
  );
});

test("gradeProducedModelValidation: unreadable validate output is not a clean model", () => {
  const ok = { exit: 0, stderr: "", stdout: "" };
  assert.equal(gradeProducedModelValidation(ok, []).status, "pass");
  // `parseJson(...) ?? []` at the call sites turned a parse failure into
  // this, and an empty diagnostics list is the same shape as a clean model.
  assert.equal(gradeProducedModelValidation(ok, null).status, "could_not_answer");
  assert.equal(gradeProducedModelValidation(ok, undefined).status, "could_not_answer");
  assert.equal(
    gradeProducedModelValidation(ok, [{ severity: "error", rule: "R1" }]).severity,
    "S1",
  );
});

test("gradeAcceptance: a missing or empty gym report cannot certify a persona", () => {
  const ok = { exit: 0, stderr: "", stdout: "", timedOut: false };
  assert.equal(
    gradeAcceptance(ok, { results: [{ passed: true }, { passed: true }] }).status,
    "pass",
  );
  // exit 0 with no readable report read as zero checks, zero failures, pass.
  assert.equal(gradeAcceptance(ok, null).status, "could_not_answer");
  assert.equal(gradeAcceptance(ok, {}).status, "could_not_answer");
  assert.equal(gradeAcceptance(ok, { results: [] }).status, "could_not_answer");
  const failed = gradeAcceptance(ok, {
    results: [{ passed: false, kind: "must_validate", message: "invalid" }],
  });
  assert.equal(failed.status, "fail");
  assert.equal(failed.severity, "S1");
});

test("evaluateGate: an authoring failure is reported separately from product findings", () => {
  const results = [
    {
      customer: "C01",
      tier: "small",
      sprint: 6,
      step: "acceptance:p:kernel",
      status: "fail",
      severity: "authoring",
      detail: "the persona rubric does not pass on its own kernel",
    },
  ];
  const v = evaluateGate(results, { findings: {} });
  // It stays out of the product baseline -- and runGate now exits 2 on it,
  // where it used to print the row and return 0.
  assert.equal(v.failing.length, 0);
  assert.equal(v.fresh.length, 0);
  assert.equal(v.authoring.length, 1);
});

// From the second Copilot review of PR #509.

test("gradeProducedModelValidation: a failed validate with no errors listed is not a clean model", () => {
  const ok = { exit: 0, stderr: "", stdout: "" };
  const failed = { exit: 1, stderr: "", stdout: "" };
  assert.equal(gradeProducedModelValidation(ok, []).status, "pass");
  // validate exits non-zero only when it reports errors or cannot run; a
  // warnings-only model exits 0. Non-zero with nothing listed is a
  // command that failed without saying why.
  assert.equal(gradeProducedModelValidation(failed, []).status, "could_not_answer");
  assert.equal(
    gradeProducedModelValidation(failed, [{ severity: "warning", rule: "W1" }]).status,
    "could_not_answer",
  );
  // A non-zero exit that does list errors is still the S1 it always was.
  assert.equal(
    gradeProducedModelValidation(failed, [{ severity: "error", rule: "R1" }]).severity,
    "S1",
  );
  assert.equal(
    gradeProducedModelValidation(ok, [{ severity: "warning", rule: "W1" }]).status,
    "pass",
  );
});

test("gradeWroteOutput: an importer that exits 0 must have written its model", () => {
  const pass = { status: "pass", detail: "exit 0 in 5 ms" };
  assert.equal(gradeWroteOutput(pass, true, "openapi").status, "pass");
  // Three read-back sites recorded this as a pass and skipped validation.
  const empty = gradeWroteOutput(pass, false, "openapi");
  assert.equal(empty.status, "fail");
  assert.equal(empty.severity, "S1");
  assert.match(empty.detail, /openapi importer exited 0 but wrote no model/);
  // A command that already failed keeps its own verdict.
  const crashed = { status: "fail", severity: "S2", detail: "stack trace" };
  assert.deepEqual(gradeWroteOutput(crashed, false, "openapi"), crashed);
});

test("evaluateGate: a step the lane could not answer is an open item, not a pass", () => {
  const cna = {
    customer: "C01",
    tier: "small",
    sprint: 4,
    step: "read-back:avro",
    status: "could_not_answer",
    detail: "no avro importer",
  };
  const none = () => false;
  // The first gate counted only `fail` rows, so this vanished and the run
  // printed PASS.
  const fresh = evaluateGate([cna], { findings: {} }, { hasReproduction: none });
  assert.equal(fresh.freshBlind.length, 1);
  assert.equal(fresh.fresh.length, 0);
  // Recorded with a note and an issue it is accounted for, and it needs no
  // reproduction, since there is no defect to reproduce.
  const known = {
    findings: {
      "C01/small/4/read-back:avro": {
        status: "could_not_answer",
        note: "no avro importer",
        issue: "barwise-s4x",
      },
    },
  };
  const v = evaluateGate([cna], known, { hasReproduction: none });
  assert.equal(v.freshBlind.length + v.unclassified.length + v.unreproduced.length, 0);
  // Once it can be answered, the row is stale like any other.
  const answered = evaluateGate([{ ...cna, status: "pass" }], known, { hasReproduction: none });
  assert.deepEqual(answered.stale, ["C01/small/4/read-back:avro"]);
});

test("evaluateGate: a row is classified only with a note, an issue, and for a finding a reproduction", () => {
  const failRow = {
    customer: "C01",
    tier: "small",
    sprint: 1,
    step: "import:x",
    status: "fail",
    severity: "S1",
  };
  const key = "C01/small/1/import:x";
  // A real note with `issue: null` used to pass the gate.
  const noIssue = evaluateGate([failRow], {
    findings: { [key]: { severity: "S1", note: "why it is open", issue: null } },
  }, { hasReproduction: () => true });
  assert.deepEqual(noIssue.unclassified, [key]);
  // An issue with nothing under findings/<issue>/ to reproduce it.
  const noRepro = evaluateGate([failRow], {
    findings: { [key]: { severity: "S1", note: "why", issue: "barwise-zzz" } },
  }, { hasReproduction: (i) => i !== "barwise-zzz" });
  assert.deepEqual(noRepro.unreproduced, [{ key, issue: "barwise-zzz" }]);
  const complete = evaluateGate([failRow], {
    findings: { [key]: { severity: "S1", note: "why", issue: "barwise-zzz" } },
  }, { hasReproduction: () => true });
  assert.equal(complete.unclassified.length + complete.unreproduced.length, 0);
});
