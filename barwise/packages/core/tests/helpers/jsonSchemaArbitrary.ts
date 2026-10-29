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
 * Every keyword it knows it honours: the second review of R1 found it
 * reading `oneOf` beside `properties` as nothing, so every constraint it
 * drew was `{}`.
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
]);

/** Usually `usual`, one time in `odds + 1` the stray. */
function mostly<T>(usual: fc.Arbitrary<T>, stray: fc.Arbitrary<T>, odds = 40): fc.Arbitrary<T> {
  return fc.oneof({ weight: odds, arbitrary: usual }, { weight: 1, arbitrary: stray });
}

function stringArbitrary(node: Node): fc.Arbitrary<string> {
  const minLength = typeof node.minLength === "number" ? node.minLength : 0;
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
      return branches
        // A tagged union written as one object with a `oneOf` of variants,
        // or an `anyOf` naming which fields must be present: one branch is
        // chosen and its properties and requirements join the node's.
        ? fc.constantFrom(...branches).chain((branch) => objectArbitrary(root, node, branch))
        : objectArbitrary(root, node, undefined);
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
 * An object: each required property usually present, each optional one
 * sometimes, the properties an `if/then/else` branch adds or forbids
 * among them, and now and then a key the schema does not name. `branch` is
 * the `oneOf` or `anyOf` member chosen for it, if it has one.
 */
function objectArbitrary(root: Node, node: Node, branch: Node | undefined): fc.Arbitrary<unknown> {
  for (const key of Object.keys(branch ?? {})) {
    if (!KNOWN.has(key)) throw new Error(`jsonSchemaArbitrary does not read "${key}"`);
  }
  const properties = {
    ...(node.properties as Record<string, unknown> | undefined),
    ...(branch?.properties as Record<string, unknown> | undefined),
  };
  for (const conditional of [node.then, node.else] as (Node | undefined)[]) {
    for (
      const [k, v] of Object.entries((conditional?.properties ?? {}) as Record<string, unknown>)
    ) {
      if (v !== false && !(k in properties)) properties[k] = v;
    }
  }
  const required = new Set([
    ...((node.required ?? []) as string[]),
    ...((branch?.required ?? []) as string[]),
  ]);
  const entries = Object.entries(properties).filter(([, v]) => v !== false) as [string, Node][];
  const fields = entries.map(([key, schema]) =>
    fc.tuple(
      fc.constant(key),
      fromJsonSchema(root, schema),
      percent.map((r) => (required.has(key) ? r < 99 : r < 30)),
    )
  );
  return fc.tuple(fc.tuple(...fields), percent).map(([values, r]) => {
    const out: Record<string, unknown> = {};
    for (const [key, value, present] of values) if (present) out[key] = value;
    if (r < 2) out.colour = "blue";
    return out;
  });
}
