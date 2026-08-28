/**
 * Map a forbidden population from the reference model onto the candidate.
 *
 * A counterexample's forbidden population is keyed by the reference
 * model's role ids, which do not exist in the candidate. To test the
 * candidate against it we re-express the population in terms of the
 * candidate's roles. The only stable cross-model key is the object type a
 * role is played by (the brief fixes the vocabulary), so we correspond
 * fact types by their multiset of player names and correspond roles by
 * player name -- and, where a player is repeated (a ring), by position.
 */
import type { FactType, OrmModel, Population, PopulationConfig, Role } from "@barwise/core";
import type { NameLicence } from "../exercise/types.js";
import { nameInVocabulary } from "./nameResolution.js";

/** The object-type name each role plays, in role order (undefined if unresolved). */
function playerNames(ft: FactType, model: OrmModel): (string | undefined)[] {
  return ft.roles.map((r) => model.getObjectType(r.playerId)?.name);
}

/**
 * Candidate-side player names, expressed in the reference vocabulary:
 * a candidate player whose alias matches a reference name is matched
 * under that name, so a synonym choice does not break correspondence.
 */
function candidatePlayerNames(
  ft: FactType,
  model: OrmModel,
  vocabulary: ReadonlySet<string>,
  licence?: NameLicence,
): (string | undefined)[] {
  return ft.roles.map((r) => {
    const ot = model.getObjectType(r.playerId);
    return ot ? nameInVocabulary(ot, vocabulary, licence) : undefined;
  });
}

/** Are two arrays equal as multisets? */
function sameMultiset(a: (string | undefined)[], b: (string | undefined)[]): boolean {
  if (a.length !== b.length) return false;
  const sort = (xs: (string | undefined)[]) => [...xs].sort();
  const sa = sort(a);
  const sb = sort(b);
  return sa.every((x, i) => x === sb[i]);
}

/** The candidate fact type corresponding to a reference fact type, if any. */
function correspondingFactType(
  refNames: (string | undefined)[],
  candidate: OrmModel,
  licence?: NameLicence,
): FactType | undefined {
  if (refNames.some((n) => n === undefined)) return undefined;
  const vocabulary = new Set(refNames.filter((n): n is string => n !== undefined));
  return candidate.factTypes.find((ft) =>
    sameMultiset(candidatePlayerNames(ft, candidate, vocabulary, licence), refNames)
  );
}

/**
 * Correspond reference role ids to candidate role ids: group each side's
 * roles by player name, then zip the groups in order (position
 * disambiguates repeated players). Returns null if the groupings do not
 * line up.
 */
function roleCorrespondence(
  refFt: FactType,
  refModel: OrmModel,
  candFt: FactType,
  candModel: OrmModel,
  licence?: NameLicence,
): Map<string, string> | null {
  const refVocabulary = new Set(
    playerNames(refFt, refModel).filter((n): n is string => n !== undefined),
  );
  const byPlayer = (ft: FactType, model: OrmModel, canonical: boolean): Map<string, Role[]> => {
    const groups = new Map<string, Role[]>();
    for (const r of ft.roles) {
      const ot = model.getObjectType(r.playerId);
      if (!ot) return groups; // caller handles mismatch below
      const name = canonical ? nameInVocabulary(ot, refVocabulary, licence) : ot.name;
      const list = groups.get(name) ?? [];
      list.push(r);
      groups.set(name, list);
    }
    return groups;
  };

  const refGroups = byPlayer(refFt, refModel, false);
  const candGroups = byPlayer(candFt, candModel, true);
  if (refGroups.size !== candGroups.size) return null;

  const map = new Map<string, string>();
  for (const [name, refRoles] of refGroups) {
    const candRoles = candGroups.get(name);
    if (!candRoles || candRoles.length !== refRoles.length) return null;
    refRoles.forEach((rr, i) => map.set(rr.id, candRoles[i]!.id));
  }
  return map;
}

/**
 * A correspondence found by expanding objectifying players
 * (docs/specs/objectified-correspondence.spec.md): plain candidate
 * roles map one-to-one to reference roles; each objectifying candidate
 * role absorbs the group of reference roles matching its objectified
 * fact type's players.
 */
interface ExpandedCorrespondence {
  readonly candFt: FactType;
  /** Reference role id -> candidate role id, for the plain roles. */
  readonly roleMap: ReadonlyMap<string, string>;
  /** Objectifying candidate role id -> absorbed reference role ids,
   *  in reference role order (the fold's join order). */
  readonly folds: ReadonlyMap<string, readonly string[]>;
}

/**
 * Second correspondence tier, tried only when the flat multiset finds
 * nothing: expand each candidate role whose player objectifies a fact
 * type into that fact type's player names (one level -- an objectified
 * player inside the expansion fails the attempt rather than recursing).
 * "Student receives LetterGrade for CourseOffering" then corresponds to
 * an objectified Enrollment carrying the grade, which is the same
 * conceptual content in ORM's own terms. Expansion is driven only by
 * declared ObjectifiedFactType links -- the licence spec's
 * declared-never-inferred rule, applied to shape.
 */
function expandedCorrespondence(
  refFt: FactType,
  refModel: OrmModel,
  candidate: OrmModel,
  licence?: NameLicence,
): ExpandedCorrespondence | null {
  const refNames = playerNames(refFt, refModel);
  if (refNames.some((n) => n === undefined)) return null;
  const refVocabulary = new Set(refNames.filter((n): n is string => n !== undefined));
  const byObjectType = new Map(
    candidate.objectifiedFactTypes.map((o) => [o.objectTypeId, o.factTypeId]),
  );

  for (const ft of candidate.factTypes) {
    const attempt = tryExpandedMatch(
      ft,
      refFt,
      refModel,
      candidate,
      refVocabulary,
      byObjectType,
      licence,
    );
    if (attempt) return attempt;
  }
  return null;
}

function tryExpandedMatch(
  candFt: FactType,
  refFt: FactType,
  refModel: OrmModel,
  candidate: OrmModel,
  refVocabulary: ReadonlySet<string>,
  byObjectType: ReadonlyMap<string, string>,
  licence?: NameLicence,
): ExpandedCorrespondence | null {
  // Classify each candidate role: plain (one reference-vocabulary
  // name) or objectifying (the objectified fact type's names, in that
  // fact type's role order).
  const plain: { role: Role; name: string; }[] = [];
  const objectifying: { role: Role; names: string[]; }[] = [];
  for (const role of candFt.roles) {
    const ot = candidate.getObjectType(role.playerId);
    if (!ot) return null;
    const baseId = byObjectType.get(role.playerId);
    const base = baseId !== undefined && baseId !== candFt.id
      ? candidate.getFactType(baseId)
      : undefined;
    if (base) {
      const names: string[] = [];
      for (const br of base.roles) {
        const player = candidate.getObjectType(br.playerId);
        // One level only: a nested objectifying player fails the
        // attempt instead of recursing.
        if (!player || byObjectType.has(br.playerId)) return null;
        names.push(nameInVocabulary(player, refVocabulary, licence));
      }
      objectifying.push({ role, names });
    } else {
      plain.push({ role, name: nameInVocabulary(ot, refVocabulary, licence) });
    }
  }
  // The flat tier already answered the no-objectification case, and
  // answered it first on purpose: expansion only rescues.
  if (objectifying.length === 0) return null;

  const expanded = [...plain.map((p) => p.name), ...objectifying.flatMap((o) => o.names)];
  if (!sameMultiset(expanded, playerNames(refFt, refModel))) return null;

  // Consume reference roles greedily in declared order -- the same
  // position-disambiguates-repeats semantics as the flat tier's zip.
  const unconsumed = refFt.roles.map((r) => ({
    role: r,
    name: refModel.getObjectType(r.playerId)?.name,
  }));
  const take = (name: string): Role | null => {
    const i = unconsumed.findIndex((e) => e.name === name);
    if (i < 0) return null;
    return unconsumed.splice(i, 1)[0]!.role;
  };

  const roleMap = new Map<string, string>();
  for (const p of plain) {
    const ref = take(p.name);
    if (!ref) return null;
    roleMap.set(ref.id, p.role.id);
  }
  const folds = new Map<string, readonly string[]>();
  for (const o of objectifying) {
    const absorbed: Role[] = [];
    for (const name of o.names) {
      const ref = take(name);
      if (!ref) return null;
      absorbed.push(ref);
    }
    // Join order is reference role order, not the objectified fact
    // type's, so the synthetic value is a pure function of the
    // reference instance alone.
    const ordered = absorbed
      .sort((a, b) => refFt.roles.indexOf(a) - refFt.roles.indexOf(b))
      .map((r) => r.id);
    folds.set(o.role.id, ordered);
  }
  return { candFt, roleMap, folds };
}

/**
 * Separator for folded synthetic values. Only equality matters -- the
 * candidate's constraints compare the value to itself across instances
 * -- so the sole requirement is that equal reference tuples fold to
 * equal strings and the seam is visible to a human reading a report.
 */
const FOLD_SEPARATOR = " & ";

/**
 * A wider-carrier mapping (docs/specs/wider-shape-correspondence.spec.md):
 * the candidate fact type a population was re-expressed into, plus the
 * config to inject. The carrier is exposed so the check can name it in
 * a failure message when no attempt is rejected.
 */
export interface WiderMapping {
  readonly candFt: FactType;
  readonly config: PopulationConfig;
}

/**
 * Does `cand` strictly contain `ref` as a multiset? (Every reference
 * name at least as often, and at least one extra role.)
 */
function strictlyContains(
  cand: (string | undefined)[],
  ref: (string | undefined)[],
): boolean {
  if (cand.length <= ref.length) return false;
  const counts = new Map<string | undefined, number>();
  for (const n of cand) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const n of ref) {
    const c = counts.get(n) ?? 0;
    if (c === 0) return false;
    counts.set(n, c - 1);
  }
  return true;
}

/**
 * Third correspondence tier, tried by the check only when
 * `mapForbiddenPopulation` returns null: PROJECT the reference
 * population into a candidate fact type whose player multiset strictly
 * contains the reference's. Shared roles map by the flat tier's
 * group-and-zip rule; every extra candidate role gets a fresh value,
 * distinct per injected instance and role. The distinctness is what
 * keeps the injection non-vacuous: two byte-identical tuples would
 * violate EVERY uniqueness constraint, so a candidate whose only
 * uniqueness spans all roles -- the shape that does NOT carry the
 * reference rule -- would falsely reject them too. With distinct
 * extras, a uniqueness over only the shared roles rejects the
 * injection (rule carried) and one spanning an extra role does not
 * (rule not carried).
 *
 * Several candidate fact types can contain the reference's players, so
 * every carrier's mapping is returned, ordered by ascending arity
 * (fewest extra roles first -- the least speculative reading) then
 * model order. The check passes on the first injection the candidate
 * rejects: each attempt asks the same question of a different declared
 * carrier, and "some declared carrier forbids this population" is the
 * check's semantic intent.
 */
export function projectionMappings(
  forbidden: Population,
  refModel: OrmModel,
  candidate: OrmModel,
  licence?: NameLicence,
): WiderMapping[] {
  const refFt = refModel.getFactType(forbidden.factTypeId);
  if (!refFt) return [];
  const refNames = playerNames(refFt, refModel);
  if (refNames.some((n) => n === undefined)) return [];
  const vocabulary = new Set(refNames.filter((n): n is string => n !== undefined));

  const carriers = candidate.factTypes
    .filter((ft) =>
      strictlyContains(candidatePlayerNames(ft, candidate, vocabulary, licence), refNames)
    )
    .sort((a, b) => a.roles.length - b.roles.length); // stable sort: model order within an arity

  const mappings: WiderMapping[] = [];
  for (const candFt of carriers) {
    const config = projectOnto(forbidden, refFt, refModel, candFt, candidate, vocabulary, licence);
    if (config) mappings.push({ candFt, config });
  }
  return mappings;
}

function projectOnto(
  forbidden: Population,
  refFt: FactType,
  refModel: OrmModel,
  candFt: FactType,
  candidate: OrmModel,
  vocabulary: ReadonlySet<string>,
  licence?: NameLicence,
): PopulationConfig | null {
  // Group both sides by player name, as the flat tier does; here the
  // candidate group may be larger. Its first ref-count roles map (the
  // same position-disambiguates-repeats semantics as the flat zip) and
  // the remainder are extra, as is every role of a non-reference name.
  const refGroups = new Map<string, Role[]>();
  for (const r of refFt.roles) {
    const name = refModel.getObjectType(r.playerId)?.name;
    if (name === undefined) return null;
    const list = refGroups.get(name) ?? [];
    list.push(r);
    refGroups.set(name, list);
  }
  const candGroups = new Map<string | undefined, Role[]>();
  for (const r of candFt.roles) {
    const ot = candidate.getObjectType(r.playerId);
    const name = ot ? nameInVocabulary(ot, vocabulary, licence) : undefined;
    const list = candGroups.get(name) ?? [];
    list.push(r);
    candGroups.set(name, list);
  }

  const roleMap = new Map<string, string>();
  const extraRoles: Role[] = [];
  for (const [name, refRoles] of refGroups) {
    const candRoles = candGroups.get(name);
    if (!candRoles || candRoles.length < refRoles.length) return null;
    refRoles.forEach((rr, i) => roleMap.set(rr.id, candRoles[i]!.id));
    extraRoles.push(...candRoles.slice(refRoles.length));
  }
  for (const [name, roles] of candGroups) {
    if (name === undefined || !refGroups.has(name)) extraRoles.push(...roles);
  }

  let fresh = 0;
  const instances: { roleValues: Record<string, string>; }[] = [];
  for (const inst of forbidden.instances) {
    const roleValues: Record<string, string> = {};
    for (const [refRoleId, value] of Object.entries(inst.roleValues)) {
      const candRoleId = roleMap.get(refRoleId);
      // A value that corresponds to nothing means the correspondence
      // was partial -- same completeness rule as the flat tier.
      if (candRoleId === undefined) return null;
      roleValues[candRoleId] = value;
    }
    for (const role of extraRoles) roleValues[role.id] = `fresh-${++fresh}`;
    instances.push({ roleValues });
  }
  return { factTypeId: candFt.id, instances };
}

/**
 * Re-express a reference forbidden population as a `PopulationConfig`
 * against the candidate, or return null if no corresponding fact type or
 * role correspondence exists (which means the candidate has not modeled
 * the relationship the constraint would guard). Flat correspondence is
 * tried first and is byte-identical to the pre-expansion behavior; the
 * objectification tier only ever rescues a mapping that would otherwise
 * have failed.
 */
export function mapForbiddenPopulation(
  forbidden: Population,
  refModel: OrmModel,
  candidate: OrmModel,
  licence?: NameLicence,
): PopulationConfig | null {
  const refFt = refModel.getFactType(forbidden.factTypeId);
  if (!refFt) return null;

  let candFt = correspondingFactType(playerNames(refFt, refModel), candidate, licence);
  let roleMap: ReadonlyMap<string, string> | null = null;
  let folds: ReadonlyMap<string, readonly string[]> = new Map();
  if (candFt) {
    roleMap = roleCorrespondence(refFt, refModel, candFt, candidate, licence);
    if (!roleMap) return null;
  } else {
    const exp = expandedCorrespondence(refFt, refModel, candidate, licence);
    if (!exp) return null;
    candFt = exp.candFt;
    roleMap = exp.roleMap;
    folds = exp.folds;
  }

  const instances: { roleValues: Record<string, string>; }[] = [];
  for (const inst of forbidden.instances) {
    const roleValues: Record<string, string> = {};
    for (const [refRoleId, value] of Object.entries(inst.roleValues)) {
      const candRoleId = roleMap.get(refRoleId);
      if (candRoleId !== undefined) roleValues[candRoleId] = value;
    }
    for (const [candRoleId, refRoleIds] of folds) {
      const parts: string[] = [];
      for (const refRoleId of refRoleIds) {
        const value = inst.roleValues[refRoleId];
        if (value === undefined) return null;
        parts.push(value);
      }
      roleValues[candRoleId] = parts.join(FOLD_SEPARATOR);
    }
    // Every reference value must have landed somewhere: a value that
    // corresponds to nothing means the correspondence was partial.
    const mapped = Object.keys(inst.roleValues).filter(
      (id) => roleMap!.has(id) || [...folds.values()].some((ids) => ids.includes(id)),
    );
    if (mapped.length !== Object.keys(inst.roleValues).length) return null;
    instances.push({ roleValues });
  }

  return { factTypeId: candFt.id, instances };
}
