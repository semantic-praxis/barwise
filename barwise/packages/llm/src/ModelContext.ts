/**
 * Builds a concise text summary of an existing OrmModel for inclusion
 * in the LLM extraction prompt.  This tells the LLM which types
 * already exist so it can reference them by name instead of
 * redefining them.
 */

import type { OrmModel } from "@barwise/core";

/**
 * Produce a text summary of the entity types, value types, and fact
 * types in the given model.  The output is designed to be embedded in
 * an LLM prompt.
 */
export function buildExistingModelContext(model: OrmModel): string {
  const lines: string[] = [];

  // Entity types with reference modes.
  const entities = model.objectTypes.filter((ot) => ot.kind === "entity");
  if (entities.length > 0) {
    lines.push("Entity Types:");
    for (const ot of entities) {
      const ref = ot.referenceMode ? ` (reference_mode: ${ot.referenceMode})` : "";
      lines.push(`  - ${ot.name}${ref}`);
    }
    lines.push("");
  }

  // Value types with data types.
  const values = model.objectTypes.filter((ot) => ot.kind === "value");
  if (values.length > 0) {
    lines.push("Value Types:");
    for (const vt of values) {
      const dt = vt.dataType ? ` (${vt.dataType.name})` : "";
      lines.push(`  - ${vt.name}${dt}`);
    }
    lines.push("");
  }

  // Fact types (non-identifier only, to keep the context concise).
  const factTypes = model.factTypes.filter((ft) => {
    // Skip identifier fact types (they're implied by reference_mode).
    const hasPreferred = ft.internalConstraints.some(
      (c) => c.type === "internal_uniqueness" && c.isPreferred,
    );
    return !hasPreferred || ft.arity > 2;
  });
  if (factTypes.length > 0) {
    lines.push("Fact Types:");
    for (const ft of factTypes) {
      const players = ft.roles.map((r) => {
        const ot = model.getObjectType(r.playerId);
        return ot?.name ?? "?";
      });
      const reading = ft.readings[0]?.template ?? ft.name;
      lines.push(`  - ${ft.name} (${players.join(", ")}) -- "${reading}"`);
    }
    lines.push("");
  }

  // Subtype relationships.
  if (model.subtypeFacts.length > 0) {
    lines.push("Subtype Relationships:");
    for (const sf of model.subtypeFacts) {
      const sub = model.getObjectType(sf.subtypeId);
      const sup = model.getObjectType(sf.supertypeId);
      lines.push(`  - ${sub?.name ?? "?"} is a ${sup?.name ?? "?"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
