/**
 * Values drawn from the shipped, hand-written JSON Schema, for holding an
 * Effect decoder to today's reader in both directions
 * (docs/specs/effect-adoption.spec.md, 1r; review of R1).
 *
 * A decoder's own derived values come from the Schema under test, and the
 * corpus is today's writer's output, so neither can show the decoder
 * refusing something today's reader accepts: an empty `definition`, a
 * `min_inclusive: true`, an integer above 2^53. These come from the other
 * answer key. They follow the JSON Schema closely enough that most are
 * valid, and stray from it often enough -- a blank string, a count below
 * its minimum, an empty list, a field the branch forbids, an unknown key --
 * that refusals are compared too. Which is which is not this generator's to
 * say: the test asks today's reader.
 *
 * It reads the subset of JSON Schema the model schema uses; a keyword it
 * does not know is refused, so a schema change cannot silently narrow it.
 * Every keyword it knows it honours, `additionalProperties` by the test
 * asking today's reader about the stray key: the second review of R1 found
 * it reading `oneOf` beside `properties` as nothing, so every constraint
 * it drew was `{}`.
 */
import fc from "fast-check";

type Node = Record<string, unknown>;

const KNOWN = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minLength",
  "minItems",
  "minimum",
  "oneOf",
  "anyOf",
  "if",
  "then",
  "else",
  "$ref",
  "description",
  // Annotations and the root's metadata, read as nothing: they constrain no
  // value (R4, which draws whole documents).
  "default",
  "title",
  "$schema",
  "$id",
  "definitions",
  // A string's pattern, honoured (R4: the model's namespace).
  "pattern",
]);

/** Usually `usual`, one time in `odds + 1` the stray. */
function mostly<T>(usual: fc.Arbitrary<T>, stray: fc.Arbitrary<T>, odds = 40): fc.Arbitrary<T> {
  return fc.oneof({ weight: odds, arbitrary: usual }, { weight: 1, arbitrary: stray });
}

function stringArbitrary(node: Node): fc.Arbitrary<string> {
  const minLength = typeof node.minLength === "number" ? node.minLength : 0;
  if (typeof node.pattern === "string") {
    return mostly(
      fc.stringMatching(new RegExp(node.pattern)),
      fc.constantFrom("", "no-scheme/", "urn:x", "http://a b/"),
      10,
    );
  }
  return mostly(
    fc.string({ minLength: Math.max(minLength, 1), maxLength: 12 }),
    fc.constantFrom("", " ", "  \t"),
  );
}

function integerArbitrary(node: Node): fc.Arbitrary<number> {
  const min = typeof node.minimum === "number" ? node.minimum : 0;
  return mostly(
    fc.integer({ min, max: min + 50 }),
    fc.constantFrom(2 ** 53 + 2, 2 ** 60, min - 1),
    20,
  );
}

/** An arbitrary for one JSON Schema node, resolving `$ref` into `definitions`. */
export function fromJsonSchema(root: Node, node: Node): fc.Arbitrary<unknown> {
  for (const key of Object.keys(node)) {
    if (!KNOWN.has(key)) throw new Error(`jsonSchemaArbitrary does not read "${key}"`);
  }
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/definitions/", "");
    const target = (root.definitions as Record<string, Node>)[name];
    if (!target) throw new Error(`no definition ${name}`);
    return fc.constant(null).chain(() => fromJsonSchema(root, target));
  }
  if (node.const !== undefined) return fc.constant(node.const);
  if (Array.isArray(node.enum)) {
    return mostly(fc.constantFrom(...node.enum), fc.constant("nonesuch"));
  }
  const branches = (node.oneOf ?? node.anyOf) as Node[] | undefined;
  if (branches && node.type === undefined && node.properties === undefined) {
    return fc.oneof(...branches.map((b) => fromJsonSchema(root, b)));
  }
  switch (node.type) {
    case "string":
      return stringArbitrary(node);
    case "integer":
      return integerArbitrary(node);
    case "number":
      return fc.double({ noNaN: true });
    case "boolean":
      return fc.boolean();
    case "array": {
      const minItems = typeof node.minItems === "number" ? node.minItems : 0;
      return mostly(
        fc.array(fromJsonSchema(root, (node.items ?? {}) as Node), {
          minLength: minItems,
          maxLength: minItems + 3,
        }),
        fc.constant([]),
      );
    }
    case "object":
    case undefined:
      // A tagged union written as one object with a `oneOf` of variants,
      // or an `anyOf` naming which fields must be present: one branch is
      // chosen and its properties and requirements join the node's. An
      // `if` chooses `then` or `else` the same way.
      return fc.constantFrom(...(branches ?? [undefined])).chain((branch) =>
        fc.constantFrom(...(node.if ? ["then", "else"] as const : [undefined])).chain((side) =>
          objectArbitrary(root, node, branch, side)
        )
      );
    default:
      throw new Error(`jsonSchemaArbitrary does not read type ${String(node.type)}`);
  }
}

/**
 * A uniform percentage, for the generator's own coin flips. Not
 * `fc.double`, which leans on 0 and the bounds to find edge cases and so
 * fired every flip at once.
 */
const percent = fc.noBias(fc.integer({ min: 0, max: 99 }));

/**
 * The one condition an `if` may state: a property holding a constant.
 * Anything else is refused, as an unknown keyword is.
 */
function conditionOf(node: Node): [string, unknown] {
  const properties = (node.if as Node).properties as Record<string, Node> | undefined;
  const entries = Object.entries(properties ?? {});
  const [key, schema] = entries[0] ?? [];
  if (entries.length !== 1 || Object.keys(node.if as Node).length !== 1 || !schema?.const) {
    throw new Error("jsonSchemaArbitrary reads an `if` only as one property's const");
  }
  return [key!, schema.const];
}

/**
 * An object: each required property usually present, each optional one
 * sometimes, and now and then a key the schema does not name. `branch` is
 * the `oneOf` or `anyOf` member chosen for it, and `side` the side of
 * its `if`: the condition's property is made to hold or not to, and that
 * side's requirements join, and its forbidden properties are left out
 * (third review of R1, which found both sides merged whatever the
 * condition said).
 */
function objectArbitrary(
  root: Node,
  node: Node,
  branch: Node | undefined,
  side: "then" | "else" | undefined,
): fc.Arbitrary<unknown> {
  const conditional = side === undefined ? undefined : node[side] as Node | undefined;
  for (const part of [branch, conditional]) {
    for (const key of Object.keys(part ?? {})) {
      if (!KNOWN.has(key)) throw new Error(`jsonSchemaArbitrary does not read "${key}"`);
    }
  }
  const properties: Record<string, unknown> = {
    ...(node.properties as Record<string, unknown> | undefined),
    ...(branch?.properties as Record<string, unknown> | undefined),
    ...(conditional?.properties as Record<string, unknown> | undefined),
  };
  if (side !== undefined) {
    const [key, value] = conditionOf(node);
    properties[key] = side === "then"
      ? { const: value }
      : {
        ...(properties[key] as Node),
        enum: ((properties[key] as Node).enum as unknown[])
          .filter((v) => v !== value),
      };
  }
  const required = new Set([
    ...((node.required ?? []) as string[]),
    ...((branch?.required ?? []) as string[]),
    ...((conditional?.required ?? []) as string[]),
  ]);
  // A property this side forbids is drawn from the node's own schema for
  // it, rarely: the stray that shows a forbidden field refused.
  const base = (node.properties ?? {}) as Record<string, Node>;
  const entries = Object.entries(properties).flatMap(([key, v]): [string, Node, number][] =>
    v !== false
      ? [[key, v as Node, required.has(key) ? 99 : 30]]
      : base[key]
      ? [[key, base[key], 3]]
      : []
  );
  const fields = entries.map(([key, schema, odds]) =>
    fc.tuple(fc.constant(key), fromJsonSchema(root, schema), percent.map((r) => r < odds))
  );
  return fc.tuple(fc.tuple(...fields), percent).map(([values, r]) => {
    const out: Record<string, unknown> = {};
    for (const [key, value, present] of values) if (present) out[key] = value;
    if (r < 2) out.colour = "blue";
    return out;
  });
}
