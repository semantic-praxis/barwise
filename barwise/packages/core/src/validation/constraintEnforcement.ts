import type { Constraint } from "../model/Constraint.js";
import {
  isDisjunctiveMandatory,
  isExternalUniqueness,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isValueConstraint,
} from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Diagnostic } from "./Diagnostic.js";
import {
  disjunctiveMandatoryViolationsFor,
  mandatoryViolationsFor,
} from "./rules/population/mandatory.js";
import { ringViolationsFor } from "./rules/population/ring.js";
import {
  externalUniquenessViolationsFor,
  uniquenessViolationsFor,
} from "./rules/population/uniqueness.js";
import {
  frequencyViolationsFor,
  valueConstraintViolationsFor,
} from "./rules/population/valueFrequency.js";

/**
 * What one constraint says about the model's population.
 *
 * A discriminated union, because "this predicate cannot answer for that kind"
 * and "this constraint is satisfied" are different answers, and collapsing
 * them is how a check with no reachable failure path is born -- the
 * barwise-902 shape. A caller that only reads a boolean cannot tell them
 * apart; one that must read `enforced` first cannot help but.
 */
export type EnforcementVerdict =
  | {
    readonly enforced: true;
    /** True when the population violates this constraint. */
    readonly rejects: boolean;
    readonly diagnostics: readonly Diagnostic[];
  }
  | { readonly enforced: false; };

/**
 * Does THIS constraint reject THIS model's population?
 *
 * The question `forbids_population` has always been asking, finally askable.
 * Before this, the only surface was `ValidationEngine.validate(model)` -- a
 * flat model-wide array in which the answer is not distinguishable from every
 * other rule firing at once -- so `@barwise/learn` reconstructed it from a
 * kind-to-rule-id map, a fact-type attribution step, and a before/after
 * multiset delta. Three layers of compensation for asking the wrong
 * interface (barwise-904).
 *
 * Each branch delegates to the same helper the model-wide sweep uses, so the
 * two cannot answer differently; only the ORDER of the model-wide array
 * depends on which loop is outer, and that array is untouched.
 *
 * `model` is required and not an oversight: `buildObjectUniverse` is
 * closed-world over every population, so enforcement is not decidable from a
 * constraint and its fact type alone.
 */
export function evaluateConstraintEnforcement(
  model: OrmModel,
  factType: FactType,
  constraint: Constraint,
): EnforcementVerdict {
  const diagnostics = violationsFor(model, factType, constraint);
  if (diagnostics === undefined) return { enforced: false };
  return { enforced: true, rejects: diagnostics.length > 0, diagnostics };
}

/**
 * `undefined` means this predicate has no per-constraint form for that kind
 * -- NOT that the constraint passed, and not that nothing checks it. Several
 * of the uncovered kinds (subset, equality, exclusion, cardinality, the join
 * and spanning families) are checked by the model-wide sweep; they simply
 * have no extracted per-constraint entry, because extracting one with no
 * caller to prove it right is how an export survives two years unused
 * (barwise-811). Reporting `rejects: false` for them would be a lie about a
 * question that was never asked, which is why the caller has to discriminate.
 *
 * The seven below are what `forbids_population` needs: its five kinds, plus
 * the two spanning forms (`external_uniqueness`, `disjunctive_mandatory`)
 * that a candidate model can present where the reference used a simpler one.
 */
function violationsFor(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
): Diagnostic[] | undefined {
  if (isInternalUniqueness(c)) return uniquenessViolationsFor(model, ft.id, c);
  if (isExternalUniqueness(c)) return externalUniquenessViolationsFor(model, ft, c);
  if (isMandatoryRole(c)) return mandatoryViolationsFor(model, ft, c);
  if (isDisjunctiveMandatory(c)) return disjunctiveMandatoryViolationsFor(model, ft, c);
  if (isValueConstraint(c)) return valueConstraintViolationsFor(model, ft.id, c);
  if (isFrequency(c)) return frequencyViolationsFor(model, ft.id, c);
  if (isRing(c)) return ringViolationsFor(model, ft.id, c);
  return undefined;
}
