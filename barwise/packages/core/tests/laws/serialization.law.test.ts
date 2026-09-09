/**
 * Laws over a generated model: the generator is honest, and
 * serialization loses nothing.
 *
 * A law is a statement that must hold for every model, checked against
 * hundreds the generator produces rather than the one a test author
 * built. Where a fixture test asserts what its author remembered to put
 * in, these fail on the first generated model that exercises an
 * omission -- which is the defect shape this zone keeps producing
 * (barwise-927, -931, -934, -937). Spec:
 * docs/specs/core-model-laws.spec.md, WS1.
 *
 * A failure prints the seed and the shrunk model, so one recorded value
 * reproduces it.
 */

/**
 * 250 runs is not a fixture test, and this file's properties hash a
 * generated model twice per run. Standalone they finish in seconds;
 * under `turbo run test:coverage`, where twelve packages instrument and
 * run at once, the slowest was measured at 46s. The 30s vitest default
 * is sized for a fixture.
 *
 * These were 120s because `hashModel` compiled a JSON Schema it never
 * used on every call, at 34ms a hash (barwise-939, now fixed: the
 * serializer's validator is lazy). That took the same law from 126s to
 * 46s. The timeout stays because the remaining cost is the property
 * itself, and removing it on the strength of that fix was tried and
 * failed under the parallel run -- which is the note this comment exists
 * to leave.
 */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashModel } from "../../src/lineage/manifest.js";
import { CONSTRAINT_TYPES } from "../../src/model/Constraint.js";
import { toFactTypeConfig } from "../../src/model/FactType.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { structuralRules } from "../../src/validation/rules/structural.js";
import { graphFor } from "../helpers/graphFor.js";
import { arbOrmModel, RUNS, SEED } from "../arbitraries/model.js";
import {
  normaliseFactTypeConfig,
  normaliseObjectTypeConfig,
  stripFactTypeIds,
  stripObjectTypeIds,
} from "../arbitraries/normalise.js";

const serializer = new OrmYamlSerializer();

describe("law: every generated model is structurally valid", () => {
  it("carries no structural/* diagnostic", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        expect(structuralRules(model, graphFor(model))).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("law: serialization is idempotent", () => {
  it("serialize -> deserialize -> serialize yields the same text and the same hash", {
    timeout: LAW_TIMEOUT_MS,
  }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        const once = serializer.serialize(model);
        const restored = serializer.deserialize(once);
        expect(serializer.serialize(restored)).toBe(once);
        expect(hashModel(restored)).toBe(hashModel(model));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("law: serialization is lossless", () => {
  /**
   * The hash cannot see this clause. `hashModel` hashes what the
   * serializer writes, so a config field the serializer forgets is
   * invisible to it and visible here: the projections are typed
   * `Complete<Config>`, so the compiler makes them enumerate every
   * field, and this fails the day a field is added to a config and not
   * to its serializer.
   */
  it("every object type and fact type projects back to the same config", {
    timeout: LAW_TIMEOUT_MS,
  }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        const restored = serializer.deserialize(serializer.serialize(model));

        expect(objectTypeProjections(restored)).toEqual(objectTypeProjections(model));
        expect(factTypeProjections(restored)).toEqual(factTypeProjections(model));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  /**
   * The fourth serializer conflation (`sample: false` reads back as
   * absent) lives on `Population`, which neither projection reaches, so
   * it is asserted directly: a sample stays a sample and a significant
   * population stays significant. Getting this wrong would silently
   * re-close the open world the sample-population semantics opened.
   */
  it(
    "every population keeps its sample flag and its instances",
    { timeout: LAW_TIMEOUT_MS },
    () => {
      fc.assert(
        fc.property(arbOrmModel(), (model) => {
          const restored = serializer.deserialize(serializer.serialize(model));

          expect(populationShapes(restored)).toEqual(populationShapes(model));
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );
});

describe("coverage: the generator reaches the shapes the recorded defects lived in", () => {
  /**
   * A generator that is too tame passes every law and proves nothing.
   * These are the shapes the four recorded defects needed: the mapper's
   * composite-key defect (barwise-931) required an objectified
   * supertype, and no fixture had thought to include one. Counted as
   * assertions rather than left to a comment, so a generator change that
   * stops reaching them fails here.
   */
  const models = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS });

  it("produces a model with an objectified supertype", () => {
    const count =
      models.filter((model) =>
        model.objectifiedFactTypes.some((oft) =>
          model.subtypeFacts.some((sf) => sf.supertypeId === oft.objectTypeId)
        )
      ).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a model with an independent object type", () => {
    const count = models.filter((model) => model.objectTypes.some((ot) => ot.independent)).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a model with a ternary fact type", () => {
    const count = models.filter((model) => model.factTypes.some((ft) => ft.arity === 3)).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a model with a sample population", () => {
    const count = models.filter((model) => model.populations.some((pop) => pop.sample)).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces every constraint kind the metamodel admits", () => {
    const seen = new Set<string>();
    for (const model of models) {
      for (const ft of model.factTypes) {
        for (const constraint of ft.constraints) seen.add(constraint.type);
      }
    }
    // Compared against the union's own runtime list rather than a
    // literal, so a constraint kind added to the metamodel fails here
    // until the generator can build one.
    expect([...seen].sort()).toEqual([...CONSTRAINT_TYPES].sort());
  });
});

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function objectTypeProjections(model: OrmModel): unknown[] {
  // The record is the projection. `toObjectTypeConfig` existed to list
  // every field once so a hand-copied literal could not drop one
  // (barwise-927); a spread of the sealed record cannot drop one either,
  // and needs no edit when a field is added.
  return model.objectTypes.map((ot) => stripObjectTypeIds(normaliseObjectTypeConfig(ot)));
}

function factTypeProjections(model: OrmModel): unknown[] {
  return model.factTypes.map((ft) =>
    stripFactTypeIds(normaliseFactTypeConfig(toFactTypeConfig(ft)))
  );
}

function populationShapes(model: OrmModel): unknown[] {
  return model.populations.map((pop) => ({
    factTypeId: pop.factTypeId,
    description: pop.description,
    sample: pop.sample,
    instances: pop.instances.map((inst) => inst.roleValues),
  }));
}
