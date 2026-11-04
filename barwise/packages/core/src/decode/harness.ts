/**
 * Rules that span several fields, reported whatever else is wrong
 * (docs/specs/effect-adoption.spec.md, WS1b part A; 1r, R1).
 *
 * Effect runs a struct's or a list's `.check` filters only once every field
 * or item of it has decoded. A rule over two fields -- a cardinality's
 * `max >= min`, a range's "a min or a max" -- therefore goes unreported
 * beside any field error in the same struct, and a file with two problems
 * is fixed one at a time. This is the one mechanism that closes it:
 *
 * - A rule is stated once, on the struct or list, by `crossField`, which
 *   marks the filter with an identity and the fields it reads.
 * - `extraChecks` is asked, at each struct or list Effect reports as
 *   failed, which of its marked rules Effect did not run, and runs them on
 *   the raw value. It reads Effect's own issue tree, so it visits exactly
 *   the nodes that failed, and follows every union, record, tuple and
 *   suspension the way Effect resolved it -- a failed union's issue names
 *   the member Effect tried -- rather than guessing a path through the
 *   Schema (first review of R1).
 * - A rule is skipped only where a field it reads is missing or of the
 *   wrong kind: there its own error is the report, and the rule could
 *   misread it. A field that failed a check, or holds an error deeper
 *   down, is still the right shape, and the rule runs (second review of
 *   R1).
 *
 * The Schemas this runs over are written in the file's own keys with no
 * transformation, so a raw value is what Effect would have checked; a test
 * walks each Schema and refuses a transformation.
 */
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

/** The mark a cross-field rule carries on its filter. */
export interface CrossFieldMark {
  /** Stable identity: what the planted-defect test keys on. */
  readonly id: string;
  /**
   * The fields the rule reads, as paths below its node: `min`, or `*.type`
   * for every item of a list. It is skipped where one of them is missing
   * or of the wrong kind.
   */
  readonly reads: readonly string[];
}

/**
 * One rule over several fields, as `Struct(...).check` or
 * `Array(...).check` takes it. The predicate returns what an Effect filter
 * may: `true` or `undefined` when it holds, `false` to fail with `message`,
 * or issues of its own -- `{ path, issue }` to point below the node, an
 * array for several -- which are reported where they point, by Effect and
 * by the harness alike.
 */
export function crossField<T>(
  mark: CrossFieldMark,
  holds: (value: T) => Schema.FilterOutput,
  message: string,
  annotations: CrossFieldAnnotations = {},
) {
  // The mark rides on the filter's annotations, which Effect hands back on
  // the issue it reports.
  return Schema.makeFilter((value: T) => holds(value), {
    ...annotations,
    message,
    crossField: mark,
  });
}

/**
 * What else a marked rule may carry: an `arbitraryConstraint` that steers
 * derivation, and a `messageWithin` that names the enclosing element
 * (`problems.ts`).
 */
export interface CrossFieldAnnotations {
  readonly arbitraryConstraint?: { readonly minLength?: number; };
  readonly messageWithin?: MessageWithin;
}

/**
 * A rule's message that names the element enclosing the one at fault, read
 * with that element's label in sentence case (`fact type "F"`), or with
 * none when the element is decoded alone. A constraint listed under the
 * wrong fact type is the case: its own Schema cannot know the fact type's
 * name, and the sentence `format30.test.ts` pins names it (R2).
 */
export type MessageWithin = (enclosing: string | undefined) => string;

/**
 * A marked rule that is also a type guard, as `Schema.refine` takes one:
 * the value's decoded type narrows to what the guard proves. For a rule
 * that fails at the node itself, such as a list's minimum stated as a
 * tuple, or a guard that never holds, which removes a member from a union's
 * decoded type.
 */
export function crossFieldGuard<S extends Schema.Top, T extends S["Type"]>(
  mark: CrossFieldMark,
  guard: (value: S["Type"]) => value is T,
  message: string,
  annotations: CrossFieldAnnotations = {},
): (schema: S) => Schema.refine<T, S> {
  return Schema.refine<S, T>(guard, { ...annotations, message, crossField: mark });
}

/** The cross-field mark on a check, if it has one. */
export function markOf(check: unknown): CrossFieldMark | undefined {
  const mark = (check as { annotations?: { crossField?: CrossFieldMark; }; })?.annotations
    ?.crossField;
  return mark && typeof mark.id === "string" ? mark : undefined;
}

/**
 * Issue tags that mean a field is missing or of the wrong kind. A failed
 * union (`AnyOf`) is one too, handled in its own case below.
 */
const STRUCTURAL = new Set(["MissingKey", "InvalidType", "InvalidValue"]);

/**
 * The paths below a failed node where a field is missing or of the wrong
 * kind. A check's failure is not one: its value had the right shape.
 */
function structuralPaths(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[] = [],
): PropertyKey[][] {
  switch (issue._tag) {
    case "Pointer":
      return structuralPaths(issue.issue, [...path, ...issue.path]);
    case "Composite":
      return issue.issues.flatMap((child) => structuralPaths(child, path));
    case "Encoding":
      return structuralPaths(issue.issue, path);
    case "Filter":
      return [];
    case "AnyOf":
      return issue.issues.length === 1 ? structuralPaths(issue.issues[0]!, path) : [[...path]];
    default:
      return STRUCTURAL.has(issue._tag) ? [[...path]] : [];
  }
}

/**
 * Whether a broken path covers a read path (`min`, `*.type`): it names
 * the field the rule reads, or one of its parents. A rule reading
 * `*.type` must not run over an item that is `null` (third review of R1).
 */
function covers(path: readonly PropertyKey[], read: string): boolean {
  const segments = read.split(".");
  return path.length <= segments.length
    && path.every((p, i) => segments[i] === "*" || segments[i] === String(p));
}

/**
 * The marked rules of a failed struct or list that Effect did not run,
 * each run on the raw value, as issues to report beside Effect's own.
 * `failed` is the Composite issue Effect reported for the node.
 */
export function extraChecks(failed: SchemaIssue.Composite, raw: unknown): SchemaIssue.Issue[] {
  const ast = failed.ast;
  if (ast._tag !== "Objects" && ast._tag !== "Arrays") return [];
  // A node's checks are a check's own issue only once all its fields
  // decoded, and then Effect runs every one of them, the passing ones
  // included: a failed check here means none is left to run.
  if (failed.issues.some((child) => child._tag === "Filter")) return [];
  const broken = structuralPaths(failed);
  const extra: SchemaIssue.Issue[] = [];
  for (const check of ast.checks ?? []) {
    const mark = markOf(check);
    if (!mark || check._tag !== "Filter") continue;
    if (mark.reads.some((read) => broken.some((path) => covers(path, read)))) continue;
    // Not caught: every field the rule reads has the right shape, so a rule
    // that throws here has a bug, and a silent skip would hide it.
    const issue = check.run(raw, ast, {});
    if (issue !== undefined) extra.push(new SchemaIssue.Filter(check, issue, raw));
  }
  return extra;
}
