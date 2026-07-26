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
 * Front matter follows learning-design C1: an exercise declares the
 * proficiency transition it serves and its observable exit performance
 * (replacing the earlier three-value difficulty enum, which said the
 * same thing less precisely). Checks may carry the C6 fields: a
 * `diagnosis` (why the reading that produced this failure was wrong)
 * and a `reading` reference (the section to study after the failure);
 * both feed miss-card emission.
 *
 * Specs: `docs/specs/modeling-gym.spec.md`,
 * `docs/specs/learning-design.spec.md` (C1, C6).
 */

/** The barwise ORM proficiency scale (learning-design), in order. */
export const PROFICIENCY_LEVELS = [
  "naive",
  "novice",
  "initiate",
  "apprentice",
  "journeyman",
  "expert",
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

/** The proficiency transition an exercise serves (learning-design C1). */
export interface GymTransition {
  readonly from: ProficiencyLevel;
  readonly to: ProficiencyLevel;
}

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
 * Learner-facing guidance a check may carry (learning-design C6):
 *
 * - `hint` -- a nudge toward the fix, shown on failure (and on a miss
 *   card's front).
 * - `diagnosis` -- why the reading that produced the failure was wrong;
 *   revealed after the failure and carried on a miss card's back.
 * - `reading` -- the fine-grained section to study after this failure
 *   (a miss card's back reference). Never a prerequisite.
 */
export interface CheckGuidance {
  readonly hint?: string;
  readonly diagnosis?: string;
  readonly reading?: string;
}

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
  | ({ readonly kind: "must_validate"; } & CheckGuidance)
  | ({ readonly kind: "requires_verbalization"; readonly sentence: string; } & CheckGuidance)
  | (
    & {
      readonly kind: "forbids_population";
      /** Name of the fact type in the reference model that carries the constraint. */
      readonly factType: string;
      /** The kind of constraint on that fact type whose forbidden population motivates the check. */
      readonly constraint: ConstraintKind;
    }
    & CheckGuidance
  )
  | ({ readonly kind: "requires_element"; readonly element: ElementQuery; } & CheckGuidance);

/** An exercise as authored in a `.gym.yaml` file. */
export interface GymExercise {
  readonly id: string;
  readonly title: string;
  /** Learning-design C1: the transition this exercise serves. */
  readonly transition: GymTransition;
  /** Learning-design C1: what the learner can observably do afterwards. */
  readonly exitPerformance: string;
  /** The domain prompt shown to the learner. */
  readonly brief: string;
  /**
   * Optional exercise-level reading for a pre-session skim. The gym
   * states plainly that skimming is welcome and deep reading is not
   * expected before attempting (learning-design C6).
   */
  readonly reading?: string;
  /** Optional path (relative to the exercise file) to a partial starter model. */
  readonly starter?: string;
  /** Path (relative to the exercise file) to one valid answer. Backs `forbids_population`. */
  readonly reference?: string;
  readonly checks: readonly GymCheck[];
}
