import { isValueConstraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import { dataTypeOf, valueConstraintOf } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";
import {
  mintAllowedValue,
  mintValueOfType,
  type ValueDomain,
  valueDomainPredicate,
} from "../model/valueDomain.js";

/**
 * Deterministic placeholder-value minting for counterexample populations.
 *
 * Every value here is a pure function of the role, its player, and an
 * index -- no randomness, no clock -- so generated counterexamples are
 * referentially transparent (same model in, identical output out).
 */

/**
 * The whole value domain a role-level constraint declares, if any.
 *
 * The WHOLE domain, enumeration and ranges together. This used to
 * return only the enumeration and only when it was non-empty, so a
 * range-only constraint read as "no constraint" and the caller minted a
 * player-named token the range forbids (barwise-959).
 */
function roleValueDomain(roleId: string, factType: FactType): ValueDomain | undefined {
  for (const c of factType.constraints) {
    if (isValueConstraint(c) && c.roleId === roleId) return c;
  }
  return undefined;
}

/** The display name of the object type that plays a role. */
export function playerName(role: Role, model: OrmModel): string {
  return model.getObjectType(role.playerId)?.name ?? "Value";
}

/**
 * A stable placeholder value for a role at a given index. Within a role's
 * value-constraint domain when one exists and a value can be constructed
 * from it; otherwise a player-named token like `Customer#1`.
 *
 * The fallback is reached only when the role declares no domain, or when
 * `mintAllowedValue` cannot construct one from the ranges it declares --
 * not, as before, whenever the domain happened to be expressed as a
 * range rather than an enumeration.
 */
export function mintValue(
  role: Role,
  factType: FactType,
  model: OrmModel,
  index: number,
): string {
  // Three sources, narrowest first. A role-level constraint is the most
  // specific statement about this role; the player's own value
  // constraint governs every role it plays; its data type is the
  // weakest of the three. Each was a separate way for a filler value to
  // break a rule the probe was not about (barwise-959, and then
  // barwise-945's new rules made the player-level half visible).
  const roleDomain = roleValueDomain(role.id, factType);
  const fromRole = roleDomain === undefined ? undefined : mintAllowedValue(roleDomain, index);
  if (fromRole !== undefined) return fromRole;

  const player = model.getObjectType(role.playerId);
  if (player !== undefined) {
    const playerDomain = valueConstraintOf(player);
    const fromPlayer = playerDomain === undefined
      ? undefined
      : mintAllowedValue(playerDomain, index);
    if (fromPlayer !== undefined) return fromPlayer;

    const dataType = dataTypeOf(player);
    const fromType = dataType === undefined ? undefined : mintValueOfType(dataType.name, index);
    if (fromType !== undefined) return fromType;
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
 * applies, so the two cannot answer differently.
 *
 * Two arms, and the split is where the totality argument lives. Against
 * an enumeration alone the suffix family is exhaustive: the candidates
 * are distinct and there is one more of them than the enumeration has
 * entries, so one of them must escape. That case therefore never returns
 * undefined, and mints the same token it always did.
 *
 * A range cannot be escaped by suffixing -- every suffix of a
 * player-named token sits on the same side of a bound -- so the second
 * arm reaches past the bounds instead, from either side and both
 * lexically and numerically. That arm is a fixed list rather than a
 * search, and a domain admitting all of it may still forbid something
 * this function will not find. Returning undefined then means the caller
 * emits no counterexample, which is the safe direction: an unbounded
 * range genuinely forbids nothing, and under-generating a probe costs
 * less than claiming the model forbids a value it accepts.
 */
export function mintInvalidValue(
  domain: ValueDomain,
  role: Role,
  model: OrmModel,
): string | undefined {
  const allowed = valueDomainPredicate(domain);
  const base = `${playerName(role, model)}#invalid`;

  for (let i = 0; i <= domain.values.length; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    if (!allowed(candidate)) return candidate;
  }

  return [
    // Sorts below every digit and letter, and above every letter: between
    // them these clear a range bounded on one side under lexical
    // comparison, whichever side it is bounded on.
    `!${base}`,
    `~${base}`,
    // Numeric extremes, for a range whose bounds and value both parse as
    // numbers and are therefore compared numerically.
    "-1e308",
    "1e308",
  ].find((candidate) => !allowed(candidate));
}
