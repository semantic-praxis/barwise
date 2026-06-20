/**
 * Element-level comparison helpers for the model diff: object types,
 * fact types (roles, readings, constraints), and definitions. Each
 * returns a list of human-readable change descriptions.
 */
import type { Constraint } from "../model/Constraint.js";
import type { Definition } from "../model/Definition.js";
import type { DerivationRule, FactType } from "../model/FactType.js";
import type { DataTypeDef, ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";

export function diffObjectType(
  a: ObjectType,
  b: ObjectType,
  _existingModel: OrmModel,
  _incomingModel: OrmModel,
): string[] {
  const changes: string[] = [];

  if (a.kind !== b.kind) {
    changes.push(`kind: ${a.kind} -> ${b.kind}`);
  }
  if ((a.referenceMode ?? "") !== (b.referenceMode ?? "")) {
    changes.push(
      `reference mode: "${a.referenceMode ?? "(none)"}" -> "${b.referenceMode ?? "(none)"}"`,
    );
  }
  if ((a.definition ?? "") !== (b.definition ?? "")) {
    changes.push("definition changed");
  }
  if ((a.sourceContext ?? "") !== (b.sourceContext ?? "")) {
    changes.push(
      `source context: "${a.sourceContext ?? "(none)"}" -> "${b.sourceContext ?? "(none)"}"`,
    );
  }

  const aVals = a.valueConstraint?.values.slice().sort().join(",") ?? "";
  const bVals = b.valueConstraint?.values.slice().sort().join(",") ?? "";
  if (aVals !== bVals) {
    changes.push("value constraint changed");
  }

  const aCard = a.cardinality ? `${a.cardinality.min}..${a.cardinality.max}` : "";
  const bCard = b.cardinality ? `${b.cardinality.min}..${b.cardinality.max}` : "";
  if (aCard !== bCard) {
    changes.push("cardinality changed");
  }

  // Aliases comparison (order-insensitive).
  const aAliases = (a.aliases ?? []).slice().sort().join(",");
  const bAliases = (b.aliases ?? []).slice().sort().join(",");
  if (aAliases !== bAliases) {
    changes.push("aliases changed");
  }

  // Data type comparison.
  const aDt = a.dataType;
  const bDt = b.dataType;
  if (aDt && bDt) {
    if (aDt.name !== bDt.name || aDt.length !== bDt.length || aDt.scale !== bDt.scale) {
      changes.push(`data type: ${formatDataType(aDt)} -> ${formatDataType(bDt)}`);
    }
  } else if (aDt && !bDt) {
    changes.push(`data type removed (was ${formatDataType(aDt)})`);
  } else if (!aDt && bDt) {
    changes.push(`data type added: ${formatDataType(bDt)}`);
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

export function diffFactType(
  a: FactType,
  b: FactType,
  existingModel: OrmModel,
  incomingModel: OrmModel,
): string[] {
  const changes: string[] = [];

  // Compare roles by position: player name and role name.
  if (a.arity !== b.arity) {
    changes.push(`arity: ${a.arity} -> ${b.arity}`);
  } else {
    for (let i = 0; i < a.arity; i++) {
      const ra = a.roles[i]!;
      const rb = b.roles[i]!;
      const nameA = playerName(existingModel, ra.playerId);
      const nameB = playerName(incomingModel, rb.playerId);
      if (nameA !== nameB) {
        changes.push(`role ${i}: player ${nameA} -> ${nameB}`);
      }
      if (ra.name !== rb.name) {
        changes.push(`role ${i}: name "${ra.name}" -> "${rb.name}"`);
      }
    }
  }

  // Readings.
  const readingsA = a.readings.map((r) => r.template).join(" | ");
  const readingsB = b.readings.map((r) => r.template).join(" | ");
  if (readingsA !== readingsB) {
    changes.push("readings changed");
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
    changes.push("definition changed");
  }

  if (derivationKey(a.derivation) !== derivationKey(b.derivation)) {
    changes.push("derivation changed");
  }

  return changes;
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
  }
}

function diffConstraints(
  a: readonly Constraint[],
  b: readonly Constraint[],
  rolesA: readonly Role[],
  rolesB: readonly Role[],
): string[] {
  const changes: string[] = [];

  const idxMapA = roleIndexMap(rolesA);
  const idxMapB = roleIndexMap(rolesB);

  const keysA = new Set(a.map((c) => constraintKey(c, idxMapA)));
  const keysB = new Set(b.map((c) => constraintKey(c, idxMapB)));

  const added = b.filter((c) => !keysA.has(constraintKey(c, idxMapB)));
  const removed = a.filter((c) => !keysB.has(constraintKey(c, idxMapA)));

  if (added.length > 0) {
    const types = [...new Set(added.map((c) => c.type))].join(", ");
    changes.push(`constraints added: ${types}`);
  }
  if (removed.length > 0) {
    const types = [...new Set(removed.map((c) => c.type))].join(", ");
    changes.push(`constraints removed: ${types}`);
  }

  return changes;
}

/** Format a DataTypeDef for human-readable diff output. */
function formatDataType(dt: DataTypeDef): string {
  let s = dt.name;
  if (dt.length !== undefined) s += `(${dt.length}`;
  if (dt.length !== undefined && dt.scale !== undefined) s += `,${dt.scale}`;
  if (dt.length !== undefined) s += ")";
  return s;
}

export function diffDefinition(a: Definition, b: Definition): string[] {
  const changes: string[] = [];
  if (a.definition !== b.definition) {
    changes.push("definition text changed");
  }
  if ((a.context ?? "") !== (b.context ?? "")) {
    changes.push(
      `context: "${a.context ?? "(none)"}" -> "${b.context ?? "(none)"}"`,
    );
  }
  return changes;
}
