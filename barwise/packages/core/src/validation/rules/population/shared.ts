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
 *
 * A value is credited to the role's player AND to every supertype
 * reachable through identification-sharing subtype links: "every
 * Employee is also a Person" is definitional in ORM, and a subtype
 * whose `providesIdentification` is true names its instances in the
 * supertype's value space, so a Manager recorded managing a department
 * exists as an Employee too. A link with an independent identifier
 * breaks the chain -- the value spaces differ, so the credit would
 * assert an identity nothing established. Witnessing flows up only:
 * whether an Employee value is also a Manager is not decidable from a
 * population and is not attempted
 * (docs/specs/mandatory-existence-witness.spec.md).
 */
export function buildObjectUniverse(model: OrmModel): Map<string, Set<string>> {
  const universe = new Map<string, Set<string>>();
  const credit = (typeId: string, value: string): void => {
    let values = universe.get(typeId);
    if (!values) {
      values = new Set();
      universe.set(typeId, values);
    }
    values.add(value);
  };
  for (const pop of model.populations) {
    if (pop.sample) continue;
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;
    for (const inst of pop.instances) {
      for (const role of ft.roles) {
        const value = inst.roleValues[role.id];
        if (value === undefined) continue;
        for (const typeId of identificationSharingAncestry(model, role.playerId)) {
          credit(typeId, value);
        }
      }
    }
  }
  return universe;
}

/**
 * The player itself plus every supertype reachable through
 * `providesIdentification` subtype links, cycle-guarded. Shared by the
 * universe above and the counterexample generator's anchor search --
 * two answers to "who does this value witness" would be the drift this
 * function exists to prevent.
 */
export function identificationSharingAncestry(
  model: OrmModel,
  playerId: string,
): readonly string[] {
  const seen = new Set<string>([playerId]);
  const chain = [playerId];
  for (let i = 0; i < chain.length; i++) {
    for (const sf of model.subtypeFacts) {
      if (sf.subtypeId !== chain[i] || !sf.providesIdentification) continue;
      if (seen.has(sf.supertypeId)) continue;
      seen.add(sf.supertypeId);
      chain.push(sf.supertypeId);
    }
  }
  return chain;
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
