import { type SubtypeFact, subtypeFactRef } from "../../model/SubtypeFact.js";
import { type OrmYamlDerivation, serializeDerivation } from "./derivation.js";

export interface OrmYamlSubtypeFact {
  id: string;
  subtype: string;
  supertype: string;
  provides_identification?: boolean;
  /** 2.0 only: read by the 2.0 reader, never written (orm-format-3 WS4b). */
  is_exclusive?: boolean;
  /** 2.0 only: read by the 2.0 reader, never written (orm-format-3 WS4b). */
  is_exhaustive?: boolean;
  defining_rule?: OrmYamlDerivation;
}

/** Format 4.0's: the id left out when the model left the subtype fact unnamed. */
export type OrmYamlSubtypeFact40 = Omit<OrmYamlSubtypeFact, "id"> & { id?: string; };

export function serializeSubtypeFact(sf: SubtypeFact): OrmYamlSubtypeFact {
  if (sf.id === undefined) {
    throw new Error(
      `Format 3.0 states every subtype fact's id, and ${subtypeFactRef(sf)} has none `
        + "(its ends do not resolve, iri-identity decision 19); format 4.0 writes it without one.",
    );
  }
  return { id: sf.id, ...serializeSubtypeFact40(sf) };
}

/** A subtype fact as format 4.0 writes it (iri-identity decision 19). */
export function serializeSubtypeFact40(sf: SubtypeFact): OrmYamlSubtypeFact40 {
  const result: OrmYamlSubtypeFact40 = {
    ...(sf.id !== undefined ? { id: sf.id } : {}),
    subtype: sf.subtypeId,
    supertype: sf.supertypeId,
  };
  if (!sf.providesIdentification) {
    result.provides_identification = false;
  }
  if (sf.definingRule) {
    result.defining_rule = serializeDerivation(sf.definingRule);
  }
  return result;
}
