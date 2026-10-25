/**
 * Maps a NormaDocument (intermediate representation) to an OrmModel.
 *
 * The mapper resolves NORMA XML id references into Barwise model
 * objects and translates NORMA constraint representations into
 * the Barwise Constraint discriminated union. The phases live in
 * `mapping/` (one module per mapped concern) and share an explicit
 * `NormaMappingContext`; this module is the orchestrator.
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 * These mappings are derived from publicly documented format information.
 */
import {
  externallyIdentifiedEntity,
  isExternalUniqueness,
  OrmModel,
  placePreferredFlags,
} from "@barwise/core";
import { runConstraintPasses } from "./mapping/constraintPasses.js";
import {
  collectExclusiveOrPairs,
  collectProcessedRefs,
  constraintsById,
  createConstraintIdAllocator,
  type NormaMappingContext,
  NormaMappingError,
} from "./mapping/context.js";
import { mapDiagrams } from "./mapping/diagrams.js";
import { mapFactTypes } from "./mapping/factTypes.js";
import { mapObjectTypes } from "./mapping/objectTypes.js";
import { mapPopulations } from "./mapping/populations.js";
import { mapObjectifiedTypes, mapSubtypeFacts } from "./mapping/subtypes.js";
import type { NormaDataType, NormaDocument } from "./NormaXmlTypes.js";

export { NormaMappingError };

/**
 * Map a parsed NormaDocument into an OrmModel.
 *
 * The mapping proceeds in phases to satisfy referential integrity
 * requirements of OrmModel:
 *
 * 1. Object types (entity + value) -- no dependencies
 * 2. Fact types with roles and readings -- depend on object types
 * 3. Constraints -- applied to fact types
 * 4. Subtype facts -- depend on object types
 * 5. Objectified fact types -- depend on both object types and fact types
 */
/**
 * Each entity's preferred identifier (orm-format-3 WS4b): NORMA's own
 * `PreferredIdentifier` reference where it names a uniqueness the mapping
 * kept, internal or external, by the id it kept; one that does not
 * identify the entity is stored anyway and reported by validation, as an
 * internal one always was (external-preferred-identifier.spec.md). An
 * entity without one is placed from the uniquenesses NORMA marks
 * `IsPreferred`: an internal one by the rule a 2.0 file's flag is read
 * with, an external one when core reads it as identifying an entity, so a
 * file written without the reference still names its identifiers.
 */
function mapPreferredIdentifiers(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, constraintById } = ctx;
  for (const et of [...doc.entityTypes, ...doc.objectifiedTypes]) {
    const entityId = objectTypeIdMap.get(et.id);
    const ref = et.preferredIdentifier;
    if (entityId === undefined || ref === undefined) continue;
    const c = model.getConstraint(ref);
    if (model.getObjectType(entityId)?.kind !== "entity") continue;
    if (c?.type === "internal_uniqueness" || (c && isExternalUniqueness(c))) {
      model.setPreferredIdentifier(entityId, ref);
    }
  }
  const flagged = (c: { id?: string; }) => {
    const nc = c.id === undefined ? undefined : constraintById.get(c.id);
    return nc?.type === "uniqueness" && nc.isPreferred;
  };
  for (const [entityId, at] of placePreferredFlags(model, flagged).byEntity) {
    if (model.preferredIdentifierOf(entityId) === undefined && at.constraint.id !== undefined) {
      model.setPreferredIdentifier(entityId, at.constraint.id);
    }
  }
  for (const c of model.constraints) {
    if (!isExternalUniqueness(c) || c.id === undefined || !flagged(c)) continue;
    const joined = externallyIdentifiedEntity(model, c);
    if (joined !== undefined && model.preferredIdentifierOf(joined) === undefined) {
      model.setPreferredIdentifier(joined, c.id);
    }
  }
}

export function mapNormaToOrm(doc: NormaDocument): OrmModel {
  const model = new OrmModel({
    name: doc.modelName,
    ...(doc.modelNote !== undefined ? { note: doc.modelNote } : {}),
  });

  const dataTypeById = new Map<string, NormaDataType>();
  for (const dt of doc.dataTypes) {
    dataTypeById.set(dt.id, dt);
  }

  const constraintById = constraintsById(doc);

  const xorPairs = collectExclusiveOrPairs(doc, constraintById);
  const ctx: NormaMappingContext = {
    doc,
    model,
    objectTypeIdMap: new Map(),
    roleIdMap: new Map(),
    factTypeIdMap: new Map(),
    dataTypeById,
    constraintById,
    processedRefs: collectProcessedRefs(doc),
    xorPairs,
    constraintIds: createConstraintIdAllocator(doc, xorPairs),
    namedIdentifiers: new Set(
      [...doc.entityTypes, ...doc.objectifiedTypes].flatMap((et) => et.preferredIdentifier ?? []),
    ),
  };

  mapObjectTypes(ctx);
  mapFactTypes(ctx);
  runConstraintPasses(ctx);
  mapSubtypeFacts(ctx);
  mapObjectifiedTypes(ctx);
  mapPreferredIdentifiers(ctx);
  mapPopulations(ctx);

  mapDiagrams(ctx);

  return model;
}
