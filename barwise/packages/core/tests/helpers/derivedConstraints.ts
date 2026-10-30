/**
 * Constraints of each kind, derived from the kind's own Schema (M1 of
 * docs/specs/effect-adoption.spec.md), for the tests that put derived values
 * beside the corpus's.
 *
 * Each kind alone, since the union weights its members by size and draws
 * the join kinds rarely (1 to 2 in 1,000 at seed 1). A kind with two or more
 * operands is drawn at a small size: Effect's generator has a cost budget
 * that grows with `size`, but so does every list it draws, and two
 * operands' role paths outrun it from size 5 up. Every other kind is drawn
 * at the default size, 10.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import { CONSTRAINT_KIND_FILES, type ConstraintFileValue } from "../../src/decode/constraint.js";

export type ConstraintKind = keyof typeof CONSTRAINT_KIND_FILES;

const SMALL = new Set<ConstraintKind>(["join_subset", "join_equality", "join_exclusion"]);
const cache = new Map<string, readonly ConstraintFileValue[]>();

/** `count` values of one kind, the same for the same arguments. */
export function derivedConstraints(
  type: ConstraintKind,
  { count = 100, seed = 1 }: { readonly count?: number; readonly seed?: number; } = {},
): readonly ConstraintFileValue[] {
  const key = `${type}:${count}:${seed}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      Effect.runSync(
        Arbitrary.sampleEffect(Arbitrary.schema(CONSTRAINT_KIND_FILES[type]), {
          count,
          seed,
          ...(SMALL.has(type) ? { size: 3 } : {}),
        }),
      ) as ConstraintFileValue[],
    );
  }
  return cache.get(key)!;
}
