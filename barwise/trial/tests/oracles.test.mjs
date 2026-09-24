/**
 * Every oracle must be able to fail. Each test plants the defect the
 * oracle exists to catch and requires the failing verdict, then shows
 * the clean case passing, so a green trial run is evidence and not a
 * grader that says PASS to everything (the barwise-906 class).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { evaluateGate } from "../lib/gate.mjs";
import {
  gradeAcceptance,
  gradeCommand,
  gradeConsumer,
  gradeHistoryStep,
  gradeImpact,
  gradeImport,
  gradeParity,
  gradeProducedModelValidation,
  gradeReadBackNotEmpty,
  gradeRoundTrip,
  gradeSplit,
  gradeStaleness,
  gradeValidationParity,
  gradeWroteOutput,
} from "../lib/oracles/grade.mjs";
import { exemptPositions, personaProblems } from "../lib/personas.mjs";
import { acceptanceCandidates } from "../lib/steps.mjs";

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
  // The candidate shape barwise diff --format json emits. This fixture used
  // to be { removed, added }, a shape the CLI never produces, which a
  // substring matcher over the serialised candidate happened to accept;
  // history.test.mjs now pins the shape against the real CLI.
  const candidate = (elementType, removedName, addedName) => ({
    elementType,
    removedName,
    addedName,
    removedIndex: 0,
    addedIndex: 1,
    reasons: ["matching reference mode suffix"],
  });
  assert.equal(
    gradeHistoryStep(expect, {
      deltas: [],
      synonymCandidates: [candidate("object_type", "Encounter", "Visit")],
    }).status,
    "pass",
  );
  // Near-misses the substring matcher accepted: a fact-type candidate that
  // mentions both names, and an object-type candidate for a longer name.
  for (
    const near of [
      candidate("fact_type", "Encounter has Id", "Visit has Id"),
      candidate("object_type", "EncounterType", "VisitType"),
    ]
  ) {
    assert.notEqual(
      gradeHistoryStep(expect, { deltas: [], synonymCandidates: [near] }).status,
      "pass",
      JSON.stringify(near),
    );
  }
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
  // manifestFound is part of that shape; these fixtures once omitted it and
  // still produced verdicts, which is what the oracle must not do.
  assert.equal(
    gradeStaleness(ok, {
      staleArtifacts: ["/w/schema.sql"],
      freshArtifacts: [],
      manifestFound: true,
    }).status,
    "pass",
  );
  assert.equal(
    gradeStaleness(ok, { staleArtifacts: ["/w/schema.sql"], freshArtifacts: [] }).status,
    "could_not_answer",
  );
  const clean = gradeStaleness(ok, {
    staleArtifacts: [],
    freshArtifacts: ["/w/schema.sql"],
    manifestFound: true,
  });
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

test("evaluateGate: a blind-spot row whose step now fails is a definite finding, not exempt", () => {
  // The reproduction exemption read the baseline's old status, so a known
  // could_not_answer row that started failing passed under the blind-spot
  // issue with nothing reproducing it.
  const key = "C01/small/4/read-back:avro";
  const baseline = {
    findings: {
      [key]: { status: "could_not_answer", note: "no avro importer", issue: "barwise-s4x" },
    },
  };
  const noRepro = { hasReproduction: () => false };
  const nowFails = [{
    customer: "C01",
    tier: "small",
    sprint: 4,
    step: "read-back:avro",
    status: "fail",
    severity: "S1",
  }];
  const v = evaluateGate(nowFails, baseline, noRepro);
  assert.deepEqual(v.changed, [{ key, was: "could_not_answer", now: "fail" }]);
  assert.deepEqual(v.unreproduced, [{ key, issue: "barwise-s4x" }]);
  // The same row still blind is exempt, and unchanged.
  const stillBlind = [{ ...nowFails[0], status: "could_not_answer", severity: undefined }];
  const w = evaluateGate(stillBlind, baseline, noRepro);
  assert.deepEqual(w.changed, []);
  assert.deepEqual(w.unreproduced, []);
  // And the reverse: a finding whose step can no longer answer.
  const finding = { findings: { [key]: { severity: "S1", note: "real", issue: "barwise-aaa" } } };
  const x = evaluateGate(stillBlind, finding, { hasReproduction: () => true });
  assert.deepEqual(x.changed, [{ key, was: "fail", now: "could_not_answer" }]);
});

test("evaluateGate: a baseline row whose step stopped being emitted is not silently kept", () => {
  // `stale` compares only rows that ran, so a step that vanished took its
  // open finding with it and the gate passed.
  const baseline = {
    findings: {
      "C01/small/5/diff:4:add_subtype": { severity: "S1", note: "n", issue: "barwise-aaa" },
      "C02/small/5/diff:1:rename": { severity: "S5", note: "n", issue: "barwise-bbb" },
      "C01/medium/5/diff:4:add_subtype": { severity: "S1", note: "n", issue: "barwise-aaa" },
    },
  };
  // C01 sprint 5 ran without the step; C02 never ran; medium is another tier.
  const results = [{
    customer: "C01",
    tier: "small",
    sprint: 5,
    step: "diff:1:rename",
    status: "pass",
  }];
  const v = evaluateGate(results, baseline, { hasReproduction: () => true });
  assert.deepEqual(v.vanished, ["C01/small/5/diff:4:add_subtype"]);
  assert.deepEqual(v.unrun, ["C02/small/5/diff:1:rename"]);
});

test("acceptanceCandidates: only the hand-written kernel is the authoring control", () => {
  // At medium and enterprise tiers the scaled model was graded under the
  // label "kernel", so a failure at scale was filed as authoring and never
  // reached the baseline.
  const c = acceptanceCandidates({
    kernel: "k.orm.yaml",
    scaled: "scaled.orm.yaml",
    imported: [["a-ddl", "a.orm.yaml", "ddl"], ["b-dbt", "b.orm.yaml", "dbt"]],
    judges: ["b-dbt"],
  });
  assert.deepEqual(c, [
    { label: "kernel", path: "k.orm.yaml", authoring: true },
    { label: "scaled", path: "scaled.orm.yaml", authoring: false },
    { label: "b-dbt", path: "b.orm.yaml", authoring: false, kind: "dbt" },
  ]);
  // Every judged artifact is graded, not only the first: the runner used to
  // read judges[0] and silently ignore the rest.
  const both = acceptanceCandidates({
    kernel: "k.orm.yaml",
    imported: [["a-ddl", "a.orm.yaml", "ddl"], ["b-dbt", "b.orm.yaml", "dbt"]],
    judges: ["a-ddl", "b-dbt"],
  });
  assert.deepEqual(both.map((x) => x.label), ["kernel", "a-ddl", "b-dbt"]);
  // No judges, no imports: the old fallback to "every import" is gone, and
  // the package check (personaProblems) refuses such a persona before a run.
  const none = acceptanceCandidates({ kernel: "k.orm.yaml", imported: [["a-ddl", "a.orm.yaml"]] });
  assert.deepEqual(none.map((x) => x.label), ["kernel"]);
});

test("personaProblems: judges is required and must name real artifacts", () => {
  const customer = {
    id: "C99",
    artifacts: [{ id: "repo", generator: "code" }, { id: "db", generator: "ddl" }],
    personas: [
      { id: "no-judges", acceptance: "a.gym.yaml" },
      { id: "empty", acceptance: "a.gym.yaml", judges: [] },
      { id: "ghost", acceptance: "a.gym.yaml", judges: ["nope"] },
      { id: "ok", acceptance: "a.gym.yaml", judges: ["repo", "db"] },
    ],
  };
  const problems = personaProblems(customer, () => []);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /no-judges: judges is required/);
  assert.match(problems[1], /empty: judges is required/);
  assert.match(problems[2], /ghost: judges names nope, which is not an artifact/);
});

test("personaProblems: a not_expressible entry must name one check, a judged kind and a reason", () => {
  const checks = [
    { kind: "requires_element", element: { entity: "Booking" } },
    { kind: "requires_element", element: { factTypeBetween: ["Shipment", "Carrier"] } },
  ];
  const persona = (x) => ({
    id: "p",
    acceptance: "a.gym.yaml",
    judges: ["repo"],
    not_expressible: [x],
  });
  const run = (x) =>
    personaProblems({
      id: "C99",
      artifacts: [{ id: "repo", generator: "code" }],
      personas: [persona(x)],
    }, () => checks);
  const good = {
    artifact_kind: "code",
    check: { factTypeBetween: ["Shipment", "Carrier"] },
    reason: "r",
  };
  assert.deepEqual(run(good), []);
  assert.match(run({ ...good, reason: undefined })[0], /has no reason/);
  assert.match(run({ ...good, artifact_kind: "ddl" })[0], /judges none of/);
  // Matched on the element exactly: the reversed pair is a different check.
  assert.match(
    run({ ...good, check: { factTypeBetween: ["Carrier", "Shipment"] } })[0],
    /matches 0 rubric checks/,
  );
});

test("the real customer packages satisfy the persona rules", () => {
  // Pins the packages themselves: a persona added without judges fails here
  // before it reaches the runner's refusal.
  const root = new URL("../customers/", import.meta.url);
  for (const d of readdirSync(root).filter((x) => /^C\d+/.test(x))) {
    const customer = parse(readFileSync(new URL(`${d}/customer.yaml`, root), "utf8"));
    const problems = personaProblems(
      customer,
      (p) => parse(readFileSync(new URL(`${d}/${p.acceptance}`, root), "utf8")).checks ?? [],
    );
    assert.deepEqual(problems, [], d);
  }
});

test("exemptPositions and gradeAcceptance: an excused check is excluded only for its artifact kind", () => {
  const checks = [
    { element: { entity: "Booking" } },
    { element: { factTypeBetween: ["Shipment", "Carrier"] } },
  ];
  const notExpressible = [
    { artifact_kind: "code", check: { factTypeBetween: ["Shipment", "Carrier"] }, reason: "r" },
  ];
  assert.deepEqual([...exemptPositions(checks, notExpressible, "code")], [1]);
  assert.deepEqual([...exemptPositions(checks, notExpressible, "ddl")], []);
  // The shape barwise gym check --format json emits.
  const report = {
    exerciseId: "p",
    passed: false,
    results: [
      {
        kind: "requires_element",
        passed: true,
        message: 'The model has an object type "Booking".',
      },
      {
        kind: "requires_element",
        passed: false,
        message: 'The model has no fact type connecting "Shipment" and "Carrier".',
      },
    ],
  };
  const exit1 = { exit: 1, stdout: "", stderr: "", timedOut: false };
  const excused = gradeAcceptance(exit1, report, { exempt: new Set([1]), checkCount: 2 });
  assert.equal(excused.status, "pass");
  assert.match(excused.detail, /1 not expressible/);
  // The same report without the exemption is the S5 it always was.
  assert.equal(gradeAcceptance(exit1, report).severity, "S5");
  // A second, unexcused failure still fails.
  const worse = {
    ...report,
    results: [{ ...report.results[0], passed: false, message: "no Booking" }, report.results[1]],
  };
  assert.equal(
    gradeAcceptance(exit1, worse, { exempt: new Set([1]), checkCount: 2 }).status,
    "fail",
  );
  // Positions only mean something when the report lines up with the rubric.
  assert.equal(
    gradeAcceptance(exit1, report, { exempt: new Set([1]), checkCount: 3 }).status,
    "could_not_answer",
  );
});

test("gradeValidationParity: payloads it cannot read are not agreement", () => {
  // Shapes copied from the products: the CLI prints an array of
  // diagnostics, MCP validate_model returns { errors, warnings }.
  const cli = JSON.stringify([
    { severity: "error", ruleId: "r1", message: "m" },
    { severity: "warning", ruleId: "r2", message: "m" },
    { severity: "info", ruleId: "r3", message: "m" },
  ]);
  const mcp = JSON.stringify({
    valid: false,
    errorCount: 1,
    warningCount: 1,
    errors: [{ severity: "error", ruleId: "r1", message: "m" }],
    warnings: [{ severity: "warning", ruleId: "r2", message: "m" }],
  });
  assert.equal(gradeValidationParity(cli, mcp).status, "pass");
  // A real disagreement is still a finding.
  const mcpClean = JSON.stringify({
    valid: true,
    errorCount: 0,
    warningCount: 0,
    errors: [],
    warnings: [],
  });
  assert.equal(gradeValidationParity(cli, mcpClean).severity, "S1");
  // The planted control: both unreadable used to compare equal and pass.
  assert.equal(gradeValidationParity("not json", "also not").status, "could_not_answer");
  // A wrong shape on either side used to summarise to zero errors.
  assert.equal(gradeValidationParity("{}", mcpClean).status, "could_not_answer");
  assert.equal(gradeValidationParity("[]", "[]").status, "could_not_answer");
});

test("gradeImport: a prefix is tolerated only at an identifier boundary", () => {
  // The name check used endsWith over normalised strings, so a model that
  // held only SuperUser satisfied an expected User.
  const users = { generator: "code", classes: [{ name: "User" }, { name: "CustomerOrder" }] };
  const grade = (names) =>
    gradeImport(ok, users, "import", { objectTypes: names.length, names }).status;
  assert.equal(grade(["SuperUser", "CustomerOrder"]), "fail");
  assert.equal(grade(["User", "PriorCustomerOrder"]), "fail");
  // The prefixes the loose match existed for still pass.
  assert.equal(grade(["dbo.User", "sales.customer_order"]), "pass");
  assert.equal(grade(["stg_user", "CustomerOrder"]), "pass");
});

test("gradeHistoryStep: a fact-type rename is matched on the candidate's own pair", () => {
  const expect = {
    renamedFactType: {
      from: "Faculty teaches CourseSection",
      to: "Faculty instructs CourseSection",
    },
  };
  const candidate = (elementType, removedName, addedName) => ({
    elementType,
    removedName,
    addedName,
  });
  const graded = (c) => gradeHistoryStep(expect, { deltas: [], synonymCandidates: [c] }).status;
  assert.equal(
    graded(
      candidate("fact_type", "Faculty teaches CourseSection", "Faculty instructs CourseSection"),
    ),
    "pass",
  );
  // Near-misses a substring matcher over the serialised candidate accepted.
  assert.notEqual(
    graded(
      candidate(
        "fact_type",
        "Faculty teaches CourseSection in Term",
        "Faculty instructs CourseSection in Term",
      ),
    ),
    "pass",
  );
  assert.notEqual(
    graded(
      candidate("object_type", "Faculty teaches CourseSection", "Faculty instructs CourseSection"),
    ),
    "pass",
  );
});

test("gradeReadBackNotEmpty: an empty model read back from a non-empty export is S1", () => {
  const pass = { status: "pass", detail: "exit 0" };
  const empty = gradeReadBackNotEmpty(pass, { objectTypes: 0 }, { objectTypes: 40 }, "sql");
  assert.equal(empty.severity, "S1");
  assert.match(empty.detail, /empty model/);
  assert.equal(gradeReadBackNotEmpty(pass, { objectTypes: 12 }, { objectTypes: 40 }, "sql"), pass);
  // An unreadable file is not an empty one.
  assert.equal(
    gradeReadBackNotEmpty(
      pass,
      { objectTypes: 0, unreadable: "bad yaml" },
      { objectTypes: 40 },
      "sql",
    ).status,
    "could_not_answer",
  );
  // A failure upstream passes through untouched.
  const failed = { status: "fail", severity: "S3", detail: "exit 1" };
  assert.equal(
    gradeReadBackNotEmpty(failed, { objectTypes: 0 }, { objectTypes: 40 }, "sql"),
    failed,
  );
});

test("gradeWroteOutput: names the tool, so an exporter that wrote nothing is graded too", () => {
  const pass = { status: "pass", detail: "exit 0" };
  const r = gradeWroteOutput(pass, false, "ddl", { tool: "ddl exporter", output: "artifact" });
  assert.equal(r.severity, "S1");
  assert.equal(r.detail, "the ddl exporter exited 0 but wrote no artifact");
  assert.equal(gradeWroteOutput(pass, true, "ddl", { tool: "ddl exporter" }), pass);
});

test("gradeImpact: an empty affected list for an exported element is a wrong answer", () => {
  // The shape barwise lineage impact --format json emits.
  const ok = { exit: 0, stdout: "", stderr: "", timedOut: false };
  const none = gradeImpact(
    ok,
    { changedElement: "ot-grade-code", affectedArtifacts: [] },
    "ot-grade-code",
  );
  assert.equal(none.severity, "S1");
  assert.equal(
    gradeImpact(ok, {
      changedElement: "ot-grade-code",
      affectedArtifacts: [{ artifact: "/w/schema.sql", format: "ddl", relationship: "table" }],
    }, "ot-grade-code").status,
    "pass",
  );
  assert.equal(gradeImpact(ok, null, "x").status, "could_not_answer");
  assert.equal(gradeImpact(ok, { changedElement: "x" }, "x").status, "could_not_answer");
});
