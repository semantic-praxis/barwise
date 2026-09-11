import { isValueConstraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import { type ConceptualDataTypeName, dataTypeOf, valueConstraintOf } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";
import {
  allowedValueCandidates,
  dataTypeAdmits,
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
 * One place a minted value has to be admissible: a role, in the fact
 * type that declares it.
 *
 * A counterexample often puts ONE value in several roles at once -- that
 * is the whole shape of an exclusion, exclusive-or, subset or equality
 * probe, and of the anchor population a mandatory probe builds in
 * another fact type. Those roles need not share a player, so the value
 * has to clear all of their domains and not just the first one's.
 */
export interface RolePlacement {
  readonly role: Role;
  readonly ft: FactType;
}

/**
 * Every domain that governs what a placement admits, narrowest first.
 *
 * Three of them, and a value has to satisfy ALL of them: the role's own
 * value constraint is the most specific statement about this role, the
 * player's value constraint governs every role it plays, and the
 * player's data type is the weakest of the three.
 */
function placementDomains(
  { role, ft }: RolePlacement,
  model: OrmModel,
): {
  readonly domains: readonly ValueDomain[];
  readonly dataType: ConceptualDataTypeName | undefined;
} {
  const domains: ValueDomain[] = [];
  const roleDomain = roleValueDomain(role.id, ft);
  if (roleDomain !== undefined) domains.push(roleDomain);

  const player = model.getObjectType(role.playerId);
  const playerDomain = player === undefined ? undefined : valueConstraintOf(player);
  if (playerDomain !== undefined) domains.push(playerDomain);

  const dataType = player === undefined ? undefined : dataTypeOf(player)?.name;
  return { domains, dataType };
}

/**
 * A stable placeholder value admissible in EVERY given placement, when
 * one can be constructed, and otherwise the first placement's own best
 * answer.
 *
 * THE CONJUNCTION IS THE POINT, twice over. Along one axis a single role
 * is governed by three layers -- its value constraint, its player's, and
 * its player's data type -- and each used to be consulted alone, the
 * first that produced anything winning, with the winner never shown to
 * the other two. A value type declaring `decimal` and enumerating
 * {v1, v2} over a range of "at most 10" minted "v1", which its own
 * enumeration admits and its own data type rejects, and the probe then
 * reported `population/value-type-data-type-violation` beside the rule
 * it was about. Along the other axis a probe places one value in several
 * roles, and minting it from the first role alone leaves the rest to
 * chance.
 *
 * Fixing this layer by layer is how the defect keeps coming back --
 * barwise-959 for the role layer, then barwise-945's new rules exposing
 * the player layer. Asking once, of everything that applies, is what
 * stops the next layer from repeating it (barwise-995).
 *
 * The fallback is reached only when NO candidate satisfies everything,
 * which means the placements are jointly contradictory: an enumeration
 * whose members are not of the declared data type admits nothing at all,
 * and two roles whose players have disjoint domains share no value.
 * Nothing this function can mint is right there, so it mints what it
 * always did and leaves the contradiction visible rather than hiding it
 * behind a value chosen for no reason.
 */
export function mintValueForAll(
  // A NON-EMPTY tuple, so "no placements" is not a case any caller has
  // to handle or this function has to refuse at run time.
  placements: readonly [RolePlacement, ...RolePlacement[]],
  model: OrmModel,
  index: number,
): string {
  const layered = placements.map((p) => placementDomains(p, model));
  const predicates = layered.flatMap((l) => l.domains.map(valueDomainPredicate));
  const dataTypes = layered.flatMap((l) => (l.dataType === undefined ? [] : [l.dataType]));
  const admitsAll = (val: string): boolean =>
    predicates.every((p) => p(val)) && dataTypes.every((t) => dataTypeAdmits(t, val));

  const candidates = [
    ...layered.flatMap((l) => l.domains.flatMap((d) => allowedValueCandidates(d, index))),
    ...dataTypes.flatMap((t) => {
      const v = mintValueOfType(t, index);
      return v === undefined ? [] : [v];
    }),
    ...placements.map((p) => `${playerName(p.role, model)}#${index + 1}`),
  ];

  const agreed = candidates.find(admitsAll);
  if (agreed !== undefined) return agreed;

  // Nothing clears every placement. Answer for the first one alone,
  // narrowest layer first, which is what this function did before it
  // asked them together.
  const first = placements[0];
  const { domains, dataType } = placementDomains(first, model);
  for (const domain of domains) {
    const fallback = allowedValueCandidates(domain, index).find(valueDomainPredicate(domain));
    if (fallback !== undefined) return fallback;
  }
  const fromType = dataType === undefined ? undefined : mintValueOfType(dataType, index);
  return fromType ?? `${playerName(first.role, model)}#${index + 1}`;
}

/** `mintValueForAll` for the common case of a value used in one role. */
export function mintValue(
  role: Role,
  factType: FactType,
  model: OrmModel,
  index: number,
): string {
  return mintValueForAll([{ role, ft: factType }], model, index);
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
