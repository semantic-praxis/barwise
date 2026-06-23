import type {
  ConceptualDataTypeName,
  ObjectType,
  ObjectTypeConfig,
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

  if (ot.referenceMode) {
    result.reference_mode = ot.referenceMode;
  }
  if (ot.definition) {
    result.definition = ot.definition;
  }
  if (ot.sourceContext) {
    result.source_context = ot.sourceContext;
  }
  if (ot.valueConstraint) {
    result.value_constraint = serializeValueConstraintBody(
      ot.valueConstraint.values,
      ot.valueConstraint.ranges,
    );
  }
  if (ot.dataType) {
    const dt: { name: string; length?: number; scale?: number; } = { name: ot.dataType.name };
    if (ot.dataType.length !== undefined) dt.length = ot.dataType.length;
    if (ot.dataType.scale !== undefined) dt.scale = ot.dataType.scale;
    result.data_type = dt;
  }
  if (ot.aliases && ot.aliases.length > 0) {
    result.aliases = [...ot.aliases];
  }
  if (ot.independent) {
    result.independent = true;
  }
  if (ot.defaultValue !== undefined) {
    result.default_value = ot.defaultValue;
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
