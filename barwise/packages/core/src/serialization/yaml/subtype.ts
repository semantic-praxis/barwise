import type { SubtypeFact, SubtypeFactConfig } from "../../model/SubtypeFact.js";
import {
  deserializeDerivation,
  type OrmYamlDerivation,
  serializeDerivation,
} from "./derivation.js";

export interface OrmYamlSubtypeFact {
  id: string;
  subtype: string;
  supertype: string;
  provides_identification?: boolean;
  is_exclusive?: boolean;
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
  if (sf.isExclusive) {
    result.is_exclusive = true;
  }
  if (sf.isExhaustive) {
    result.is_exhaustive = true;
  }
  if (sf.definingRule) {
    result.defining_rule = serializeDerivation(sf.definingRule);
  }
  return result;
}

export function deserializeSubtypeFact(sfDoc: OrmYamlSubtypeFact): SubtypeFactConfig {
  return {
    id: sfDoc.id,
    subtypeId: sfDoc.subtype,
    supertypeId: sfDoc.supertype,
    providesIdentification: sfDoc.provides_identification ?? true,
    isExclusive: sfDoc.is_exclusive ?? false,
    isExhaustive: sfDoc.is_exhaustive ?? false,
    definingRule: sfDoc.defining_rule
      ? deserializeDerivation(sfDoc.defining_rule)
      : undefined,
  };
}
