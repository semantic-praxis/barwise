import { inferExternalUniquenessJoin } from "../externalUniqueness.js";
import {
  type Constraint,
  type DisjunctiveMandatoryConstraint,
  type EqualityConstraint,
  type ExclusionConstraint,
  type ExclusiveOrConstraint,
  type ExternalUniquenessConstraint,
  type FrequencyConstraint,
  type InternalUniquenessConstraint,
  type MandatoryRoleConstraint,
  RING_PROPERTIES,
  type RingConstraint,
  type RingProperty,
  type SubsetConstraint,
  type ValueConstraint,
} from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { Population } from "../model/Population.js";
import type { Role } from "../model/Role.js";
import { assertNever } from "../util/assertNever.js";
import { identificationSharingAncestry } from "../validation/rules/population/shared.js";
import { describeValueRange } from "../verbalization/constraints/phase1.js";
import {
  kwSeg,
  textSeg,
  valSeg,
  type VerbalizationSegment,
} from "../verbalization/Verbalization.js";
import type { Counterexample } from "./Counterexample.js";
import { mintInvalidValue, mintValue, mintValueForAll, playerName } from "./values.js";

type RoleValues = Record<string, string>;

/**
 * Generate a counterexample for every constraint in the model that has
 * one. A counterexample is the minimal population a constraint forbids;
 * it is the deterministic inverse of population validation.
 *
 * Covers the intra-fact-type constraints (internal uniqueness, value,
 * frequency, ring) and the cross-fact-type ones (mandatory, disjunctive
 * mandatory, exclusion, exclusive-or, subset, equality, external
 * uniqueness). External uniqueness is skipped only when its join key
 * cannot be inferred as a single clear common object type.
 */
export function generateCounterexamples(model: OrmModel): Counterexample[] {
  const result: Counterexample[] = [];
  for (const [constraint, factType] of model.everyConstraint()) {
    const ce = generateInView(constraint, factType, model);
    if (ce) result.push(ce);
  }
  return result;
}

/**
 * The counterexamples for a view of one fact type: those probing a
 * constraint that applies to it, so a constraint across fact types is
 * probed under every fact type it touches, as the verbalization of that
 * fact type says it. A counterexample's `factTypeIds` are the fact types
 * holding its constraint's roles, which is the same set
 * `OrmModel.constraintsTouching` reads.
 */
export function counterexamplesTouching(
  factTypeId: string,
  counterexamples: readonly Counterexample[],
): Counterexample[] {
  return counterexamples.filter((ce) => ce.factTypeIds.includes(factTypeId));
}

/**
 * Generate the counterexample for a single constraint, if one exists.
 * `factType` is the fact type an internal constraint lives in; a
 * constraint across fact types belongs to none, and its generator is not
 * handed one, as `ConstraintVerbalizer.verbalize` ignores it.
 */
export function generateCounterexampleForConstraint(
  constraint: Constraint,
  factType: FactType,
  model: OrmModel,
): Counterexample | undefined {
  return generateInView(constraint, factType, model);
}

/**
 * The dispatch. Only the kinds that live in a fact type are handed `ft`;
 * it is undefined for a constraint across fact types from
 * `everyConstraint`, which those kinds never read.
 *
 * A switch rather than the chain of `is*` guards this used to be: eleven
 * guards covered eleven of the sixteen constraint kinds and the five
 * without one fell through to the same `return undefined` a guard that
 * simply failed to match produces, so a kind added to the union got no
 * counterexample and nothing said so. The five are listed by name below
 * and `assertNever` closes the union, which makes the next kind a compile
 * error here rather than a silent gap (barwise-936).
 *
 * A probe confirmed the gap and its shape before this changed: adding a
 * seventeenth member to `Constraint` failed to compile at six consumers
 * and NOT here, because a guard chain ending in a fallback cannot fail.
 */
function generateInView(
  constraint: Constraint,
  ft: FactType | undefined,
  model: OrmModel,
): Counterexample | undefined {
  switch (constraint.type) {
    case "internal_uniqueness":
      return ft && forUniqueness(constraint, ft, model);
    case "value_constraint":
      return ft && forValue(constraint, ft, model);
    case "frequency":
      return ft && forFrequency(constraint, ft, model);
    case "ring":
      return ft && forRing(constraint, ft, model);
    case "mandatory":
      return ft && forMandatory(constraint, ft, model);
    case "disjunctive_mandatory":
      return forDisjunctive(constraint, model);
    case "exclusion":
      return forExclusion(constraint, model);
    case "exclusive_or":
      return forExclusiveOr(constraint, model);
    case "subset":
      return forSubset(constraint, model);
    case "equality":
      return forEquality(constraint, model);
    case "external_uniqueness":
      return forExternalUniqueness(constraint, model);

    // No generator, deliberately and for two different reasons. A
    // value-comparison or cardinality violation needs values chosen to
    // break an ordering or a count, which the minting helpers here do not
    // do; the three join kinds span fact types along a role path, which
    // this module's one-fact-type population shape cannot express. Listed
    // rather than omitted so the distinction between "no generator yet"
    // and "nobody noticed" is in the code.
    case "value_comparison":
    case "cardinality":
    case "join_subset":
    case "join_equality":
    case "join_exclusion":
      return undefined;

    default:
      return assertNever(constraint);
  }
}

// ---------------------------------------------------------------------------
// Per-constraint generators
// ---------------------------------------------------------------------------

function forUniqueness(
  uc: InternalUniquenessConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const roles = ft.roles;
  if (roles.length === 0) return undefined;

  const constrained = new Set(uc.roleIds);
  const inst1: RoleValues = {};
  const inst2: RoleValues = {};
  for (const role of roles) {
    if (constrained.has(role.id)) {
      const shared = mintValue(role, ft, model, 0);
      inst1[role.id] = shared;
      inst2[role.id] = shared;
    } else {
      // Differ on an unconstrained role so the two facts are distinct yet
      // collide on the constrained role set.
      inst1[role.id] = mintValue(role, ft, model, 0);
      inst2[role.id] = mintValue(role, ft, model, 1);
    }
  }

  const names = uc.roleIds
    .map((rid) => roles.find((r) => r.id === rid))
    .filter((r): r is Role => r !== undefined)
    .map((r) => playerName(r, model));
  const reason = `two facts of ${ft.name} that agree on `
    + `${names.join(", ") || "the constrained role(s)"}`;
  return makeCounterexample(ft, uc, [inst1, inst2], reason, model);
}

function forValue(
  vc: ValueConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  if (!vc.roleId) return undefined; // type-level value constraints have no role to probe
  const role = ft.roles.find((r) => r.id === vc.roleId);
  if (!role) return undefined;

  // Undefined when the constraint's ranges admit every candidate -- an
  // unbounded range forbids nothing, so there is nothing to probe.
  const invalid = mintInvalidValue(vc, role, model);
  if (invalid === undefined) return undefined;

  const inst: RoleValues = {};
  for (const r of ft.roles) {
    inst[r.id] = r.id === vc.roleId ? invalid : mintValue(r, ft, model, 0);
  }

  // The domain is worded the way the constraint verbalizer words it, so a
  // constraint carrying only ranges does not read as "outside {}".
  const domain = [
    ...vc.values,
    ...(vc.ranges ?? []).map((r) => describeValueRange(r)),
  ].join(", ");
  const reason = `${playerName(role, model)} taking a value outside {${domain}}`;
  return makeCounterexample(ft, vc, [inst], reason, model);
}

function forFrequency(
  fc: FrequencyConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  // Counterexamples are generated for single-role frequency; a multi-role
  // (role-sequence) frequency violation is over a value combination and is
  // skipped here.
  if (fc.roleIds.length !== 1) return undefined;
  const roleId = fc.roleIds[0]!;
  const role = ft.roles.find((r) => r.id === roleId);
  if (!role) return undefined;

  const name = playerName(role, model);
  let count: number;
  let reason: string;
  if (fc.max !== "unbounded") {
    count = fc.max + 1; // exceed the upper bound
    reason = `the same ${name} in ${ft.name} more than ${fc.max} time(s)`;
  } else if (fc.min > 1) {
    count = fc.min - 1; // fall short of the lower bound
    reason = `a ${name} in ${ft.name} fewer than ${fc.min} time(s)`;
  } else {
    return undefined; // min <= 1 and unbounded max forbids nothing
  }

  const shared = mintValue(role, ft, model, 0);
  const instances: RoleValues[] = [];
  for (let i = 0; i < count; i++) {
    const inst: RoleValues = {};
    for (const r of ft.roles) {
      inst[r.id] = r.id === roleId ? shared : mintValue(r, ft, model, i);
    }
    instances.push(inst);
  }
  return makeCounterexample(ft, fc, instances, reason, model);
}

/**
 * The smallest population that violates each ring property, as directed
 * pairs over three minted values. One row per property replaces the
 * eight-arm switch that used to spell the same thing out per ring type;
 * the grouped arms it replaced (`case "asymmetric": case "antisymmetric":
 * case "acyclic":` sharing one body) were the algebra showing through.
 */
const RING_WITNESSES: Record<
  RingProperty,
  (a: string, b: string, c: string) => ReadonlyArray<readonly [string, string]>
> = {
  irreflexive: (a) => [[a, a]],
  antisymmetric: (a, b) => [[a, b], [b, a]],
  acyclic: (a, b) => [[a, b], [b, a]],
  symmetric: (a, b) => [[a, b]],
  purely_reflexive: (a, b) => [[a, b]],
  transitive: (a, b, c) => [[a, b], [b, c]],
  intransitive: (a, b, c) => [[a, b], [b, c], [a, c]],
};

function forRing(
  rc: RingConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const r1 = ft.roles.find((r) => r.id === rc.roleId1);
  if (!ft.roles.some((r) => r.id === rc.roleId2) || !r1) return undefined;

  // Both ring roles are played by the same object type; mint from one.
  const a = mintValue(r1, ft, model, 0);
  const b = mintValue(r1, ft, model, 1);
  const c = mintValue(r1, ft, model, 2);
  const pair = (x: string, y: string): RoleValues => {
    const inst: RoleValues = {};
    for (const r of ft.roles) {
      inst[r.id] = r.id === rc.roleId1 ? x : r.id === rc.roleId2 ? y : mintValue(r, ft, model, 0);
    }
    return inst;
  };

  // The witness comes from the ring type's FIRST property (barwise-935).
  // Asymmetric lists antisymmetric first for exactly this reason: the
  // reading ORM 2 gives it is the reverse pair, not the self-loop its
  // other property would yield.
  const instances = RING_WITNESSES[RING_PROPERTIES[rc.ringType][0]](a, b, c)
    .map(([x, y]) => pair(x, y));

  const reason = `a ${rc.ringType.replace(/_/g, " ")} ring violation among `
    + `${playerName(r1, model)} instances`;
  return makeCounterexample(ft, rc, instances, reason, model);
}

// ---------------------------------------------------------------------------
// Cross-fact-type generators
// ---------------------------------------------------------------------------

/**
 * Mandatory: an instance of the player type that exists (plays a role in
 * another fact type) but never plays the mandatory role.
 */
function forMandatory(
  mc: MandatoryRoleConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const role = ft.roles.find((r) => r.id === mc.roleId);
  if (!role) return undefined;
  const anchor = findAnchorRole(model, role.playerId, new Set([mc.roleId]));
  if (!anchor) return undefined;

  // Minted against the anchor role as well as the constrained one: the
  // value has to sit in the anchor's fact type, whose player may declare
  // a narrower domain than this one's.
  const value = mintValueForAll([{ role, ft }, anchor], model, 0);
  const forbidden = anchorPopulation(anchor, value, model);
  const reason = `a ${playerName(role, model)} that exists but never plays `
    + `"${ft.name}"`;
  const rendered = `${value} appears in ${anchor.ft.name} but not in ${ft.name}`;
  return makeCrossCounterexample(model, mc, [forbidden], reason, rendered);
}

/**
 * Disjunctive mandatory: an instance of the common player type that plays
 * none of the required roles.
 */
function forDisjunctive(
  dc: DisjunctiveMandatoryConstraint,
  model: OrmModel,
): Counterexample | undefined {
  const firstId = dc.roleIds[0];
  if (firstId === undefined) return undefined;
  const first = findRoleById(model, firstId);
  if (!first) return undefined;
  const anchor = findAnchorRole(model, first.role.playerId, new Set(dc.roleIds));
  if (!anchor) return undefined;

  const value = mintValueForAll([first, anchor], model, 0);
  const forbidden = anchorPopulation(anchor, value, model);
  const reason = `a ${playerName(first.role, model)} that plays none of the `
    + `required roles`;
  const rendered = `${value} appears in ${anchor.ft.name} but plays none of `
    + `[${dc.roleIds.join(", ")}]`;
  return makeCrossCounterexample(model, dc, [forbidden], reason, rendered);
}

/**
 * Build a forbidden set where one object value plays every one of the
 * given roles, grouping roles by fact type. For a single fact type that
 * is one population; across fact types it is one per fact type.
 */
function valueInAllRoles(
  roleIds: readonly string[],
  model: OrmModel,
): { populations: Population[]; value: string; } | undefined {
  const resolved = roleIds.map((rid) => findRoleById(model, rid));
  if (resolved.some((r) => r === undefined) || resolved.length < 2) return undefined;
  // Every one of these roles receives this same value, so every one of
  // them has a say in what it may be.
  const placements = resolved as AnchorRole[];
  const value = mintValueForAll([placements[0]!, ...placements.slice(1)], model, 0);

  const byFactType = new Map<string, { ft: FactType; roleIds: string[]; }>();
  resolved.forEach((r, i) => {
    let group = byFactType.get(r!.ft.id);
    if (!group) {
      group = { ft: r!.ft, roleIds: [] };
      byFactType.set(r!.ft.id, group);
    }
    group.roleIds.push(roleIds[i]!);
  });

  const populations: Population[] = [];
  for (const { ft, roleIds: rids } of byFactType.values()) {
    const inst: RoleValues = {};
    for (const r of ft.roles) {
      inst[r.id] = mintValue(r, ft, model, 1);
    }
    for (const rid of rids) {
      inst[rid] = value;
    }
    populations.push(new Population({ factTypeId: ft.id, instances: [{ roleValues: inst }] }));
  }
  return { populations, value };
}

/** Exclusion: an object value that plays more than one of the excluded roles. */
function forExclusion(
  ec: ExclusionConstraint,
  model: OrmModel,
): Counterexample | undefined {
  const built = valueInAllRoles(ec.roleIds, model);
  if (!built) return undefined;
  const reason = `an object that plays more than one of the excluded roles`;
  const rendered = `${built.value} plays all ${ec.roleIds.length} excluded roles`;
  return makeCrossCounterexample(model, ec, built.populations, reason, rendered);
}

/** Exclusive-or: an object value that plays more than one of the roles. */
function forExclusiveOr(
  xor: ExclusiveOrConstraint,
  model: OrmModel,
): Counterexample | undefined {
  const built = valueInAllRoles(xor.roleIds, model);
  if (!built) return undefined;
  const reason = `an object that plays more than one of the exclusive-or roles`;
  const rendered = `${built.value} plays all ${xor.roleIds.length} roles (must be one)`;
  return makeCrossCounterexample(model, xor, built.populations, reason, rendered);
}

/**
 * Build a forbidden tuple in one role sequence with no match in the other.
 *
 * Spanning, the two sequences live in different fact types: one tuple in
 * the present side's fact type, and nothing in the absent side's. Local,
 * both live in one fact type (barwise-0od): one fact whose present tuple
 * differs from its absent tuple, so it matches no absent tuple in the same
 * population. Validation checks both shapes across the population
 * (barwise-h2a), so both get a witness.
 */
function forTupleAbsence(
  constraint: Constraint,
  presentRoleIds: readonly string[],
  absentRoleIds: readonly string[],
  model: OrmModel,
): Counterexample | undefined {
  const present = presentRoleIds.map((rid) => findRoleById(model, rid));
  const absent = absentRoleIds.map((rid) => findRoleById(model, rid));
  if (present.some((r) => !r) || absent.some((r) => !r)) return undefined;
  if (presentRoleIds.length === 0) return undefined;
  const presentFt = present[0]!.ft;
  const absentFt = absent[0]!.ft;
  const local = presentFt.id === absentFt.id;

  const inst = local
    ? localWitness(presentFt, presentRoleIds, absentRoleIds, model)
    : factWith(presentFt, [[presentRoleIds, 0]], model);
  if (!inst) return undefined;
  const forbidden = new Population({
    factTypeId: presentFt.id,
    instances: [{ roleValues: inst }],
  });
  const reason = local
    ? `a ${presentFt.name} fact whose [${presentRoleIds.join(", ")}] tuple is not `
      + `also a [${absentRoleIds.join(", ")}] tuple`
    : `a ${presentFt.name} tuple with no match in ${absentFt.name}`;
  const rendered = `a tuple in [${presentRoleIds.join(", ")}] absent from `
    + `[${absentRoleIds.join(", ")}]`;
  return makeCrossCounterexample(model, constraint, [forbidden], reason, rendered);
}

/**
 * How many minted values each side of a local subset or equality tries.
 * A role's domain may admit a single value, which makes index 0 and index
 * 1 mint the same one; a few indices on each side find two tuples that
 * differ whenever the domains allow it.
 */
const LOCAL_WITNESS_TRIES = 4;

/**
 * One fact of `ft` whose present tuple differs from its absent tuple, or
 * undefined when no pair of tried values separates them -- the two
 * sequences are the same roles, or their domains leave one choice each.
 * A role in both sequences takes the present side's value, since one fact
 * holds one value per role.
 */
function localWitness(
  ft: FactType,
  presentRoleIds: readonly string[],
  absentRoleIds: readonly string[],
  model: OrmModel,
): RoleValues | undefined {
  for (let p = 0; p < LOCAL_WITNESS_TRIES; p++) {
    for (let a = 0; a < LOCAL_WITNESS_TRIES; a++) {
      const inst = factWith(ft, [[absentRoleIds, a], [presentRoleIds, p]], model);
      const differs = presentRoleIds.some((rid, i) => inst[rid] !== inst[absentRoleIds[i]!]);
      if (differs) return inst;
    }
  }
  return undefined;
}

/**
 * One fact of `ft`: every role minted at index 1, then each listed role
 * group at its index, later groups overwriting earlier ones.
 */
function factWith(
  ft: FactType,
  groups: readonly (readonly [readonly string[], number])[],
  model: OrmModel,
): RoleValues {
  const inst: RoleValues = {};
  for (const r of ft.roles) inst[r.id] = mintValue(r, ft, model, 1);
  for (const [roleIds, index] of groups) {
    for (const rid of roleIds) {
      const role = ft.roles.find((r) => r.id === rid)!;
      inst[rid] = mintValue(role, ft, model, index);
    }
  }
  return inst;
}

/** Subset: a subset tuple with no superset match. */
function forSubset(sc: SubsetConstraint, model: OrmModel): Counterexample | undefined {
  return forTupleAbsence(sc, sc.subsetRoleIds, sc.supersetRoleIds, model);
}

/** Equality: a tuple on one side with no match on the other. */
function forEquality(eq: EqualityConstraint, model: OrmModel): Counterexample | undefined {
  return forTupleAbsence(eq, eq.roleIds1, eq.roleIds2, model);
}

/**
 * External uniqueness: two distinct common-object instances that share the
 * same identifying combination across the joined fact types. Skipped when
 * the join key cannot be inferred as a single clear common object type.
 */
function forExternalUniqueness(
  euc: ExternalUniquenessConstraint,
  model: OrmModel,
): Counterexample | undefined {
  const join = inferExternalUniquenessJoin(euc.roleIds, model);
  if (!join) return undefined;

  const firstFt = join.factTypes[0];
  if (!firstFt) return undefined;
  const firstKeyRole = firstFt.roles.find((r) => r.id === join.keyRoleByFactType.get(firstFt.id));
  if (!firstKeyRole) return undefined;
  // The same common instance must appear under both values in every fact
  // type, so mint the two keys once and reuse them across the join.
  const common1 = mintValue(firstKeyRole, firstFt, model, 0);
  const common2 = mintValue(firstKeyRole, firstFt, model, 1);

  const forbidden: Population[] = [];
  for (const jft of join.factTypes) {
    const keyRoleId = join.keyRoleByFactType.get(jft.id)!;
    const constrainedRoleId = join.constrainedRoleByFactType.get(jft.id)!;
    const constrainedRole = jft.roles.find((r) => r.id === constrainedRoleId)!;
    const shared = mintValue(constrainedRole, jft, model, 0);
    const inst1: RoleValues = {};
    const inst2: RoleValues = {};
    for (const r of jft.roles) {
      inst1[r.id] = mintValue(r, jft, model, 0);
      inst2[r.id] = mintValue(r, jft, model, 0);
    }
    inst1[keyRoleId] = common1;
    inst2[keyRoleId] = common2;
    inst1[constrainedRoleId] = shared;
    inst2[constrainedRoleId] = shared;
    forbidden.push(
      new Population({
        factTypeId: jft.id,
        instances: [{ roleValues: inst1 }, { roleValues: inst2 }],
      }),
    );
  }

  const reason = `two ${playerName(firstKeyRole, model)} instances sharing the same `
    + `identifying combination`;
  const rendered = `${common1} and ${common2} share the same combination`;
  return makeCrossCounterexample(model, euc, forbidden, reason, rendered);
}

/** A single anchor role in some fact type, used to make an instance exist. */
interface AnchorRole {
  readonly ft: FactType;
  readonly role: Role;
}

/**
 * Find a role that can witness an instance of the type, excluding the
 * given role ids: a role played by the type itself, or -- failing that
 * -- by an identification-sharing descendant, since a Manager recorded
 * anywhere exists as an Employee under the same identifier
 * (docs/specs/mandatory-existence-witness.spec.md). Exact-player
 * anchors win when both exist: the counterexample then reads in the
 * constrained type's own vocabulary, and the preference keeps output
 * stable for every model the widening does not concern.
 */
function findAnchorRole(
  model: OrmModel,
  playerId: string,
  excludeRoleIds: ReadonlySet<string>,
): AnchorRole | undefined {
  let descendant: AnchorRole | undefined;
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      if (excludeRoleIds.has(role.id)) continue;
      if (role.playerId === playerId) return { ft, role };
      if (
        descendant === undefined
        && identificationSharingAncestry(model, role.playerId).includes(playerId)
      ) {
        descendant = { ft, role };
      }
    }
  }
  return descendant;
}

/**
 * The role and its fact type, found by scanning the model.
 *
 * The graph indexes exactly this, and `model-graph-and-id-spaces.spec.md`
 * WS5 listed replacing the scan. It is deliberately still a scan. Using
 * `ModelGraph` would mean adding a `role(id) -> Role | undefined`
 * accessor beside the total `role(id) -> Role`, because counterexample
 * generation is best-effort -- each of the five call sites answers a
 * miss with "no counterexample for this constraint" and moves on, rather
 * than refusing the model, which would also stop it generating
 * counterexamples for the constraints that ARE sound. Widening a
 * deliberately total interface with the fallible accessor it exists to
 * remove is a worse trade than a scan over a few hundred roles, and the
 * repo's DRY rule prefers the small parallel index to the abstraction
 * that makes one side bend.
 *
 * If this ever shows up in a profile, the fix is a local map built once
 * per generation, not a change to `ModelGraph`.
 */
function findRoleById(
  model: OrmModel,
  roleId: string,
): AnchorRole | undefined {
  for (const ft of model.factTypes) {
    const role = ft.roles.find((r) => r.id === roleId);
    if (role) return { ft, role };
  }
  return undefined;
}

/** A population that puts `value` in the anchor role, others minted apart. */
function anchorPopulation(anchor: AnchorRole, value: string, model: OrmModel): Population {
  const inst: RoleValues = {};
  for (const r of anchor.ft.roles) {
    inst[r.id] = r.id === anchor.role.id ? value : mintValue(r, anchor.ft, model, 1);
  }
  return new Population({
    factTypeId: anchor.ft.id,
    instances: [{ roleValues: inst }],
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function makeCounterexample(
  ft: FactType,
  constraint: Constraint,
  instances: readonly RoleValues[],
  reason: string,
  model: OrmModel,
): Counterexample {
  const forbidden = new Population({
    factTypeId: ft.id,
    description: reason,
    instances: instances.map((roleValues) => ({ roleValues })),
  });
  return makeCrossCounterexample(
    model,
    constraint,
    [forbidden],
    reason,
    renderInstances(instances, ft, model),
  );
}

/**
 * Assemble a Counterexample from a set of forbidden populations. Its
 * `factTypeIds` are the fact types its constraint applies to, worked out
 * here once for every kind: an internal constraint's roles all sit in its
 * own fact type, so the one answer covers both placements.
 */
function makeCrossCounterexample(
  model: OrmModel,
  constraint: Constraint,
  forbidden: readonly Population[],
  reason: string,
  rendered: string,
): Counterexample {
  const segments: VerbalizationSegment[] = [
    kwSeg("Rules out: "),
    textSeg(reason),
    textSeg(" -- e.g. "),
    valSeg(rendered),
  ];
  return {
    factTypeIds: model.factTypesOf(constraint).map((ft) => ft.id),
    constraintId: constraint.id,
    constraintType: constraint.type,
    forbidden,
    segments,
    text: segments.map((s) => s.text).join(""),
  };
}

function renderInstances(
  instances: readonly RoleValues[],
  ft: FactType,
  model: OrmModel,
): string {
  return instances
    .map((rv) =>
      "{"
      + ft.roles.map((r) => `${playerName(r, model)}=${rv[r.id] ?? ""}`).join(", ")
      + "}"
    )
    .join("; ");
}
