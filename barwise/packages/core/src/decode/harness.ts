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
) {
  // The mark rides on the filter's annotations, which Effect hands back on
  // the issue it reports.
  return Schema.makeFilter((value: T) => holds(value), { message, crossField: mark });
}

/** The cross-field mark on a check, if it has one. */
export function markOf(check: unknown): CrossFieldMark | undefined {
  const mark = (check as { annotations?: { crossField?: CrossFieldMark; }; })?.annotations
    ?.crossField;
  return mark && typeof mark.id === "string" ? mark : undefined;
}

/** Issue tags that mean a field is missing or of the wrong kind. */
const STRUCTURAL = new Set(["MissingKey", "InvalidType", "InvalidValue", "AnyOf"]);

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

/** Whether a read path (`min`, `*.type`) names a concrete path. */
function names(read: string, path: readonly PropertyKey[]): boolean {
  const segments = read.split(".");
  return segments.length === path.length
    && segments.every((s, i) => s === "*" || s === String(path[i]));
}

/**
 * The marked rules of a failed struct or list that Effect did not run,
 * each run on the raw value, as issues to report beside Effect's own.
 * `failed` is the Composite issue Effect reported for the node.
 */
export function extraChecks(failed: SchemaIssue.Composite, raw: unknown): SchemaIssue.Issue[] {
  const ast = failed.ast;
  if (ast._tag !== "Objects" && ast._tag !== "Arrays") return [];
  const ran = new Set(
    failed.issues.flatMap((child) => (child._tag === "Filter" ? [child.filter] : [])),
  );
  const broken = structuralPaths(failed);
  const extra: SchemaIssue.Issue[] = [];
  for (const check of ast.checks ?? []) {
    const mark = markOf(check);
    if (!mark || check._tag !== "Filter" || ran.has(check)) continue;
    if (mark.reads.some((read) => broken.some((path) => names(read, path)))) continue;
    // Not caught: every field the rule reads has the right shape, so a rule
    // that throws here has a bug, and a silent skip would hide it.
    const issue = check.run(raw, ast, {});
    if (issue !== undefined) extra.push(new SchemaIssue.Filter(check, issue, raw));
  }
  return extra;
}
