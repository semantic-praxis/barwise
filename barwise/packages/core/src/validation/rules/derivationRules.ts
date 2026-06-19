import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";

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
      diagnostics.push({
        severity: "warning",
        message: `Fact type "${ft.name}" is marked ${d.kind} but has no `
          + `derivation rule text.`,
        elementId: ft.id,
        ruleId: "derivation/missing-rule",
      });
    }

    const onRequest = (d.storage ?? "derive_on_request") === "derive_on_request";
    if (d.kind === "derived" && onRequest) {
      const populated = model.populations.some(
        (p) => p.factTypeId === ft.id && p.instances.length > 0,
      );
      if (populated) {
        diagnostics.push({
          severity: "warning",
          message: `Fact type "${ft.name}" is purely derived (computed on `
            + `request) but carries a sample population; its facts are not `
            + `asserted.`,
          elementId: ft.id,
          ruleId: "derivation/derived-with-population",
        });
      }
    }
  }

  for (const sf of model.subtypeFacts) {
    const d = sf.definingRule;
    if (!d) continue;
    if (d.expression.trim() === "") {
      const subtype = model.getObjectType(sf.subtypeId);
      diagnostics.push({
        severity: "warning",
        message: `Subtype "${subtype?.name ?? sf.subtypeId}" is marked ${d.kind} `
          + `but has no defining rule text.`,
        elementId: sf.id,
        ruleId: "derivation/missing-rule",
      });
    }
  }

  return diagnostics;
}
