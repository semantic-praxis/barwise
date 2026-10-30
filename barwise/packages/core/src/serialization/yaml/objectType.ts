import { isEntityType, isValueType, type ObjectType } from "../../model/ObjectType.js";
import {
  type OrmYamlValueConstraintBody,
  serializeValueConstraintBody,
} from "./valueConstraint.js";

export interface OrmYamlObjectType {
  id: string;
  name: string;
  kind: "entity" | "value";
  reference_mode?: string;
  /** An entity's preferred identifier: a uniqueness constraint's id (3.0). */
  preferred_identifier?: string;
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

/**
 * An object type as the file states it. `preferredIdentifierId` is the
 * model's (`OrmModel.preferredIdentifierOf`): the model holds the
 * reference, the file states it on the entity.
 */
export function serializeObjectType(
  ot: ObjectType,
  preferredIdentifierId?: string,
): OrmYamlObjectType {
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
    if (preferredIdentifierId !== undefined) result.preferred_identifier = preferredIdentifierId;
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
