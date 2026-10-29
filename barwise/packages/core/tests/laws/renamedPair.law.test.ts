/**
 * The shared-id law: a shared id is the same element, so a model compared
 * with itself renamed under kept ids is one modification per rename, and
 * merging it neither drops nor duplicates anything.
 *
 * Before diff paired by id (barwise-ue5), a renamed object type read as a
 * removal plus an addition, every subtype fact, objectification and
 * population that named it read the same way, and the merge either dropped
 * the kept element or held both. The arbitrary draws the renames that
 * matter: a suffix on object types and fact types, and a rotation of names
 * among object types, which is the swap whose partial acceptance lands one
 * name on two elements and is the one outcome the merge refuses.
 *
 * Spec: docs/specs/model-invariants.spec.md, WS2.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeAndValidate } from "../../src/diff/ModelMerge.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { arbModelPlan, buildModel, type ModelPlan, RUNS, SEED } from "../arbitraries/model.js";

interface RenamedPair {
  readonly existing: OrmModel;
  readonly incoming: OrmModel;
  /** Object type and fact type ids whose name differs between the two. */
  readonly renamed: ReadonlySet<string>;
}

/**
 * The plan's names are positional (`T0`, `F0`), so a suffix no generated
 * name carries cannot collide, and a rotation within the object types is a
 * permutation, so the incoming model's names stay distinct too.
 */
function renamePlan(
  plan: ModelPlan,
  suffixOt: readonly boolean[],
  rotate: readonly number[],
  suffixFt: readonly boolean[],
): ModelPlan {
  const names = plan.objectTypes.map((ot) => ot.name);
  const ring = [...new Set(rotate.map((i) => i % Math.max(names.length, 1)))];
  const rotated = [...names];
  ring.forEach((at, k) => {
    rotated[at] = names[ring[(k + 1) % ring.length]!]!;
  });
  return {
    ...plan,
    objectTypes: plan.objectTypes.map((ot, i) => ({
      ...ot,
      name: suffixOt[i] ? `${rotated[i]} renamed` : rotated[i]!,
    })),
    factTypes: plan.factTypes.map((ft, i) => ({
      ...ft,
      name: suffixFt[i] ? `${ft.name} renamed` : ft.name,
    })),
  };
}

/**
 * A constraint the plan leaves without an id is given a random one when it
 * is built, so two builds of one plan would disagree on it. Both sides of
 * the pair are one model, so the ids are fixed before either is built.
 */
function withConstraintIds(plan: ModelPlan): ModelPlan {
  return {
    ...plan,
    factTypes: plan.factTypes.map((ft, j) => ({
      ...ft,
      constraints: ft.constraints?.map((c, k) => ({ ...c, id: c.id ?? `ft${j}c${k}` })),
    })),
    constraints: plan.constraints.map((c, k) => ({ ...c, id: c.id ?? `mc${k}` })),
  };
}

const arbRenamedPair: fc.Arbitrary<RenamedPair> = arbModelPlan().map(withConstraintIds).chain((
  plan,
) =>
  fc.tuple(
    fc.array(fc.boolean(), {
      minLength: plan.objectTypes.length,
      maxLength: plan.objectTypes.length,
    }),
    fc.array(fc.nat(), { maxLength: 4 }),
    fc.array(fc.boolean(), { minLength: plan.factTypes.length, maxLength: plan.factTypes.length }),
  ).map(([suffixOt, rotate, suffixFt]) => {
    const existing = buildModel(plan);
    const incoming = buildModel(renamePlan(plan, suffixOt, rotate, suffixFt));
    const renamed = new Set<string>();
    for (const ot of incoming.objectTypes) {
      if (existing.getObjectType(ot.id)!.name !== ot.name) renamed.add(ot.id);
    }
    for (const ft of incoming.factTypes) {
      if (existing.getFactType(ft.id)!.name !== ft.name) renamed.add(ft.id);
    }
    return { existing, incoming, renamed };
  })
);

/**
 * Measured 2026-10-24 at SEED over RUNS pairs: 250 renamed, 93 swapped,
 * 173 with a population, 96 a subtype fact, 70 an objectification, 22 a
 * preferred identifier. Floors sit about a fifth below, so a generator
 * change that starves a shape fails here rather than leaving the laws
 * passing over pairs that never had it.
 *
 * Re-measured the same day when `join_ring` joined the constraint kinds
 * (join-ring-constraint WS1): the five shapes the plan draws directly did
 * not move; a preferred identifier fell from 22 to 14, because whether one
 * is placed depends on the constraint draws (a drawn uniqueness flagged
 * preferred both counts and blocks the placed one), and adding a kind
 * reshuffles every one of those draws. Its floor follows the rule above.
 */
const FLOORS = {
  renamed: 200,
  swapped: 75,
  populations: 140,
  subtypeFacts: 75,
  objectifications: 55,
  preferredIdentifiers: 11,
};

const ids = (items: readonly { readonly id: string; }[]) => items.map((e) => e.id).sort();

describe("law: a shared id is the same element", () => {
  it("reports one modification per rename and nothing else", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbRenamedPair, ({ existing, incoming, renamed }) => {
        const changed = diffModels(existing, incoming).deltas.filter((d) => d.kind !== "unchanged");
        expect(changed.map((d) => `${d.kind} ${d.existing?.id}`).sort()).toEqual(
          [...renamed].map((id) => `modified ${id}`).sort(),
        );
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it(
    "merges any subset without dropping or duplicating an element, or refuses a name clash",
    { timeout: LAW_TIMEOUT_MS },
    () => {
      fc.assert(
        fc.property(arbRenamedPair, fc.infiniteStream(fc.boolean()), (pair, coin) => {
          const { existing, incoming } = pair;
          const { deltas } = diffModels(existing, incoming);
          const accepted = new Set(
            deltas.flatMap((_, i) => (coin.next().value ? [i] : [])),
          );
          const result = mergeAndValidate(
            existing,
            incoming,
            { deltas, matching: "id-first" },
            accepted,
          );

          // The name each object type and fact type ends with.
          const takes = new Map<string, string>();
          deltas.forEach((d, i) => {
            if (d.elementType !== "object_type" && d.elementType !== "fact_type") return;
            const side = accepted.has(i) && d.incoming ? d.incoming : d.existing!;
            takes.set(
              `${d.elementType} ${side.name}`,
              (takes.get(`${d.elementType} ${side.name}`) ?? "") + "x",
            );
          });
          const clash = [...takes.values()].some((n) => n.length > 1);

          if (result.model === null) {
            expect(clash).toBe(true);
            expect(result.diagnostics.map((d) => d.ruleId)).toEqual([RULE_ID.mergeError]);
            return;
          }
          expect(clash).toBe(false);
          expect(result.diagnostics).toEqual([]);
          const merged = result.model;
          expect(ids(merged.objectTypes)).toEqual(ids(existing.objectTypes));
          expect(ids(merged.factTypes)).toEqual(ids(existing.factTypes));
          expect(ids(merged.subtypeFacts)).toEqual(ids(existing.subtypeFacts));
          expect(ids(merged.objectifiedFactTypes)).toEqual(ids(existing.objectifiedFactTypes));
          expect(ids(merged.populations)).toEqual(ids(existing.populations));
          expect(ids(merged.everyConstraint().map(([c]) => c))).toEqual(
            ids(existing.everyConstraint().map(([c]) => c)),
          );
          for (const ot of existing.objectTypes) {
            expect(merged.preferredIdentifierOf(ot.id)).toBe(existing.preferredIdentifierOf(ot.id));
          }
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );
});

describe("coverage: the renamed pairs reach the shapes the laws assert on", () => {
  const pairs = fc.sample(arbRenamedPair, { seed: SEED, numRuns: RUNS });

  /** A floor, stated so the failure reports the drift rather than `false`. */
  function expectFloor(dimension: string, test: (pair: RenamedPair) => boolean, floor: number) {
    const count = pairs.filter(test).length;
    expect(count, `${dimension}: ${count} of ${pairs.length} pairs, floor is ${floor}`)
      .toBeGreaterThanOrEqual(floor);
  }

  it("renames something in most pairs", () => {
    expectFloor("a rename", (p) => p.renamed.size > 0, FLOORS.renamed);
  });

  it("swaps names, the shape a partial acceptance turns into a clash", () => {
    expectFloor(
      "an object type given another's name",
      ({ existing, incoming }) =>
        incoming.objectTypes.some((ot) =>
          existing.objectTypes.some((e) => e.id !== ot.id && e.name === ot.name)
        ),
      FLOORS.swapped,
    );
  });

  it("renames elements that other elements refer to", () => {
    expectFloor("a population", (p) => p.existing.populations.length > 0, FLOORS.populations);
    expectFloor("a subtype fact", (p) => p.existing.subtypeFacts.length > 0, FLOORS.subtypeFacts);
    expectFloor(
      "an objectification",
      (p) => p.existing.objectifiedFactTypes.length > 0,
      FLOORS.objectifications,
    );
    expectFloor(
      "a preferred identifier",
      (p) => p.existing.objectTypes.some((ot) => p.existing.preferredIdentifierOf(ot.id)),
      FLOORS.preferredIdentifiers,
    );
  });
});
