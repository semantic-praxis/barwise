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
import {
  counterexampleRoundTripFailure,
  expectedRuleFor,
  type LocalStray,
  localStrays,
  rulesFromKind,
} from "../helpers/counterexampleRules.js";

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

/**
 * The rules a counterexample still trips besides its own, by data it
 * minted itself, inside the fact types it populated -- with the reason
 * each is still open.
 *
 * A RATCHET, not an allowance. The law below fails on a rule id that is
 * not here AND on one that is here and no longer strays, so this list
 * always enumerates exactly what is open, the way
 * `audit-baseline.json` and `rubric-baseline.json` do for their
 * findings.
 *
 * Keyed to rule ids and a count rather than to the 56
 * (constraint kind -> rule) pairs the sweep measures. Pairs assert more
 * and are a worse artifact: any change to `arbOrmModel` reshuffles all
 * 56 rows, and a contributor facing 56 diff lines regenerates the
 * baseline instead of reading it. Rule ids survive a reshuffle, and the
 * count still only comes down deliberately.
 *
 * Spec: `docs/specs/counterexample-stray-rules.spec.md`.
 */
const LOCAL_STRAY_BASELINE = {
  occurrences: 123,
  reasons: {
    // barwise-1017: the MODEL is contradictory at that role. A value
    // type declaring `integer` and enumerating {v3, v1, v2} admits
    // nothing, so no minted value avoids these two. Nothing reports the
    // contradiction itself, which is the missing validation rule.
    "population/value-type-data-type-violation": "contradictory value type",
    "population/value-type-domain-violation": "contradictory value type",
    // barwise-1014: `arbOrmModel` builds join exclusions whose two
    // operands are the same path with the same projection, which any
    // populated tuple violates.
    "population/join-exclusion-violation": "degenerate generated constraint",
    // barwise-1015: the minter knows what each ROLE admits, not what the
    // fact type's other constraints require of the tuple as a whole --
    // distinct values under irreflexivity, ordered ones under a value
    // comparison, a bounded count under a cardinality.
    "population/ring-violation": "sibling-role constraint",
    "population/frequency-violation": "sibling-role constraint",
    "population/value-comparison-violation": "sibling-role constraint",
    "population/unary-role-cardinality-violation": "sibling-role constraint",
    "population/exclusion-violation": "sibling-role constraint",
    "population/exclusive-or-violation": "sibling-role constraint",
    "population/mandatory-violation": "sibling-role constraint",
    "population/disjunctive-mandatory-violation": "sibling-role constraint",
  } as Record<string, string>,
};

/**
 * The (constraint kind -> stray rule) breakdown, most frequent first.
 *
 * Attached to the failure messages below rather than kept as a separate
 * sweep script. barwise-995's number was produced by a sweep that was
 * never committed, so the next reader could neither reproduce it nor
 * see what made it up (barwise-999). A count that moves and a reader
 * who then has to rebuild the instrument is the same problem as a count
 * that goes stale.
 */
function strayTable(strays: readonly LocalStray[]): string {
  const counts = new Map<string, number>();
  for (const s of strays) {
    const key = `${s.constraintType} -> ${s.ruleId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `  ${String(n).padStart(4)}  ${key}`)
    .join("\n");
}

describe("ratchet: a counterexample's own filler values break less than they did", () => {
  const models = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS });
  const strays = models.flatMap((model) => localStrays(model));

  it("trips no rule the baseline does not name", () => {
    const seen = [...new Set(strays.map((s) => s.ruleId))].sort();
    const named = Object.keys(LOCAL_STRAY_BASELINE.reasons).sort();
    // Both directions in one assertion: a new stray rule and a baseline
    // row that has been fixed are the same kind of staleness.
    expect(seen, `local strays by (kind -> rule):\n${strayTable(strays)}`).toEqual(named);
  });

  it("trips exactly as many as the baseline records", () => {
    // Exact, not a ceiling. A ceiling lets an improvement go unrecorded,
    // and the next reader cannot tell whether 40 under a cap of 123 is
    // progress or a measurement that stopped working.
    expect(strays.length, `local strays by (kind -> rule):\n${strayTable(strays)}`)
      .toBe(LOCAL_STRAY_BASELINE.occurrences);
  });
});

describe("the two constraint-kind tables agree where both speak", () => {
  it("every expected rule is one the kind can produce", () => {
    // `RULE_BY_TYPE` says which rule a counterexample of a kind must
    // trip; `RULES_FROM_KIND` says which rules the kind can report at
    // all. A hand-maintained pair either drifts or is checked.
    for (const type of CONSTRAINT_TYPES) {
      const expected = expectedRuleFor(type);
      if (expected === null) continue;
      expect(rulesFromKind(type)).toContain(expected);
    }
  });
});
