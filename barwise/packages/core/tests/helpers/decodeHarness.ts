/**
 * What the cross-field harness tests ask of any element's Schema
 * (docs/specs/effect-adoption.spec.md, 1r): the problems a decode reports,
 * harness on or off; every marked rule in the Schema; and the fields each
 * rule reads. Shared by the object type and constraint harness tests, so
 * the R3 and R4 elements are held the same way.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import { DECODE_OPTIONS } from "../../src/decode/decoder.js";
import { type CrossFieldMark, markOf } from "../../src/decode/harness.js";
import { fieldPath, problemsOf } from "../../src/decode/problems.js";

const decoders = new WeakMap<
  Schema.Top,
  (raw: unknown) => Effect.Effect<unknown, Schema.SchemaError>
>();

/** Every path a decode reports, through the shell's own walk, harness on or off. */
export function reportedPaths(schema: Schema.Top, raw: unknown, harness = true): string[] {
  // One decoder per Schema: the constraint harness decodes tens of thousands of inputs.
  if (!decoders.has(schema)) {
    // The element Schemas need no services, so the decode runs synchronously.
    decoders.set(
      schema,
      Schema.decodeUnknownEffect(schema, DECODE_OPTIONS) as (
        raw: unknown,
      ) => Effect.Effect<unknown, Schema.SchemaError>,
    );
  }
  const result = Effect.runSync(Effect.result(decoders.get(schema)!(raw)));
  if (Result.isSuccess(result)) return [];
  return problemsOf(result.failure.issue, raw, { harness }).map((p) => fieldPath(p.path)).sort();
}

/** Every node of a Schema, through every child the harness walks. */
export function nodesOf(ast: SchemaAST.AST, seen = new Set<SchemaAST.AST>()): SchemaAST.AST[] {
  if (seen.has(ast)) return [];
  seen.add(ast);
  const children: SchemaAST.AST[] = ast._tag === "Objects"
    ? [...ast.propertySignatures.map((ps) => ps.type), ...ast.indexSignatures.map((i) => i.type)]
    : ast._tag === "Arrays"
    ? [...ast.elements, ...ast.rest]
    : ast._tag === "Union"
    ? [...ast.types]
    : ast._tag === "Suspend"
    ? [ast.thunk()]
    : [];
  return [ast, ...children.flatMap((child) => nodesOf(child, seen))];
}

export interface MarkedCheck {
  readonly node: SchemaAST.AST;
  readonly check: SchemaAST.Filter<unknown>;
  readonly mark: CrossFieldMark;
}

/** Every rule `crossField` (or a mark on a refinement) put in the Schema. */
export const markedChecks = (ast: SchemaAST.AST): MarkedCheck[] =>
  nodesOf(ast).flatMap((node) =>
    (node.checks ?? []).flatMap((check) => {
      const mark = markOf(check);
      return mark && check._tag === "Filter"
        ? [{ node, check: check as SchemaAST.Filter<unknown>, mark }]
        : [];
    })
  );

type Fill = "absent" | "number" | "string" | "shaped";
const FILLS: readonly Fill[] = ["absent", "number", "string", "shaped"];

/**
 * The paths a check reads of the value it runs on, as `CrossFieldMark.reads`
 * spells them: `min`, `operand.path.root`, `*.type` for every item of a list
 * (barwise-nh5). The value has its node's shape, and each field below it is
 * filled, one run at a time, with nothing, a number, a string, and a value
 * of the field's own shape -- a list where the Schema has a list, a mapping
 * where it has a struct, all the way down -- so a predicate that branches on
 * what it reads is followed down each branch, and one that calls a list's
 * methods (`readings.flatMap`) meets a list (R3). Only the deepest paths
 * are kept: reading `a.b` reads `a` on the way.
 */
export function keysRead(check: MarkedCheck["check"], node: SchemaAST.AST): string[] {
  const read = new Set<string>();
  const join = (prefix: string, key: string) => (prefix === "" ? key : `${prefix}.${key}`);

  /** A value of an AST's shape, with every field below it recorded as it is read. */
  const shaped = (path: string, ast: SchemaAST.AST | undefined): unknown => {
    switch (ast?._tag) {
      case "Arrays":
        return proxyAt(path, ast, "shaped");
      case "Objects":
        return proxyAt(path, ast, "shaped");
      case "Union": {
        const container = ast.types.find((t) => t._tag === "Objects" || t._tag === "Arrays");
        return shaped(path, container ?? ast.types[0]);
      }
      case "Suspend":
        return shaped(path, ast.thunk());
      case "Literal":
        return ast.literal;
      case "Number":
        return 1;
      case "Boolean":
        return true;
      case "String":
        return "x";
      default:
        // Unknown below this point: a mapping that records whatever is read.
        return proxyAt(path, undefined, "shaped");
    }
  };

  const fillAt = (path: string, fill: Fill, ast: SchemaAST.AST | undefined): unknown =>
    fill === "absent"
      ? undefined
      : fill === "number"
      ? 1
      : fill === "string"
      ? "x"
      : shaped(path, ast);

  // A built-in a predicate calls (`length`, `map`, `valueOf`) is not a field
  // it reads, and an index of a list is every item, `*`. A comparison
  // coerces its operands, and a list's coercion joins its items, which
  // would read as a read of each: a filler coerces to NaN, reading nothing.
  function proxyAt(path: string, ast: SchemaAST.AST | undefined, fill: Fill): object {
    const isList = ast?._tag === "Arrays";
    const target: object = isList ? [undefined] : {};
    const fieldAst = (key: string) =>
      ast?._tag === "Objects"
        ? ast.propertySignatures.find((ps) => String(ps.name) === key)?.type
        : undefined;
    return new Proxy(target, {
      get: (t, key, receiver) => {
        if (key === Symbol.toPrimitive) return () => Number.NaN;
        if (typeof key !== "string") return Reflect.get(t, key, receiver);
        if (isList && /^\d+$/.test(key)) {
          const item = join(path, "*");
          read.add(item);
          return fill === "absent" ? undefined : shaped(item, ast.rest[0] ?? ast.elements[0]);
        }
        if (key in t) return Reflect.get(t, key, receiver);
        // A mapping filler standing where the field is a list.
        if (key === "length") return 1;
        const at = join(path, key);
        read.add(at);
        return fillAt(at, fill, fieldAst(key));
      },
      has: (t, key) => {
        if (typeof key === "string" && !(key in t)) read.add(join(path, key));
        return isList ? Reflect.has(t, key) : fill !== "absent";
      },
    });
  }

  for (const fill of FILLS) {
    try {
      check.run(proxyAt("", node, fill), node, {});
    } catch {
      // A predicate that cannot read a filler value still recorded what it read.
    }
  }
  const paths = [...read];
  return paths.filter((p) => !paths.some((q) => q !== p && q.startsWith(`${p}.`))).sort();
}
