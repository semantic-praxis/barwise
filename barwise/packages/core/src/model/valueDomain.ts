import type { ValueRange } from "./ObjectType.js";

/**
 * What a value constraint admits, as one predicate.
 *
 * Two modules ask this question and must not answer it differently.
 * Population validation asks it to report a violation; counterexample
 * generation asks it to mint a value the constraint forbids, which is
 * the same question read backwards. They disagreed: the generator
 * checked only the enumerated `values` and ignored `ranges`, so a
 * constraint reading "in {A} or at least 1" produced a "counterexample"
 * the model in fact permits -- a probe that told a modeler the model
 * ruled out something it allowed (barwise-958). Found by the
 * counterexample law on its first run.
 *
 * It lives in `model/` rather than beside either caller because
 * "is this value in this constraint's domain" is a metamodel question;
 * neither validation nor counterexample generation owns the answer.
 */

/** Whether a string parses as a finite number. */
function isFiniteNumber(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

/**
 * Whether a value falls within a range. Compares numerically when the value
 * and both present bounds parse as numbers, otherwise lexically. A missing
 * bound is open-ended; bounds are inclusive unless flagged otherwise.
 */
function valueInRange(val: string, r: ValueRange): boolean {
  const minIncl = r.minInclusive !== false;
  const maxIncl = r.maxInclusive !== false;
  const numeric = isFiniteNumber(val)
    && (r.min === undefined || isFiniteNumber(r.min))
    && (r.max === undefined || isFiniteNumber(r.max));

  if (numeric) {
    const v = Number(val);
    if (r.min !== undefined && (minIncl ? v < Number(r.min) : v <= Number(r.min))) return false;
    if (r.max !== undefined && (maxIncl ? v > Number(r.max) : v >= Number(r.max))) return false;
    return true;
  }
  if (r.min !== undefined && (minIncl ? val < r.min : val <= r.min)) return false;
  if (r.max !== undefined && (maxIncl ? val > r.max : val >= r.max)) return false;
  return true;
}

/** The domain a value constraint declares: an enumeration, ranges, or both. */
export interface ValueDomain {
  readonly values: readonly string[];
  readonly ranges?: readonly ValueRange[];
}

/**
 * A predicate deciding whether a value satisfies a domain, with the
 * enumeration indexed once. Population validation asks this of every
 * instance of every population, so the set is built per constraint
 * rather than per value.
 */
export function valueDomainPredicate(domain: ValueDomain): (val: string) => boolean {
  const allowed = new Set(domain.values);
  const ranges = domain.ranges ?? [];
  return (val) => allowed.has(val) || ranges.some((r) => valueInRange(val, r));
}
