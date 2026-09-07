import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, RULE_ID } from "../ruleId.js";

/**
 * Derivation consistency rules.
 *
 * These check the _declaration_ of a derivation, never its meaning -- core
 * stores derivation rules as data and never evaluates them (ADR-0001 filter
 * 3). Two structural checks:
 *
 * - A derived or semiderived element (fact type or subtype) whose rule text
 *   is blank: the derivation is declared but undefined (warning).
 * - A purely-derived (derive-on-request) fact type that carries a sample
 *   population: its facts are computed on demand, so asserting instances is
 *   suspect (warning). Derived-and-stored and semiderived populations are
 *   accepted.
 */
export function derivationRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    const d = ft.derivation;
    if (!d) continue;

    if (d.expression.trim() === "") {
      diagnostics.push(report(RULE_ID.missingRule, "factType", ft.id, ft.name, d.kind));
    }

    const onRequest = (d.storage ?? "derive_on_request") === "derive_on_request";
    if (d.kind === "derived" && onRequest) {
      const populated = model.populations.some(
        (p) => p.factTypeId === ft.id && p.instances.length > 0,
      );
      if (populated) {
        diagnostics.push(report(RULE_ID.derivedWithPopulation, "default", ft.id, ft.name));
      }
    }
  }

  for (const sf of model.subtypeFacts) {
    const d = sf.definingRule;
    if (!d) continue;
    if (d.expression.trim() === "") {
      const subtype = model.getObjectType(sf.subtypeId);
      diagnostics.push(
        report(RULE_ID.missingRule, "subtype", sf.id, subtype?.name ?? sf.subtypeId, d.kind),
      );
    }
  }

  return diagnostics;
}
