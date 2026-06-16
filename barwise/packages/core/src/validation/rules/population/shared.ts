import type { OrmModel } from "../../../model/OrmModel.js";
import type { FactInstance } from "../../../model/Population.js";

/**
 * The universe of an object type: every distinct value that appears in any
 * role played by that type across all of the model's populations. This is
 * the closed-world set of "instances that exist" for cross-fact-type
 * mandatory checks.
 */
export function buildObjectUniverse(model: OrmModel): Map<string, Set<string>> {
  const universe = new Map<string, Set<string>>();
  for (const pop of model.populations) {
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
