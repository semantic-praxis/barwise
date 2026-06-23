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

/** Parse a derivation rule, dropping the default storage and false flags. */
export function deserializeDerivation(d: OrmYamlDerivation): DerivationRule {
  const rule: DerivationRule = { kind: d.kind, expression: d.expression };
  return {
    ...rule,
    ...(d.storage ? { storage: d.storage } : {}),
    ...(d.is_formal ? { isFormal: true } : {}),
  };
}
