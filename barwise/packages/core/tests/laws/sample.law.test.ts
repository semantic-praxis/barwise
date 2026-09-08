/**
 * A sample population never creates an obligation.
 *
 * `core-model-laws.spec.md` WS4. A sample is explicitly not evidence
 * about the world -- `buildObjectUniverse` skips populations marked
 * `sample` -- so adding one can only tell a rule that an obligation is
 * already met. It must never make a rule that judges by ABSENT data
 * fire.
 *
 * The set of rules that judge that way is not restated here. It is
 * `ABSENT_DATA_RULES` in production -- a typed subset of the list the
 * dispatcher passes a universe to -- so this law and the validator
 * cannot disagree about which rules it covers
 * (docs/specs/object-universe-as-a-parameter.spec.md).
 *
 * The subset matters, and it was found by this law rather than
 * assumed: run over all five universe-reading rules, it went red twice,
 * first on `checkJoinPathViolations` (two operands projecting the same
 * tuple) and then on `checkSpanningExclusiveOrViolations` ("plays two
 * of them"). Both are present-data violations that a sample can
 * legitimately create. Their exclusions are argued in
 * `populationValidation.ts`, not here.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { buildObjectUniverse } from "../../src/validation/rules/population/shared.js";
import { ABSENT_DATA_RULES } from "../../src/validation/rules/populationValidation.js";
import { arbOrmModel, RUNS, SEED } from "../arbitraries/model.js";

/** Every diagnostic the absent-data rules produce for this model. */
function absentDataDiagnostics(model: OrmModel): string[] {
  const universe = buildObjectUniverse(model);
  return ABSENT_DATA_RULES.flatMap((rule) => rule(model, universe)).map((d) =>
    `${d.ruleId}|${d.message}`
  );
}

/**
 * One sample population over a fact type of the model.
 *
 * Values are drawn from a small pool that overlaps the generator's own
 * (`v1`-`v3`), plus one that cannot appear in any generated population,
 * so the sample carries both values the universe already knows and a
 * value it has never seen. A sample of entirely novel values is the
 * case most likely to create a mandatory obligation if samples were
 * counted as evidence, which is the defect this law exists to exclude.
 */
const arbSampleDraw = fc.record({
  factTypePick: fc.nat({ max: 20 }),
  tuples: fc.array(
    fc.array(fc.constantFrom("v1", "v2", "v3", "novel"), { minLength: 1, maxLength: 3 }),
    {
      minLength: 1,
      maxLength: 3,
    },
  ),
});

function addSample(
  model: OrmModel,
  draw: { factTypePick: number; tuples: readonly (readonly string[])[]; },
): boolean {
  const factTypes = model.factTypes;
  if (factTypes.length === 0) return false;
  const ft = factTypes[draw.factTypePick % factTypes.length]!;

  const population = model.addPopulation({ factTypeId: ft.id, sample: true });
  for (const tuple of draw.tuples) {
    const roleValues: Record<string, string> = {};
    for (const [i, role] of ft.roles.entries()) {
      const value = tuple[i % tuple.length];
      if (value !== undefined) roleValues[role.id] = value;
    }
    population.addInstance({ roleValues });
  }
  return true;
}

describe("law: a sample population never creates an obligation", () => {
  it("no absent-data rule gains a diagnostic", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), arbSampleDraw, (model, draw) => {
        const before = absentDataDiagnostics(model);
        if (!addSample(model, draw)) return;
        const after = absentDataDiagnostics(model);

        // Not merely "the count did not rise": a rule could lose one
        // diagnostic and gain another, which is a new obligation hidden
        // by a satisfied one. Every diagnostic after must have been
        // there before.
        const wasThere = new Set(before);
        const gained = after.filter((d) => !wasThere.has(d));
        expect(gained, `a sample population created ${gained.length} diagnostic(s)`).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("coverage: the law is not vacuous", () => {
  const models = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS });
  const draws = fc.sample(arbSampleDraw, { seed: SEED, numRuns: RUNS });

  it("generates models that carry non-sample population data", () => {
    // Without one, the universe is empty, every absent-data rule
    // returns early, and the law compares two empty lists 250 times.
    // Measured at this seed: 90 of 250.
    const count = models.filter((m) => buildObjectUniverse(m).size > 0).length;
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("generates models where an absent-data rule actually fires", () => {
    // The stronger premise: some model must produce a diagnostic for
    // the law to have anything to compare. Measured at this seed: 52.
    const count = models.filter((m) => absentDataDiagnostics(m).length > 0).length;
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it("adds a sample population to every model it examines", () => {
    const added = models.filter((m, i) => addSample(m, draws[i]!)).length;
    expect(added).toBe(models.length);
  });
});
