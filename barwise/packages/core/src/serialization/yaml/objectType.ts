import {
  type ConceptualDataTypeName,
  isEntityType,
  isValueType,
  type ObjectType,
  type ObjectTypeConfig,
} from "../../model/ObjectType.js";
import {
  deserializeValueConstraintBody,
  type OrmYamlValueConstraintBody,
  serializeValueConstraintBody,
} from "./valueConstraint.js";

export interface OrmYamlObjectType {
  id: string;
  name: string;
  kind: "entity" | "value";
  reference_mode?: string;
  definition?: string;
  source_context?: string;
  value_constraint?: OrmYamlValueConstraintBody;
  data_type?: { name: string; length?: number; scale?: number; };
  aliases?: string[];
  independent?: boolean;
  default_value?: string;
  note?: string;
  cardinality?: { min: number; max: number | "unbounded"; };
}

export function serializeObjectType(ot: ObjectType): OrmYamlObjectType {
  const result: OrmYamlObjectType = {
    id: ot.id,
    name: ot.name,
    kind: ot.kind,
  };

  // Narrowed field by field rather than by grouping the variants, because
  // key INSERTION ORDER is what the golden bytes record: a value type's
  // `value_constraint` and `data_type` sit between `source_context` and
  // `aliases`, and moving them into a `kind` block would reorder every
  // serialized value type.
  const value = isValueType(ot) ? ot : undefined;

  if (isEntityType(ot)) {
    result.reference_mode = ot.referenceMode;
  }
  if (ot.definition) {
    result.definition = ot.definition;
  }
  if (ot.sourceContext) {
    result.source_context = ot.sourceContext;
  }
  if (value?.valueConstraint) {
    result.value_constraint = serializeValueConstraintBody(
      value.valueConstraint.values,
      value.valueConstraint.ranges,
    );
  }
  if (value?.dataType) {
    const dt: { name: string; length?: number; scale?: number; } = { name: value.dataType.name };
    if (value.dataType.length !== undefined) dt.length = value.dataType.length;
    if (value.dataType.scale !== undefined) dt.scale = value.dataType.scale;
    result.data_type = dt;
  }
  if (ot.aliases.length > 0) {
    result.aliases = [...ot.aliases];
  }
  if (ot.independent) {
    result.independent = true;
  }
  if (value?.defaultValue !== undefined) {
    result.default_value = value.defaultValue;
  }
  if (ot.note) {
    result.note = ot.note;
  }
  if (ot.cardinality) {
    result.cardinality = { min: ot.cardinality.min, max: ot.cardinality.max };
  }

  return result;
}

export function deserializeObjectType(otDoc: OrmYamlObjectType): ObjectTypeConfig {
  return {
    id: otDoc.id,
    name: otDoc.name,
    kind: otDoc.kind,
    referenceMode: otDoc.reference_mode,
    definition: otDoc.definition,
    sourceContext: otDoc.source_context,
    valueConstraint: otDoc.value_constraint
      ? deserializeValueConstraintBody(otDoc.value_constraint)
      : undefined,
    dataType: otDoc.data_type
      ? {
        name: otDoc.data_type.name as ConceptualDataTypeName,
        length: otDoc.data_type.length,
        scale: otDoc.data_type.scale,
      }
      : undefined,
    aliases: otDoc.aliases,
    independent: otDoc.independent,
    defaultValue: otDoc.default_value,
    note: otDoc.note,
    cardinality: otDoc.cardinality,
  };
}
