import { objectificationRef, type ObjectifiedFactType } from "../../model/ObjectifiedFactType.js";

export interface OrmYamlObjectifiedFactType {
  id: string;
  fact_type: string;
  object_type: string;
}

export function serializeObjectifiedFactType(
  oft: ObjectifiedFactType,
): OrmYamlObjectifiedFactType {
  if (oft.id === undefined) {
    throw new Error(
      `Format 3.0 states every objectification's id, and ${objectificationRef(oft)} has none `
        + "(its references do not resolve, iri-identity decision 19); format 4.0 writes it without one.",
    );
  }
  return {
    id: oft.id,
    fact_type: oft.factTypeId,
    object_type: oft.objectTypeId,
  };
}
