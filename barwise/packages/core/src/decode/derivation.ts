/**
 * A derivation rule as a 3.0 file states it: a fact type's `derivation` and
 * a subtype fact's `defining_rule` alike (docs/specs/effect-adoption.spec.md,
 * 1r, R3 and R4).
 */
import * as Schema from "effect/Schema";
import type { DerivationKind, DerivationRule, DerivationStorage } from "../model/FactType.js";
import { Flag, Text } from "./leaves.js";

/** Total records, so a kind or storage added to the model fails to compile here. */
const DERIVATION_KIND_MEMBERS: Record<DerivationKind, true> = { derived: true, semiderived: true };
const DERIVATION_KINDS = Object.keys(DERIVATION_KIND_MEMBERS) as DerivationKind[];
const STORAGE_MEMBERS: Record<DerivationStorage, true> = {
  derive_on_request: true,
  derived_and_stored: true,
};
const STORAGES = Object.keys(STORAGE_MEMBERS) as DerivationStorage[];

export const DerivationFile = Schema.Struct({
  kind: Schema.Literals(DERIVATION_KINDS).annotate({
    message: `must be ${DERIVATION_KINDS.join(" or ")}.`,
  }),
  storage: Schema.optionalKey(
    Schema.Literals(STORAGES).annotate({ message: `must be ${STORAGES.join(" or ")}.` }),
  ),
  expression: Text,
  is_formal: Schema.optionalKey(Flag),
});

/**
 * The rule a decoded derivation stands for. A storage the file states is
 * kept, the default included, and a false `is_formal` dropped, as
 * `deserializeDerivation` reads them.
 */
export function derivationRule(d: (typeof DerivationFile)["Type"]): DerivationRule {
  return {
    kind: d.kind,
    expression: d.expression,
    ...(d.storage !== undefined ? { storage: d.storage } : {}),
    ...(d.is_formal ? { isFormal: true } : {}),
  };
}
