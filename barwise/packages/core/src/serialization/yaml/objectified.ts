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
  return { id: oft.id, ...serializeObjectifiedFactType40(oft) };
}

/** Format 4.0's: the id left out when the model left the objectification unnamed. */
export type OrmYamlObjectifiedFactType40 = Omit<OrmYamlObjectifiedFactType, "id"> & {
  id?: string;
};

/** An objectification as format 4.0 writes it (iri-identity decision 19). */
export function serializeObjectifiedFactType40(
  oft: ObjectifiedFactType,
): OrmYamlObjectifiedFactType40 {
  return {
    ...(oft.id !== undefined ? { id: oft.id } : {}),
    fact_type: oft.factTypeId,
    object_type: oft.objectTypeId,
  };
}
