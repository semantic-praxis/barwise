import { isValueConstraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";
import { type ValueDomain, valueDomainPredicate } from "../model/valueDomain.js";

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

/**
 * A stable value the given domain forbids, or undefined when no candidate
 * this function knows how to build is forbidden.
 *
 * The domain is the whole value constraint, not just its enumeration: a
 * constraint carrying ranges admits values the enumeration does not list,
 * and minting against the enumeration alone produced counterexamples the
 * model in fact permitted (barwise-958). Every candidate is checked with
 * `valueDomainPredicate`, the same predicate population validation
 * applies, so
 * the two cannot answer differently.
 *
 * The candidates are a fixed short list rather than a search. The first
 * family is the player-named token the enumeration-only case has always
 * produced, so a constraint with no ranges mints exactly what it did
 * before; the rest reach past a range's bounds from either side, lexically
 * and numerically. A domain that admits all of them admits so much that
 * saying what it forbids is not useful -- typically an unbounded range,
 * which forbids nothing at all -- and undefined means the caller emits no
 * counterexample. Under-generating a probe is safe; claiming the model
 * forbids a value it accepts is not.
 */
export function mintInvalidValue(
  domain: ValueDomain,
  role: Role,
  model: OrmModel,
): string | undefined {
  const base = `${playerName(role, model)}#invalid`;
  const candidates = [
    base,
    `${base}-1`,
    `${base}-2`,
    // Sorts below every digit and letter, and above every letter: between
    // them these clear a range bounded on one side under lexical
    // comparison, whichever side it is bounded on.
    `!${base}`,
    `~${base}`,
    // Numeric extremes, for a range whose bounds and value both parse as
    // numbers and are therefore compared numerically.
    "-1e308",
    "1e308",
  ];
  const allowed = valueDomainPredicate(domain);
  return candidates.find((candidate) => !allowed(candidate));
}
