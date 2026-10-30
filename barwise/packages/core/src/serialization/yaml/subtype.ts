import type { SubtypeFact } from "../../model/SubtypeFact.js";
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
