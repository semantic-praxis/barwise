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

/**
 * A subtype fact as 2.0 writes it. `flags` are what the model's constraints
 * over subtypes say about it (`subtypeFlagsFromConstraints`): 2.0 states
 * them on the subtype fact, the model as constraints.
 */
export function serializeSubtypeFact(
  sf: SubtypeFact,
  flags?: { readonly exclusive: boolean; readonly exhaustive: boolean; },
): OrmYamlSubtypeFact {
  const result: OrmYamlSubtypeFact = {
    id: sf.id,
    subtype: sf.subtypeId,
    supertype: sf.supertypeId,
  };
  if (!sf.providesIdentification) {
    result.provides_identification = false;
  }
  if (flags?.exclusive) {
    result.is_exclusive = true;
  }
  if (flags?.exhaustive) {
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
    definingRule: sfDoc.defining_rule
      ? deserializeDerivation(sfDoc.defining_rule)
      : undefined,
  };
}
