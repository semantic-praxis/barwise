/**
 * The tutorial step format (modeling-tutorial spec, workstream 1).
 *
 * A tutorial is an authored, CSDP-ordered sequence of steps. Each step
 * carries the model snapshot the learner reaches, a motivation (a
 * generated counterexample or authored prose), the concept text, and
 * the links that make the narrative a graph: what the step builds on,
 * what it unlocks, and where to drill (deck) or practice (gym).
 *
 * Front matter carries the learning-design C1 declaration: the
 * proficiency transition the tutorial serves and the observable
 * exit performance.
 */
import type { OrmModel } from "@barwise/core";

/** The proficiency transition a tutorial serves (learning-design C1). */
export interface TutorialTransition {
  readonly from: string;
  readonly to: string;
}

/**
 * How a step is motivated, always shown before the concept
 * (generation-first, learning-design C5):
 *
 * - "counterexample": the hook is generated at build time -- the minimal
 *   population this step's named constraint forbids, which the prior
 *   step's model still allowed.
 * - "prose": authored motivation, the escape hatch for steps whose
 *   generated hook would not teach well (the render marks which kind
 *   was used, so the gap stays visible).
 */
export type TutorialMotivation =
  | { readonly kind: "counterexample"; readonly constraintId: string; }
  | { readonly kind: "prose"; readonly text: string; };

/** One authored tutorial step, as parsed from the tutorial file. */
export interface TutorialStepDef {
  readonly id: string;
  /** The CSDP step this tutorial step enacts (Halpin & Morgan ch. 3-7). */
  readonly csdpStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly title: string;
  /** Path to the .orm.yaml snapshot the learner reaches AFTER this step. */
  readonly model: string;
  readonly motivation: TutorialMotivation;
  /** The teaching text, shown after the motivation. */
  readonly concept: string;
  /** Ids of steps this one depends on (backward references). */
  readonly buildsOn: readonly string[];
  /** Ids of steps this one enables (forward references). */
  readonly unlocks: readonly string[];
  /** Deck subdeck that drills this step, e.g. "ORM 2::Constraints I". */
  readonly deck?: string;
  /** Gym exercise id that practices this step. */
  readonly gym?: string;
}

/** A parsed tutorial: front matter plus its ordered steps. */
export interface TutorialDef {
  readonly id: string;
  readonly title: string;
  /** Learning-design C1: the transition this tutorial serves. */
  readonly transition: TutorialTransition;
  /** Learning-design C1: the observable exit performance. */
  readonly exitPerformance: string;
  /** Authored introduction rendered before the first step. */
  readonly intro: string;
  readonly steps: readonly TutorialStepDef[];
}

/** A step with its model snapshot loaded. */
export interface LoadedTutorialStep extends TutorialStepDef {
  readonly modelInstance: OrmModel;
}

/** A tutorial with every step's model snapshot loaded. */
export interface LoadedTutorial extends Omit<TutorialDef, "steps"> {
  readonly steps: readonly LoadedTutorialStep[];
}
