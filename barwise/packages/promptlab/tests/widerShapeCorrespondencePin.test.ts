/**
 * Integration pin for the wider-shape correspondence tiers
 * (docs/specs/wider-shape-correspondence.spec.md, barwise-890): the
 * exact recorded payloads that exposed the gap in the 2026-08-28
 * baseline, scored through the real suite. At 2.5.0 the sonnet clinic
 * payload failed five forbids_population checks -- two direct
 * projections and three anchor propagations off the same 5-ary shape
 * decision. With the projection tier they all pass, and the remaining
 * gap to 1.000 is the payload's own recorded conformance defects.
 *
 * The payloads live in the committed round record at the repo root
 * (`eval-payloads/20260828-0936/`), not in fixtures/ -- they are the
 * baseline's evidence, and the pin scoring the evidence itself is what
 * makes the rescue claim checkable.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite, scoreExtraction } from "../src/index.js";

const payloadsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "eval-payloads/20260828-0936",
);
const suite = loadSuite(defaultSuitePath());

function caseFor(caseId: string) {
  const loaded = suite.cases.find((c) => c.evalCase.id === caseId);
  if (!loaded) throw new Error(`missing case ${caseId}`);
  return loaded;
}

describe("wider-shape correspondence on the recorded baseline payloads", () => {
  it("sonnet's clinic 5-ary passes every forbids_population check", () => {
    const payload = readFileSync(
      join(payloadsDir, "sonnet5-train/clinic-appointments-run1.json"),
      "utf8",
    );
    const result = scoreExtraction(payload, caseFor("clinic-appointments"), suite.weights);

    // The five rescued checks and the one that always passed: none of
    // the rubric's misses were ever about the rules, only the shape.
    for (const check of result.results.filter((r) => r.kind === "forbids_population")) {
      expect(check).toMatchObject({ passed: true });
    }
    expect(result.rubricPassed).toBe(result.rubricTotal);

    // What remains below 1.000 is the recorded extraction's own
    // conformance defects (four arity_mismatch corrections), which no
    // correspondence tier should touch: 1 - 0.2 * (4/24) = 29/30.
    expect(result.correctionsByCategory).toEqual({ arity_mismatch: 4 });
    expect(result.elementCount).toBe(24);
    expect(result.score).toBeCloseTo(29 / 30, 10);
  });

  it("haiku's Contact-as-entity vendor shape passes the Meridian check", () => {
    // The recorded payload carries the exact uniqueness over (Vendor,
    // Region), sourced to the transcript's settling lines, on a ternary
    // that folds the reference's three contact value roles into a
    // Contact entity evidenced by its own attribute binaries. At 2.5.0
    // it scored as "does not carry the relationship"; the entity-fold
    // tier plus the ContactPhone/ContactPhoneNumber licence (both words
    // are the transcript's "phone number") map it.
    const payload = readFileSync(
      join(payloadsDir, "haiku45-dev/vendor-onboarding-run1.json"),
      "utf8",
    );
    const result = scoreExtraction(payload, caseFor("vendor-onboarding"), suite.weights);

    expect(result.rubricPassed).toBe(result.rubricTotal);
    // The remaining gap to 1.000 is the payload's own ambiguity excess
    // (12 reported against the case's budget of 10), untouched by any
    // correspondence tier.
    expect(result.ambiguitiesReported).toBe(12);
    expect(result.ambiguityExcess).toBe(2);
    expect(result.score).toBeCloseTo(0.96, 10);
  });
});
