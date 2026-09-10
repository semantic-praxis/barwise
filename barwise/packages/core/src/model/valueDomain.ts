import type { ConceptualDataTypeName, ValueRange } from "./ObjectType.js";

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

/**
 * Whether a value is a possible instance of a conceptual data type.
 *
 * The second half of "is this value admissible here". `valueDomainPredicate`
 * above answers it for a declared enumeration or range; this answers it for
 * the declared TYPE, which a model may carry without any enumeration at all.
 * Both were declared, serialized, and exported to SQL as a CHECK, and
 * neither was ever applied to the model's own sample data (barwise-945): a
 * value type could declare `integer` and its population could hold
 * "banana".
 *
 * DELIBERATELY PARTIAL, and that is the design rather than an omission. It
 * returns true for every type whose admissible spellings this codebase
 * cannot pin down, because a false positive here accuses a modeller of an
 * error in correct data, which is worse than a missed check:
 *
 * - `date`, `time`, `datetime`, `timestamp` -- no format is declared
 *   anywhere in the metamodel, so "2026-09-09", "09/09/2026" and
 *   "Sept 9" are all defensible and none is checkable.
 * - `uuid` -- a definite shape exists, but this corpus already carries
 *   NORMA-derived ids like `_84B3E1CA-690B-...` that a strict RFC 4122
 *   test would reject.
 * - `text`, `binary`, `other` -- no constraint by definition.
 *
 * Widening this is the safe direction and narrowing it is not, so a type
 * joins the checked set only once a real model shows the check would have
 * helped.
 */
export function dataTypeAdmits(type: ConceptualDataTypeName, val: string): boolean {
  const trimmed = val.trim();
  switch (type) {
    case "integer":
    case "auto_counter":
      return /^[+-]?\d+$/.test(trimmed);
    case "decimal":
    case "money":
    case "float":
      return isFiniteNumber(trimmed);
    case "boolean":
      // "1"/"0" alongside true/false because that is what a SQL or CSV
      // export of the same fact produces, and a model assembled from one
      // is not in error.
      return ["true", "false", "1", "0"].includes(trimmed.toLowerCase());
    default:
      return true;
  }
}
