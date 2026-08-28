/**
 * Errors are named, not just counted
 * (docs/specs/pipeline-observability.spec.md, barwise-837).
 *
 * `warningsByRule` shipped on the argument that "the count alone says a
 * run lost 0.30 without saying to what". The identical argument applies
 * to errors, which cost 0.1 against a warning's 0.05 -- so the record
 * named the cheaper signal and counted the dearer one.
 *
 * That asymmetry had a concrete cost. After the ring-player fix
 * (barwise-831) and the population fix (barwise-835), whether either
 * moved the recorded train and dev baselines could not be read off the
 * record: history rows carry `penalties.errors` as a bare number. The
 * only remaining way to find out was to pay for a re-run, which is the
 * wrong lever for a question the record should answer.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSuite } from "../src/evalcase/loadSuite.js";
import { toHistoryEntry } from "../src/history/history.js";
import type { SuiteReport } from "../src/run/runSuite.js";
import { scoreExtraction } from "../src/score/scoreExtraction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const evalsDir = resolve(__dirname, "../evals");
const suite = loadSuite(resolve(evalsDir, "suite.yaml"));

function caseNamed(id: string) {
  const found = suite.cases.find((c) => c.evalCase.id === id);
  if (!found) throw new Error(`no case ${id}`);
  return found;
}

function payloadFor(id: string): string {
  return readFileSync(resolve(__dirname, `fixtures/responses/${id}.json`), "utf-8");
}

describe("CaseScore.errorsByRule", () => {
  it("is empty rather than absent when a payload validates clean", () => {
    // The answer keys are the evidence that warning and error cost is
    // addressable rather than a floor: every one scores full rubric
    // and none carries a validation error. A reader must not have to
    // tell "none" from "not measured".
    const score = scoreExtraction(
      payloadFor("order-management"),
      caseNamed("order-management"),
      suite.weights,
    );

    expect(score.errorsByRule).toEqual({});
    expect(score.validationErrors).toBe(0);
  });

  it("names the rule and agrees with the count", () => {
    // A ring constraint over two different object types reaches the
    // model only if conformance misses it, so this asserts the pairing
    // rather than a specific defect: whatever errors, the tally sums to
    // the count. A tally that disagreed with its own total is the
    // failure mode a count-only field cannot expose.
    for (const c of suite.cases) {
      let payload: string;
      try {
        payload = payloadFor(c.evalCase.id);
      } catch {
        continue; // dev cases ship no recorded payload
      }
      const score = scoreExtraction(payload, c, suite.weights);
      const summed = Object.values(score.errorsByRule).reduce((a, b) => a + b, 0);
      expect(summed).toBe(score.validationErrors);

      const warned = Object.values(score.warningsByRule).reduce((a, b) => a + b, 0);
      expect(warned).toBe(score.validationWarnings);
    }
  });
});

describe("HistoryEntry.errorsByRule", () => {
  const base: SuiteReport = {
    suiteVersion: "1.3.0",
    artifactVersion: "test",
    repeat: 1,
    mean: 0.9,
    worst: 0.9,
    failures: 0,
    truncations: 0,
    complete: true,
    cases: [],
    warningsByRule: {},
    errorsByRule: {},
    dispersion: { lowerBound: false },
  } as unknown as SuiteReport;

  it("is recorded when rules errored", () => {
    const entry = toHistoryEntry(
      { ...base, errorsByRule: { "constraint/ring-different-players": 2 } },
      "2026-08-22",
    );

    expect(entry.errorsByRule).toEqual({ "constraint/ring-different-players": 2 });
  });

  it("is omitted when nothing errored, like the warning tally", () => {
    // Both, or neither: adding the field to the scorer without the
    // history row would repeat the original defect one level up, which
    // is exactly how the warning tally came to exist in one place and
    // not the other.
    const entry = toHistoryEntry(base, "2026-08-22");

    expect("errorsByRule" in entry).toBe(false);
    expect("warningsByRule" in entry).toBe(false);
  });
});
