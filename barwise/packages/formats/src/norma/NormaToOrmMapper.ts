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
import { OrmModel } from "@barwise/core";
import { runConstraintPasses } from "./mapping/constraintPasses.js";
import { type NormaMappingContext, NormaMappingError } from "./mapping/context.js";
import { mapFactTypes } from "./mapping/factTypes.js";
import { mapObjectTypes } from "./mapping/objectTypes.js";
import { mapObjectifiedTypes, mapSubtypeFacts } from "./mapping/subtypes.js";
import type { NormaConstraint, NormaDataType, NormaDocument } from "./NormaXmlTypes.js";

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
export function mapNormaToOrm(doc: NormaDocument): OrmModel {
  const model = new OrmModel({ name: doc.modelName });

  const dataTypeById = new Map<string, NormaDataType>();
  for (const dt of doc.dataTypes) {
    dataTypeById.set(dt.id, dt);
  }

  const constraintById = new Map<string, NormaConstraint>();
  for (const c of doc.constraints) {
    constraintById.set(c.id, c);
  }

  const ctx: NormaMappingContext = {
    doc,
    model,
    objectTypeIdMap: new Map(),
    roleIdMap: new Map(),
    factTypeIdMap: new Map(),
    dataTypeById,
    constraintById,
  };

  mapObjectTypes(ctx);
  mapFactTypes(ctx);
  runConstraintPasses(ctx);
  mapSubtypeFacts(ctx);
  mapObjectifiedTypes(ctx);

  return model;
}
