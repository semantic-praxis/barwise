/**
 * The merge identity law: merging nothing changes nothing.
 *
 * Diffing a model against itself reports only `unchanged`, and merging
 * it with itself while accepting nothing must therefore return the same
 * model. It is the one merge where any change at all is loss, which is
 * what makes it a law rather than a scenario -- and it is the property
 * that earned this arbitrary, because today's `mergeModels` fails it on
 * any model carrying a subtype fact, an objectified fact type, a
 * population, a diagram layout or a model-level note (barwise-937).
 *
 * Spec: docs/specs/core-model-laws.spec.md, WS2.
 *
 * These carried an explicit 120s timeout until `hashModel` stopped
 * compiling a JSON Schema it never used on every call (barwise-939); see
 * the module comment in `serialization.law.test.ts`.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelDelta } from "../../src/diff/deltas.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import { hashModel } from "../../src/lineage/manifest.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { arbOrmModel, RUNS, SEED } from "../arbitraries/model.js";

describe("law: merging nothing changes nothing", () => {
  it(
    "diffing a model against itself reports only unchanged deltas",
    { timeout: LAW_TIMEOUT_MS },
    () => {
      fc.assert(
        fc.property(arbOrmModel(), (model) => {
          const { deltas } = diffModels(model, model);
          expect(deltas.filter((d) => d.kind !== "unchanged")).toEqual([]);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );

  it("merging a model with itself, accepting nothing, preserves its hash", {
    timeout: LAW_TIMEOUT_MS,
  }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        const { deltas } = diffModels(model, model);
        const merged = mergeModels(model, model, deltas, new Set());
        expect(hashModel(merged)).toBe(hashModel(model));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  /**
   * The hash is content-addressed over the serialized document, so a
   * dropped element kind shows up as a hash mismatch and not as
   * anything a reader can name. These count the kinds directly, so a
   * regression says which kind went missing rather than that two hex
   * strings differ.
   */
  it("every element kind survives the identity merge", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        const { deltas } = diffModels(model, model);
        const merged = mergeModels(model, model, deltas, new Set());

        expect(merged.objectTypes.length).toBe(model.objectTypes.length);
        expect(merged.factTypes.length).toBe(model.factTypes.length);
        expect(merged.subtypeFacts.length).toBe(model.subtypeFacts.length);
        expect(merged.objectifiedFactTypes.length).toBe(model.objectifiedFactTypes.length);
        expect(merged.populations.length).toBe(model.populations.length);
        expect(merged.definitions.length).toBe(model.definitions.length);
        expect(merged.diagramLayouts.length).toBe(model.diagramLayouts.length);
        expect(merged.note).toBe(model.note);
        expect(merged.domainContext).toBe(model.domainContext);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The spec drafted a second law provisionally: accept every delta and
 * the merged model should be the incoming one, so re-diffing reports
 * only `unchanged`. Measured against the fixed generator, that form is
 * false in 50 of 60 model pairs, and always for the same reason -- the
 * merge unions aliases on an accepted modification rather than taking
 * the incoming set, which is deliberate (`unionAliases`, and the
 * fixture test that pins it). The element sets matched in all 60.
 *
 * So the law ships in the shape the spec's own fallback names, plus the
 * exception stated exactly rather than waved at: accepting everything
 * yields the incoming model, except that aliases are unioned. A second
 * divergence appearing later fails the second clause, which is the
 * point of naming this one.
 */
describe("law: accepting every delta yields the incoming model, aliases aside", () => {
  it("reproduces the incoming element set", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), arbOrmModel(), (existing, incoming) => {
        const merged = mergeAll(existing, incoming);

        expect(names(merged.objectTypes)).toEqual(names(incoming.objectTypes));
        expect(names(merged.factTypes)).toEqual(names(incoming.factTypes));
        expect(merged.definitions.map((d) => d.term).sort()).toEqual(
          incoming.definitions.map((d) => d.term).sort(),
        );

        // The four kinds the diff learned in WS2 and WS3. Until it did,
        // `mergeModels` carried them from the EXISTING model whatever a
        // reviewer accepted, so this law passed while asserting only the
        // three kinds that worked -- which is why it is stated over all
        // six now. Diagram layouts are the seventh and are deliberately
        // NOT here: they stay carried, so accepting every delta cannot
        // reproduce the incoming model's layouts and must not try to
        // (`docs/specs/typed-diff-all-element-kinds.spec.md`).
        expect(subtypePairs(merged)).toEqual(subtypePairs(incoming));
        expect(objectificationPairs(merged)).toEqual(objectificationPairs(incoming));
        expect(populationKeys(merged)).toEqual(populationKeys(incoming));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("differs from the incoming model only in unioned aliases", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), arbOrmModel(), (existing, incoming) => {
        const merged = mergeAll(existing, incoming);
        const residual = diffModels(merged, incoming).deltas.filter((d) => d.kind !== "unchanged");

        for (const delta of residual) {
          expect(describeDelta(delta)).toBe('modified object_type ["aliases changed"]');
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The subtype relationships a model asserts, as resolved name pairs.
 *
 * Ids churn between two independently generated models, so the pair of
 * names is the only comparable identity -- the same reason `diffModels`
 * matches these by name.
 */
function subtypePairs(model: OrmModel): string[] {
  return model.subtypeFacts
    .map((sf) =>
      `${model.getObjectType(sf.subtypeId)?.name ?? sf.subtypeId}`
      + ` < ${model.getObjectType(sf.supertypeId)?.name ?? sf.supertypeId}`
    )
    .sort();
}

/** The objectifications a model asserts, as resolved name pairs. */
function objectificationPairs(model: OrmModel): string[] {
  return model.objectifiedFactTypes
    .map((oft) =>
      `${model.getObjectType(oft.objectTypeId)?.name ?? oft.objectTypeId}`
      + ` = ${model.getFactType(oft.factTypeId)?.name ?? oft.factTypeId}`
    )
    .sort();
}

/** The populations a model holds, by the identity the diff keys them on. */
function populationKeys(model: OrmModel): string[] {
  return model.populations
    .map((p) =>
      `${model.getFactType(p.factTypeId)?.name ?? p.factTypeId}`
      + `/${p.sample ? "sample" : "significant"}`
    )
    .sort();
}

/** Merge with every non-unchanged delta accepted. */
function mergeAll(existing: OrmModel, incoming: OrmModel): OrmModel {
  const { deltas } = diffModels(existing, incoming);
  const accepted = new Set(
    deltas.map((_, index) => index).filter((index) => deltas[index]!.kind !== "unchanged"),
  );
  return mergeModels(existing, incoming, deltas, accepted);
}

function names(elements: readonly { name: string; }[]): string[] {
  return elements.map((element) => element.name).sort();
}

/** A delta as one comparable line, so a failure names what diverged. */
function describeDelta(delta: ModelDelta): string {
  return `${delta.kind} ${delta.elementType} ${JSON.stringify(delta.changeDescriptions)}`;
}
