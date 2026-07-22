/**
 * The modeling-gym exercise format.
 *
 * An exercise poses a domain brief, and a learner writes a candidate
 * `.orm.yaml` model to satisfy it. The exercise carries a rubric of
 * declarative checks that the evaluator runs against the candidate. The
 * checks are semantic -- they reason about the candidate's verbalization
 * and the populations its constraints forbid -- rather than diffing the
 * candidate against a single "correct" model, because a domain has many
 * valid ORM models.
 *
 * Spec: `docs/specs/modeling-gym.spec.md`.
 */

/** How hard the exercise is meant to be. */
export type Difficulty = "intro" | "core" | "advanced";

/** The ORM constraint kinds a `forbids_population` check can name. */
export type ConstraintKind =
  | "internal_uniqueness"
  | "mandatory"
  | "value"
  | "frequency"
  | "ring";

/**
 * A structural precondition asked of the candidate: that a named object
 * type exists, or that some fact type connects two named object types.
 */
export type ElementQuery =
  | { readonly entity: string; }
  | { readonly factTypeBetween: readonly [string, string]; };

/**
 * One rubric check. Each reuses a core primitive:
 *
 * - `must_validate` -- the candidate has no structural (error-severity)
 *   diagnostics.
 * - `requires_verbalization` -- a required FORML sentence appears in the
 *   candidate's verbalization. Robust to role-name and id choices because
 *   it compares meaning, not structure.
 * - `forbids_population` -- the candidate rejects the population the named
 *   reference constraint forbids. The evaluator derives that population
 *   from the reference model via `generateCounterexampleForConstraint`,
 *   maps it onto the candidate, and requires the candidate to reject it.
 * - `requires_element` -- a structural precondition, used sparingly to
 *   scaffold the brief.
 */
export type GymCheck =
  | { readonly kind: "must_validate"; }
  | { readonly kind: "requires_verbalization"; readonly sentence: string; readonly hint?: string; }
  | {
    readonly kind: "forbids_population";
    /** Name of the fact type in the reference model that carries the constraint. */
    readonly factType: string;
    /** The kind of constraint on that fact type whose forbidden population motivates the check. */
    readonly constraint: ConstraintKind;
    readonly hint?: string;
  }
  | { readonly kind: "requires_element"; readonly element: ElementQuery; readonly hint?: string; };

/** An exercise as authored in a `.gym.yaml` file. */
export interface GymExercise {
  readonly id: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  /** The domain prompt shown to the learner. */
  readonly brief: string;
  /** Optional path (relative to the exercise file) to a partial starter model. */
  readonly starter?: string;
  /** Path (relative to the exercise file) to one valid answer. Backs `forbids_population`. */
  readonly reference?: string;
  readonly checks: readonly GymCheck[];
}
