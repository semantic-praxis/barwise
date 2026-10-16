/**
 * Effect's issue tree, as the failures a person reads one per line.
 *
 * Shared by the object type and constraint decoders, which differ in how they
 * name their element and in how the file spells a field; the walk over the
 * tree and the wording of Effect's own structural refusals are the same.
 */
import * as SchemaIssue from "effect/SchemaIssue";

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
    case "Filter": {
      // A filter that points its failure at a field reports it there. One
      // with an authored message keeps the message, at the field it points
      // to; one without is reported by what it pointed at.
      const inner = issue.issue;
      if (issue.filter.annotations?.message !== undefined) {
        return inner._tag === "Pointer" ? [{ path: [...path, ...inner.path], issue }] : [{
          path,
          issue,
        }];
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

/**
 * A path in the spelling of the input it points into.
 *
 * Effect reports a rule stated on a decoded struct at the decoded key, which
 * the input may spell differently (`roleIds` for a file's `roles`). Each
 * segment the input lacks is replaced by the first of its spellings the input
 * has. When it has none -- the key is missing altogether -- `whenAbsent:
 * "first"` names the first spelling, so a file is never told about a key it
 * cannot write; a config decoder leaves the segment as it is, because there
 * the decoded key is the caller's spelling. An unknown key the input does
 * have is left as written.
 */
export function spelledAs(
  raw: unknown,
  path: readonly PropertyKey[],
  spellingsOf: (key: string) => readonly string[],
  whenAbsent: "first" | "keep" = "keep",
): PropertyKey[] {
  const spelled: PropertyKey[] = [];
  let node = raw;
  for (const segment of path) {
    let key = segment;
    if (node !== null && typeof node === "object") {
      const record = node as Record<PropertyKey, unknown>;
      if (typeof segment === "string" && !(segment in record)) {
        const spellings = spellingsOf(segment);
        const found = spellings.find((k) => k in record);
        if (found !== undefined) key = found;
        else if (whenAbsent === "first" && spellings[0] !== undefined) key = spellings[0];
      }
      node = record[key];
    } else {
      node = undefined;
    }
    spelled.push(key);
  }
  return spelled;
}
