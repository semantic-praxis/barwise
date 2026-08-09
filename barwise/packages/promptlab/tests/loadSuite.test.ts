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
  it("loads the manifest with weights and four cases in declared order", () => {
    const suite = loadSuite(defaultSuitePath());
    expect(suite.version).toBe("1.0.0");
    expect(suite.weights).toEqual({
      conformanceCorrection: 0.02,
      validationError: 0.1,
      validationWarning: 0.05,
    });
    expect(suite.cases.map((c) => c.evalCase.id)).toEqual([
      "order-management",
      "university-enrollment",
      "clinic-appointments",
      "employee-hierarchy",
    ]);
    for (const c of suite.cases) {
      expect(c.transcript.length).toBeGreaterThan(100);
      expect(c.reference).toBeDefined();
      expect(c.evalCase.checks.length).toBeGreaterThanOrEqual(5);
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
});
