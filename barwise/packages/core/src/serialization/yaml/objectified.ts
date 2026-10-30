import type { ObjectifiedFactType } from "../../model/ObjectifiedFactType.js";

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
