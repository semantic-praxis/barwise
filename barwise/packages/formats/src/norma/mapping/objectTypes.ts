/**
 * Phase 1 of the NORMA mapping: object types.
 *
 * Creates entity types, value types (with data-type resolution), and the
 * entity halves of objectified types.
 */
import type { ConceptualDataTypeName, DataTypeDef, ValueConstraintDef } from "@barwise/core";
import type { NormaDataType, NormaValueConstraintInline } from "../NormaXmlTypes.js";
import type { NormaMappingContext } from "./context.js";

/** Map a NORMA inline value constraint to a core value-constraint definition. */
export function toValueConstraintDef(
  vc: NormaValueConstraintInline | undefined,
): ValueConstraintDef | undefined {
  if (!vc) return undefined;
  if (vc.values.length === 0 && (vc.ranges?.length ?? 0) === 0) return undefined;
  return vc.ranges && vc.ranges.length > 0
    ? { values: vc.values, ranges: vc.ranges }
    : { values: vc.values };
}

/** Create entity, value, and objectified-entity object types (phase 1). */
export function mapObjectTypes(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, dataTypeById } = ctx;

  // Entity types from both EntityType and ObjectifiedType elements.
  for (const et of doc.entityTypes) {
    const ot = model.addObjectType({
      name: et.name,
      kind: "entity",
      referenceMode: et.referenceMode || `${snakeCase(et.name)}_id`,
      definition: et.definition,
      independent: et.independent,
    });
    objectTypeIdMap.set(et.id, ot.id);
  }

  // Value types.
  for (const vt of doc.valueTypes) {
    const ot = model.addObjectType({
      name: vt.name,
      kind: "value",
      definition: vt.definition,
      valueConstraint: toValueConstraintDef(vt.valueConstraint),
      dataType: resolveDataType(vt.dataTypeRef, vt.dataTypeLength, vt.dataTypeScale, dataTypeById),
      independent: vt.independent,
    });
    objectTypeIdMap.set(vt.id, ot.id);
  }

  // Objectified types create entity object types (the objectification
  // link is established after fact types are created).
  for (const ot of doc.objectifiedTypes) {
    const objectType = model.addObjectType({
      name: ot.name,
      kind: "entity",
      referenceMode: ot.referenceMode || `${snakeCase(ot.name)}_id`,
      definition: ot.definition,
    });
    objectTypeIdMap.set(ot.id, objectType.id);
  }
}

// ---- Data Type Resolution ----

/**
 * Maps NORMA data type kind strings (from dataTypeTagToKind in the parser)
 * to portable ConceptualDataTypeName values.
 *
 * The NORMA kinds use snake_case derived from the XML tag name (e.g.
 * "variable_length_text" from VariableLengthTextDataType). This table
 * normalizes them to the Barwise conceptual type vocabulary.
 */
const normaKindToConceptual: Record<string, ConceptualDataTypeName> = {
  // Text types
  variable_length_text: "text",
  fixed_length_text: "text",
  large_length_text: "text",

  // Numeric types
  signed_integer_numeric: "integer",
  unsigned_integer_numeric: "integer",
  signed_small_integer_numeric: "integer",
  unsigned_small_integer_numeric: "integer",
  signed_large_integer_numeric: "integer",
  unsigned_large_integer_numeric: "integer",
  auto_counter_numeric: "auto_counter",
  decimal_numeric: "decimal",
  money_numeric: "money",
  floating_point_numeric: "float",
  single_precision_floating_point_numeric: "float",
  double_precision_floating_point_numeric: "float",

  // Boolean
  true_or_false_logical: "boolean",

  // Date/time types
  date_and_time_temporal: "datetime",
  date_temporal: "date",
  time_temporal: "time",
  auto_timestamp_temporal: "timestamp",

  // Binary types
  variable_length_raw_data: "binary",
  fixed_length_raw_data: "binary",
  large_length_raw_data: "binary",
  picture_raw_data: "binary",
  ole_object_raw_data: "binary",

  // UUID
  unique_identifier: "uuid",

  // Row counter (NORMA-specific, treat as auto_counter)
  row_counter_numeric: "auto_counter",
};

/**
 * Resolve a NORMA DataType reference into a portable DataTypeDef.
 * Returns undefined if the reference is absent or unrecognized.
 */
export function resolveDataType(
  dataTypeRef: string | undefined,
  length: number | undefined,
  scale: number | undefined,
  dataTypeById: Map<string, NormaDataType>,
): DataTypeDef | undefined {
  if (!dataTypeRef) return undefined;

  const normaDt = dataTypeById.get(dataTypeRef);
  if (!normaDt) return undefined;

  const conceptualName = normaKindToConceptual[normaDt.kind] ?? "other";

  const result: { name: ConceptualDataTypeName; length?: number; scale?: number; } = {
    name: conceptualName,
  };
  if (length !== undefined) result.length = length;
  if (scale !== undefined) result.scale = scale;
  return result;
}

/**
 * Convert a PascalCase or camelCase name to snake_case.
 */
export function snakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}
