import type { ConstraintModality } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { FactInstance } from "../../../model/Population.js";
import type { DiagnosticSeverity } from "../../Diagnostic.js";

/**
 * The severity of a constraint violation given its modality: an alethic
 * constraint is a logical necessity, so a violation is an `error`; a
 * deontic constraint is an obligation, so a violation is a `warning`.
 */
export function severityForModality(
  c: { readonly modality?: ConstraintModality; },
): DiagnosticSeverity {
  return c.modality === "deontic" ? "warning" : "error";
}

/**
 * The universe of an object type: every distinct value that appears in any
 * role played by that type across the model's *significant* populations.
 * This is the closed-world set of "instances that exist" for cross-fact-type
 * mandatory checks.
 *
 * Sample populations are excluded, and that exclusion is the whole of the
 * open-world story -- the rules that ask "does everything that exists
 * satisfy X" (mandatory, disjunctive mandatory, cardinality, spanning,
 * join paths) all reach existence through this function, while the rules
 * that judge data already present (uniqueness, exclusion, value and ring
 * constraints) read the populations directly and are untouched.
 *
 * That split is the intended semantics, stated once: **a sample is
 * positive evidence only.** It can satisfy a constraint but never creates
 * the obligation that one be satisfied. Note that `valuesPlayedInRole`
 * deliberately still counts sample instances -- a sample may discharge an
 * obligation raised by a significant population, just never raise one.
 *
 * Treating extracted samples as complete is what reported a mandatory
 * violation for every entity a transcript merely mentioned in passing
 * (docs/specs/sample-populations.spec.md).
 */
export function buildObjectUniverse(model: OrmModel): Map<string, Set<string>> {
  const universe = new Map<string, Set<string>>();
  for (const pop of model.populations) {
    if (pop.sample) continue;
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;
    for (const inst of pop.instances) {
      for (const role of ft.roles) {
        const value = inst.roleValues[role.id];
        if (value === undefined) continue;
        let values = universe.get(role.playerId);
        if (!values) {
          values = new Set();
          universe.set(role.playerId, values);
        }
        values.add(value);
      }
    }
  }
  return universe;
}
/** The set of values appearing in a given role across all populations. */
export function valuesPlayedInRole(model: OrmModel, roleId: string): Set<string> {
  const values = new Set<string>();
  for (const pop of model.populations) {
    for (const inst of pop.instances) {
      const value = inst.roleValues[roleId];
      if (value !== undefined) values.add(value);
    }
  }
  return values;
}
/** Build a model-wide map of role id to the id of the type that plays it. */
export function rolePlayerMap(model: OrmModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      map.set(role.id, role.playerId);
    }
  }
  return map;
}
/** All composite-key tuples for a role sequence across all populations. */
export function tuplesForRoleSeq(model: OrmModel, roleIds: readonly string[]): Set<string> {
  const tuples = new Set<string>();
  for (const pop of model.populations) {
    for (const inst of pop.instances) {
      if (roleIds.every((rid) => inst.roleValues[rid] !== undefined)) {
        tuples.add(makeCompositeKey(inst, roleIds));
      }
    }
  }
  return tuples;
}
/**
 * Create a composite key from an instance's values for the given role ids.
 * Used for uniqueness checking.
 */
export function makeCompositeKey(
  inst: FactInstance,
  roleIds: readonly string[],
): string {
  return roleIds.map((rid) => inst.roleValues[rid] ?? "").join("\0");
}
