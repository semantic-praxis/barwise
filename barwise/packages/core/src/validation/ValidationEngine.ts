import { graphOf } from "../model/graph.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Diagnostic, DiagnosticSeverity } from "./Diagnostic.js";
import { referenceDiagnostics } from "./referenceDiagnostics.js";
import { completenessWarnings } from "./rules/completenessWarnings.js";
import { constraintConsistencyRules } from "./rules/constraintConsistency.js";
import { derivationRules } from "./rules/derivationRules.js";
import { joinConstraintRules } from "./rules/joinConstraintRules.js";
import { populationValidationRules } from "./rules/populationValidation.js";
import { structuralRules } from "./rules/structural.js";
import type { GraphValidationRule, ValidationRule } from "./ValidationRule.js";

/**
 * The validation engine orchestrates rule sets against an OrmModel
 * and collects the resulting diagnostics.
 *
 * Rules come in two kinds and the engine's whole shape follows from the
 * difference. A rule that needs a role's player, a population's fact
 * type or a subtype's supertype cannot run on a model whose references
 * do not resolve; a rule that only inspects what is written in front of
 * it can. So `validate` builds the graph first: on success every rule
 * runs and the graph-taking ones read resolved values; on failure the
 * unresolvable references are reported in the rules' own diagnostic ids
 * and only the reference-free rules run.
 *
 * The cost of that ordering is stated rather than hidden: a model with
 * one dangling id no longer gets the graph-taking rules' findings in
 * the same pass. That is the compiler's bargain -- a parse error
 * suppresses type errors -- and it is the price of resolving each
 * reference once instead of at all 131 lookups.
 */
export class ValidationEngine {
  /** Rules that read only what is written in the model. */
  private readonly rules: ValidationRule[] = [
    completenessWarnings,
  ];

  /**
   * Rules that need the graph -- most because they read resolved values
   * from it, `constraintConsistencyRules` because it depends on the
   * graph having built at all. Its `ft.hasRole(roleId)` guards ask
   * whether a role belongs to THIS fact type, which is a different
   * question from whether it exists; once `graphOf` has succeeded every
   * role id resolves, so the guard means only "belongs to another fact
   * type" and cannot duplicate what `referenceDiagnostics` reported.
   */
  private readonly graphRules: GraphValidationRule[] = [
    structuralRules,
    constraintConsistencyRules,
    populationValidationRules,
    derivationRules,
    joinConstraintRules,
  ];

  /**
   * Register an additional validation rule.
   *
   * Custom rules join the reference-free list, so they run on every
   * model handed to `validate` -- which is what they did before the
   * split, and what a caller who wrote one against the old signature
   * expects.
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Run all registered rules against the model and return
   * the collected diagnostics, sorted by severity
   * (errors first, then warnings, then info).
   */
  validate(model: OrmModel): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const result = graphOf(model);

    if (result.ok) {
      for (const rule of this.graphRules) {
        diagnostics.push(...rule(model, result.graph));
      }
    } else {
      diagnostics.push(...referenceDiagnostics(result.unresolved));
    }

    for (const rule of this.rules) {
      diagnostics.push(...rule(model));
    }

    return diagnostics.sort(compareBySeverity);
  }

  /**
   * Run all rules and return only errors (severity === "error").
   */
  errors(model: OrmModel): Diagnostic[] {
    return this.validate(model).filter((d) => d.severity === "error");
  }

  /**
   * Run all rules and return true if the model has no errors.
   * Warnings and info diagnostics do not cause this to return false.
   */
  isValid(model: OrmModel): boolean {
    return this.errors(model).length === 0;
  }
}

const severityOrder: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function compareBySeverity(a: Diagnostic, b: Diagnostic): number {
  return severityOrder[a.severity] - severityOrder[b.severity];
}
