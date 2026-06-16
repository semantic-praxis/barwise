/**
 * Property-based round-trip tests over seeded random models. These lock
 * the two core invariants regardless of how the code is later refactored:
 * serialization is lossless, and every generated counterexample trips its
 * own rule. A failure reports its seed, so it reproduces deterministically.
 */
import { describe, expect, it } from "vitest";
import { generateCounterexamples } from "../../src/counterexample/CounterexampleGenerator.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { generateModel } from "../helpers/randomModel.js";

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

const RULE_BY_TYPE: Record<string, string> = {
  internal_uniqueness: "population/uniqueness-violation",
  value_constraint: "population/value-constraint-violation",
  frequency: "population/frequency-violation",
  ring: "population/ring-violation",
  mandatory: "population/mandatory-violation",
  disjunctive_mandatory: "population/disjunctive-mandatory-violation",
  exclusion: "population/exclusion-violation",
  exclusive_or: "population/exclusive-or-violation",
  subset: "population/subset-violation",
  equality: "population/equality-violation",
  external_uniqueness: "population/external-uniqueness-violation",
};

describe("property: serialization round-trip is lossless", () => {
  const serializer = new OrmYamlSerializer();
  for (const seed of SEEDS) {
    it(`seed ${seed}: serialize -> deserialize -> serialize is stable`, () => {
      const model = generateModel(seed);
      const once = serializer.serialize(model);
      const twice = serializer.serialize(serializer.deserialize(once));
      expect(twice, `serialization not idempotent for seed ${seed}`).toBe(once);
    });
  }
});

describe("property: every generated counterexample trips its own rule", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: counterexamples round-trip`, () => {
      const model = generateModel(seed);
      for (const ce of generateCounterexamples(model)) {
        const expected = RULE_BY_TYPE[ce.constraintType];
        expect(expected, `unmapped constraint type ${ce.constraintType}`).toBeTruthy();

        const added: string[] = [];
        for (const forbidden of ce.forbidden) {
          const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
          for (const inst of forbidden.instances) {
            pop.addInstance({ roleValues: { ...inst.roleValues } });
          }
          added.push(pop.id);
        }
        const ruleIds = populationValidationRules(model).map((d) => d.ruleId);
        for (const id of added) model.removePopulation(id);

        expect(
          ruleIds,
          `seed ${seed}: ${ce.constraintType} counterexample did not trip ${expected}`,
        ).toContain(expected);
      }
    });
  }
});
