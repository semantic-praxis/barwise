/**
 * Lineage generation: traces exported artifacts back to source ORM elements.
 */

import type { ConstraintPlacement } from "../mapping/constraintRouting.js";
import type { RelationalSchema } from "../mapping/RelationalSchema.js";
import { type Constraint, subtypeFactIdsOf } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { ConstraintInView, OrmModel } from "../model/OrmModel.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { subtypeOperands } from "../model/subtypeOperands.js";
import type { LineageEntry, SourceReference } from "./types.js";

/**
 * Generate lineage entries for a DDL export.
 *
 * Walks the RelationalSchema and traces each table/column/FK back to
 * its source ORM element using the traceability fields.
 *
 * @param model - The source ORM model
 * @param schema - The relational schema produced by RelationalMapper
 * @param placements - The constraints the DDL's routing wrote on each
 *   table, as a clause or a spilled comment (`routeConstraints`): each is
 *   a source of that table, since changing it changes the table's text
 *   (barwise-20o). A format that writes no routed constraint passes none.
 * @returns Lineage entries, one per table artifact
 */
export function generateDdlLineage(
  model: OrmModel,
  schema: RelationalSchema,
  placements: readonly ConstraintPlacement[] = [],
): readonly LineageEntry[] {
  const entries: LineageEntry[] = [];
  const placedOn = new Map<string, ConstraintInView[]>();
  for (const { tableName, inView } of placements) {
    const list = placedOn.get(tableName);
    if (list) list.push(inView);
    else placedOn.set(tableName, [inView]);
  }

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
            // All roles, not just the sourceRoleId, so both the entity and
            // the value type roles are captured.
            addFactTypeSources(sources, model, ft);
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
          // The fact types the constraint is named by (orm-format-3, Open
          // decision 9): its own for an internal one, every one it spans
          // for one across fact types. RelationalMapper sets this id to an
          // internal uniqueness (or, below, a subtype fact or fact type)
          // today, so the second case is the placement-correct reading,
          // not one an export reaches yet.
          addConstraintSources(sources, model, inView);
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

    for (const inView of placedOn.get(table.name) ?? []) {
      const id = inView[0].id;
      // A source needs an id; one with none cannot be named in impact.
      if (id === undefined || sources.has(id)) continue;
      addConstraintSources(sources, model, inView);
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

  // Each constraint over subtypes, as a source of its supertype and of every
  // subtype it names, indexed once rather than per entity.
  const subtypeConstraintSources = new Map<string, SourceReference[]>();
  for (const c of model.constraints) {
    const facts = subtypeFactIdsOf(c).flatMap((id) => model.getSubtypeFact(id) ?? []);
    if (!c.id || facts.length === 0) continue;
    const source = constraintSource(model, [c, undefined]);
    for (const id of new Set(facts.flatMap((sf) => [sf.subtypeId, sf.supertypeId]))) {
      const list = subtypeConstraintSources.get(id);
      if (list) list.push(source);
      else subtypeConstraintSources.set(id, [source]);
    }
  }

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
    // whose roles resolve touches no fact type, so no entity lists it.
    // Validation reports one naming a role no fact type has; one with no
    // roles at all, which only code can build, is reported for every kind
    // but subset and equality, which have no role-count rule.
    for (const inView of model.constraintsTouchingAny(relatedFactTypes.map((ft) => ft.id))) {
      if (inView[0].id) sources.push(constraintSource(model, inView));
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

    // The constraints over those subtype facts (orm-format-3 WS4b): the
    // NORMA writer and the DDL annotation emit them, so impact on one must
    // find this artifact too.
    for (const source of subtypeConstraintSources.get(entity.id) ?? []) sources.push(source);

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
  | "value_comparison"
  | "cardinality"
  | "join_subset"
  | "join_equality"
  | "join_exclusion"
  | "join_ring",
  true
> = {
  value_comparison: true,
  cardinality: true,
  join_subset: true,
  join_equality: true,
  join_exclusion: true,
  join_ring: true,
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
      return of("Disjunctive Mandatory");
    case "exclusion":
      return of("Exclusion");
    case "exclusive_or":
      return of("Exclusive-Or");
    case "frequency":
      return of("Frequency");
    case "ring":
      return of("Ring");
    case "subset":
      return of("Subset");
    case "equality":
      return of("Equality");
    default: {
      // Narrowed to exactly the declared generic-labeled kinds; a new
      // member missing from GENERIC_LABELED fails to compile.
      const declared: true = GENERIC_LABELED[constraint.type];
      void declared;
      return of("Constraint");
    }
  }
}

/**
 * A constraint as a lineage source, named by the fact types it names, or
 * by its supertype for one over subtypes, which names no fact type. One
 * helper, so every constraint source is named alike: a foreign key's, one
 * the DDL routing placed, and the model lineage's.
 */
function constraintSource(model: OrmModel, inView: ConstraintInView): SourceReference {
  const [c] = inView;
  const subtypeFacts = subtypeFactIdsOf(c);
  let named: readonly { readonly name: string; }[];
  if (subtypeFacts.length > 0) {
    const supertypeId = subtypeOperands(subtypeFacts, model).supertypeId;
    const supertype = supertypeId && (model.getObjectType(supertypeId)?.name ?? supertypeId);
    named = [{ name: `subtypes of ${supertype ?? "the supertype"}` }];
  } else {
    named = model.factTypesNaming(inView);
  }
  // Every caller has checked the id: a source with none cannot be matched.
  return { elementId: c.id!, elementType: "Constraint", elementName: getConstraintName(c, named) };
}

/** A constraint source and the fact types it names, as a table lists them. */
function addConstraintSources(
  sources: Map<string, SourceReference>,
  model: OrmModel,
  inView: ConstraintInView,
): void {
  sources.set(inView[0].id!, constraintSource(model, inView));
  for (const ft of model.factTypesNaming(inView)) addFactTypeSources(sources, model, ft);
}

/** "Customer is a subtype of Person", by the names of its two entities. */
function subtypeFactName(model: OrmModel, sf: SubtypeFact): string {
  const sub = model.getObjectType(sf.subtypeId)?.name ?? sf.subtypeId;
  const sup = model.getObjectType(sf.supertypeId)?.name ?? sf.supertypeId;
  return `${sub} is a subtype of ${sup}`;
}

/**
 * Add a fact type, each of its roles, and each role's player to the sources,
 * skipping any already there. A column's role and a foreign key's constraint
 * both trace back through the whole fact type.
 */
function addFactTypeSources(
  sources: Map<string, SourceReference>,
  model: OrmModel,
  ft: FactType,
): void {
  if (!sources.has(ft.id)) {
    sources.set(ft.id, { elementId: ft.id, elementType: "FactType", elementName: ft.name });
  }
  for (const r of ft.roles) {
    if (!sources.has(r.id)) {
      sources.set(r.id, { elementId: r.id, elementType: "Role", elementName: r.name });
    }
    const player = model.getObjectType(r.playerId);
    if (player && !sources.has(player.id)) {
      sources.set(player.id, {
        elementId: player.id,
        elementType: player.kind === "entity" ? "EntityType" : "ValueType",
        elementName: player.name,
      });
    }
  }
}
