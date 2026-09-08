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
import type { Constraint, JoinOperand } from "../model/Constraint.js";
import type { Definition } from "../model/Definition.js";
import type { DerivationRule, FactType } from "../model/FactType.js";
import type { ObjectType, ValueConstraintDef } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
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

  if (a.kind !== b.kind) {
    changes.push({ change: "kind", from: a.kind, to: b.kind });
  }
  if ((a.referenceMode ?? "") !== (b.referenceMode ?? "")) {
    changes.push({ change: "referenceMode", from: a.referenceMode, to: b.referenceMode });
  }
  if ((a.definition ?? "") !== (b.definition ?? "")) {
    changes.push({ change: "definition", from: a.definition, to: b.definition });
  }
  if ((a.sourceContext ?? "") !== (b.sourceContext ?? "")) {
    changes.push({ change: "sourceContext", from: a.sourceContext, to: b.sourceContext });
  }

  if (valueConstraintKey(a.valueConstraint) !== valueConstraintKey(b.valueConstraint)) {
    changes.push({
      change: "valueConstraint",
      from: copy(a.valueConstraint),
      to: copy(b.valueConstraint),
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
  if ((a.defaultValue ?? "") !== (b.defaultValue ?? "")) {
    changes.push({ change: "defaultValue", from: a.defaultValue, to: b.defaultValue });
  }

  // Aliases comparison (order-insensitive).
  const aAliases = (a.aliases ?? []).slice().sort().join(",");
  const bAliases = (b.aliases ?? []).slice().sort().join(",");
  if (aAliases !== bAliases) {
    changes.push({ change: "aliases", from: [...a.aliases ?? []], to: [...b.aliases ?? []] });
  }

  // Data type comparison.
  const aDt = a.dataType;
  const bDt = b.dataType;
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
 * Resolve an object type id to its name using the given model.
 * Returns the id itself if the object type is not found.
 */
export function playerName(model: OrmModel, playerId: string): string {
  return model.getObjectType(playerId)?.name ?? playerId;
}

/**
 * Resolve a fact type id to its name using the given model.
 * Returns the id itself if the fact type is not found, like `playerName`.
 */
export function factTypeName(model: OrmModel, factTypeId: string): string {
  return model.getFactType(factTypeId)?.name ?? factTypeId;
}

export function diffFactType(
  a: FactType,
  b: FactType,
  existingModel: OrmModel,
  incomingModel: OrmModel,
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];

  // Compare roles by position: player name and role name.
  if (a.arity !== b.arity) {
    changes.push({ change: "arity", from: a.arity, to: b.arity });
  } else {
    for (let i = 0; i < a.arity; i++) {
      const ra = a.roles[i]!;
      const rb = b.roles[i]!;
      const summaryA = roleSummary(ra, existingModel);
      const summaryB = roleSummary(rb, incomingModel);
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

  // Constraints -- pass both role arrays so constraintKey can resolve
  // role IDs to positional indices (stable across LLM re-extractions).
  const constraintDiff = diffConstraints(
    a.constraints,
    b.constraints,
    a.roles,
    b.roles,
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
 * role came from.
 *
 * Both sides of a role change are resolved against _different_ models,
 * which is why the name is carried rather than left for a consumer to
 * look up: given only the delta, there is no model in which both names
 * resolve.
 */
function roleSummary(role: Role, model: OrmModel): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    playerId: role.playerId,
    playerName: playerName(model, role.playerId),
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
  const values = vc.values.slice().sort().join(",");
  const ranges = (vc.ranges ?? [])
    .map((r) =>
      `${r.minInclusive === false ? "(" : "["}${r.min ?? ""}..${r.max ?? ""}`
      + `${r.maxInclusive === false ? ")" : "]"}`
    )
    .sort()
    .join(",");
  return `${values}|${ranges}`;
}

/** A stable key for a derivation rule, or "" when absent (asserted). */
function derivationKey(d: DerivationRule | undefined): string {
  if (!d) return "";
  return `${d.kind}|${d.storage ?? "derive_on_request"}|${d.expression}|${d.isFormal ? "f" : ""}`;
}

/**
 * Build a role-id-to-index lookup from a roles array.
 */
function roleIndexMap(roles: readonly Role[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < roles.length; i++) {
    m.set(roles[i]!.id, i);
  }
  return m;
}

/**
 * Resolve a role ID to its positional index using the lookup.
 * Falls back to the raw ID for cross-fact-type constraints whose role
 * IDs don't belong to this fact type.
 */
function resolveRole(id: string, idxMap: Map<string, number>): string {
  const idx = idxMap.get(id);
  return idx !== undefined ? String(idx) : id;
}

/**
 * Produce a stable, comparable string key for a constraint, normalized
 * so that role IDs are replaced with positional indices within the
 * parent fact type. This eliminates false-positive diffs caused by
 * fresh UUIDs from LLM re-extractions.
 */
function constraintKey(
  c: Constraint,
  idxMap: Map<string, number>,
): string {
  const base = constraintTypeKey(c, idxMap);
  // Modality is part of a constraint's identity: alethic vs deontic is a
  // real change, so a deontic constraint keys distinctly from its alethic
  // twin.
  return c.modality === "deontic" ? `${base}|deontic` : base;
}

function constraintTypeKey(
  c: Constraint,
  idxMap: Map<string, number>,
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
      const vals = [...c.values].sort().join(",");
      return `VC:${role}:${vals}`;
    }
    case "disjunctive_mandatory": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
      return `DM:${indices.join(",")}`;
    }
    case "exclusion": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
      return `EX:${indices.join(",")}`;
    }
    case "exclusive_or": {
      const indices = c.roleIds.map((id) => resolveRole(id, idxMap)).sort();
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

function diffConstraints(
  a: readonly Constraint[],
  b: readonly Constraint[],
  rolesA: readonly Role[],
  rolesB: readonly Role[],
): ChangeDescription[] {
  const changes: ChangeDescription[] = [];

  const idxMapA = roleIndexMap(rolesA);
  const idxMapB = roleIndexMap(rolesB);

  const keysA = new Set(a.map((c) => constraintKey(c, idxMapA)));
  const keysB = new Set(b.map((c) => constraintKey(c, idxMapB)));

  const added = b.filter((c) => !keysA.has(constraintKey(c, idxMapB)));
  const removed = a.filter((c) => !keysB.has(constraintKey(c, idxMapA)));

  // The constraints themselves, copied: the prose renders only their
  // deduplicated type names, and that was the whole of what a consumer
  // could learn about a constraint change until now.
  if (added.length > 0) {
    changes.push({ change: "constraintsAdded", constraints: added.map(copy) });
  }
  if (removed.length > 0) {
    changes.push({ change: "constraintsRemoved", constraints: removed.map(copy) });
  }

  return changes;
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
  if (a.isExclusive !== b.isExclusive) {
    changes.push({ change: "subtypeExclusive", from: a.isExclusive, to: b.isExclusive });
  }
  if (a.isExhaustive !== b.isExhaustive) {
    changes.push({ change: "subtypeExhaustive", from: a.isExhaustive, to: b.isExhaustive });
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
