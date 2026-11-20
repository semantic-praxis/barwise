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
import type { ConstraintDelta, FactTypeDelta, ModelDelta } from "../../src/diff/deltas.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate, mergeModels } from "../../src/diff/ModelMerge.js";
import { hashModel } from "../../src/lineage/manifest.js";
import type { Constraint } from "../../src/model/Constraint.js";
import { graphOf } from "../../src/model/graph.js";
import { populationIdBase } from "../../src/model/idRules.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { replayInto40 } from "../../src/serialization/replay.js";
import {
  arbModelPlan,
  arbOrmModel,
  buildModel,
  type ModelPlan,
  reIdModel,
  RUNS,
  SEED,
} from "../arbitraries/model.js";

/**
 * The three forms every law over a drawn pair runs in.
 *
 * The arbitrary gives ids by position, so two drawn models hold the same
 * ids: everything the diff pairs, it pairs by id, and the merge translates
 * every incoming id to itself. Run in that form alone, these laws passed
 * with any of six faults planted in the merge's id translation
 * (docs/specs/model-merge-stages.spec.md, "Can the suite protect a
 * restructure?"). The other two forms are the two ways a real pair comes
 * to hold different ids for one element:
 *
 * - **Under different ids.** The incoming model is re-id'd, so the pair
 *   shares no id and pairs by name and content: an id a person stated, or
 *   a draft whose ids are its own.
 * - **Through prior ids.** Both models are replayed as a 3.x file is on
 *   load, so each takes format 4.0's name-given ids and keeps the ids it
 *   was drawn with as `priorIds`, and some of the incoming model's names
 *   are changed first. The diff pairs through the prior ids, so a renamed
 *   element is one modification whose two sides hold different ids:
 *   two revisions of one older file, the case most of the merge's
 *   object-type and fact-type translation now exists for.
 *
 * In both, every reference the merge takes from the incoming side has to
 * be translated to arrive. All three run, and none replaces another: only
 * the shared-id form makes two drawn subtype facts, objectifications and
 * populations collide on an id, which is what the determinism law below
 * was written for.
 *
 * A form takes plans and not models because a name can only be changed
 * before a model is built. `arbOrmModel` is `arbModelPlan` built, so the
 * laws draw what they drew.
 */
interface IdForm {
  readonly name: string;
  readonly pairOf: (existing: ModelPlan, incoming: ModelPlan) => readonly [OrmModel, OrmModel];
  /** Whether the pair's ids differ, which is where the diff misreads a join path. */
  readonly idsDiffer: boolean;
}
const SHARING_IDS: IdForm = {
  name: "sharing ids",
  pairOf: (existing, incoming) => [buildModel(existing), buildModel(incoming)],
  idsDiffer: false,
};
const UNDER_DIFFERENT_IDS: IdForm = {
  name: "under different ids",
  pairOf: (existing, incoming) => [buildModel(existing), reIdModel(buildModel(incoming))],
  idsDiffer: true,
};
const THROUGH_PRIOR_IDS: IdForm = {
  name: "through prior ids",
  pairOf: (existing, incoming) => [
    replayInto40(buildModel(existing)),
    replayInto40(buildModel(withSomeRenamed(incoming))),
  ],
  idsDiffer: true,
};
const ID_FORMS: readonly IdForm[] = [SHARING_IDS, UNDER_DIFFERENT_IDS, THROUGH_PRIOR_IDS];

/** The suffix `withSomeRenamed` gives a name; no generated name carries it. */
const RENAMED = " renamed";

/**
 * The plan with every second object type and fact type renamed, ids kept.
 *
 * Every second one, from the second: the first of each kind keeps its
 * name, and the merge needs that. Where no element keeps its name under
 * the id two older files share, `refuseCoincidentIds` reads the files as
 * unrelated and refuses every accepted rename, and the laws would be
 * reading a refusal.
 */
function withSomeRenamed(plan: ModelPlan): ModelPlan {
  const renamed = <T extends { readonly name: string; }>(element: T, at: number): T =>
    at % 2 === 1 ? { ...element, name: `${element.name}${RENAMED}` } : element;
  return {
    ...plan,
    objectTypes: plan.objectTypes.map(renamed),
    factTypes: plan.factTypes.map(renamed),
  };
}

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
        const { deltas } = diffModels(model, model, MERGE_DIFF_OPTIONS);
        const merged = mergeModels(model, model, {
          deltas,
          matching: "id-first",
          recognizeRenames: false,
        }, new Set());
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
        const { deltas } = diffModels(model, model, MERGE_DIFF_OPTIONS);
        const merged = mergeModels(model, model, {
          deltas,
          matching: "id-first",
          recognizeRenames: false,
        }, new Set());

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
 *
 * Where the pair's ids differ, the second clause carries one more
 * exception, and it is the diff's, not the merge's: `operandKey` keys a join path by the
 * ids it is written with, where every other kind reads its roles through
 * the pairing, so a join constraint the merge translated into the base's
 * ids reads as modified against the incoming model's (barwise-bni). The
 * exception is held to what that defect explains: read each path id as
 * what it names in its own model, and the two sides must be the same
 * constraint. A path left in the incoming model's ids names nothing in the
 * merged one, and a path sent to the wrong element names another, so
 * neither passes as the diff's misreading.
 */

/**
 * A constraint with each id its join paths hold read as what it names in
 * `model`: a root as its object type's name, a step's role as its fact
 * type's name and the role's position. An id that names nothing is kept,
 * marked, so it equals no resolved one. Keys are sorted, because a
 * constraint the merge rebuilt lists its fields in another order.
 */
function withPathsByName(model: OrmModel, constraint: Constraint | undefined): unknown {
  const role = (id: string): string => {
    const factType = model.factTypes.find((ft) => ft.getRoleById(id) !== undefined);
    return factType === undefined
      ? `unresolved ${id}`
      : `${factType.name} role ${factType.roles.findIndex((r) => r.id === id)}`;
  };
  return JSON.parse(
    JSON.stringify(constraint, (key, value) =>
      key === "root"
        ? model.getObjectType(value)?.name ?? `unresolved ${value}`
        : key === "entry" || key === "exit"
        ? role(value)
        : value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
        : value),
  );
}

/** A join constraint the diff left unpaired, which barwise-bni may explain. */
function isUnpairedJoin(delta: ModelDelta): delta is ConstraintDelta {
  return delta.elementType === "constraint" && (delta.kind === "added" || delta.kind === "removed")
    && (delta.existing ?? delta.incoming)?.type.startsWith("join_") === true;
}

/** A join constraint the diff reports as modified, which barwise-bni may explain. */
function isModifiedJoin(delta: ModelDelta): delta is ConstraintDelta {
  return delta.elementType === "constraint" && delta.kind === "modified"
    && delta.incoming?.type.startsWith("join_") === true;
}

describe("law: accepting every delta yields the incoming model, aliases aside", () => {
  it.each(ID_FORMS)("reproduces the incoming element set, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), (drawnExisting, drawnIncoming) => {
        const [existing, incoming] = pairOf(drawnExisting, drawnIncoming);
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

  it.each(ID_FORMS)("differs from the incoming model only in unioned aliases, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf, idsDiffer }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), (drawnExisting, drawnIncoming) => {
        const [existing, incoming] = pairOf(drawnExisting, drawnIncoming);
        const merged = mergeAll(existing, incoming);
        const residual = diffModels(merged, incoming).deltas.filter((d) => d.kind !== "unchanged");

        for (const delta of residual) {
          if (idsDiffer && isModifiedJoin(delta)) {
            expect(withPathsByName(merged, delta.existing)).toEqual(
              withPathsByName(incoming, delta.incoming),
            );
            continue;
          }
          expect(describeDelta(delta)).toBe('modified object_type ["aliases changed"]');
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  /**
   * Every reference the incoming model makes resolves, by construction,
   * so every reference in the model that accepting everything yields does
   * too. This is the clause that reads the id translation without the
   * diff: a player, an objectified fact type or a join path's root that
   * the merge took from the incoming side and did not translate names
   * nothing in the merged model, and `graphOf` lists it. The clause above
   * reads the merged model through the diff's pairing, so where the diff
   * pairs a kind wrongly (barwise-bni is one case) it is this clause that
   * still sees a reference left in the incoming model's ids.
   *
   * References only, through `graphOf`, and not `getStructuralErrors`:
   * one drawn pair of 250 leaves an accept-all merge holding one
   * constraint id twice (barwise-qzh), which is a finding about ids the
   * two files reuse and says nothing about translation.
   */
  it.each(ID_FORMS)("leaves no reference dangling, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), (drawnExisting, drawnIncoming) => {
        const [existing, incoming] = pairOf(drawnExisting, drawnIncoming);
        const graph = graphOf(mergeAll(existing, incoming));
        expect(graph.ok ? [] : graph.unresolved.map((ref) => `${ref.field}: ${ref.missing}`))
          .toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The other end of the accepted set: a merge that accepts nothing returns
 * the base, whatever the incoming model holds.
 *
 * `merging a model with itself` above is this law at one point, the pair
 * whose diff is all `unchanged`. Over two drawn models every kind of
 * delta is on offer and every one is declined, so each of the merge's
 * "kept the existing side" branches runs, and under different ids each
 * records a translation it must then not apply to anything it keeps.
 *
 * By hash, which is the hash of the serialized document, ids included: the
 * base comes back under its own ids, in its own order.
 */
describe("law: accepting nothing returns the base", () => {
  it.each(ID_FORMS)("merging any incoming model preserves the base's hash, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), (drawnExisting, drawnIncoming) => {
        const [existing, incoming] = pairOf(drawnExisting, drawnIncoming);
        const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
        const merged = mergeModels(existing, incoming, {
          deltas,
          matching: "id-first",
          recognizeRenames: false,
        }, new Set());
        expect(hashModel(merged)).toBe(hashModel(existing));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The premises the two-draw laws above rest on, as measured floors.
 *
 * A law stated over `(existing, incoming)` only says something where
 * the two models differ in the dimension being compared. Where they
 * agree, `expect(names(merged.objectTypes)).toEqual(names(incoming.objectTypes))`
 * compares a value to itself and holds whatever `mergeModels` did --
 * `x toEqual x`, 250 times, reading as coverage. `sample.law.test.ts`
 * names the same failure ("the law compares two empty lists 250
 * times"); this file was the only law file with no such block, and the
 * only one whose properties take two draws, which is where the premise
 * is hardest to eyeball (`docs/specs/pair-coverage-floors.spec.md`,
 * barwise-985).
 *
 * Measured at this seed over 250 pairs: object type names 181, fact
 * type names 184, definitions 231, subtype pairs 159, objectification
 * pairs 120, population keys 218, non-empty residual 224.
 *
 * The objectification row is the thin one, and thin for a traceable
 * reason: barwise-968 recorded an objectified fact type in 70 models of
 * 250, and a PAIR needs one side non-empty, so (180/250)^2 predicts 130
 * both-empty pairs against the 127 measured. A dimension adequately
 * covered per model is the square of that per pair. It is also the
 * clause that matters most -- until the diff learned these four kinds,
 * `mergeModels` carried them from the EXISTING model whatever a
 * reviewer accepted, which is the regression the clause exists to
 * catch, asserting `[] toEqual []` in more than half its runs.
 *
 * Floors sit near half the measured counts, per the rule
 * `generator-coverage-floors.spec.md` set: well under the measurement
 * so ordinary generator churn does not trip them, well over one so a
 * collapse does.
 */
describe("coverage: the two-draw laws are not vacuous", () => {
  /**
   * The pairs the laws above actually see.
   *
   * `fc.sample(fc.tuple(a, b))` is a different call than
   * `fc.property(a, b, ...)`, so "same pairs" is a claim rather than a
   * definition. It was checked: counting collisions from inside the
   * property returned 69 identical object-type name sets, and these
   * sampled pairs return 250 - 181 = 69.
   */
  const plans = fc.sample(fc.tuple(arbModelPlan(), arbModelPlan()), {
    seed: SEED,
    numRuns: RUNS,
  });

  /**
   * The pairs as drawn, which is where the dimension floors are read. A
   * floor met here is met in every form: re-iding changes no name, and
   * the prior-id form's renames can only add a difference.
   */
  const pairs = plans.map(([existing, incoming]) => SHARING_IDS.pairOf(existing, incoming));

  /** How many sampled pairs the two models differ in, under `project`. */
  function differing(project: (model: OrmModel) => string[]): number {
    return pairs.filter(([existing, incoming]) =>
      JSON.stringify(project(existing)) !== JSON.stringify(project(incoming))
    ).length;
  }

  /** A floor, stated so the failure reports the drift rather than `false`. */
  function expectFloor(dimension: string, count: number, floor: number): void {
    expect(
      count,
      `${dimension}: ${count} of ${pairs.length} pairs differ, floor is ${floor}`,
    ).toBeGreaterThanOrEqual(floor);
  }

  it("draws pairs whose object type names differ", () => {
    expectFloor("object type names", differing((m) => names(m.objectTypes)), 90);
  });

  it("draws pairs whose fact type names differ", () => {
    expectFloor("fact type names", differing((m) => names(m.factTypes)), 90);
  });

  it("draws pairs whose definitions differ", () => {
    expectFloor(
      "definition terms",
      differing((m) => m.definitions.map((d) => d.term).sort()),
      120,
    );
  });

  it("draws pairs whose subtype facts differ", () => {
    expectFloor("subtype pairs", differing(subtypePairs), 80);
  });

  it("draws pairs whose objectifications differ", () => {
    // The thinnest row: 127 pairs of 250 have BOTH sides empty.
    expectFloor("objectification pairs", differing(objectificationPairs), 60);
  });

  it("draws pairs whose populations differ", () => {
    expectFloor("population keys", differing(populationKeys), 110);
  });

  it.each(ID_FORMS)("draws pairs that leave a residual delta to inspect, $name", ({ pairOf }) => {
    // The second law asserts INSIDE `for (const delta of residual)`.
    // Where the residual is empty the body never runs and the test
    // passes having executed no assertion -- the it()-shaped version of
    // a check that cannot fail. It stood at 224 of 250 sharing ids, 232
    // under different ids and 230 through prior ids.
    const count = plans.map(([existing, incoming]) => pairOf(existing, incoming))
      .filter(([existing, incoming]) =>
        diffModels(mergeAll(existing, incoming), incoming).deltas.some((d) =>
          d.kind !== "unchanged"
        )
      ).length;
    expectFloor("non-empty residual", count, 120);
  });

  it.each(ID_FORMS)("draws pairs that offer a change to decline, $name", ({ pairOf }) => {
    // The accept-nothing law is `merging a model with itself` again
    // wherever the diff offers nothing. 250 of 250 in every form.
    const count = plans.filter(([existing, incoming]) =>
      diffModels(...pairOf(existing, incoming), MERGE_DIFF_OPTIONS).deltas.some((d) =>
        d.kind !== "unchanged"
      )
    ).length;
    expectFloor("a change to decline", count, 200);
  });
});

/**
 * The premises of the second id form, the first of the two that make the
 * laws read the merge's id translation at all.
 *
 * It is easy to lose without a test going red. A re-id that kept one kind
 * of id, or a diff that stopped pairing a kind by name, leaves these laws
 * running over pairs that share ids again, or over pairs that have nothing
 * in common, and both pass: the first is the state this form was added to
 * end (docs/specs/model-merge-stages.spec.md, workstream 1), and in the
 * second every delta is an addition or a removal and no id is translated
 * to anything.
 *
 * Measured at this seed over 250 pairs: no pair shares an id; an object
 * type and a fact type pair by name under different ids in all 250, and in
 * all 250 one of each is a modification, the delta whose acceptance keeps
 * the base's id under the incoming content; a fact type's modification
 * changes its arity in 202; a population pairs under different ids in 36;
 * the diff misreads a join constraint in the residual of 82.
 *
 * The population row is thin for the reason the objectification row
 * above is, squared again: a pair needs a population on the same fact
 * type, with the same sample flag, on both sides.
 */
describe("coverage: the pairs under different ids are paired by name, not by id", () => {
  const pairs = fc.sample(fc.tuple(arbModelPlan(), arbModelPlan()), {
    seed: SEED,
    numRuns: RUNS,
  }).map(([existing, incoming]) => UNDER_DIFFERENT_IDS.pairOf(existing, incoming));

  const diffs = pairs.map(([existing, incoming]) =>
    diffModels(existing, incoming, MERGE_DIFF_OPTIONS).deltas
  );

  /** How many pairs' diffs hold a delta `matches` accepts. */
  function pairsWith(matches: (delta: ModelDelta) => boolean): number {
    return diffs.filter((deltas) => deltas.some(matches)).length;
  }

  /** An object type or fact type the diff paired by name although the ids differ. */
  const pairedByName = (kind: "object_type" | "fact_type") => (delta: ModelDelta): boolean =>
    delta.elementType === kind && delta.pairedBy === "name"
    && delta.existing!.id !== delta.incoming!.id;

  /**
   * A population on both sides under different ids, the incoming one
   * named for its fact type as a file names it.
   */
  const pairedPopulation = (delta: ModelDelta): boolean =>
    delta.elementType === "population" && delta.existing !== undefined
    && delta.incoming !== undefined && delta.existing.id !== delta.incoming.id
    && delta.incoming.id.startsWith(populationIdBase(delta.incoming.factTypeId));

  it("no pair shares an id", () => {
    const sharing = pairs.filter(([existing, incoming]) => {
      const held = new Set(idsOf(existing));
      return idsOf(incoming).some((id) => held.has(id));
    }).length;
    expect(sharing, `${sharing} of ${pairs.length} pairs share an id`).toBe(0);
  });

  it("re-ids a model without changing what it says", () => {
    // The laws compare a merge with the re-id'd incoming model and never
    // with the drawn one, so a re-id that lost an alias or a population
    // would cost them inputs without failing them. The diff is the
    // reader: against its own re-id'd form a model reports nothing but
    // the join constraints barwise-bni explains, and those are the same
    // constraints on each side once each path id is read as what it names
    // in its own model. Sorted, since the order the diff lists them in is
    // not the claim.
    const models = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS });
    for (const model of models) {
      const reIdd = reIdModel(model);
      const changed = diffModels(model, reIdd, MERGE_DIFF_OPTIONS).deltas
        .filter((delta) => delta.kind !== "unchanged");
      expect(changed.filter((delta) => !isUnpairedJoin(delta)).map(describeDelta)).toEqual([]);

      const joins = (kind: "removed" | "added", side: OrmModel) =>
        changed.filter((delta): delta is ConstraintDelta =>
          delta.kind === kind && isUnpairedJoin(delta)
        )
          .map((delta) =>
            JSON.stringify(
              withPathsByName(side, { ...(delta.existing ?? delta.incoming)!, id: "" }),
            )
          )
          .sort();
      expect(joins("added", reIdd)).toEqual(joins("removed", model));
    }
  });

  it("draws pairs whose object types pair by name under different ids", () => {
    expectAtLeast("object types paired by name", pairsWith(pairedByName("object_type")), 200);
  });

  it("draws pairs whose fact types pair by name under different ids", () => {
    expectAtLeast("fact types paired by name", pairsWith(pairedByName("fact_type")), 200);
  });

  it("draws pairs whose populations pair under different ids", () => {
    expectAtLeast("populations paired", pairsWith(pairedPopulation), 18);
  });

  it("draws a pair holding all three at once", () => {
    // The spec's requirement, as written: some pair holds an object type,
    // a fact type and a population named for its fact type that pair by
    // name under different ids. 36 of 250, the population row's count.
    const count =
      diffs.filter((deltas) =>
        deltas.some(pairedByName("object_type")) && deltas.some(pairedByName("fact_type"))
        && deltas.some(pairedPopulation)
      ).length;
    expectAtLeast("an object type, a fact type and a population together", count, 18);
  });

  it("draws pairs that modify an element paired by name", () => {
    // Accepting one of these keeps the base's id and takes the incoming
    // content, so everything else the incoming model says about the
    // element reaches it only through the translation.
    const modified = (kind: "object_type" | "fact_type") => (delta: ModelDelta): boolean =>
      pairedByName(kind)(delta) && delta.kind === "modified";
    expectAtLeast("modified object types", pairsWith(modified("object_type")), 200);
    expectAtLeast("modified fact types", pairsWith(modified("fact_type")), 200);
  });

  it("draws pairs whose fact types change arity", () => {
    // Where the arity agrees, a re-id'd role rebases onto the base's role
    // of the same position and the role remaps have nothing to record
    // (the spec's note on its probe M3). 202 of 250.
    const count = pairsWith((delta) =>
      delta.elementType === "fact_type" && delta.kind === "modified"
      && delta.existing!.roles.length !== delta.incoming!.roles.length
    );
    expectAtLeast("fact types changing arity", count, 100);
  });

  it("draws pairs whose residual holds the join constraint the diff misreads", () => {
    // The exception in the accept-all law runs an assertion of its own,
    // so it needs inputs too. 82 of 250.
    const count =
      pairs.filter(([existing, incoming]) =>
        diffModels(mergeAll(existing, incoming), incoming).deltas.some(isModifiedJoin)
      ).length;
    expectAtLeast("misread join constraints", count, 40);
  });
});

/**
 * The premises of the third id form.
 *
 * What it adds over the second is the pairing: an element the diff pairs
 * by the id two older files stated, whose name and so whose id differ
 * between the two models. That is one delta, a modification, and
 * accepting it keeps the base's id under the incoming name. Lose the
 * prior ids on either side, or the renames, and the form quietly becomes
 * one of the other two: without prior ids the renamed elements pair with
 * nothing, and without renames every id the replay gives is the same on
 * both sides.
 *
 * Measured at this seed over 250 pairs: both models hold prior ids in all
 * 250; a renamed object type pairs by id under different ids in 250 and a
 * renamed fact type in 128, the pairs where both models hold a second
 * fact type; a population pairs under different ids in 15.
 */
describe("coverage: the pairs through prior ids pair renamed elements by id", () => {
  const pairs = fc.sample(fc.tuple(arbModelPlan(), arbModelPlan()), {
    seed: SEED,
    numRuns: RUNS,
  }).map(([existing, incoming]) => THROUGH_PRIOR_IDS.pairOf(existing, incoming));

  const diffs = pairs.map(([existing, incoming]) =>
    diffModels(existing, incoming, MERGE_DIFF_OPTIONS).deltas
  );

  /** A renamed element the diff paired by id although the two sides' ids differ. */
  const renamedPairedById = (kind: "object_type" | "fact_type") => (delta: ModelDelta): boolean =>
    delta.elementType === kind && delta.kind === "modified" && delta.pairedBy === "id"
    && delta.existing!.id !== delta.incoming!.id && delta.incoming!.name.endsWith(RENAMED);

  it("gives both models prior ids", () => {
    const without =
      pairs.filter(([existing, incoming]) =>
        existing.priorIds === undefined || incoming.priorIds === undefined
      ).length;
    expect(without, `${without} of ${pairs.length} pairs lack prior ids on a side`).toBe(0);
  });

  it("draws pairs whose renamed object types pair by id under different ids", () => {
    const count = diffs.filter((deltas) => deltas.some(renamedPairedById("object_type"))).length;
    expectAtLeast("renamed object types paired by id", count, 125);
  });

  it("draws pairs whose renamed fact types pair by id under different ids", () => {
    const count = diffs.filter((deltas) => deltas.some(renamedPairedById("fact_type"))).length;
    expectAtLeast("renamed fact types paired by id", count, 64);
  });

  it("draws pairs whose populations pair under different ids", () => {
    // A population's id is its fact type's and `.population`, so the two
    // differ exactly where the fact type was renamed.
    const count =
      diffs.filter((deltas) =>
        deltas.some((delta) =>
          delta.elementType === "population" && delta.existing !== undefined
          && delta.incoming !== undefined && delta.existing.id !== delta.incoming.id
        )
      ).length;
    expectAtLeast("populations paired under different ids", count, 7);
  });

  it("draws pairs whose residual holds the join constraint the diff misreads", () => {
    // The accept-all law's exception is open in this form too, so it
    // needs inputs here as it does under different ids. 42 of 250.
    const count =
      pairs.filter(([existing, incoming]) =>
        diffModels(mergeAll(existing, incoming), incoming).deltas.some(isModifiedJoin)
      ).length;
    expectAtLeast("misread join constraints", count, 21);
  });
});

/** A floor over the `RUNS` draws, stated so the failure reports the count. */
function expectAtLeast(dimension: string, count: number, floor: number): void {
  expect(count, `${dimension}: ${count} of ${RUNS} draws, floor is ${floor}`)
    .toBeGreaterThanOrEqual(floor);
}

/** Every id a model holds, whatever holds it. */
function idsOf(model: OrmModel): string[] {
  return [
    ...model.objectTypes.map((ot) => ot.id),
    ...model.factTypes.flatMap((ft) => [ft.id, ...ft.roles.map((role) => role.id)]),
    ...model.everyConstraint().map(([constraint]) => constraint.id),
    ...model.subtypeFacts.map((sf) => sf.id),
    ...model.objectifiedFactTypes.map((oft) => oft.id),
    ...model.populations.flatMap((p) => [p.id, ...p.instances.map((instance) => instance.id)]),
  ].filter((id): id is string => id !== undefined);
}

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

/**
 * Merge is deterministic: the same two models and the same accepted set
 * give the same model, ids included. Where the merged store already held
 * an element's id, the merge used to leave the id to the installed
 * generator, so two runs differed (barwise-yg5). The generated models
 * number their ids by position, so two independent draws collide on
 * subtype fact, objectification and population ids often.
 *
 * Compared as serialized documents, not through `hashModel`. When this
 * was written the hash renumbered ids by first appearance, so it read two
 * merges that differ only in a fresh id as the same, and the law passed on
 * the code it exists to reject. Since format 4.0 the hash is of the
 * document as written (`lineage/manifest.ts`); the documents stay because
 * a failure then prints the two it compared.
 */
describe("law: merging twice gives the same model", () => {
  it.each(ID_FORMS)("the same inputs give the same document, or the same refusal, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    const yaml = new OrmYamlSerializer();
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), fc.infiniteStream(fc.boolean()), (x, y, coin) => {
        const [a, b] = pairOf(x, y);
        const { deltas } = diffModels(a, b, MERGE_DIFF_OPTIONS);
        const accepted = acceptedBy(deltas, coin);
        const once = mergeAndValidate(a, b, {
          deltas,
          matching: "id-first",
          recognizeRenames: false,
        }, accepted);
        const twice = mergeAndValidate(a, b, {
          deltas,
          matching: "id-first",
          recognizeRenames: false,
        }, accepted);
        expect(twice.model && yaml.serialize(twice.model)).toBe(
          once.model && yaml.serialize(once.model),
        );
        expect(twice.diagnostics).toEqual(once.diagnostics);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * Between the two ends of the accepted set: whatever a reviewer accepts,
 * a merged population's values are keyed by roles its fact type has.
 *
 * A population keys each value by a role id, and the merge takes a fact
 * type and its population from whichever side each delta's answer names,
 * so the two can come from different models. Decline a population's
 * change and accept its fact type's, and the base's population is carried
 * onto the incoming roles: a role the incoming fact type dropped has to
 * take its values with it (barwise-941). Accept a population and keep the
 * base's fact type, and every key the incoming population carries has to
 * be translated to the kept roles, or dropped where the base has none.
 *
 * Neither end reaches the first case: accepting everything takes the
 * population from the incoming side too, and accepting nothing changes no
 * fact type. The determinism law above is the only other one over a
 * partial acceptance, and it compares a merge with itself, so a merge
 * that left a value under a dead key did so both times and passed. The
 * spec's probe M3 plants its fault there, and no other law in this file
 * sees it in any of the three forms.
 *
 * A merge that is refused is the determinism law's subject and passes
 * here; the coverage block counts the merges that were not.
 */
describe("law: whatever is accepted, a population is keyed by its fact type's roles", () => {
  it.each(ID_FORMS)("no merged population holds a value for a role its fact type lacks, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), fc.infiniteStream(fc.boolean()), (x, y, coin) => {
        const [existing, incoming] = pairOf(x, y);
        const { model } = mergeSome(existing, incoming, coin);
        if (model === null) return;
        expect(strayRoleKeys(model)).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The premises of the law over a partial acceptance.
 *
 * The law has something to read only where a merge was returned and a
 * population and its fact type came from different sides. Drawn from the
 * arbitraries the law draws from, at its seed.
 *
 * Measured over 250 draws, sharing ids, under different ids and through
 * prior ids: a merge is returned in 205 each; among those the base's
 * population is carried past an accepted fact-type change that dropped a
 * role in 17, 19 and 18, and an incoming population is taken onto a fact
 * type the merge kept from the base in 39, 38 and 40.
 *
 * The first of those is the thin one, and it is the only input the
 * spec's probe M3 is read on: it needs a population on the base, a lower
 * arity on the incoming side, and two coin tosses landing opposite ways.
 */
describe.each(ID_FORMS)(
  "coverage: the partial acceptances split a population from its fact type, $name",
  ({ pairOf }) => {
    const merges = fc.sample(
      fc.tuple(arbModelPlan(), arbModelPlan(), fc.infiniteStream(fc.boolean())),
      { seed: SEED, numRuns: RUNS },
    ).map(([x, y, coin]) => mergeSome(...pairOf(x, y), coin)).filter(({ model }) => model !== null);

    /** The paired fact types whose delta `chosen` accepts, by the id `side` gives them. */
    const factTypesWhere = (
      deltas: readonly ModelDelta[],
      side: "existing" | "incoming",
      chosen: (delta: FactTypeDelta, at: number) => boolean,
    ): Set<string> =>
      new Set(
        deltas.flatMap((delta, at) =>
          delta.elementType === "fact_type" && delta.existing && delta.incoming && chosen(delta, at)
            ? [delta[side]!.id]
            : []
        ),
      );

    it("returns a merge to read", () => {
      expectAtLeast("merges returned", merges.length, 100);
    });

    it("carries a base population past a dropped role", () => {
      const count = merges.filter(({ deltas, accepted }) => {
        const narrowed = factTypesWhere(
          deltas,
          "existing",
          (delta, at) =>
            delta.kind === "modified" && accepted.has(at)
            && delta.incoming!.roles.length < delta.existing!.roles.length,
        );
        return deltas.some((delta, at) =>
          delta.elementType === "population" && delta.existing !== undefined
          && narrowed.has(delta.existing.factTypeId)
          && (delta.kind === "unchanged" || !accepted.has(at))
        );
      }).length;
      expectAtLeast("base populations carried past a dropped role", count, 8);
    });

    it("takes an incoming population onto a kept fact type", () => {
      const count = merges.filter(({ deltas, accepted }) => {
        const kept = factTypesWhere(
          deltas,
          "incoming",
          (delta, at) => delta.kind === "unchanged" || !accepted.has(at),
        );
        return deltas.some((delta, at) =>
          delta.elementType === "population" && delta.incoming !== undefined
          && (delta.kind === "added" || delta.kind === "modified") && accepted.has(at)
          && kept.has(delta.incoming.factTypeId)
        );
      }).length;
      expectAtLeast("incoming populations taken onto a kept fact type", count, 19);
    });
  },
);

/** Each value a population holds under a role id its fact type does not have. */
function strayRoleKeys(model: OrmModel): string[] {
  return model.populations.flatMap((population) => {
    const roles = new Set(model.getFactType(population.factTypeId)?.roles.map((role) => role.id));
    return population.instances.flatMap((instance) =>
      Object.keys(instance.roleValues).filter((key) => !roles.has(key)).map((key) =>
        `${population.id}: ${key}`
      )
    );
  });
}

/** The deltas a reviewer accepting each on a coin toss accepts. */
function acceptedBy(deltas: readonly ModelDelta[], coin: Iterator<boolean>): Set<number> {
  return new Set(deltas.flatMap((_, i) => (coin.next().value ? [i] : [])));
}

/** Merge with each delta accepted on a coin toss; `model` is null where the merge refused. */
function mergeSome(existing: OrmModel, incoming: OrmModel, coin: Iterator<boolean>) {
  const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
  const accepted = acceptedBy(deltas, coin);
  const { model } = mergeAndValidate(existing, incoming, {
    deltas,
    matching: "id-first",
    recognizeRenames: false,
  }, accepted);
  return { deltas, accepted, model };
}

/** Merge with every non-unchanged delta accepted. */
function mergeAll(existing: OrmModel, incoming: OrmModel): OrmModel {
  const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
  const accepted = new Set(
    deltas.map((_, index) => index).filter((index) => deltas[index]!.kind !== "unchanged"),
  );
  return mergeModels(
    existing,
    incoming,
    { deltas, matching: "id-first", recognizeRenames: false },
    accepted,
  );
}

function names(elements: readonly { name: string; }[]): string[] {
  return elements.map((element) => element.name).sort();
}

/** A delta as one comparable line, so a failure names what diverged. */
function describeDelta(delta: ModelDelta): string {
  return `${delta.kind} ${delta.elementType} ${JSON.stringify(delta.changeDescriptions)}`;
}
