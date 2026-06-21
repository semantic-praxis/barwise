import type { OrmModel } from "../model/OrmModel.js";
import type { Diagnostic, DiagnosticSeverity } from "./Diagnostic.js";
import { completenessWarnings } from "./rules/completenessWarnings.js";
import { constraintConsistencyRules } from "./rules/constraintConsistency.js";
import { derivationRules } from "./rules/derivationRules.js";
import { joinConstraintRules } from "./rules/joinConstraintRules.js";
import { populationValidationRules } from "./rules/populationValidation.js";
import { structuralRules } from "./rules/structural.js";
import type { ValidationRule } from "./ValidationRule.js";

/**
 * The validation engine orchestrates rule sets against an OrmModel
 * and collects the resulting diagnostics.
 *
 * By default, it runs all built-in rule sets (structural,
 * constraint consistency, completeness). Custom rules can be
 * added via addRule().
 */
export class ValidationEngine {
  private readonly rules: ValidationRule[] = [
    structuralRules,
    constraintConsistencyRules,
    completenessWarnings,
    populationValidationRules,
    derivationRules,
    joinConstraintRules,
  ];

  /**
   * Register an additional validation rule.
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
