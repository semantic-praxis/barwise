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

export function serializeSubtypeFact(sf: SubtypeFact): OrmYamlSubtypeFact {
  if (sf.id === undefined) {
    throw new Error(
      `Format 3.0 states every subtype fact's id, and ${subtypeFactRef(sf)} has none `
        + "(its ends do not resolve, iri-identity decision 19); format 4.0 writes it without one.",
    );
  }
  const result: OrmYamlSubtypeFact = {
    id: sf.id,
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
