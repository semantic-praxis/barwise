import { type OrmModel, ValidationEngine } from "@barwise/core";
import type { CheckResult } from "../GymReport.js";

/**
 * Pass iff the candidate has no error-severity diagnostics. Warnings
 * (e.g. completeness) do not fail the check -- an unfinished-but-sound
 * model still passes structural validation.
 */
export function mustValidate(candidate: OrmModel): CheckResult {
  const errors = new ValidationEngine().validate(candidate)
    .filter((d) => d.severity === "error");

  if (errors.length === 0) {
    return { kind: "must_validate", passed: true, message: "The model is structurally valid." };
  }

  const first = errors[0]!;
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return {
    kind: "must_validate",
    passed: false,
    message: `The model has ${errors.length} validation error(s): ${first.message}${more}`,
  };
}
