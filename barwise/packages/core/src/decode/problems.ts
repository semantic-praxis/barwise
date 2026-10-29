/**
 * What a decoder reports: one problem per line, each naming its element and
 * the field at fault (docs/specs/effect-adoption.spec.md, S4).
 *
 * The decoders read the file's own spelling, so a problem's path is the
 * path in the file (`value_constraint.ranges.0`), and a message is written
 * around it. Shared by every element kind's decoder, so one rule reads one
 * way whichever element reported it.
 */
import * as SchemaIssue from "effect/SchemaIssue";

/** One thing wrong with one element. */
export interface DecodeProblem {
  /** How a person finds the element: its name, else its id, else "". */
  readonly element: string;
  /** The path below the element, in the file's spelling. */
  readonly path: readonly PropertyKey[];
  /** A sentence naming the element and the field. */
  readonly message: string;
}

/** A path below an element, as a message names it: `ranges.0.min`. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

/** One failure in an issue tree, with the path that leads to it. */
export interface Located {
  readonly path: readonly PropertyKey[];
  readonly issue: SchemaIssue.Issue;
}

/**
 * The failures in an issue tree, one per problem.
 *
 * A union is descended only when one member was tried: that is a
 * discriminated union picking its variant by its tag (`kind`, `type`), and
 * the problems are that variant's. A union none of whose members applied,
 * or several, is one problem at its own position -- `max: "lots"` is one bad
 * value, not one per member it failed to match. A failed check with its own
 * message is one problem where it ran; one without is reported by what it
 * points at.
 */
export function locate(issue: SchemaIssue.Issue, path: readonly PropertyKey[] = []): Located[] {
  switch (issue._tag) {
    case "Pointer":
      return locate(issue.issue, [...path, ...issue.path]);
    case "Composite":
      return issue.issues.flatMap((child) => locate(child, path));
    case "Encoding":
      return locate(issue.issue, path);
    case "Filter": {
      const inner = issue.issue;
      if (issue.filter.annotations?.message !== undefined) {
        return inner._tag === "Pointer"
          ? [{ path: [...path, ...inner.path], issue }]
          : [{ path, issue }];
      }
      return inner._tag === "Pointer" || inner._tag === "Composite"
        ? locate(inner, path)
        : [{ path, issue }];
    }
    case "AnyOf":
      return issue.issues.length === 1 ? locate(issue.issues[0]!, path) : [{ path, issue }];
    default:
      return [{ path, issue }];
  }
}

const defaultFormat = SchemaIssue.makeFormatterDefault();

/**
 * The rest of the sentence after the element's label and its field's path.
 *
 * A rule a Schema states carries its predicate as a `message` annotation,
 * used as it is. What is left is Effect's own structural refusals -- an
 * unknown key, a missing key, a wrong type -- phrased here, because
 * Effect's text names neither the element nor the field. `atRoot` words a
 * union that matched no variant at the element itself: its tag is wrong.
 */
export function predicateOf(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  atRoot: string,
): string {
  switch (issue._tag) {
    case "UnexpectedKey":
      return "is not a field this element has.";
    case "MissingKey":
      return issue.annotations?.messageMissingKey ?? "is missing.";
    case "AnyOf": {
      const message = issue.ast.annotations?.message;
      if (typeof message === "string") return message;
      if (path.length === 0) return atRoot;
      break;
    }
    case "Filter": {
      const message = issue.filter.annotations?.message;
      if (typeof message === "string") return message;
      break;
    }
    case "InvalidType":
    case "InvalidValue": {
      const message = issue._tag === "InvalidType"
        ? issue.ast.annotations?.message
        : issue.annotations?.message;
      if (typeof message === "string") return message;
      break;
    }
  }
  return `is invalid: ${defaultFormat(issue)}.`;
}

/**
 * The sentence for one problem: the element's label, the field's path when
 * the problem is below the element, and the predicate.
 * `Entity type "Customer": reference_mode is missing.`
 */
export function sentence(label: string, path: readonly PropertyKey[], predicate: string): string {
  return path.length === 0 ? `${label} ${predicate}` : `${label}: ${fieldPath(path)} ${predicate}`;
}
