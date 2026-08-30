import { inferExternalUniquenessJoin } from "../../../externalUniqueness.js";
import type { Constraint, InternalUniquenessConstraint } from "../../../model/Constraint.js";
import { isExternalUniqueness, isInternalUniqueness } from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Population } from "../../../model/Population.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { makeCompositeKey, severityForModality } from "./shared.js";

/**
 * Internal uniqueness constraints require that the combination of values
 * for the specified roles is unique across all instances in the population.
 */
export function checkUniquenessViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const uniquenessConstraints = ft.constraints.filter(isInternalUniqueness);
    for (const uc of uniquenessConstraints) {
      diagnostics.push(...uniquenessViolationsIn(pop, uc));
    }
  }

  return diagnostics;
}

/**
 * One constraint against ONE population. Shared by the model-wide sweep
 * above and by the per-constraint entry point below, so the two cannot
 * answer differently -- the reason `evaluateConstraintEnforcement` does not
 * simply re-run the sweep and filter its output (barwise-904).
 */
function uniquenessViolationsIn(
  pop: Population,
  uc: InternalUniquenessConstraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, string>(); // composite key -> first instance id

  for (const inst of pop.instances) {
    const key = makeCompositeKey(inst, uc.roleIds);
    const firstId = seen.get(key);
    if (firstId) {
      diagnostics.push({
        severity: severityForModality(uc),
        message: `Population "${pop.id}": instance "${inst.id}" violates `
          + `internal uniqueness constraint on role(s) [${uc.roleIds.join(", ")}]. `
          + `Duplicate of instance "${firstId}".`,
        elementId: pop.id,
        ruleId: "population/uniqueness-violation",
      });
    } else {
      seen.set(key, inst.id);
    }
  }
  return diagnostics;
}

/**
 * Does this one internal uniqueness constraint reject the model's population?
 *
 * The model-wide sweep keeps its own loop order (population, then
 * constraint); this walks the same work the other way round. Both call
 * `uniquenessViolationsIn`, so a fact type with two populations cannot make
 * them disagree -- only the ORDER of the model-wide array depends on which
 * loop is outer, and that array is untouched.
 */
export function uniquenessViolationsFor(
  model: OrmModel,
  factTypeId: string,
  uc: InternalUniquenessConstraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pop of model.populations) {
    if (pop.factTypeId !== factTypeId) continue;
    diagnostics.push(...uniquenessViolationsIn(pop, uc));
  }
  return diagnostics;
}
/**
 * External uniqueness: the combination of constrained role values is unique
 * per common object (the inferred join key). Two distinct common instances
 * with the same combination violate it. Skips when the join key is not a
 * single clear object type.
 */
export function checkExternalUniquenessViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      diagnostics.push(...externalUniquenessViolationsIn(model, ft, c));
    }
  }
  return diagnostics;
}

/** One external uniqueness constraint. Its roles span fact types, so the
 * join is inferred from the constraint rather than from one fact type
 * (barwise-904). Shared by the sweep and the per-constraint entry. */
function externalUniquenessViolationsIn(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isExternalUniqueness(c)) return diagnostics;
  const join = inferExternalUniquenessJoin(c.roleIds, model);
  if (!join) return diagnostics;

  // Per fact type: common-object value -> constrained value.
  const constrainedByCommon = new Map<string, Map<string, string>>();
  for (const jft of join.factTypes) {
    const keyRole = join.keyRoleByFactType.get(jft.id)!;
    const constrainedRole = join.constrainedRoleByFactType.get(jft.id)!;
    const map = new Map<string, string>();
    for (const pop of model.populations) {
      if (pop.factTypeId !== jft.id) continue;
      for (const inst of pop.instances) {
        const common = inst.roleValues[keyRole];
        const constrained = inst.roleValues[constrainedRole];
        if (common !== undefined && constrained !== undefined) {
          map.set(common, constrained);
        }
      }
    }
    constrainedByCommon.set(jft.id, map);
  }

  const commonValues = new Set<string>();
  for (const map of constrainedByCommon.values()) {
    for (const v of map.keys()) commonValues.add(v);
  }

  const seen = new Map<string, string>(); // combination tuple -> first common value
  for (const common of commonValues) {
    const parts: string[] = [];
    let complete = true;
    for (const jft of join.factTypes) {
      const value = constrainedByCommon.get(jft.id)!.get(common);
      if (value === undefined) {
        complete = false;
        break;
      }
      parts.push(value);
    }
    if (!complete) continue;

    const tuple = parts.join("\0");
    const first = seen.get(tuple);
    if (first !== undefined && first !== common) {
      diagnostics.push({
        severity: severityForModality(c),
        message: `External uniqueness constraint is violated: "${common}" and `
          + `"${first}" share the same combination [${parts.join(", ")}].`,
        elementId: c.id ?? ft.id,
        ruleId: "population/external-uniqueness-violation",
      });
    } else if (first === undefined) {
      seen.set(tuple, common);
    }
  }
  return diagnostics;
}

/** Does this one external uniqueness constraint reject the model's population? */
export function externalUniquenessViolationsFor(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
): Diagnostic[] {
  return externalUniquenessViolationsIn(model, ft, c);
}
