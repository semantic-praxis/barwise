/**
 * Models generated to stress the LAYOUT, not the semantics.
 *
 * `core/tests/arbitraries/model.ts` already generates ORM models, in 1003
 * lines, and this deliberately does not reuse it
 * (docs/specs/diagram-layout-laws.spec.md). Not for an architectural reason --
 * importing across the boundary is an established practice here, and three
 * diagram tests already pull `ModelBuilder` from `core/tests/helpers/`. The
 * reason is what core's arbitrary NAMES things: every object type is `T0`,
 * `T1`, every fact type `F0`, `F1`. Fixed, uniform, two characters.
 *
 * Node width is derived from text, so name length is the single strongest
 * lever on whether two rectangles collide. A corpus of uniformly sized boxes
 * is one the placement engine spaces out comfortably every time -- the
 * degenerate corpus `pair-coverage-floors.spec.md` warns about, where 250 runs
 * over inputs that cannot discriminate is one trial repeated. Core is right to
 * hold names uniform; nothing it tests depends on them.
 *
 * What a layout DOES read, and what this therefore varies:
 *
 *   Name length, from two characters to thirty-three.
 *   Counts and arity, which set how much has to fit.
 *   Connectivity, which drives clustering and therefore placement.
 *   Subtyping, which adds a second edge kind with its own routing.
 *   Objectification, which turns a fact type into a box that also plays roles.
 *
 * **This generator is only as good as its ability to make the laws fail.** An
 * arbitrary that never crowds a layout would pass every law against a layout
 * engine that had been deleted -- `pair-coverage-floors.spec.md` names that
 * exact failure, 250 runs over inputs that cannot discriminate being one trial
 * repeated. It is accepted here because a planted layout defect makes the laws
 * fail; see the law suite's header for the readings.
 */
import { OrmModel } from "@barwise/core";
import fc from "fast-check";

/**
 * Pinned so a failure is reproducible from the file alone, matching the
 * convention in `core/tests/arbitraries/model.ts`.
 */
export const SEED = 20260915;

/**
 * Chosen against measured runtime, NOT copied from core's 250.
 *
 * A layout runs ELK and is orders of magnitude more expensive per case than a
 * mapper call: measured at roughly 25ms per generated model on this machine,
 * where a `core` law case is well under one. 60 runs keeps the law suite near
 * two seconds, which is what a suite in the pre-commit hook's path can afford.
 * A bare number here would be the thing `pair-coverage-floors.spec.md` warns
 * about, so the measurement is the comment.
 */
export const RUNS = 60;

/** Identifier-safe names across the full width range a real model shows. */
const arbName = fc
  .tuple(
    fc.constantFrom(
      "A",
      "Order",
      "Customer",
      "PurchaseOrderLineItem",
      "InternationalShippingAddressLine",
    ),
    fc.nat({ max: 999 }),
  )
  .map(([stem, n]) => `${stem}${n}`);

interface Plan {
  readonly objectTypes: readonly { id: string; name: string; entity: boolean; }[];
  readonly factTypes: readonly {
    id: string;
    name: string;
    playerIdx: readonly number[];
    objectified: boolean;
  }[];
  readonly subtypes: readonly { subIdx: number; superIdx: number; }[];
}

/**
 * A plan first, then a model, so the invalid combinations are excluded by
 * construction rather than filtered out afterwards. `fc.pre` on a model this
 * expensive to build would throw away most of the runs.
 */
const arbPlan: fc.Arbitrary<Plan> = fc
  .record({
    names: fc.uniqueArray(arbName, { minLength: 1, maxLength: 8 }),
    factSpecs: fc.array(
      fc.record({
        arity: fc.integer({ min: 1, max: 3 }),
        picks: fc.array(fc.nat({ max: 7 }), { minLength: 1, maxLength: 3 }),
        objectified: fc.boolean(),
      }),
      { maxLength: 6 },
    ),
    subtypePicks: fc.array(fc.tuple(fc.nat({ max: 7 }), fc.nat({ max: 7 })), { maxLength: 3 }),
    entityFlags: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  })
  .map(({ names, factSpecs, subtypePicks, entityFlags }) => {
    const objectTypes = names.map((name, i) => ({
      id: `ot${i}`,
      name,
      // At least one entity: a model of only value types has no subtype or
      // objectification structure to place, which would quietly narrow the
      // corpus to its least interesting shape.
      entity: i === 0 ? true : (entityFlags[i] ?? true),
    }));
    const n = objectTypes.length;

    const factTypes = factSpecs.map((spec, i) => {
      const playerIdx = spec.picks.slice(0, spec.arity).map((p) => p % n);
      return {
        id: `ft${i}`,
        name: `fact${i}`,
        playerIdx: playerIdx.length > 0 ? playerIdx : [0],
        objectified: spec.objectified,
      };
    });

    // Subtyping is entity-to-entity, irreflexive, and acyclic by construction:
    // only a lower index may be the supertype, so no cycle can be generated and
    // no run is wasted on a model `core` would reject.
    const entities = objectTypes.flatMap((o, i) => (o.entity ? [i] : []));
    const seen = new Set<string>();
    const subtypes: { subIdx: number; superIdx: number; }[] = [];
    for (const [a, b] of subtypePicks) {
      if (entities.length < 2) break;
      const x = entities[a % entities.length]!;
      const y = entities[b % entities.length]!;
      const [superIdx, subIdx] = x < y ? [x, y] : [y, x];
      const key = `${superIdx}>${subIdx}`;
      if (superIdx === subIdx || seen.has(key)) continue;
      seen.add(key);
      subtypes.push({ subIdx, superIdx });
    }

    return { objectTypes, factTypes, subtypes };
  });

/** A model the layout can be run against. */
export function arbLayoutModel(): fc.Arbitrary<OrmModel> {
  return arbPlan.map((plan) => {
    const model = new OrmModel({ name: "generated" });
    for (const ot of plan.objectTypes) {
      model.addObjectType({
        id: ot.id,
        name: ot.name,
        kind: ot.entity ? "entity" : "value",
        ...(ot.entity ? { referenceMode: "id" } : { dataType: { name: "text" } }),
      });
    }
    for (const ft of plan.factTypes) {
      model.addFactType({
        id: ft.id,
        name: ft.name,
        roles: ft.playerIdx.map((p, j) => ({
          id: `${ft.id}r${j}`,
          name: `role${j}`,
          playerId: plan.objectTypes[p]!.id,
        })),
        readings: [ft.playerIdx.map((_, j) => `{${j}}`).join(" relates ")],
      });
    }
    for (const st of plan.subtypes) {
      model.addSubtypeFact({
        subtypeId: plan.objectTypes[st.subIdx]!.id,
        supertypeId: plan.objectTypes[st.superIdx]!.id,
      });
    }
    return model;
  });
}
