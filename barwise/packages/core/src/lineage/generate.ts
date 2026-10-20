/**
 * Lineage generation: traces exported artifacts back to source ORM elements.
 */

import type { RelationalSchema } from "../mapping/RelationalSchema.js";
import type { Constraint } from "../model/Constraint.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
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
        const inView = model.getConstraintInView(fk.sourceConstraintId);
        if (inView) {
          const [constraint] = inView;
          // The fact types the constraint is named by (orm-format-3, Open
          // decision 9): its own for an internal one, every one it spans
          // for one across fact types. RelationalMapper sets this id to an
          // internal uniqueness (or, below, a subtype fact or fact type)
          // today, so the second case is the placement-correct reading,
          // not one an export reaches yet.
          const named = model.factTypesNaming(inView);
          sources.set(fk.sourceConstraintId, {
            elementId: fk.sourceConstraintId,
            elementType: "Constraint",
            elementName: getConstraintName(constraint, named),
          });

          for (const ft of named) {
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
          }
        }

        // RelationalMapper also stores a subtype fact id here (the subtype
        // table's key or foreign key to its supertype), and a fact type id
        // for an objectification's key. Resolving only constraint ids left
        // a changed subtype relationship with no affected artifact.
        const sf = model.getSubtypeFact(fk.sourceConstraintId);
        if (sf && !sources.has(sf.id)) {
          sources.set(sf.id, {
            elementId: sf.id,
            elementType: "SubtypeFact",
            elementName: subtypeFactName(model, sf),
          });
        }
        const ft = model.getFactType(fk.sourceConstraintId);
        if (ft && !sources.has(ft.id)) {
          sources.set(ft.id, {
            elementId: ft.id,
            elementType: "FactType",
            elementName: ft.name,
          });
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
    }

    // The constraints touching the entity's fact types, each once even
    // when it spans two of them. A constraint across fact types none of
    // whose roles resolve touches no fact type, so no entity lists it;
    // validation reports it.
    for (const inView of model.constraintsTouchingAny(relatedFactTypes.map((ft) => ft.id))) {
      const [constraint] = inView;
      if (constraint.id) {
        sources.push({
          elementId: constraint.id,
          elementType: "Constraint",
          elementName: getConstraintName(constraint, model.factTypesNaming(inView)),
        });
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

    // The subtype facts themselves: the NORMA writer emits each one, so
    // impact on a subtype fact id must find this artifact too.
    for (const sf of model.subtypeFacts) {
      if (sf.subtypeId !== entity.id && sf.supertypeId !== entity.id) continue;
      sources.push({
        elementId: sf.id,
        elementType: "SubtypeFact",
        elementName: subtypeFactName(model, sf),
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
 * A readable name for a constraint, by the fact types it is named by
 * (`OrmModel.factTypesNaming`): one for an internal constraint, every
 * one it spans for one across fact types, joined with "and".
 */
function getConstraintName(
  constraint: { type: Constraint["type"]; id?: string; },
  factTypes: readonly { name: string; }[],
): string {
  // The span, joined; empty for a constraint none of whose roles resolve,
  // which then reads as its label alone rather than "Label: ".
  const span = factTypes.map((ft) => ft.name).join(" and ");
  const of = (label: string) => (span ? `${label}: ${span}` : label);
  switch (constraint.type) {
    case "internal_uniqueness":
      return of("UC");
    case "mandatory":
      return of("Mandatory");
    case "external_uniqueness":
      return of("External UC");
    case "value_constraint":
      return of("Value");
    case "disjunctive_mandatory":
      return `Disjunctive Mandatory`;
    case "exclusion":
      return of("Exclusion");
    case "exclusive_or":
      return `Exclusive-Or`;
    case "frequency":
      return of("Frequency");
    case "ring":
      return of("Ring");
    case "subset":
      return `Subset`;
    case "equality":
      return `Equality`;
    default: {
      // Narrowed to exactly the declared generic-labeled kinds; a new
      // member missing from GENERIC_LABELED fails to compile.
      const declared: true = GENERIC_LABELED[constraint.type];
      void declared;
      return of("Constraint");
    }
  }
}

/** "Customer is a subtype of Person", by the names of its two entities. */
function subtypeFactName(model: OrmModel, sf: SubtypeFact): string {
  const sub = model.getObjectType(sf.subtypeId)?.name ?? sf.subtypeId;
  const sup = model.getObjectType(sf.supertypeId)?.name ?? sf.supertypeId;
  return `${sub} is a subtype of ${sup}`;
}
