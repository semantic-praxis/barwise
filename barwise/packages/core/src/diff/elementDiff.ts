/**
 * Element-level comparison helpers for the model diff: object types,
 * fact types (roles, readings, constraints), and definitions. Each
 * returns a list of `ChangeDescription` variants; the prose a surface
 * displays is rendered from them by `describeChange`.
 *
 * Values that come out of a model are copied on the way into a variant
 * (`structuredClone`), so a delta cannot be corrupted by a later
 * mutation of the model it was computed from. See the module comment on
 * `changeDescription.ts` for why.
 */
import type { Constraint, ExternalConstraint, JoinOperand } from "../model/Constraint.js";
import type { Definition } from "../model/Definition.js";
import type { DerivationRule, FactType } from "../model/FactType.js";
import {
  isEntityType,
  isValueType,
  type ObjectType,
  type ValueConstraintDef,
  type ValueType,
} from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { FactInstance, Population } from "../model/Population.js";
import type { Role } from "../model/Role.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import type { ChangeDescription, RoleSummary } from "./changeDescription.js";

export function diffObjectType(
  a: ObjectType,
  b: ObjectType,
  _existingModel: OrmModel,
  _incomingModel: OrmModel,
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];

  // The diff is one of the few places that genuinely holds both variants
  // at once -- `a` and `b` may differ in kind, and that difference is
  // itself a reported change -- so it reads the variant fields through
  // these rather than narrowing. Absent reads as undefined, which is what
  // the old single class stored for the fields its kind did not use, so
  // every comparison below means exactly what it meant before.
  const referenceModeOf = (ot: ObjectType): string | undefined =>
    isEntityType(ot) ? ot.referenceMode : undefined;
  const valuePartOf = (ot: ObjectType): ValueType | undefined => isValueType(ot) ? ot : undefined;
  const aValue = valuePartOf(a);
  const bValue = valuePartOf(b);

  if (a.kind !== b.kind) {
    changes.push({ change: "kind", from: a.kind, to: b.kind });
  }
  if ((referenceModeOf(a) ?? "") !== (referenceModeOf(b) ?? "")) {
    changes.push({
      change: "referenceMode",
      from: referenceModeOf(a),
      to: referenceModeOf(b),
    });
  }
  if ((a.definition ?? "") !== (b.definition ?? "")) {
    changes.push({ change: "definition", from: a.definition, to: b.definition });
  }
  if ((a.sourceContext ?? "") !== (b.sourceContext ?? "")) {
    changes.push({ change: "sourceContext", from: a.sourceContext, to: b.sourceContext });
  }

  if (valueConstraintKey(aValue?.valueConstraint) !== valueConstraintKey(bValue?.valueConstraint)) {
    changes.push({
      change: "valueConstraint",
      from: copy(aValue?.valueConstraint),
      to: copy(bValue?.valueConstraint),
    });
  }

  const aCard = a.cardinality ? `${a.cardinality.min}..${a.cardinality.max}` : "";
  const bCard = b.cardinality ? `${b.cardinality.min}..${b.cardinality.max}` : "";
  if (aCard !== bCard) {
    changes.push({ change: "cardinality", from: copy(a.cardinality), to: copy(b.cardinality) });
  }

  if ((a.note ?? "") !== (b.note ?? "")) {
    changes.push({ change: "note", from: a.note, to: b.note });
  }
  if (a.independent !== b.independent) {
    changes.push({ change: "independent", from: a.independent, to: b.independent });
  }
  if ((aValue?.defaultValue ?? "") !== (bValue?.defaultValue ?? "")) {
    changes.push({
      change: "defaultValue",
      from: aValue?.defaultValue,
      to: bValue?.defaultValue,
    });
  }

  // Aliases comparison (order-insensitive).
  const aAliases = a.aliases.slice().sort().join(",");
  const bAliases = b.aliases.slice().sort().join(",");
  if (aAliases !== bAliases) {
    changes.push({ change: "aliases", from: [...a.aliases], to: [...b.aliases] });
  }

  // Data type comparison.
  const aDt = aValue?.dataType;
  const bDt = bValue?.dataType;
  if (aDt && bDt) {
    if (aDt.name !== bDt.name || aDt.length !== bDt.length || aDt.scale !== bDt.scale) {
      changes.push({ change: "dataTypeChanged", from: copy(aDt), to: copy(bDt) });
    }
  } else if (aDt && !bDt) {
    changes.push({ change: "dataTypeRemoved", from: copy(aDt) });
  } else if (!aDt && bDt) {
    changes.push({ change: "dataTypeAdded", to: copy(bDt) });
  }

  return changes;
}

/**
 * Resolve an object type id to its name, against the model the element
 * came from and then against the other model of the same diff.
 *
 * The second model is not a nicety. A lenient fragment -- one that
 * references an object type without defining it, which `barwise merge`
 * and the MCP merge tool accept -- makes the owning model unable to
 * name its own element's endpoints. Resolving against it alone then
 * yields a UUID, which does two visible things: it keys the element
 * differently from the model that DOES define it, so an unchanged
 * subtype fact reads as a removed-plus-added pair, and it labels every
 * delta with an id no reader recognises (barwise-957).
 *
 * Both models are required rather than one plus an optional fallback,
 * because every call site has both and an optional one is a decision a
 * caller can forget to make. Returns the id when neither model defines
 * it -- a dangling reference, which `ValidationEngine` reports and
 * `diffModels` refuses to build a pair-matched delta from.
 */
export function playerName(model: OrmModel, playerId: string, other: OrmModel): string {
  return model.getObjectType(playerId)?.name
    ?? other.getObjectType(playerId)?.name
    ?? playerId;
}

/**
 * Resolve a fact type id to its name, with the same two-model rule and
 * for the same reason as `playerName`. A lenient fragment can carry an
 * objectification or a population whose fact type it does not define.
 */
export function factTypeName(model: OrmModel, factTypeId: string, other: OrmModel): string {
  return model.getFactType(factTypeId)?.name
    ?? other.getFactType(factTypeId)?.name
    ?? factTypeId;
}

/** True when neither model of the diff defines this object type. */
export function isDanglingPlayer(a: OrmModel, b: OrmModel, playerId: string): boolean {
  return !a.getObjectType(playerId) && !b.getObjectType(playerId);
}

/** True when neither model of the diff defines this fact type. */
export function isDanglingFactType(a: OrmModel, b: OrmModel, factTypeId: string): boolean {
  return !a.getFactType(factTypeId) && !b.getFactType(factTypeId);
}

/**
 * How a diff pairs a constraint on one side with one on the other
 * (orm-format-3, Open decision 4 as revised 2026-10-18).
 *
 * - `"id-first"`, the default: a constraint whose id occurs exactly once
 *   on each side is paired by id, so an edit that keeps the id is one
 *   `constraintsModified` change rather than a removal and an addition;
 *   the rest are paired by content key. The fallback is what keeps a
 *   transcript import working against its base: its ids are fresh, so
 *   nothing pairs by id and everything falls through to content.
 * - `"content"`: content keys only. For comparing independent LLM samples,
 *   whose ids are unrelated by construction, so a coincidental id never
 *   pairs two different constraints.
 */
export type ConstraintMatching = "id-first" | "content";

/** How one diff pairs constraints, fixed once for the whole pair of models. */
export interface ConstraintPairing {
  readonly matching: ConstraintMatching;
  /**
   * Ids given to more than one constraint anywhere in each model
   * (barwise-b2s). They pair nothing by id: uniqueness is a whole-model
   * condition, so a list of one fact type's constraints cannot decide it.
   */
  readonly repeatedA: ReadonlySet<string>;
  readonly repeatedB: ReadonlySet<string>;
}

/** The pairing for diffing `existing` against `incoming`. */
export function constraintPairing(
  existing: OrmModel,
  incoming: OrmModel,
  matching: ConstraintMatching,
): ConstraintPairing {
  // Content matching never reads the repeated ids, and the sample fold
  // diffs every pair of samples, so it skips the two model walks.
  if (matching !== "id-first") return { matching, repeatedA: NO_IDS, repeatedB: NO_IDS };
  return { matching, repeatedA: repeatedIds(existing), repeatedB: repeatedIds(incoming) };
}

const NO_IDS: ReadonlySet<string> = new Set();

/** The constraint ids that occur more than once in the model. */
function repeatedIds(model: OrmModel): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const [c] of model.everyConstraint()) {
    if (c.id === undefined) continue;
    if (seen.has(c.id)) repeated.add(c.id);
    seen.add(c.id);
  }
  return repeated;
}

export function diffFactType(
  a: FactType,
  b: FactType,
  existingModel: OrmModel,
  incomingModel: OrmModel,
  holders: { readonly existing: RoleHolders; readonly incoming: RoleHolders; } = {
    existing: roleHolders(existingModel),
    incoming: roleHolders(incomingModel),
  },
  pairing: ConstraintPairing = constraintPairing(existingModel, incomingModel, "id-first"),
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];

  // Compare roles by position: player name and role name.
  if (a.arity !== b.arity) {
    changes.push({ change: "arity", from: a.arity, to: b.arity });
  } else {
    for (let i = 0; i < a.arity; i++) {
      const ra = a.roles[i]!;
      const rb = b.roles[i]!;
      const summaryA = roleSummary(ra, existingModel, incomingModel);
      const summaryB = roleSummary(rb, incomingModel, existingModel);
      if (summaryA.playerName !== summaryB.playerName) {
        changes.push({ change: "rolePlayer", index: i, from: summaryA, to: summaryB });
      }
      if (ra.name !== rb.name) {
        changes.push({ change: "roleName", index: i, from: summaryA, to: summaryB });
      }
    }
  }

  // Readings.
  const readingsA = a.readings.map((r) => r.template);
  const readingsB = b.readings.map((r) => r.template);
  if (readingsA.join(" | ") !== readingsB.join(" | ")) {
    changes.push({ change: "readings", from: readingsA, to: readingsB });
  }

  // Constraints -- pass both role arrays and both models' role-holder
  // indexes, so constraintKey can resolve role IDs to positions (stable
  // across LLM re-extractions and imports), or, for a pair joined by its
  // constraint id, to the role ids themselves (see `pairRoleKeys`).
  // A fact type's own constraints only: one across fact types is the
  // model's, and its own delta (`pairModelConstraints`) reports it.
  const constraintDiff = diffConstraints(
    a.internalConstraints,
    b.internalConstraints,
    a.roles,
    b.roles,
    holders.existing,
    holders.incoming,
    pairing,
  );
  changes.push(...constraintDiff);

  if ((a.definition ?? "") !== (b.definition ?? "")) {
    changes.push({ change: "definition", from: a.definition, to: b.definition });
  }

  if (derivationKey(a.derivation) !== derivationKey(b.derivation)) {
    changes.push({ change: "derivation", from: copy(a.derivation), to: copy(b.derivation) });
  }

  if ((a.note ?? "") !== (b.note ?? "")) {
    changes.push({ change: "note", from: a.note, to: b.note });
  }

  return changes;
}

/**
 * A role as plain data, with its player resolved against the model the
 * role came from, falling back to the other model of the diff.
 *
 * Both sides of a role change are resolved against _different_ models,
 * which is why the name is carried rather than left for a consumer to
 * look up: given only the delta, there is no model in which both names
 * resolve.
 *
 * The fallback is what stops a lenient fragment reporting a fact type
 * as modified when nothing about it changed -- its roles name the same
 * players, and only the fragment's failure to define them made one side
 * read as a UUID (barwise-957).
 */
function roleSummary(role: Role, model: OrmModel, other: OrmModel): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    playerId: role.playerId,
    playerName: playerName(model, role.playerId, other),
  };
}

/**
 * A defensive copy of a plain-data value reachable from a model.
 *
 * `structuredClone` is Node core and handles the plain interfaces these
 * variants carry (constraints, value constraints, data types,
 * derivations). It would lose a class prototype, which is the reason a
 * variant never carries a model instance.
 */
function copy<T>(value: T): T {
  return value === undefined ? value : (structuredClone(value) as T);
}

/**
 * A stable key for a value constraint, order-insensitive on both halves.
 *
 * Both halves: the comparison read `values` alone until barwise-934, so a
 * narrowed range between two models with the same enumerated values --
 * `1..10` becoming `1..5` -- was invisible, which is the one omission here
 * that changed what the model permits rather than what it documents.
 */
function valueConstraintKey(vc: ValueConstraintDef | undefined): string {
  if (!vc) return "";
  // JSON-quoted, so a value holding a comma, a bar or ".." cannot read as
  // two values or as a range.
  const values = vc.values.slice().sort();
  const ranges = (vc.ranges ?? [])
    .map((r) =>
      JSON.stringify([
        r.minInclusive !== false,
        r.min ?? "",
        r.max ?? "",
        r.maxInclusive !== false,
      ])
    )
    .sort();
  return JSON.stringify([values, ranges]);
}

/** A stable key for a derivation rule, or "" when absent (asserted). */
function derivationKey(d: DerivationRule | undefined): string {
  if (!d) return "";
  return `${d.kind}|${d.storage ?? "derive_on_request"}|${d.expression}|${d.isFormal ? "f" : ""}`;
}

/** A role id's stable key within one model. */
type RoleKeys = (id: string) => string;

/**
 * Every fact type that holds each role id, in one model. Built once per
 * diff: `roleKeys` consults it for every role a constraint names, and a
 * scan of the model per role made the diff quadratic in its size.
 */
export type RoleHolders = ReadonlyMap<string, readonly FactType[]>;

export function roleHolders(model: OrmModel): RoleHolders {
  const holders = new Map<string, FactType[]>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      const list = holders.get(role.id);
      if (list) list.push(ft);
      else holders.set(role.id, [ft]);
    }
  }
  return holders;
}

/**
 * Key a constraint's roles: a role of the host fact type by its position,
 * a role of another fact type by that fact type's name and its position
 * there -- the diff matches fact types by name, so that names the same
 * role in both models. The cross-fact-type case used to keep the raw id,
 * so every external uniqueness read as removed and added after an import
 * minted new role ids (barwise-b7z, diff-cross-fact-type-role-keys.spec.md).
 *
 * A role resolves against the model its constraint came from, then the
 * other model of the diff, as `playerName` and `factTypeName` do: a
 * lenient fragment can name a role only the full model defines, and
 * keying it by raw id on one side alone would report a false change.
 *
 * An id more than one fact type holds is ambiguous, as `graphOf` treats
 * it, host included; like an id neither model holds, it keeps its raw id
 * rather than naming one holder. `graphOf` itself cannot serve here: it
 * refuses the whole model on any unresolved reference, and the diff must
 * still key fragments.
 */
function roleKeys(
  roles: readonly Role[],
  holders: RoleHolders,
  otherHolders: RoleHolders,
): RoleKeys {
  // Each kind of key carries its own tag, and the free text in it is
  // JSON-quoted, so a raw id can never read as a resolved one: a dangling
  // id spelled "Room is in Building#1" once matched that fact type's role.
  const host = new Map(roles.map((r, i) => [r.id, `h${i}`]));
  const raw = (id: string) => `r${JSON.stringify(id)}`;
  return (id) => {
    const homes = holders.get(id) ?? otherHolders.get(id) ?? [];
    if (homes.length !== 1) return raw(id);
    const own = host.get(id);
    if (own !== undefined) return own;
    const home = homes[0]!;
    return `f${JSON.stringify([home.name, home.roles.findIndex((r) => r.id === id)])}`;
  };
}

/**
 * The role keys for a constraint already paired by its own id, and only
 * then: a role both models hold, once each, is keyed by its id as well as
 * its `roleKeys` position. The pair's id already says the two are one
 * constraint, so its roles' ids are evidence: by position alone, a
 * constraint moved onto the role that took the old position kept its key
 * (orm-format-3 WS3a-iii review). Position stays because readings refer
 * to roles by it: in "Person is parent of Person" two roles can share a
 * player and a name, so a reorder under the same reading changes what the
 * constraint says while every per-role comparison of the fact type
 * agrees. The position is `roleKeys`' own -- host position, or the other
 * fact type's name and position there -- so no fact type id enters the
 * key: the diff matches fact types by name, so a holder that changed only
 * its id is the same fact type, and one renamed is a different one.
 *
 * The content pass uses `roleKeys` alone and never reads a role id: it
 * pairs constraints whose ids say nothing, and keying by role id there
 * would let a coincidental role id pair two different constraints, which
 * is what content matching exists to rule out. Two functions rather than
 * a flag, so the content pass cannot reach this one.
 */
function pairRoleKeys(
  position: RoleKeys,
  holders: RoleHolders,
  otherHolders: RoleHolders,
): RoleKeys {
  return (id) =>
    holders.get(id)?.length === 1 && otherHolders.get(id)?.length === 1
      ? `i${JSON.stringify([id, position(id)])}`
      : position(id);
}

function resolveRole(id: string, keys: RoleKeys): string {
  return keys(id);
}

/**
 * The operand of an exclusion, a disjunctive mandatory or an exclusive-or:
 * its roles or its subtype facts, which `withSubtypeFacts` keys by name.
 */
function operandOf(
  c: { readonly roleIds?: readonly string[]; readonly subtypeFactIds?: readonly string[]; },
) {
  return c.roleIds ?? c.subtypeFactIds ?? [];
}

/**
 * Keys a subtype fact by its subtype's and supertype's names, as
 * `roleKeys` keys a role by its fact type's name and position, so a
 * subtype constraint pairs by content across models whose subtype fact
 * ids are unrelated (an import, independent LLM samples). Only constraints
 * across fact types can name one, so only `pairModelConstraints` wraps
 * its keys with this (orm-format-3 WS4b).
 */
function withSubtypeFacts(keys: RoleKeys, model: OrmModel, other: OrmModel): RoleKeys {
  return (id) => {
    // Its ends are named in the model that holds it: two files can give one
    // id to different object types.
    const owner = model.getSubtypeFact(id) ? model : other;
    const sf = owner.getSubtypeFact(id);
    if (!sf) return keys(id);
    const nameOf = (ot: string) => owner.getObjectType(ot)?.name ?? ot;
    return `s${JSON.stringify([nameOf(sf.subtypeId), nameOf(sf.supertypeId)])}`;
  };
}

/**
 * Produce a stable, comparable string key for a constraint, normalized
 * so that role IDs are replaced with positions, or for a pair joined by
 * id with shared role ids (see `roleKeys` and `pairRoleKeys`). This
 * eliminates false-positive diffs caused by fresh UUIDs from LLM
 * re-extractions and imports.
 */
function constraintKey(
  c: Constraint,
  idxMap: RoleKeys,
): string {
  const base = constraintTypeKey(c, idxMap);
  // Modality is part of a constraint's identity: alethic vs deontic is a
  // real change, so a deontic constraint keys distinctly from its alethic
  // twin.
  return c.modality === "deontic" ? `${base}|deontic` : base;
}

function constraintTypeKey(
  c: Constraint,
  idxMap: RoleKeys,
): string {
  switch (c.type) {
    case "internal_uniqueness": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
      return `IU:${indices.join(",")}:${c.isPreferred ? "P" : ""}`;
    }
    case "mandatory":
      return `M:${resolveRole(c.roleId, idxMap)}`;
    case "external_uniqueness": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
      return `EU:${indices.join(",")}`;
    }
    case "value_constraint": {
      const role = c.roleId ? resolveRole(c.roleId, idxMap) : "";
      // Both halves, as `valueConstraintKey` reads them: a range-only edit
      // is a change to what the model permits (barwise-934, for roles).
      return `VC:${role}:${valueConstraintKey(c)}`;
    }
    case "disjunctive_mandatory": {
      const indices = operandOf(c).map((id) => resolveRole(id, idxMap)).sort();
      return `DM:${indices.join(",")}`;
    }
    case "exclusion": {
      const indices = operandOf(c).map((id) => resolveRole(id, idxMap)).sort();
      return `EX:${indices.join(",")}`;
    }
    case "exclusive_or": {
      const indices = operandOf(c).map((id) => resolveRole(id, idxMap)).sort();
      return `XO:${indices.join(",")}`;
    }
    case "subset": {
      const sub = c.subsetRoleIds.map((id) => resolveRole(id, idxMap));
      const sup = c.supersetRoleIds.map((id) => resolveRole(id, idxMap));
      return `SUB:${sub.join(",")}:${sup.join(",")}`;
    }
    case "equality": {
      const ids1 = c.roleIds1.map((id) => resolveRole(id, idxMap));
      const ids2 = c.roleIds2.map((id) => resolveRole(id, idxMap));
      return `EQ:${ids1.join(",")}:${ids2.join(",")}`;
    }
    case "ring":
      return `RING:${resolveRole(c.roleId1, idxMap)},${
        resolveRole(c.roleId2, idxMap)
      }:${c.ringType}`;
    case "frequency": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
      return `FREQ:${indices.join(",")}:${c.min}:${c.max}`;
    }
    case "value_comparison":
      return `VCMP:${resolveRole(c.roleId1, idxMap)},${
        resolveRole(c.roleId2, idxMap)
      }:${c.operator}`;
    case "cardinality":
      return `CARD:${resolveRole(c.roleId, idxMap)}:${c.min}:${c.max}`;
    // Join constraints carry inline role paths whose role ids span fact
    // types, so they key by their (stable) role ids rather than by the
    // owner fact type's positional index. Subset is ordered; equality and
    // exclusion are an unordered set of operand paths.
    case "join_subset":
      return `JSUB:${operandKey(c.subset)}::${operandKey(c.superset)}`;
    case "join_equality":
      return `JEQ:${c.operands.map(operandKey).sort().join("::")}`;
    case "join_exclusion":
      return `JEXC:${c.operands.map(operandKey).sort().join("::")}`;
  }
}

/** A stable structural key for a join operand: its path plus its projection. */
function operandKey(o: JoinOperand): string {
  const path = `${o.path.root}|${o.path.steps.map((s) => `${s.entry}>${s.exit}`).join(",")}`;
  return `${path}#${o.projection.join(",")}`;
}

/**
 * The constraints of `a` paired by id with one of `b`, where an id names
 * exactly one constraint in each model, and whether the pair says
 * something different. An id given twice anywhere in a model
 * (barwise-b2s) pairs nothing, so those constraints fall through to
 * content rather than pairing one of them arbitrarily. Content matching
 * pairs nothing here. One function for a fact type's own constraints and
 * the model's, so the two cannot come to pair differently.
 */
function pairById<C extends Constraint>(
  a: readonly C[],
  b: readonly C[],
  keysA: RoleKeys,
  keysB: RoleKeys,
  holdersA: RoleHolders,
  holdersB: RoleHolders,
  pairing: ConstraintPairing,
): Map<C, { readonly to: C; readonly changed: boolean; }> {
  const pairs = new Map<C, { readonly to: C; readonly changed: boolean; }>();
  if (pairing.matching !== "id-first") return pairs;
  // The key for comparing a pair joined by id; see `pairRoleKeys`.
  const pairA = pairRoleKeys(keysA, holdersA, holdersB);
  const pairB = pairRoleKeys(keysB, holdersB, holdersA);
  const byIdB = new Map(
    b.flatMap((c) => (c.id !== undefined && !pairing.repeatedB.has(c.id) ? [[c.id, c]] : [])),
  );
  for (const ca of a) {
    if (ca.id === undefined || pairing.repeatedA.has(ca.id)) continue;
    const cb = byIdB.get(ca.id);
    if (!cb) continue;
    pairs.set(ca, { to: cb, changed: constraintKey(ca, pairA) !== constraintKey(cb, pairB) });
  }
  return pairs;
}

function diffConstraints(
  a: readonly Constraint[],
  b: readonly Constraint[],
  rolesA: readonly Role[],
  rolesB: readonly Role[],
  holdersA: RoleHolders,
  holdersB: RoleHolders,
  pairing: ConstraintPairing,
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];

  const idxMapA = roleKeys(rolesA, holdersA, holdersB);
  const idxMapB = roleKeys(rolesB, holdersB, holdersA);

  // Pair by id first, where an id names exactly one constraint in each
  // model. An id given twice anywhere in a model (barwise-b2s) pairs
  // nothing, so those constraints fall through to content rather than
  // pairing one of them arbitrarily. The id is optional in the type until
  // WS3c, though every constraint in a model has one (barwise-nkq).
  const paired = new Set<Constraint>();
  const modified: { from: Constraint; to: Constraint; }[] = [];
  for (
    const [ca, { to, changed }] of pairById(a, b, idxMapA, idxMapB, holdersA, holdersB, pairing)
  ) {
    paired.add(ca).add(to);
    if (changed) modified.push({ from: ca, to });
  }
  const restA = a.filter((c) => !paired.has(c));
  const restB = b.filter((c) => !paired.has(c));

  const keyA = new Map(restA.map((c) => [c, constraintKey(c, idxMapA)]));
  const keyB = new Map(restB.map((c) => [c, constraintKey(c, idxMapB)]));
  const keysA = new Set(keyA.values());
  const keysB = new Set(keyB.values());

  const added = restB.filter((c) => !keysA.has(keyB.get(c)!));
  const removed = restA.filter((c) => !keysB.has(keyA.get(c)!));

  // The constraints themselves, copied: the prose renders only their
  // deduplicated type names, and that was the whole of what a consumer
  // could learn about a constraint change until now.
  if (added.length > 0) {
    changes.push({ change: "constraintsAdded", constraints: added.map(copy) });
  }
  if (removed.length > 0) {
    changes.push({ change: "constraintsRemoved", constraints: removed.map(copy) });
  }
  if (modified.length > 0) {
    changes.push({
      change: "constraintsModified",
      constraints: modified.map(({ from, to }) => ({ from: copy(from), to: copy(to) })),
    });
  }

  return changes;
}

/** One constraint across fact types matched, or not, between two models. */
export interface ConstraintPair {
  readonly existing?: ExternalConstraint;
  readonly incoming?: ExternalConstraint;
  /** Paired by id and saying something different. */
  readonly modified: boolean;
}

/**
 * Match the constraints across fact types of two models one to one
 * (orm-format-3 WS3c): by id first, as `diffConstraints` does, then by
 * content. With no host, every role is keyed by its fact type's name and
 * position there (`roleKeys` given no host roles), so the key no longer
 * depends on where a 2.0 file nested the constraint. Content pairs are
 * taken one for one, so a second identical copy in one model reads as
 * added or removed, where a fact type's list compares keys as a set.
 * Existing order first, then what only the incoming model has.
 */
export function pairModelConstraints(
  existing: OrmModel,
  incoming: OrmModel,
  holders: { readonly existing: RoleHolders; readonly incoming: RoleHolders; },
  pairing: ConstraintPairing,
): ConstraintPair[] {
  const a = existing.constraints;
  const b = incoming.constraints;
  const keysA = withSubtypeFacts(
    roleKeys([], holders.existing, holders.incoming),
    existing,
    incoming,
  );
  const keysB = withSubtypeFacts(
    roleKeys([], holders.incoming, holders.existing),
    incoming,
    existing,
  );
  const pairOf = new Map<ExternalConstraint, ConstraintPair>();
  const taken = new Set<ExternalConstraint>();
  const byId = pairById(a, b, keysA, keysB, holders.existing, holders.incoming, pairing);
  for (const [ca, { to, changed }] of byId) {
    taken.add(to);
    pairOf.set(ca, { existing: ca, incoming: to, modified: changed });
  }
  const byKeyB = new Map<string, ExternalConstraint[]>();
  for (const cb of b) {
    if (taken.has(cb)) continue;
    const key = constraintKey(cb, keysB);
    const list = byKeyB.get(key);
    if (list) list.push(cb);
    else byKeyB.set(key, [cb]);
  }
  for (const ca of a) {
    if (pairOf.has(ca)) continue;
    const cb = byKeyB.get(constraintKey(ca, keysA))?.shift();
    if (cb) taken.add(cb);
    pairOf.set(
      ca,
      cb ? { existing: ca, incoming: cb, modified: false } : { existing: ca, modified: false },
    );
  }
  return [
    ...a.map((ca) => pairOf.get(ca)!),
    ...b.filter((cb) => !taken.has(cb)).map((cb) => ({ incoming: cb, modified: false })),
  ];
}

/**
 * Compare two subtype facts that matched on `(subtype, supertype)`.
 *
 * Only the four fields a subtype fact carries beyond that pair can
 * differ, since the pair is what made them match. An objectified fact
 * type has no equivalent function: it carries nothing beyond its two
 * references, so two that match are equal by construction, which is why
 * `ObjectifiedFactTypeDelta` forbids `modified` in its type.
 */
export function diffSubtypeFact(a: SubtypeFact, b: SubtypeFact): ChangeDescription[] {
  const changes: ChangeDescription[] = [];
  if (a.providesIdentification !== b.providesIdentification) {
    changes.push({
      change: "providesIdentification",
      from: a.providesIdentification,
      to: b.providesIdentification,
    });
  }
  if (derivationKey(a.definingRule) !== derivationKey(b.definingRule)) {
    changes.push({
      change: "definingRule",
      from: copy(a.definingRule),
      to: copy(b.definingRule),
    });
  }
  return changes;
}

/**
 * Compare two populations that matched on `(fact type, sample)`.
 *
 * Only description and instances can differ; the fact type and the flag
 * are what made them match. Instances compare by their role values
 * rather than by id, because ids churn across a re-extraction exactly
 * as element ids do -- comparing them would report every population as
 * modified on every import.
 */
export function diffPopulation(
  a: Population,
  b: Population,
  aRoles: readonly Role[],
  bRoles: readonly Role[],
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];
  if ((a.description ?? "") !== (b.description ?? "")) {
    changes.push({
      change: "populationDescription",
      from: a.description,
      to: b.description,
    });
  }
  if (instancesKey(a, aRoles) !== instancesKey(b, bRoles)) {
    // Counted here, on the same positional basis `instancesKey` used to
    // decide they differ, because this is the last place the role order
    // is available.
    const before = new Set(a.instances.map((i) => tupleKey(i, aRoles)));
    const after = new Set(b.instances.map((i) => tupleKey(i, bRoles)));
    changes.push({
      change: "populationInstances",
      from: copy(a.instances),
      to: copy(b.instances),
      added: [...after].filter((k) => !before.has(k)).length,
      removed: [...before].filter((k) => !after.has(k)).length,
    });
  }
  return changes;
}

/**
 * A stable key for a population's tuples: the role values by POSITION,
 * with instance ids and role ids left out.
 *
 * By position, not by role id. Role ids churn across a re-extraction
 * exactly as element ids do, so keying on them made two identical
 * populations from two models compare unequal, and every import reported
 * every population as modified with `instances: 1 -> 1`. Positional
 * indices are the same correspondence `diffFactType` uses to decide a
 * role changed at all, so this agrees with the delta the reviewer is
 * looking at.
 *
 * A role id the fact type does not declare sorts last under its own id.
 * That is the population-tuple hole barwise-945 describes -- nothing
 * stops an instance naming a role of some other fact type -- and this
 * function reports such a tuple as different rather than pretending it
 * is comparable.
 */
export function instancesKey(pop: Population, roles: readonly Role[]): string {
  return pop.instances.map((inst) => tupleKey(inst, roles)).sort().join("|");
}

/**
 * One tuple, keyed by role POSITION rather than by role id.
 *
 * Shared by `instancesKey` and the added/removed count above so the two
 * cannot answer differently about whether a tuple is the same tuple --
 * they did, and the count reported six added and six removed for a
 * single edited tuple among six.
 */
function tupleKey(inst: FactInstance, roles: readonly Role[]): string {
  const index = new Map(roles.map((r, i) => [r.id, i]));
  return Object.entries(inst.roleValues)
    .map(([roleId, value]) => [index.get(roleId) ?? `?${roleId}`, value] as const)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([slot, value]) => `${slot}=${value}`)
    .join(",");
}

export function diffDefinition(a: Definition, b: Definition): ChangeDescription[] {
  const changes: ChangeDescription[] = [];
  if (a.definition !== b.definition) {
    changes.push({ change: "definitionText", from: a.definition, to: b.definition });
  }
  if ((a.context ?? "") !== (b.context ?? "")) {
    changes.push({ change: "context", from: a.context, to: b.context });
  }
  return changes;
}
