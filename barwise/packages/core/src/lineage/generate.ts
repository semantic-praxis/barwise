/**
 * Lineage generation: traces exported artifacts back to source ORM elements.
 */

import type { RelationalSchema } from "../mapping/RelationalSchema.js";
import type { Constraint } from "../model/Constraint.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { LineageEntry, SourceReference } from "./types.js";

/**
 * Generate lineage entries for a DDL export.
 *
 * Walks the RelationalSchema and traces each table/column/FK back to
 * its source ORM element using the traceability fields.
 *
 * @param model - The source ORM model
 * @param schema - The relational schema produced by RelationalMapper
 * @returns Lineage entries, one per table artifact
 */
export function generateDdlLineage(
  model: OrmModel,
  schema: RelationalSchema,
): readonly LineageEntry[] {
  const entries: LineageEntry[] = [];

  for (const table of schema.tables) {
    const sources = new Map<string, SourceReference>();

    // The table itself traces back to an entity type or fact type
    const sourceElement = model.getObjectType(table.sourceElementId)
      ?? model.getFactType(table.sourceElementId);

    if (sourceElement) {
      const elementType = model.getObjectType(table.sourceElementId)
        ? "EntityType"
        : "FactType";

      sources.set(table.sourceElementId, {
        elementId: table.sourceElementId,
        elementType,
        elementName: sourceElement.name,
      });
    }

    // Each column traces back to a role
    for (const column of table.columns) {
      if (column.sourceRoleId) {
        // Find which fact type contains this role
        for (const ft of model.factTypes) {
          const role = ft.roles.find(r => r.id === column.sourceRoleId);
          if (role) {
            // Add the fact type as a source
            if (!sources.has(ft.id)) {
              sources.set(ft.id, {
                elementId: ft.id,
                elementType: "FactType",
                elementName: ft.name,
              });
            }

            // Add all roles from this fact type (not just the sourceRoleId)
            // This ensures we capture both entity and value type roles
            for (const r of ft.roles) {
              if (!sources.has(r.id)) {
                sources.set(r.id, {
                  elementId: r.id,
                  elementType: "Role",
                  elementName: r.name,
                });
              }

              // Add the role's player (object type) as a source
              const player = model.getObjectType(r.playerId);
              if (player && !sources.has(player.id)) {
                const playerType = player.kind === "entity" ? "EntityType" : "ValueType";
                sources.set(player.id, {
                  elementId: player.id,
                  elementType: playerType,
                  elementName: player.name,
                });
              }
            }

            break;
          }
        }
      }
    }

    // Each foreign key traces back to a constraint and the referenced entity
    for (const fk of table.foreignKeys) {
      // Find the referenced entity by looking up the referenced table
      const referencedTable = schema.tables.find(t => t.name === fk.referencedTable);
      if (referencedTable) {
        const referencedEntity = model.getObjectType(referencedTable.sourceElementId);
        if (referencedEntity && !sources.has(referencedEntity.id)) {
          sources.set(referencedEntity.id, {
            elementId: referencedEntity.id,
            elementType: "EntityType",
            elementName: referencedEntity.name,
          });
        }
      }

      if (fk.sourceConstraintId) {
        // Find which fact type contains this constraint
        for (const ft of model.factTypes) {
          for (const constraint of ft.constraints) {
            if (constraint.id === fk.sourceConstraintId) {
              // Add the constraint as a source
              sources.set(constraint.id, {
                elementId: constraint.id,
                elementType: "Constraint",
                elementName: getConstraintName(constraint, ft),
              });

              // Also add the fact type if not already present
              if (!sources.has(ft.id)) {
                sources.set(ft.id, {
                  elementId: ft.id,
                  elementType: "FactType",
                  elementName: ft.name,
                });
              }

              // Add all roles and their players from this fact type
              for (const r of ft.roles) {
                if (!sources.has(r.id)) {
                  sources.set(r.id, {
                    elementId: r.id,
                    elementType: "Role",
                    elementName: r.name,
                  });
                }

                const player = model.getObjectType(r.playerId);
                if (player && !sources.has(player.id)) {
                  const playerType = player.kind === "entity" ? "EntityType" : "ValueType";
                  sources.set(player.id, {
                    elementId: player.id,
                    elementType: playerType,
                    elementName: player.name,
                  });
                }
              }

              break;
            }
          }
        }
      }
    }

    // Create lineage entry for this table
    entries.push({
      artifact: table.name,
      sources: Array.from(sources.values()),
    });
  }

  return entries;
}

/**
 * Generate lineage entries for any export directly from the ORM model.
 *
 * For formats that don't go through RelationalSchema (like OpenAPI),
 * traces directly from model elements. Creates one lineage entry per
 * entity type, including all related fact types and constraints.
 *
 * @param model - The source ORM model
 * @returns Lineage entries, one per entity type
 */
export function generateModelLineage(
  model: OrmModel,
): readonly LineageEntry[] {
  const entries: LineageEntry[] = [];

  for (const entity of model.objectTypes) {
    if (entity.kind !== "entity") continue;

    const sources: SourceReference[] = [];

    // Add the entity itself
    sources.push({
      elementId: entity.id,
      elementType: "EntityType",
      elementName: entity.name,
    });

    // Find all fact types that involve this entity
    const relatedFactTypes = model.factTypesForObjectType(entity.id);

    for (const ft of relatedFactTypes) {
      // Add the fact type
      sources.push({
        elementId: ft.id,
        elementType: "FactType",
        elementName: ft.name,
      });

      // Add roles from this fact type
      for (const role of ft.roles) {
        sources.push({
          elementId: role.id,
          elementType: "Role",
          elementName: role.name,
        });

        // Add the role's player if it's a value type
        const player = model.getObjectType(role.playerId);
        if (player && player.kind === "value") {
          sources.push({
            elementId: player.id,
            elementType: "ValueType",
            elementName: player.name,
          });
        }
      }

      // Add constraints from this fact type
      for (const constraint of ft.constraints) {
        if (constraint.id) {
          sources.push({
            elementId: constraint.id,
            elementType: "Constraint",
            elementName: getConstraintName(constraint, ft),
          });
        }
      }
    }

    // Add subtype relationships
    const supertypes = model.supertypesOf(entity.id);
    for (const supertype of supertypes) {
      sources.push({
        elementId: supertype.id,
        elementType: "EntityType",
        elementName: supertype.name,
      });
    }

    const subtypes = model.subtypesOf(entity.id);
    for (const subtype of subtypes) {
      sources.push({
        elementId: subtype.id,
        elementType: "EntityType",
        elementName: subtype.name,
      });
    }

    entries.push({
      artifact: entity.name,
      sources,
    });
  }

  return entries;
}

/**
 * Constraint kinds that deliberately take the generic label below
 * rather than a dedicated one. Typed over the exact complement of the
 * labeled cases so a new Constraint member forces a choice here or in
 * the switch -- previously the parameter was widened to plain string
 * and five kinds fell to the generic label with nothing recording
 * whether that was intended (barwise-869).
 */
const GENERIC_LABELED: Record<
  "value_comparison" | "cardinality" | "join_subset" | "join_equality" | "join_exclusion",
  true
> = {
  value_comparison: true,
  cardinality: true,
  join_subset: true,
  join_equality: true,
  join_exclusion: true,
};

/**
 * Helper to generate a readable name for a constraint.
 */
function getConstraintName(
  constraint: { type: Constraint["type"]; id?: string; },
  factType: { name: string; },
): string {
  switch (constraint.type) {
    case "internal_uniqueness":
      return `UC: ${factType.name}`;
    case "mandatory":
      return `Mandatory: ${factType.name}`;
    case "external_uniqueness":
      return `External UC: ${factType.name}`;
    case "value_constraint":
      return `Value: ${factType.name}`;
    case "disjunctive_mandatory":
      return `Disjunctive Mandatory`;
    case "exclusion":
      return `Exclusion: ${factType.name}`;
    case "exclusive_or":
      return `Exclusive-Or`;
    case "frequency":
      return `Frequency: ${factType.name}`;
    case "ring":
      return `Ring: ${factType.name}`;
    case "subset":
      return `Subset`;
    case "equality":
      return `Equality`;
    default: {
      // Narrowed to exactly the declared generic-labeled kinds; a new
      // member missing from GENERIC_LABELED fails to compile.
      const declared: true = GENERIC_LABELED[constraint.type];
      void declared;
      return `Constraint: ${factType.name}`;
    }
  }
}
