/**
 * What a decoder reports: one problem per line, each naming its element and
 * the field at fault (docs/specs/effect-adoption.spec.md, S4).
 *
 * The decoders read the file's own spelling, so a problem's path is the
 * path in the file (`value_constraint.ranges.0`). One walk over Effect's
 * issue tree turns it into problems: it knows which element each problem
 * belongs to, because an element's Schema carries an `element` annotation
 * (`elementOf`) that the walk meets on the way down, so a problem deep in a
 * document is labelled by the constraint or object type it sits in, not by
 * the document (second review of R1). At each failed struct or list it adds
 * the cross-field rules Effect did not run (`harness.ts`).
 */
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import { extraChecks, type MessageWithin } from "./harness.js";

/** One thing wrong with one element. */
export interface DecodeProblem {
  /** How a person finds the element: its name, else its id, else "". */
  readonly element: string;
  /**
   * Where the element sits in the decoded value: `[]` for the value
   * itself, `["object_types", 3]` in a document. What finds an element
   * that has no name or id (third review of R1).
   */
  readonly at: readonly PropertyKey[];
  /** The path below the element, in the file's spelling. */
  readonly path: readonly PropertyKey[];
  /** A sentence naming the element and the field. */
  readonly message: string;
}

/** A path below an element, as a message names it: `ranges.0.min`. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

/** How a message names an element, read from its raw value. */
export interface ElementLabel {
  readonly label: string;
  readonly identity: string;
}

/**
 * The annotation an element's Schema carries: how to name one from its
 * raw value, and the sentence for a union of variants none of which the
 * value's tag selects.
 */
export interface ElementAnnotation {
  readonly describe: (raw: unknown) => ElementLabel;
  readonly badTag: string;
  /** What a value that is not a mapping is called: "Object type". */
  readonly noun: string;
  /**
   * The field the tag lives in, where a tag that selects no variant is
   * reported: a constraint's `type`. Without it, at the element itself.
   */
  readonly tagField?: string;
}

/**
 * What a message calls an element named by its `name`: by the name as the
 * model stores it, trimmed; by its id when the name is missing or blank --
 * which is when the name is the problem; and, lacking both, by its noun.
 * Object types and fact types alike.
 */
export function labelByNameOrId(noun: string, raw: unknown): ElementLabel {
  const doc = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  if (name !== "") return { label: `${noun} "${name}"`, identity: name };
  if (typeof doc.id === "string" && doc.id !== "") {
    return { label: `${noun} with id "${doc.id}"`, identity: doc.id };
  }
  return { label: `${noun} with no name or id`, identity: "" };
}

/** Mark a Schema as an element, for `problemsOf`. */
export function elementOf(annotation: ElementAnnotation) {
  return { element: annotation } as const;
}

const elementAt = (ast: SchemaAST.AST | undefined): ElementAnnotation | undefined =>
  (ast?.annotations as { element?: ElementAnnotation; } | undefined)?.element;

const isMapping = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

const defaultFormat = SchemaIssue.makeFormatterDefault();

/** The message an issue carries itself, if it has one. */
function ownMessage(issue: SchemaIssue.Issue, enclosing?: ElementLabel): string | undefined {
  const within = issue._tag === "Filter"
    ? (issue.filter.annotations as { messageWithin?: MessageWithin; } | undefined)?.messageWithin
    : undefined;
  if (within) return within(enclosing && inSentence(enclosing.label));
  const message = issue._tag === "InvalidType"
    ? issue.ast.annotations?.message
    : issue._tag === "InvalidValue" || issue._tag === "MissingKey"
    ? issue.annotations?.message
    : issue._tag === "Filter"
    ? issue.filter.annotations?.message
    : issue._tag === "AnyOf"
    ? issue.ast.annotations?.message
    : undefined;
  return typeof message === "string" ? message : undefined;
}

/**
 * The rest of the sentence after the element's label and the field's path.
 * A rule's own message is used as it is; Effect's structural refusals -- an
 * unknown key, a missing key, a wrong type -- are phrased here, because its
 * text names neither the element nor the field. `fallback` is the message of
 * a rule whose failure this leaf is part of.
 */
function predicateOf(issue: SchemaIssue.Issue, fallback: string | undefined): string {
  if (issue._tag === "UnexpectedKey") return "is not a field this element has.";
  if (issue._tag === "MissingKey") {
    return issue.annotations?.messageMissingKey ?? ownMessage(issue) ?? "is missing.";
  }
  // Effect's text can run to several lines; a problem is one.
  return ownMessage(issue) ?? fallback
    ?? `is invalid: ${defaultFormat(issue).replace(/\s*\n\s*/g, " ")}.`;
}

/** A label as it reads inside a sentence: `Fact type "F"` as `fact type "F"`. */
const inSentence = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

interface Context {
  readonly label: ElementLabel;
  /** Where the element starts: a problem's path is reported below it. */
  readonly base: number;
  /** The element this one sits in, if it is decoded inside one. */
  readonly enclosing?: ElementLabel;
}

const ROOTLESS: ElementLabel = { label: "The document", identity: "" };

/** Every problem in an issue tree, the harness's included unless `harness` is off. */
export function problemsOf(
  issue: SchemaIssue.Issue,
  raw: unknown,
  { harness = true }: { readonly harness?: boolean; } = {},
): DecodeProblem[] {
  const out: DecodeProblem[] = [];
  const push = (context: Context, path: readonly PropertyKey[], predicate: string) => {
    const below = path.slice(context.base);
    out.push({
      element: context.label.identity,
      at: path.slice(0, context.base),
      path: below,
      message: below.length === 0
        ? `${context.label.label} ${predicate}`
        : `${context.label.label}: ${fieldPath(below)} ${predicate}`,
    });
  };

  const enter = (
    ast: SchemaAST.AST | undefined,
    value: unknown,
    path: readonly PropertyKey[],
    context: Context,
  ): Context => {
    const element = elementAt(ast);
    return element
      ? {
        label: element.describe(value),
        base: path.length,
        // The bare root is no element, so an element directly in it has none around it.
        ...(context.label !== ROOTLESS ? { enclosing: context.label } : {}),
      }
      : context;
  };

  // An element that is not a mapping: named by its noun, and, below the
  // root, by where it sits, since it has no name to be found by.
  const notAMapping = (element: ElementAnnotation, path: readonly PropertyKey[]) =>
    push(
      {
        label: {
          label: path.length === 0 ? element.noun : `${element.noun} at ${fieldPath(path)}`,
          identity: "",
        },
        base: path.length,
      },
      path,
      "must be a mapping of fields.",
    );

  const walk = (
    node: SchemaIssue.Issue,
    value: unknown,
    path: readonly PropertyKey[],
    context: Context,
    fallback: string | undefined,
  ): void => {
    switch (node._tag) {
      case "Pointer": {
        let inner = value;
        for (const segment of node.path) {
          inner = isMapping(inner) || Array.isArray(inner)
            ? (inner as Record<PropertyKey, unknown>)[segment]
            : undefined;
        }
        walk(node.issue, inner, [...path, ...node.path], context, fallback);
        return;
      }
      case "Composite": {
        const here = enter(node.ast, value, path, context);
        const children = harness ? [...node.issues, ...extraChecks(node, value)] : node.issues;
        for (const child of children) walk(child, value, path, here, fallback);
        return;
      }
      case "Encoding":
        walk(node.issue, value, path, context, fallback);
        return;
      case "AnyOf": {
        const element = elementAt(node.ast);
        const here = enter(node.ast, value, path, context);
        if (node.issues.length === 1) {
          walk(node.issues[0]!, value, path, here, fallback);
          return;
        }
        // No member, or several, took the value. At an element that is a
        // wrong tag -- or, for a value that is not a mapping at all, that.
        if (element) {
          if (!isMapping(value)) notAMapping(element, path);
          else push(here, element.tagField ? [...path, element.tagField] : path, element.badTag);
          return;
        }
        push(context, path, predicateOf(node, fallback));
        return;
      }
      case "Filter": {
        // A rule's own failure: its issues are reported where they point,
        // each in its own words or, lacking any, the rule's.
        const message = ownMessage(node, context.enclosing) ?? fallback;
        const inner = node.issue;
        if (inner._tag === "Pointer") {
          walk(inner, value, path, context, message);
        } else if (inner._tag === "Composite") {
          // A rule's several issues, wrapped in a Composite at its own node:
          // not a failure of that node, so its rules are not run again
          // (third review of R1, where that recursed without end).
          for (const child of inner.issues) walk(child, value, path, context, message);
        } else {
          push(context, path, ownMessage(inner) ?? message ?? predicateOf(inner, undefined));
        }
        return;
      }
      default: {
        // A struct element given something that is not a mapping.
        const element = node._tag === "InvalidType" ? elementAt(node.ast) : undefined;
        if (element && !isMapping(value)) notAMapping(element, path);
        else push(context, path, predicateOf(node, fallback));
      }
    }
  };

  walk(issue, raw, [], { label: ROOTLESS, base: 0 }, undefined);
  return out;
}
