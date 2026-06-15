import { isValueConstraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";

/**
 * Deterministic placeholder-value minting for counterexample populations.
 *
 * Every value here is a pure function of the role, its player, and an
 * index -- no randomness, no clock -- so generated counterexamples are
 * referentially transparent (same model in, identical output out).
 */

/** Allowed values declared by a role-level value constraint, if any. */
function roleAllowedValues(
  roleId: string,
  factType: FactType,
): readonly string[] | undefined {
  for (const c of factType.constraints) {
    if (isValueConstraint(c) && c.roleId === roleId && c.values.length > 0) {
      return c.values;
    }
  }
  return undefined;
}

/** The display name of the object type that plays a role. */
export function playerName(role: Role, model: OrmModel): string {
  return model.getObjectType(role.playerId)?.name ?? "Value";
}

/**
 * A stable placeholder value for a role at a given index. Within a role's
 * value-constraint domain when one exists; otherwise a player-named token
 * like `Customer#1`.
 */
export function mintValue(
  role: Role,
  factType: FactType,
  model: OrmModel,
  index: number,
): string {
  const allowed = roleAllowedValues(role.id, factType);
  const fromDomain = allowed?.[index % allowed.length];
  if (fromDomain !== undefined) {
    return fromDomain;
  }
  return `${playerName(role, model)}#${index + 1}`;
}

/** A stable value guaranteed to fall outside the given allowed set. */
export function mintInvalidValue(
  values: readonly string[],
  role: Role,
  model: OrmModel,
): string {
  const set = new Set(values);
  const base = `${playerName(role, model)}#invalid`;
  let candidate = base;
  let i = 1;
  while (set.has(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  return candidate;
}
