/**
 * The cross-field harness reaches a rule wherever a Schema can put a struct
 * (docs/specs/effect-adoption.spec.md, 1r, R1; review of R1): behind a union
 * tagged by `Literal` or `Literals`, behind a suspension or a nested union,
 * beside an optional literal field two members share, inside a record's
 * entries, a tuple's elements, and an untagged union with one struct.
 *
 * Each case is the blind spot itself: the rule broken beside an unknown key
 * in its own struct, so Effect reports only the key.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { crossField, crossFieldProblems } from "../../src/decode/harness.js";
import { fieldPath, locate } from "../../src/decode/problems.js";

const rule = crossField(
  { id: "a-le-b", reads: ["a", "b"] },
  (v: { readonly a: number; readonly b: number; }) => v.a <= v.b,
  "must have a no larger than b.",
);
const S = Schema.Struct({ a: Schema.Number, b: Schema.Number }).check(rule);
const tagged = (tag: Schema.Top) =>
  Schema.Struct({ type: tag, a: Schema.Number, b: Schema.Number }).check(rule);
const Other = Schema.Struct({ type: Schema.Literal("z"), c: Schema.String });

const BROKEN = { a: 5, b: 1, extra: 1 };

/** Every path the decode reports, the harness's included. */
function paths(schema: Schema.Top, raw: unknown): string[] {
  const decode = Schema.decodeUnknownEffect(schema, { errors: "all", onExcessProperty: "error" });
  const result = Effect.runSync(Effect.result(decode(raw)));
  if (Result.isSuccess(result)) return [];
  const located = locate(result.failure.issue);
  return [...located, ...crossFieldProblems(schema.ast, raw, located)].map((l) => fieldPath(l.path))
    .sort();
}

describe("the harness reaches a rule", () => {
  const cases: [string, Schema.Top, unknown, string[]][] = [
    ["in a plain struct", S, BROKEN, ["", "extra"]],
    [
      "behind a union tagged by Literals",
      Schema.Union([tagged(Schema.Literals(["x", "y"])), Other]),
      { type: "y", ...BROKEN },
      ["", "extra"],
    ],
    [
      "behind a suspended member",
      Schema.Union([Schema.suspend(() => tagged(Schema.Literal("x"))), Other]),
      { type: "x", ...BROKEN },
      ["", "extra"],
    ],
    [
      "behind a nested union",
      Schema.Union([Schema.Union([tagged(Schema.Literal("x"))]), Other]),
      { type: "x", ...BROKEN },
      ["", "extra"],
    ],
    [
      "beside an optional literal both members have",
      Schema.Union([
        Schema.Struct({
          type: Schema.Literal("x"),
          flag: Schema.optionalKey(Schema.Literal(true)),
          a: Schema.Number,
          b: Schema.Number,
        }).check(rule),
        Schema.Struct({
          type: Schema.Literal("z"),
          flag: Schema.optionalKey(Schema.Literal(true)),
        }),
      ]),
      { type: "x", flag: true, ...BROKEN },
      ["", "extra"],
    ],
    ["in a record's entries", Schema.Record(Schema.String, S), { k: BROKEN }, ["k", "k.extra"]],
    ["in a tuple's elements", Schema.Tuple([S]), [BROKEN], ["0", "0.extra"]],
    ["in an array's items", Schema.Array(S), [{ a: 1, b: 2 }, BROKEN], ["1", "1.extra"]],
    ["behind NullOr", Schema.NullOr(S), BROKEN, ["", "extra"]],
    ["behind a union with a string", Schema.Union([S, Schema.String]), BROKEN, ["", "extra"]],
  ];
  it.each(cases)("%s", (_, schema, raw, expected) => {
    expect(paths(schema, raw)).toEqual(expected);
  });

  it("and reports it once when Effect ran it", () => {
    expect(paths(S, { a: 5, b: 1 })).toEqual([""]);
  });
});
