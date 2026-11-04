/**
 * A struct's fields as an Effect Schema states them, for the drift tests that
 * hold each Schema to the shipped JSON Schema until part C generates the
 * file (docs/specs/effect-adoption.spec.md, 1r): which fields it allows,
 * which it refuses by name, and which it requires.
 */
import type * as SchemaAST from "effect/SchemaAST";

export function fields(ast: SchemaAST.AST) {
  if (ast._tag !== "Objects") throw new Error(`not a struct: ${ast._tag}`);
  const all = ast.propertySignatures.map((ps) => ({
    name: String(ps.name),
    type: ps.type,
    optional: ps.type.context?.isOptional === true,
  }));
  return {
    allowed: all.filter((f) => f.type._tag !== "Never").map((f) => f.name).sort(),
    refused: all.filter((f) => f.type._tag === "Never").map((f) => f.name).sort(),
    required: all.filter((f) => !f.optional).map((f) => f.name).sort(),
    byName: new Map(all.map((f) => [f.name, f.type])),
  };
}

/** The literals a `Literals` (a union of literals) or a single `Literal` allows. */
export function literalsOf(ast: SchemaAST.AST): string[] {
  const members = ast._tag === "Union" ? ast.types : [ast];
  return members.map((m) => String((m as SchemaAST.Literal).literal));
}

/** What a check states for derivation: the limits Effect's `isMinLength` and `intAtLeast` carry. */
interface ArbitraryConstraint {
  readonly minLength?: number;
  readonly minimum?: number;
}

/**
 * The numeric limits a node states, as JSON Schema spells them: a list's
 * `minItems` and its items' limits, a string's `minLength`, an integer's
 * `minimum` (for a union such as `max`, its integer member's). Read from
 * each check's `arbitraryConstraint`, which every limit check carries.
 */
export function limitsOf(ast: SchemaAST.AST): Record<string, unknown> {
  const stated = (node: SchemaAST.AST): ArbitraryConstraint =>
    Object.assign(
      {},
      ...(node.checks ?? []).map((c) =>
        (c.annotations as { arbitraryConstraint?: ArbitraryConstraint; } | undefined)
          ?.arbitraryConstraint ?? {}
      ),
    );
  switch (ast._tag) {
    case "Arrays":
      return { minItems: stated(ast).minLength ?? 0, items: limitsOf(ast.rest[0]!) };
    case "String":
      return { minLength: stated(ast).minLength ?? 0 };
    case "Number":
      return { minimum: stated(ast).minimum };
    case "Union": {
      const number = ast.types.find((t) => t._tag === "Number");
      return number ? limitsOf(number) : {};
    }
    default:
      return {};
  }
}
