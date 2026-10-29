/**
 * Content keys for constraints and value constraints, shared by the
 * element comparison (`elementDiff.ts`) and the pairing of object types
 * and fact types (`identity.ts`), which recognizes a rename by content
 * (iri-identity 6a). A leaf module, because `elementDiff.ts` imports
 * `identity.ts`, so the key cannot live in the first and be read by the
 * second without an import cycle.
 */
import type { Constraint, JoinOperand } from "../model/Constraint.js";
import type { ValueConstraintDef } from "../model/ObjectType.js";

/** A role id's stable key within one model. */
export type RoleKeys = (id: string) => string;

/**
 * A stable key for a value constraint, order-insensitive on both halves.
 *
 * Both halves: the comparison read `values` alone until barwise-934, so a
 * narrowed range between two models with the same enumerated values --
 * `1..10` becoming `1..5` -- was invisible, which is the one omission here
 * that changed what the model permits rather than what it documents.
 */
export function valueConstraintKey(vc: ValueConstraintDef | undefined): string {
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
 * Produce a stable, comparable string key for a constraint, normalized
 * so that role IDs are replaced with positions, or for a pair joined by
 * id with shared role ids (see `roleKeys` and `pairRoleKeys`). This
 * eliminates false-positive diffs caused by fresh UUIDs from LLM
 * re-extractions and imports.
 */
export function constraintKey(
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
      return `IU:${indices.join(",")}`;
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
    // exclusion are an unordered set of operand paths; a ring has one.
    case "join_subset":
      return `JSUB:${operandKey(c.subset)}::${operandKey(c.superset)}`;
    case "join_equality":
      return `JEQ:${c.operands.map(operandKey).sort().join("::")}`;
    case "join_exclusion":
      return `JEXC:${c.operands.map(operandKey).sort().join("::")}`;
    case "join_ring":
      return `JRING:${operandKey(c.operand)}:${c.ringType}`;
  }
}

/** A stable structural key for a join operand: its path plus its projection. */
function operandKey(o: JoinOperand): string {
  const path = `${o.path.root}|${o.path.steps.map((s) => `${s.entry}>${s.exit}`).join(",")}`;
  return `${path}#${o.projection.join(",")}`;
}
