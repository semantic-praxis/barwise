/**
 * Law: every counterexample the generator emits trips its own rule.
 *
 * `CounterexampleGenerator.test.ts` states this by example, over one
 * hand-built constraint-rich model. That model is a readable record of
 * the cases its author thought of; this asserts the same thing over
 * every model the arbitrary reaches, which is the difference that
 * matters for an omission-shaped defect. Spec:
 * docs/specs/core-model-laws.spec.md, WS3.
 *
 * A failure prints the seed and the shrunk model, so one recorded value
 * reproduces it.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateCounterexamples } from "../../src/counterexample/CounterexampleGenerator.js";
import { CONSTRAINT_TYPES } from "../../src/model/Constraint.js";
import { arbOrmModel, RUNS, SEED } from "../arbitraries/model.js";
import { counterexampleRoundTripFailure, expectedRuleFor } from "../helpers/counterexampleRules.js";

describe("law: a counterexample is the inverse of population validation", () => {
  it("every generated counterexample trips its own rule", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        expect(counterexampleRoundTripFailure(model)).toBeUndefined();
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("coverage: the law reaches every constraint kind that has a generator", () => {
  /**
   * The law above is vacuous for a kind the generator never emits over
   * these models, and the reader cannot tell which kinds those are. This
   * names them: every kind mapped to a rule must be exercised by at
   * least one sampled model, and the expected set is derived from the
   * metamodel's own list rather than restated, so a new constraint kind
   * with a generator fails here until the arbitrary can build one.
   */
  const models = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS });

  it("emits a counterexample for each mapped kind", () => {
    const seen = new Set<string>();
    for (const model of models) {
      for (const ce of generateCounterexamples(model)) seen.add(ce.constraintType);
    }
    const mapped = CONSTRAINT_TYPES.filter((type) => expectedRuleFor(type) !== null);
    expect([...seen].sort()).toEqual([...mapped].sort());
  });
});
