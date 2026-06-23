import type {
  ObjectifiedFactType,
  ObjectifiedFactTypeConfig,
} from "../../model/ObjectifiedFactType.js";

export interface OrmYamlObjectifiedFactType {
  id: string;
  fact_type: string;
  object_type: string;
}

export function serializeObjectifiedFactType(
  oft: ObjectifiedFactType,
): OrmYamlObjectifiedFactType {
  return {
    id: oft.id,
    fact_type: oft.factTypeId,
    object_type: oft.objectTypeId,
  };
}

export function deserializeObjectifiedFactType(
  oftDoc: OrmYamlObjectifiedFactType,
): ObjectifiedFactTypeConfig {
  return {
    id: oftDoc.id,
    factTypeId: oftDoc.fact_type,
    objectTypeId: oftDoc.object_type,
  };
}
