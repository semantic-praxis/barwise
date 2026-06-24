/**
 * Shared helpers for the draft-model parse passes.
 */

import {
  type ConceptualDataTypeName,
  type DataTypeDef,
  type FactType,
  OrmModel,
  type RingType,
} from "@barwise/core";

/** Valid ConceptualDataTypeName values for validation of LLM output. */
export const VALID_DATA_TYPE_NAMES: ReadonlySet<string> = new Set<ConceptualDataTypeName>([
  "text",
  "integer",
  "decimal",
  "money",
  "float",
  "boolean",
  "date",
  "time",
  "datetime",
  "timestamp",
  "auto_counter",
  "binary",
  "uuid",
  "other",
]);

/** Valid RingType values for validation of LLM output. */
export const VALID_RING_TYPES: ReadonlySet<string> = new Set<RingType>([
  "irreflexive",
  "asymmetric",
  "antisymmetric",
  "intransitive",
  "acyclic",
  "symmetric",
  "transitive",
  "purely_reflexive",
]);

/**
 * Resolve role identifiers from constraint role hints.
 *
 * The LLM may send role names ("is placed by"), player names
 * ("Customer"), or a mix. We try matching strategies in order:
 *   1. Exact role name match (case-insensitive)
 *   2. Player object type name match (via model lookup)
 *   3. Skip with warning (no blind fallback)
 */
export function resolveRolesByPlayerName(
  ft: FactType,
  roleHints: readonly string[],
  model: OrmModel,
  warnings: string[],
  constraintDesc: string,
): string[] {
  const roleIds: string[] = [];
  for (const hint of roleHints) {
    const hintLower = hint.toLowerCase();

    // Strategy 1: Match by role name (case-insensitive).
    const byRoleName = ft.roles.find(
      (r) => r.name.toLowerCase() === hintLower && !roleIds.includes(r.id),
    );
    if (byRoleName) {
      roleIds.push(byRoleName.id);
      continue;
    }

    // Strategy 2: Match by player object type name.
    const ot = model.getObjectTypeByName(hint);
    if (ot) {
      const candidates = ft.rolesForPlayer(ot.id)
        .filter((r) => !roleIds.includes(r.id));
      if (candidates.length > 0) {
        roleIds.push(candidates[0]!.id);
        continue;
      }
    }

    // No match found -- warn but do not blindly pick a role.
    warnings.push(
      `Constraint "${constraintDesc}": could not resolve `
        + `role "${hint}" in fact type "${ft.name}". Skipping this role.`,
    );
  }
  return roleIds;
}

export function camelCase(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function buildDefaultReading(
  roles: Array<{ name: string; playerId: string; }>,
): string {
  // Build "{0} role_name_1 {1} role_name_2 {2}" etc.
  const parts: string[] = [];
  for (let i = 0; i < roles.length; i++) {
    parts.push(`{${i}}`);
    const role = roles[i]!;
    if (i < roles.length - 1) {
      parts.push(role.name);
    }
  }
  return parts.join(" ");
}

/**
 * Validate and convert an LLM-produced data_type into a DataTypeDef.
 * Returns undefined if the input is missing or has an unrecognized type name.
 */
export function resolveDataType(
  raw: { readonly name: string; readonly length?: number; readonly scale?: number; } | undefined,
  objectTypeName: string,
  warnings: string[],
): DataTypeDef | undefined {
  if (!raw?.name) return undefined;

  if (!VALID_DATA_TYPE_NAMES.has(raw.name)) {
    warnings.push(
      `Object type "${objectTypeName}": unrecognized data type "${raw.name}". Ignoring.`,
    );
    return undefined;
  }

  const result: DataTypeDef = { name: raw.name as ConceptualDataTypeName };
  if (raw.length !== undefined && typeof raw.length === "number") {
    (result as { length: number; }).length = raw.length;
  }
  if (raw.scale !== undefined && typeof raw.scale === "number") {
    (result as { scale: number; }).scale = raw.scale;
  }
  return result;
}
