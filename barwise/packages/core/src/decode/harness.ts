/**
 * Rules that span several fields of one struct, reported whatever else is
 * wrong (docs/specs/effect-adoption.spec.md, WS1b part A; 1r, R1).
 *
 * Effect runs a struct's `.check` filters only once every field of that
 * struct has decoded. A rule over two fields -- a cardinality's `max >= min`,
 * a range's "a min or a max" -- therefore goes unreported beside any field
 * error in the same struct, and a file with two problems would be fixed
 * one at a time. #672 compensated in four places, each written for its
 * case. This is the one mechanism instead:
 *
 * - A rule is stated once, on the struct, by `crossField`, which marks the
 *   filter with an identity and the fields it reads.
 * - When a decode fails, `crossFieldProblems` walks the Schema's AST beside
 *   the raw input -- struct properties by key, arrays by index, a union by
 *   the member its literal tag selects -- and runs every marked rule at a
 *   node where none of the fields it reads failed.
 * - A failure Effect already reported, at the same path for the same rule,
 *   is not reported again, so a rule is reported once whether or not
 *   Effect ran it, and two rules failing at one node are both kept.
 *
 * Two facts make this exact, both probed on Effect 4.0.5 before it was
 * written: a failed check comes back as a `Filter` issue carrying the
 * filter it ran, so a rule Effect reported is recognised by identity; and a
 * filter's `run` takes the raw value. The Schemas it walks are written in
 * the file's own keys with no transformations, so a struct whose fields
 * decoded is the raw value, and running a rule on the raw value is running
 * it on what Effect would have checked.
 */
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import { type Located } from "./problems.js";

/** The mark a cross-field rule carries on its filter. */
export interface CrossFieldMark {
  /** Stable identity: what the planted-defect test and the dedupe key on. */
  readonly id: string;
  /** The struct's fields the rule reads; it runs only where none failed. */
  readonly reads: readonly string[];
}

/** One rule over several fields, as a filter `Struct(...).check` takes. */
export function crossField<T>(mark: CrossFieldMark, holds: (value: T) => boolean, message: string) {
  // The mark rides on the filter's annotations, which Effect hands back on
  // the issue it reports.
  return Schema.makeFilter(holds, { message, crossField: mark });
}

/** The cross-field mark on a check, if it has one. */
export function markOf(check: unknown): CrossFieldMark | undefined {
  const mark = (check as { annotations?: { crossField?: CrossFieldMark; }; })?.annotations
    ?.crossField;
  return mark && typeof mark.id === "string" ? mark : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const startsWith = (path: readonly PropertyKey[], prefix: readonly PropertyKey[]) =>
  prefix.every((segment, i) => path[i] === segment);

const samePath = (a: readonly PropertyKey[], b: readonly PropertyKey[]) =>
  a.length === b.length && startsWith(a, b);

/**
 * The cross-field failures Effect did not report, as located issues beside
 * the ones it did. `located` is what Effect reported for this decode.
 */
export function crossFieldProblems(
  ast: SchemaAST.AST,
  raw: unknown,
  located: readonly Located[],
): Located[] {
  const found: Located[] = [];
  walk(ast, raw, [], located, found);
  return found;
}

function walk(
  ast: SchemaAST.AST,
  raw: unknown,
  path: readonly PropertyKey[],
  located: readonly Located[],
  found: Located[],
): void {
  switch (ast._tag) {
    case "Objects": {
      if (!isRecord(raw)) return;
      for (const check of ast.checks ?? []) {
        const mark = markOf(check);
        if (!mark || check._tag !== "Filter") continue;
        // A rule reads only fields that decoded: on one that did not, its
        // own error is the report, and the rule could misread it.
        if (located.some((l) => mark.reads.some((f) => startsWith(l.path, [...path, f])))) {
          continue;
        }
        let issue;
        try {
          issue = check.run(raw, ast, {});
        } catch {
          // A rule that cannot read the value is not a failure of it.
          continue;
        }
        if (issue === undefined) continue;
        const reported = located.some((l) =>
          samePath(l.path, path) && l.issue._tag === "Filter"
          && markOf(l.issue.filter)?.id === mark.id
        );
        if (!reported) {
          found.push({ path, issue: { _tag: "Filter", filter: check, issue } as Located["issue"] });
        }
      }
      for (const ps of ast.propertySignatures) {
        const key = ps.name;
        if (typeof key === "string" && key in raw) {
          walk(ps.type, raw[key], [...path, key], located, found);
        }
      }
      return;
    }
    case "Arrays": {
      if (!Array.isArray(raw)) return;
      const item = ast.rest[0];
      if (item === undefined) return;
      raw.forEach((element, i) => walk(item, element, [...path, i], located, found));
      return;
    }
    case "Union": {
      const member = memberFor(ast, raw);
      if (member) walk(member, raw, path, located, found);
      return;
    }
    case "Suspend":
      walk(ast.thunk(), raw, path, located, found);
      return;
    default:
      return;
  }
}

/**
 * The member of a union the raw value's literal tag selects: the one struct
 * whose literal property the value matches. None when no member or several
 * do, which is a union mismatch Effect has already reported.
 */
function memberFor(ast: SchemaAST.Union, raw: unknown): SchemaAST.AST | undefined {
  if (!isRecord(raw)) return undefined;
  const matching = ast.types.filter((member) =>
    member._tag === "Objects"
    && member.propertySignatures.some((ps) =>
      SchemaAST.isLiteral(ps.type) && typeof ps.name === "string"
      && raw[ps.name] === ps.type.literal
    )
  );
  return matching.length === 1 ? matching[0] : undefined;
}
