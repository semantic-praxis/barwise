/**
 * Effect's issue tree, as the failures a person reads one per line.
 *
 * Shared by the object type and constraint decoders, which differ in how they
 * name their element and in how the file spells a field; the walk over the
 * tree and the wording of Effect's own structural refusals are the same.
 */
import type * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaIssueRuntime from "effect/SchemaIssue";

/** One failure in the issue tree, with the path that leads to it. */
export interface Located {
  readonly path: readonly PropertyKey[];
  readonly issue: SchemaIssue.Issue;
}

/**
 * The failures in an issue tree, one per problem.
 *
 * A union is descended only when one member was tried: that is a
 * discriminated union picking its variant by its tag (`kind`, `type`), and
 * the problems are that variant's. A union none of whose members applied, or
 * several, is one problem at its own position -- `max: "lots"` is one bad
 * value, not one per member it failed to match.
 */
export function locate(issue: SchemaIssue.Issue, path: readonly PropertyKey[] = []): Located[] {
  switch (issue._tag) {
    case "Pointer":
      return locate(issue.issue, [...path, ...issue.path]);
    case "Composite":
      return issue.issues.flatMap((child) => locate(child, path));
    case "Encoding":
      return locate(issue.issue, path);
    case "Filter":
      // A filter that points its failure at a field reports it there.
      return issue.issue._tag === "Pointer" || issue.issue._tag === "Composite"
        ? locate(issue.issue, path)
        : [{ path, issue }];
    case "AnyOf":
      return issue.issues.length === 1 ? locate(issue.issues[0]!, path) : [{ path, issue }];
    default:
      return [{ path, issue }];
  }
}

const defaultFormat = SchemaIssueRuntime.makeFormatterDefault();

/**
 * The rest of the sentence after the element's label.
 *
 * Every rule a schema states carries its own predicate as a `message`
 * annotation; those are used as they are. What is left is Effect's own
 * structural refusals -- a wrong type, a missing key, an unknown key -- which
 * are phrased here around the path, because Effect's text names neither the
 * element nor, for a key, the field. `atRoot` words a union that matched no
 * variant at the element itself: the element's tag is what is wrong.
 */
export function predicateOf(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  atRoot: string,
): string {
  const at = path.map(String).join(".");
  switch (issue._tag) {
    case "UnexpectedKey":
      return `has an unknown field "${at}".`;
    case "MissingKey":
      return issue.annotations?.messageMissingKey ?? `is missing "${at}".`;
    case "AnyOf": {
      if (path.length === 0) return atRoot;
      const message = issue.ast.annotations?.message;
      if (typeof message === "string") return message;
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
  return `has an invalid ${at}: ${defaultFormat(issue)}.`;
}
