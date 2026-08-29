/**
 * Compare two recorded history rows (barwise-893,
 * docs/specs/recorded-evidence-commands.spec.md).
 *
 * The runner already prints "gaps below X are not resolvable" and then
 * leaves the operator to do the subtraction by hand, which is how the
 * 2026-08-28 baseline's core analysis was produced. Every input is
 * recorded -- rows carry the suite mean, its standard error, and per-case
 * means and sds -- so the arithmetic layer is automatable and only the
 * judgement half (which cell matters, and why) is not.
 *
 * The arithmetic is `marginOfError` from `stats/dispersion`, not a copy
 * of it, so a verdict here and a verdict from `runSuite` cannot disagree.
 */
import type { HistoryEntry } from "../history/history.js";
import { marginOfError } from "../stats/dispersion.js";

/** One resolvability judgement. */
export interface Verdict {
  readonly delta: number;
  /**
   * The gap two runs of these precisions resolve at 95%:
   * `sqrt(marginA^2 + marginB^2)`. Absent when either side reports no
   * standard error, which is the honest answer for a single-sample or
   * pre-`standardError` row rather than a margin of zero.
   */
  readonly margin?: number;
  /**
   * True only when `|delta|` exceeds `margin`. Absent margin means
   * false: nothing about the precision is known, so nothing is resolved.
   */
  readonly resolved: boolean;
}

/** Suite-level and per-case comparison of two rows. */
export interface Comparison {
  readonly suite: Verdict;
  readonly cases: readonly ({ readonly caseId: string; } & Verdict)[];
  /** Cases present in one row and not the other, named rather than dropped. */
  readonly onlyInA: readonly string[];
  readonly onlyInB: readonly string[];
}

/** The combined resolvable difference of two independent margins. */
function combinedMargin(a?: number, b?: number): number | undefined {
  const ma = marginOfError(a);
  const mb = marginOfError(b);
  if (ma === undefined || mb === undefined) return undefined;
  return Math.sqrt(ma * ma + mb * mb);
}

function verdict(delta: number, seA?: number, seB?: number): Verdict {
  const margin = combinedMargin(seA, seB);
  return {
    delta,
    ...(margin !== undefined ? { margin } : {}),
    resolved: margin !== undefined && Math.abs(delta) > margin,
  };
}

/**
 * Compare `b` against `a`; deltas read as "b minus a".
 *
 * Refuses rows from different suite versions. A suite bump changes what
 * a score means -- 2.8.0 removed credit that 2.7.0 banked -- so
 * subtracting across one produces a number with no referent. That
 * incomparability is the whole reason the field is recorded, and a
 * comparison that ignored it would be the most expensive kind of wrong:
 * confident, precise, and meaningless.
 */
export function compareRows(a: HistoryEntry, b: HistoryEntry): Comparison {
  if (a.suiteVersion !== b.suiteVersion) {
    throw new Error(
      `Rows are not comparable: suite ${a.suiteVersion} vs ${b.suiteVersion}. `
        + "A suite bump changes what a score means, which is what the version "
        + "field records; re-score the rounds under one version instead.",
    );
  }

  const casesA = new Map(a.cases.map((c) => [c.caseId, c]));
  const casesB = new Map(b.cases.map((c) => [c.caseId, c]));
  const shared = [...casesB.keys()].filter((id) => casesA.has(id)).sort();

  return {
    suite: verdict(b.mean - a.mean, a.standardError, b.standardError),
    cases: shared.map((caseId) => {
      const ca = casesA.get(caseId)!;
      const cb = casesB.get(caseId)!;
      return {
        caseId,
        ...verdict(cb.mean - ca.mean, caseStandardError(ca), caseStandardError(cb)),
      };
    }),
    onlyInA: [...casesA.keys()].filter((id) => !casesB.has(id)).sort(),
    onlyInB: [...casesB.keys()].filter((id) => !casesA.has(id)).sort(),
  };
}

/**
 * A case's standard error, from the sd and sample count the row records.
 *
 * Undefined below two samples: with one, nothing about the spread is
 * knowable and reporting zero would claim the opposite -- the same rule
 * `dispersionOf` applies at suite level.
 */
function caseStandardError(c: HistoryEntry["cases"][number]): number | undefined {
  if (c.sd === undefined || c.samples === undefined || c.samples < 2) return undefined;
  return c.sd / Math.sqrt(c.samples);
}
