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

/**
 * A stable value the domain ADMITS, or undefined when this function
 * cannot construct one.
 *
 * The constructive twin of `valueDomainPredicate`, and the third corner
 * of a square whose fourth is `mintInvalidValue` in
 * `counterexample/values.ts`: predicate and minter, admitting and
 * forbidding. Counterexample generation needs all four, because a probe
 * for one constraint has to fill the fact type's OTHER roles with
 * values those roles accept -- otherwise the population it shows breaks
 * something besides the rule it claims to demonstrate.
 *
 * That is the defect it exists for. `mintValue` consulted a role's
 * value constraint only when the constraint carried an ENUMERATION, so
 * a range-only domain fell through to a player-named token like
 * `Score#1`, which a range of 1..9 forbids. The uniqueness
 * counterexample for `Person scores Score` then reported both
 * `population/uniqueness-violation` and
 * `population/value-constraint-violation`, saying "this is what
 * uniqueness forbids" while showing a population that broke the value
 * constraint too (barwise-959). It is the exact mirror of barwise-958,
 * where the forbidding side read the enumeration and ignored ranges.
 *
 * `index` cycles the enumeration, so a caller minting several values
 * for one role gets distinct ones where the domain allows it.
 *
 * TOTALITY, stated honestly rather than claimed. The enumeration arm is
 * total: a non-empty enumeration always admits its own entries. The
 * range arm is a fixed candidate list checked against the predicate,
 * not a search, so a domain whose only admissible values lie between
 * the candidates -- an exclusive range narrower than 1 over
 * non-integers, say -- yields undefined. The caller then falls back to
 * the token it used before, which is the pre-existing behaviour rather
 * than a new failure. Under-generating is the safe direction here for
 * the same reason it is in `mintInvalidValue`.
 */
export function mintAllowedValue(domain: ValueDomain, index: number): string | undefined {
  if (domain.values.length > 0) {
    return domain.values[index % domain.values.length];
  }

  const admits = valueDomainPredicate(domain);
  for (const range of domain.ranges ?? []) {
    for (const candidate of rangeCandidates(range, index)) {
      if (admits(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Values worth trying for a range at a given index, most preferred first.
 *
 * INDEX-SENSITIVE, and that is not decoration. A caller minting several
 * values for one role needs DISTINCT ones: the mandatory counterexample
 * shows an object that plays no mandatory role by putting a different
 * value in a sibling role, and if both roles receive the same value they
 * are the same object and the violation it means to demonstrate
 * disappears. The first draft returned the range's minimum regardless of
 * index, both roles got "1", and the counterexample law caught it -- the
 * enumeration arm above had cycled on index since it was written, and
 * the range arm silently did not.
 *
 * So a numeric bound is walked by the index rather than merely offered.
 * An inclusive bound yields the bound itself at index 0, which is also
 * the most readable value to show; an exclusive one starts one step in.
 * Each is only a CANDIDATE -- `mintAllowedValue` checks every one
 * against the whole domain, so a step that leaves the range is
 * discarded and the next candidate tried.
 */
function rangeCandidates(range: ValueRange, index: number): readonly string[] {
  const candidates: string[] = [];
  const minIncl = range.minInclusive !== false;
  const maxIncl = range.maxInclusive !== false;

  const min = range.min !== undefined && isFiniteNumber(range.min)
    ? Number(range.min)
    : undefined;
  const max = range.max !== undefined && isFiniteNumber(range.max)
    ? Number(range.max)
    : undefined;

  // Walking up from the lower bound keeps the values whole where the
  // bounds are whole, which matters for a player declaring `integer`.
  if (min !== undefined) candidates.push(String(minIncl ? min + index : min + index + 1));
  if (max !== undefined) candidates.push(String(maxIncl ? max - index : max - index - 1));
  // Neither neighbour is admissible in an exclusive range narrower than
  // one step; the midpoint is.
  if (min !== undefined && max !== undefined) candidates.push(String((min + max) / 2));

  // A bound with no numeric reading is offered as itself when inclusive,
  // and cleared by appending when not: every suffix of a string sorts
  // above it. Gated on the bound NOT parsing as a number, because
  // `valueInRange` compares lexically whenever the VALUE is non-numeric,
  // so "1a" reads as inside 1..2 and would be minted for a numeric
  // range, where it is the wrong kind of value and violates any integer
  // data type the player declares.
  if (range.min !== undefined && min === undefined) {
    candidates.push(minIncl ? range.min : `${range.min}a`);
  }
  if (range.max !== undefined && max === undefined && maxIncl) candidates.push(range.max);

  // An open-below, open-above range admits everything, so anything does.
  if (range.min === undefined && range.max === undefined) candidates.push(String(index));

  return candidates;
}

/**
 * A stable value of a conceptual data type, or undefined for a type
 * whose admissible spellings `dataTypeAdmits` does not constrain.
 *
 * The constructive twin of `dataTypeAdmits`, and it exists for the same
 * reason `mintAllowedValue` does. Counterexample generation fills a
 * fact type's other roles with player-named tokens like `Score#1`, and
 * a role played by a value type declaring `integer` does not admit
 * that. Before barwise-945 nothing checked it, so nothing noticed; the
 * moment the check existed, probes across almost every constraint kind
 * began tripping `population/value-type-data-type-violation` beside
 * their own rule.
 *
 * Undefined for the unchecked types is correct rather than lazy: those
 * admit the token already, so the caller's fallback is right there.
 */
export function mintValueOfType(
  type: ConceptualDataTypeName,
  index: number,
): string | undefined {
  switch (type) {
    case "integer":
    case "auto_counter":
      return String(index + 1);
    case "decimal":
    case "money":
    case "float":
      return String(index + 1);
    case "boolean":
      // Two values exist, so a caller asking for many gets them
      // alternately rather than the same one repeatedly.
      return index % 2 === 0 ? "true" : "false";
    default:
      return undefined;
  }
}
