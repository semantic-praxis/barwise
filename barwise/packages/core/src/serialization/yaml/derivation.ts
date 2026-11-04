import type { DerivationKind, DerivationRule, DerivationStorage } from "../../model/FactType.js";

export interface OrmYamlDerivation {
  kind: DerivationKind;
  storage?: DerivationStorage;
  expression: string;
  is_formal?: boolean;
}

/** Serialize a derivation rule, omitting the default storage and absent flags. */
export function serializeDerivation(d: DerivationRule): OrmYamlDerivation {
  const out: OrmYamlDerivation = { kind: d.kind, expression: d.expression };
  if (d.storage && d.storage !== "derive_on_request") {
    out.storage = d.storage;
  }
  if (d.isFormal) {
    out.is_formal = true;
  }
  return out;
}
