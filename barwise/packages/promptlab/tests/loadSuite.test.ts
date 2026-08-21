/**
 * Tests for the suite loader: the packaged seed suite round-trips, and
 * authoring errors (missing checks, forbids_population without a
 * reference, duplicate ids) fail with the file path in the message.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadEvalCase, loadSuite } from "../src/index.js";

const MINIMAL_TRANSCRIPT = "Facilitator: hello.\n";

function tmpSuiteDir(): string {
  return mkdtempSync(join(tmpdir(), "barwise-evals-"));
}

describe("loadSuite on the packaged seed suite", () => {
  // The only test that loads the whole packaged suite in its body: ten
  // transcripts read from disk and seven reference models deserialized
  // through OrmYamlSerializer. That runs in well under a second locally
  // and an order of magnitude slower under coverage instrumentation on a
  // shared CI runner, so the package sets a 30s testTimeout.
  it("loads the manifest with weights and ten cases in declared order", () => {
    const suite = loadSuite(defaultSuitePath());
    expect(suite.version).toBe("1.2.0");
    expect(suite.weights).toEqual({
      conformanceCorrection: 0.02,
      validationError: 0.1,
      validationWarning: 0.05,
      // Undeclared in the seed manifest, so the loader defaults it to 0
      // and no seed case pays an ambiguity penalty.
      ambiguityExcess: 0,
    });
    expect(suite.cases.map((c) => c.evalCase.id)).toEqual([
      "order-management",
      "university-enrollment",
      "clinic-appointments",
      "employee-hierarchy",
      "project-staffing",
      "conference-reviews",
      "freight-corrections",
      "vendor-onboarding",
      "subscription-billing",
      "incident-response",
    ]);
    expect(suite.collapseFloor).toBe(0.3);
    for (const c of suite.cases) {
      expect(c.transcript.length).toBeGreaterThan(100);
      expect(c.evalCase.checks.length).toBeGreaterThanOrEqual(5);
      expect(c.split).toBeDefined();
    }
  });

  it("splits seven train cases from three held-out dev cases", () => {
    const suite = loadSuite(defaultSuitePath());
    const dev = suite.cases.filter((c) => c.split === "dev").map((c) => c.evalCase.id);
    const train = suite.cases.filter((c) => c.split === "train");
    expect(dev).toEqual(["vendor-onboarding", "subscription-billing", "incident-response"]);
    expect(train).toHaveLength(7);
  });

  it("gives every train case a reference model, and no dev case one", () => {
    // References are generated from a recorded payload, and the dev
    // cases have never run against a provider -- so they ship with
    // reference-free rubrics and gain population checks later. Pinned
    // so that stays a deliberate state rather than a forgotten one.
    const suite = loadSuite(defaultSuitePath());
    for (const c of suite.cases) {
      if (c.split === "train") expect(c.reference, c.evalCase.id).toBeDefined();
      else expect(c.reference, c.evalCase.id).toBeUndefined();
    }
  });
});

describe("loadSuite validation", () => {
  it("rejects a manifest without cases", () => {
    const dir = tmpSuiteDir();
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0.02, validationError: 0.1}\ncases: []\n",
    );
    expect(() => loadSuite(manifest)).toThrow(/cases/);
  });

  it("rejects duplicate case ids", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    writeFileSync(
      join(dir, "a.eval.yaml"),
      "id: same\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0, validationError: 0}\n"
        + "cases: [a.eval.yaml, a.eval.yaml]\n",
    );
    expect(() => loadSuite(manifest)).toThrow(/duplicate case id "same"/);
  });

  it("rejects missing or malformed weights", () => {
    const dir = tmpSuiteDir();
    const manifest = join(dir, "suite.yaml");
    writeFileSync(manifest, "version: 1.0.0\ncases: [a.eval.yaml]\n");
    expect(() => loadSuite(manifest)).toThrow(/weights/);
  });

  it("rejects a negative ambiguityExcess weight", () => {
    const dir = tmpSuiteDir();
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0, validationError: 0,"
        + " ambiguityExcess: -1}\ncases: [a.eval.yaml]\n",
    );
    expect(() => loadSuite(manifest)).toThrow(/ambiguityExcess/);
  });

  it("reads a declared ambiguityExcess weight", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    writeFileSync(
      join(dir, "a.eval.yaml"),
      "id: a\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0, validationError: 0,"
        + " ambiguityExcess: 0.03}\ncases: [a.eval.yaml]\n",
    );
    expect(loadSuite(manifest).weights.ambiguityExcess).toBe(0.03);
  });
});

describe("loadEvalCase validation", () => {
  it("rejects a forbids_population check without a reference model", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(
      file,
      "id: c\ntranscript: t.md\nchecks:\n"
        + "  - kind: forbids_population\n    factType: X has Y\n    constraint: mandatory\n",
    );
    expect(() => loadEvalCase(file)).toThrow(/requires a "reference" model/);
  });

  it("rejects an unknown check kind with the index in the message", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(
      file,
      "id: c\ntranscript: t.md\nchecks:\n  - kind: diff_reference\n",
    );
    expect(() => loadEvalCase(file)).toThrow(/checks\[0\]\.kind/);
  });

  it("rejects an empty checks list", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(file, "id: c\ntranscript: t.md\nchecks: []\n");
    expect(() => loadEvalCase(file)).toThrow(/non-empty/);
  });

  it("accepts a requires_ambiguity check with an ambiguityBudget", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(
      file,
      "id: c\ntranscript: t.md\nambiguityBudget: 4\nchecks:\n"
        + "  - kind: requires_ambiguity\n    matches: [tier]\n",
    );
    const loaded = loadEvalCase(file);
    expect(loaded.evalCase.ambiguityBudget).toBe(4);
    expect(loaded.evalCase.checks[0]).toEqual({
      kind: "requires_ambiguity",
      matches: ["tier"],
    });
  });

  it("leaves ambiguityBudget absent when undeclared, meaning unbounded", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(file, "id: c\ntranscript: t.md\nchecks:\n  - kind: must_validate\n");
    expect(loadEvalCase(file).evalCase.ambiguityBudget).toBeUndefined();
  });

  it("rejects a requires_ambiguity check with no matches", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(
      file,
      "id: c\ntranscript: t.md\nchecks:\n  - kind: requires_ambiguity\n    matches: []\n",
    );
    expect(() => loadEvalCase(file)).toThrow(/checks\[0\].*matches/s);
  });

  it("rejects a non-integer ambiguityBudget", () => {
    const dir = tmpSuiteDir();
    writeFileSync(join(dir, "t.md"), MINIMAL_TRANSCRIPT);
    const file = join(dir, "case.eval.yaml");
    writeFileSync(
      file,
      "id: c\ntranscript: t.md\nambiguityBudget: 1.5\nchecks:\n  - kind: must_validate\n",
    );
    expect(() => loadEvalCase(file)).toThrow(/ambiguityBudget/);
  });
});
