/**
 * The oracle law: on every generated input, the merge returns what it
 * returned before it was restructured.
 *
 * `mergeModels` is being rebuilt in steps, each of which must keep
 * behaviour (docs/specs/model-merge-stages.spec.md, workstreams 3 to 5).
 * The judge of "keeps behaviour" is the merge as it stood before the first
 * step, frozen in `tests/diff/oracle/ModelMergeOracle.ts`: the live merge
 * and the frozen one must give the same serialized document and the same
 * diagnostics, or refuse in the same words.
 *
 * It compares documents where the laws in `merge.law.test.ts` assert
 * properties, and that is the reason it exists beside them. A property
 * names what must hold; a restructure can change what a partial
 * acceptance returns in a way no property names. Four faults that pass
 * every property law fail this one (barwise-ocn, its second class): which
 * id a merged role, population or instance takes is in the document, and
 * no property reads it.
 *
 * Two things it cannot judge. Input the generator does not draw: a
 * leniently loaded model with a dangling reference, imports, a namespace,
 * a fragment naming the base's prior ids. The frozen copy's lines this
 * law does not execute are listed in the spec under workstream 2, and
 * rest on the fixtures in `tests/diff`, as they did before. And a change
 * to a module both merges import: the copy freezes `ModelMerge.ts`, not
 * the pairing and id rules it calls, so a change there moves both sides
 * (the frozen file's header names them).
 *
 * While the two files are the same code, as they are on the day this is
 * added, the law holds by construction. It was seen failing by planting
 * faults in the live file; the coverage block holds the rest.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelDelta } from "../../src/diff/deltas.js";
import { diffModels, type DiffOptions } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate } from "../../src/diff/ModelMerge.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import {
  arbModelPlan,
  ID_FORMS,
  type ModelPlan,
  RUNS,
  SEED,
  UNDER_DIFFERENT_IDS,
} from "../arbitraries/model.js";
import {
  MERGE_DIFF_OPTIONS as FROZEN_MERGE_DIFF_OPTIONS,
  mergeAndValidate as frozenMergeAndValidate,
} from "../diff/oracle/ModelMergeOracle.js";

type Merge = typeof mergeAndValidate;

/**
 * How much of a diff a drawn reviewer accepts: a level from 0 to 4, and a
 * toss per delta that accepts it when it lands under the level. Level 0
 * accepts nothing and level 4 everything, so the two ends the property
 * laws state are drawn here too, and the levels between lean a partial
 * acceptance each way. An even coin alone almost never accepts all of a
 * fact type's dependents at once, or none of them.
 */
const LEVELS = 4;
const arbAcceptance = fc.tuple(
  fc.integer({ min: 0, max: LEVELS }),
  fc.infiniteStream(fc.integer({ min: 0, max: LEVELS - 1 })),
);
type Acceptance = readonly [level: number, tosses: Iterator<number>];

function acceptedBy(deltas: readonly ModelDelta[], [level, tosses]: Acceptance): Set<number> {
  return new Set(deltas.flatMap((_, at) => (tosses.next().value < level ? [at] : [])));
}

const yaml = new OrmYamlSerializer();

/**
 * What one merge gave: the document and what validation said of it, or no
 * document and the refusal. `mergeAndValidate` turns a throw into a
 * diagnostic carrying the message, so the same refusal is the same value.
 */
function outcome(
  merge: Merge,
  existing: OrmModel,
  incoming: OrmModel,
  diff: Parameters<Merge>[2],
  accepted: ReadonlySet<number>,
) {
  const { model, diagnostics, isValid } = merge(existing, incoming, diff, accepted);
  return { document: model === null ? null : yaml.serialize(model), diagnostics, isValid };
}

/**
 * Both merges on one input, the frozen one first: it reads the pair
 * before the live merge has touched it, so a live merge that changed its
 * inputs could not hand the judge a pair that already agrees with it.
 */
function bothOutcomes(
  existing: OrmModel,
  incoming: OrmModel,
  options: DiffOptions,
  acceptance: Acceptance,
) {
  const diff = diffModels(existing, incoming, options);
  const accepted = acceptedBy(diff.deltas, acceptance);
  const frozen = outcome(frozenMergeAndValidate, existing, incoming, diff, accepted);
  const live = outcome(mergeAndValidate, existing, incoming, diff, accepted);
  return { frozen, live, deltas: diff.deltas, accepted };
}

/**
 * The plan with every third object type and fact type edited, from the
 * second: a definition on the one, a note on the other.
 *
 * For the pairs two independent draws never give. Two drawn models differ
 * in every element they share a name for (0 of 687 paired object types
 * were `unchanged` when barwise-ocn counted), so the merge's "unchanged"
 * branches, and the translations they record, ran in no generated merge.
 * A model against its own edited copy is mostly unchanged elements, and
 * under different ids each of them is one the incoming side's references
 * reach only through the translation its branch recorded.
 */
function withSomeEdited(plan: ModelPlan): ModelPlan {
  return {
    ...plan,
    objectTypes: plan.objectTypes.map((ot, at) =>
      at % 3 === 1 ? { ...ot, definition: "edited" } : ot
    ),
    factTypes: plan.factTypes.map((ft, at) => (at % 3 === 1 ? { ...ft, note: "edited" } : ft)),
  };
}

/**
 * Whether an acceptance kept at least one changed delta's existing side
 * and took at least one other's incoming side.
 */
function builtFromBothSides(
  { deltas, accepted }: { deltas: readonly ModelDelta[]; accepted: ReadonlySet<number>; },
): boolean {
  const changed = deltas.flatMap((delta, at) => (delta.kind === "unchanged" ? [] : [at]));
  return changed.some((at) => accepted.has(at)) && changed.some((at) => !accepted.has(at));
}

describe("law: the merge returns what the frozen merge returns", () => {
  /**
   * Every caller diffs with `MERGE_DIFF_OPTIONS` before it merges, so the
   * constant decides what every merge is handed. The laws below build one
   * diff and give it to both merges; this is what holds the diff itself.
   */
  it("diffs for a merge with the options the frozen merge named", () => {
    expect(MERGE_DIFF_OPTIONS).toEqual(FROZEN_MERGE_DIFF_OPTIONS);
  });

  it.each(ID_FORMS)("the same document and diagnostics, or the same refusal, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbModelPlan(), arbAcceptance, (x, y, acceptance) => {
        const { frozen, live } = bothOutcomes(...pairOf(x, y), MERGE_DIFF_OPTIONS, acceptance);
        expect(live).toEqual(frozen);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it.each(ID_FORMS)("the same for a model against its own edited copy, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(arbModelPlan(), arbAcceptance, (x, acceptance) => {
        const pair = pairOf(x, withSomeEdited(x));
        const { frozen, live } = bothOutcomes(...pair, MERGE_DIFF_OPTIONS, acceptance);
        expect(live).toEqual(frozen);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  /**
   * A diff the merge refuses before it builds anything: one that paired
   * by content, or with rename recognition on (the diff's own default).
   * The refusals move to a module of their own in workstream 4, and the
   * message is the behaviour.
   */
  it.each(ID_FORMS)("refuses a diff it cannot trust in the same words, $name", {
    timeout: LAW_TIMEOUT_MS,
  }, ({ pairOf }) => {
    fc.assert(
      fc.property(
        arbModelPlan(),
        arbModelPlan(),
        arbAcceptance,
        fc.constantFrom<DiffOptions>({}, { ...MERGE_DIFF_OPTIONS, matching: "content" }),
        (x, y, acceptance, untrusted) => {
          const { frozen, live } = bothOutcomes(...pairOf(x, y), untrusted, acceptance);
          expect(frozen.document).toBeNull();
          expect(live).toEqual(frozen);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/**
 * The premises the oracle law rests on.
 *
 * Two merges that agree on 250 refusals, or on 250 acceptances of
 * nothing, have been compared on almost none of the code. The law reads a
 * restructure only where a merge was built from a mix of sides, so the
 * floors below hold the draws to that, per form.
 *
 * Measured at this seed over 250 draws, and the same in each of the three
 * forms, since a form changes ids and names and not which deltas there
 * are: the levels 0 to 4 are drawn 56, 51, 56, 48 and 39 times; a merge is
 * returned in 225 and refused in 25; a returned merge kept one changed
 * delta and took another in 129.
 */
describe.each(ID_FORMS)("coverage: the oracle law compares merges worth comparing, $name", ({
  pairOf,
}) => {
  const draws = fc.sample(fc.tuple(arbModelPlan(), arbModelPlan(), arbAcceptance), {
    seed: SEED,
    numRuns: RUNS,
  }).map(([x, y, acceptance]) => ({
    level: acceptance[0],
    ...bothOutcomes(...pairOf(x, y), MERGE_DIFF_OPTIONS, acceptance),
  }));

  function expectAtLeast(dimension: string, count: number, floor: number): void {
    expect(count, `${dimension}: ${count} of ${RUNS} draws, floor is ${floor}`)
      .toBeGreaterThanOrEqual(floor);
  }

  it("draws every acceptance level", () => {
    for (let level = 0; level <= LEVELS; level++) {
      expectAtLeast(`level ${level}`, draws.filter((d) => d.level === level).length, 20);
    }
  });

  it("compares merges that were returned", () => {
    expectAtLeast("returned", draws.filter((d) => d.frozen.document !== null).length, 110);
  });

  it("compares merges that were refused", () => {
    expectAtLeast("refused", draws.filter((d) => d.frozen.document === null).length, 12);
  });

  it("compares merges built from both sides", () => {
    const mixed = draws.filter((d) => d.frozen.document !== null && builtFromBothSides(d)).length;
    expectAtLeast("built from both sides", mixed, 64);
  });
});

/**
 * The premises of the edited-copy pairs: that they hold what the drawn
 * pairs lack, an element the diff calls unchanged, and, where the form's
 * ids differ, one whose two sides hold different ids.
 *
 * Measured at this seed over 250 draws, the same in each form: an
 * unchanged object type in 250 and an unchanged fact type in 250 (under
 * another id, in the re-id'd form); an edited object type in 250 and an
 * edited fact type in 175, the draws with a second fact type. A merge is
 * returned in all 250 in each form, and built from both sides in 59
 * sharing ids, 80 under different ids and 86 through prior ids.
 */
describe.each(ID_FORMS)("coverage: the edited copies leave elements unchanged, $name", ({
  pairOf,
  name,
}) => {
  // Through prior ids an unchanged element keeps its name, and so its id.
  const underOtherIds = name === UNDER_DIFFERENT_IDS.name;

  const diffs = fc.sample(arbModelPlan(), { seed: SEED, numRuns: RUNS }).map((x) =>
    diffModels(...pairOf(x, withSomeEdited(x)), MERGE_DIFF_OPTIONS).deltas
  );

  /** How many draws hold an unchanged element of `kind`: under another id, in the re-id'd form. */
  const unchanged = (kind: "object_type" | "fact_type"): number =>
    diffs.filter((deltas) =>
      deltas.some((delta) =>
        delta.elementType === kind && delta.kind === "unchanged"
        && (!underOtherIds || delta.existing!.id !== delta.incoming!.id)
      )
    ).length;

  const changed = (kind: "object_type" | "fact_type"): number =>
    diffs.filter((deltas) =>
      deltas.some((delta) => delta.elementType === kind && delta.kind === "modified")
    ).length;

  function expectAtLeast(dimension: string, count: number, floor: number): void {
    expect(count, `${name} ${dimension}: ${count} of ${RUNS} draws, floor is ${floor}`)
      .toBeGreaterThanOrEqual(floor);
  }

  it("compares merges that were returned, and built from both sides", () => {
    // The diffs above say what was on offer; these say a merge was built
    // from it. An edited copy that came to be refused in every draw would
    // leave the law comparing 250 identical refusals.
    const merges = fc.sample(fc.tuple(arbModelPlan(), arbAcceptance), {
      seed: SEED,
      numRuns: RUNS,
    }).map(([x, acceptance]) =>
      bothOutcomes(...pairOf(x, withSomeEdited(x)), MERGE_DIFF_OPTIONS, acceptance)
    ).filter(({ frozen }) => frozen.document !== null);
    expectAtLeast("returned", merges.length, 125);
    expectAtLeast("built from both sides", merges.filter(builtFromBothSides).length, 29);
  });

  it("draws unchanged object types", () => {
    expectAtLeast("unchanged object types", unchanged("object_type"), 125);
  });

  it("draws unchanged fact types", () => {
    expectAtLeast("unchanged fact types", unchanged("fact_type"), 125);
  });

  it("draws edited object types beside them", () => {
    expectAtLeast("modified object types", changed("object_type"), 125);
  });

  it("draws edited fact types beside them", () => {
    expectAtLeast("modified fact types", changed("fact_type"), 85);
  });
});

describe("coverage: the oracle is not the live merge", () => {
  it("imports the frozen merge from the test tree, not from src", () => {
    // Repoint the frozen import at `src/` and every law above compares a
    // function with itself: 250 green runs that can say nothing.
    expect(frozenMergeAndValidate).not.toBe(mergeAndValidate);
  });
});
