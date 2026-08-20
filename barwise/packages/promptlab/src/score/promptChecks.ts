/**
 * Runners for the promptlab-native check family
 * (docs/specs/eval-transcript-realism.spec.md).
 *
 * These grade the extraction payload rather than the parsed model. A
 * realistic transcript leaves some questions genuinely open, and an
 * open question has no single right answer to assert against the
 * model -- but the extractor is expected to notice the fork and report
 * it, and `ExtractionResponse` already carries that report.
 *
 * Pure: same ambiguities and checks give byte-identical results.
 */
import type { GymCheck } from "@barwise/learn";
import type { Ambiguity } from "@barwise/llm";
import type { PromptCheck } from "../evalcase/types.js";

/**
 * A check outcome from either family. Structurally a superset of
 * `@barwise/learn`'s `CheckResult`, so gym results flow through
 * unchanged.
 */
export interface PromptCheckResult {
  readonly kind: GymCheck["kind"] | PromptCheck["kind"];
  readonly passed: boolean;
  /** A concrete explanation of the outcome. */
  readonly message: string;
  /** Shown only on failure; the case author's nudge. */
  readonly hint?: string;
}

/**
 * Evaluate every promptlab-native check against the reported
 * ambiguities, in authored order.
 */
export function runPromptChecks(
  checks: readonly PromptCheck[],
  ambiguities: readonly Ambiguity[],
): PromptCheckResult[] {
  return checks.map((check) => requiresAmbiguity(check, ambiguities));
}

function requiresAmbiguity(
  check: PromptCheck,
  ambiguities: readonly Ambiguity[],
): PromptCheckResult {
  const terms = check.matches.map((m) => m.toLowerCase());
  const matched = ambiguities.find((a) => {
    const description = a.description.toLowerCase();
    return terms.every((term) => description.includes(term));
  });

  const quoted = check.matches.map((m) => `"${m}"`).join(" + ");
  if (matched !== undefined) {
    return {
      kind: "requires_ambiguity",
      passed: true,
      message: `An ambiguity matching ${quoted} was reported: "${matched.description}".`,
    };
  }
  return {
    kind: "requires_ambiguity",
    passed: false,
    message: ambiguities.length === 0
      ? `No ambiguities were reported; expected one matching ${quoted}.`
      : `None of the ${ambiguities.length} reported ambiguities match ${quoted}.`,
    ...(check.hint !== undefined ? { hint: check.hint } : {}),
  };
}

/**
 * Ambiguities reported beyond a case's budget. An absent budget means
 * unbounded, so cases authored before the field carry no penalty.
 */
export function ambiguityExcess(
  reported: number,
  budget: number | undefined,
): number {
  if (budget === undefined) return 0;
  return Math.max(0, reported - budget);
}
