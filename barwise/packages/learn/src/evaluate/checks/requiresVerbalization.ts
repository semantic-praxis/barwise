import type { OrmModel } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import type { CheckResult } from "../GymReport.js";

/** Collapse runs of whitespace so comparison ignores incidental spacing. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Pass iff the required FORML sentence appears in the candidate's
 * verbalization. Compares the flattened `text` of each verbalization,
 * whitespace-normalized, so it matches on meaning rather than on
 * incidental spacing, role-name, or id choices.
 */
export function requiresVerbalization(
  candidate: OrmModel,
  sentence: string,
  hint?: string,
): CheckResult {
  const target = normalize(sentence);
  const produced = new Verbalizer().verbalizeModel(candidate).map((v) => normalize(v.text));

  if (produced.includes(target)) {
    return {
      kind: "requires_verbalization",
      passed: true,
      message: `The model verbalizes as: "${sentence}"`,
    };
  }

  return {
    kind: "requires_verbalization",
    passed: false,
    message: `The model does not verbalize as "${sentence}". Check the fact type, its reading, and its constraints.`,
    hint,
  };
}
