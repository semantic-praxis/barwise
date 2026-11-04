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
import { decoderFor } from "../../src/decode/decoder.js";
import { crossField } from "../../src/decode/harness.js";
import { fieldPath } from "../../src/decode/problems.js";

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
  const result = Effect.runSync(Effect.result(decoderFor(schema)(raw)));
  if (Result.isSuccess(result)) return [];
  return result.failure.problems.map((p) => fieldPath(p.path)).sort();
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

describe("the harness, as Effect resolves the value (second review of R1)", () => {
  it("follows the member Effect tried, though a required enum field in it is wrong", () => {
    // A required Literals field is no tag: Effect enters the member by
    // `type`, reports the bad `r`, and the rule under `inner` must still run.
    const U = Schema.Union([
      Schema.Struct({ type: Schema.Literal("x"), r: Schema.Literals(["a", "b"]), inner: S }),
      Other,
    ]);
    expect(paths(U, { type: "x", r: "bogus", inner: BROKEN })).toEqual([
      "inner",
      "inner.extra",
      "r",
    ]);
  });

  it("runs a rule whose field holds an error deeper down, or failed a check", () => {
    const counts = crossField(
      { id: "readings-fit-roles", reads: ["roles", "readings"] },
      (v: { readonly roles: readonly unknown[]; readonly readings: readonly string[]; }) =>
        v.readings.length <= v.roles.length,
      "must not have more readings than roles.",
    );
    const T = Schema.Struct({
      roles: Schema.Array(Schema.Struct({ player: Schema.String })).check(
        Schema.isMinLength(1, { message: "must list a role." }),
      ),
      readings: Schema.Array(Schema.String),
    }).check(counts);
    expect(paths(T, { roles: [{}], readings: ["a", "b"] })).toEqual(["", "roles.0.player"]);
    expect(paths(T, { roles: [], readings: ["a"] })).toEqual(["", "roles"]);
    // A field of the wrong kind is its own report; the rule stays out.
    expect(paths(T, { roles: "none", readings: ["a"] })).toEqual(["roles"]);
  });

  it("reports a rule's own paths, whether Effect ran it or the harness did", () => {
    const pointing = crossField(
      { id: "points", reads: ["a", "b"] },
      (v: { readonly a: number; readonly b: number; }) =>
        v.a > v.b
          ? [{ path: ["b"], issue: "is too small." }, { path: ["a"], issue: "is too big." }]
          : true,
      "must order a and b.",
    );
    const P = Schema.Struct({ a: Schema.Number, b: Schema.Number }).check(pointing);
    expect(paths(P, { a: 5, b: 1 })).toEqual(["a", "b"]);
    expect(paths(P, { a: 5, b: 1, extra: 1 })).toEqual(["a", "b", "extra"]);
  });

  it("runs a rule on a list beside an item's error", () => {
    const distinct = crossField(
      { id: "distinct-types", reads: ["*.type"] },
      (items: readonly { readonly type: string; }[]) =>
        new Set(items.map((i) => i.type)).size === items.length,
      "must not repeat a type.",
    );
    const L = Schema.Array(Schema.Struct({ type: Schema.String })).check(distinct);
    expect(paths(L, [{ type: "a" }, { type: "a", extra: 1 }])).toEqual(["", "1.extra"]);
    expect(paths(L, [{ type: "a" }, { type: 3 }])).toEqual(["1.type"]);
  });
});

describe("the harness, against the third review of R1", () => {
  it("reports a rule's several issues once each, and runs no rule again for them", () => {
    let runs = 0;
    const fit = crossField(
      { id: "fit", reads: ["roles", "readings"] },
      (v: { readonly roles: readonly string[]; readonly readings: readonly string[]; }) => {
        runs++;
        return v.readings.slice(v.roles.length).map((_, i) => ({
          path: ["readings", v.roles.length + i],
          issue: "has no role to read.",
        }));
      },
      "must not have more readings than roles.",
    );
    const zero = crossField(
      { id: "zero", reads: ["c"] },
      (v: { readonly c: number; }) => v.c !== 0,
      "must have a nonzero c.",
    );
    const F = Schema.Struct({
      roles: Schema.Array(Schema.String),
      readings: Schema.Array(Schema.String),
      c: Schema.Number,
    }).check(fit, zero);
    // Effect runs both rules here; before the fix the walk ran them again
    // for the Composite holding fit's issues, and recursed without end.
    expect(paths(F, { roles: ["a"], readings: ["x", "y", "z"], c: 0 })).toEqual([
      "",
      "readings.1",
      "readings.2",
    ]);
    expect(runs).toBe(1);
    // Beside a field error the harness runs them, once.
    runs = 0;
    expect(paths(F, { roles: ["a"], readings: ["x", "y"], c: 0, extra: 1 })).toEqual([
      "",
      "extra",
      "readings.1",
    ]);
    expect(runs).toBe(1);
  });

  it("does not run a rule Effect already ran and passed", () => {
    let runs = 0;
    const counted = crossField(
      { id: "counted", reads: ["a", "b"] },
      (v: { readonly a: number; readonly b: number; }) => {
        runs++;
        return v.a <= v.b;
      },
      "must have a no larger than b.",
    );
    const notThree = Schema.makeFilter((v: { readonly a: number; }) => v.a !== 3, {
      message: "must not have a of 3.",
    });
    const N = Schema.Struct({ a: Schema.Number, b: Schema.Number }).check(notThree, counted);
    expect(paths(N, { a: 3, b: 4 })).toEqual([""]);
    expect(runs).toBe(1);
  });

  it("does not run a list rule over an item of the wrong kind", () => {
    const distinct = crossField(
      { id: "distinct-types", reads: ["*.type"] },
      (items: readonly { readonly type: string; }[]) =>
        new Set(items.map((i) => i.type)).size === items.length,
      "must not repeat a type.",
    );
    const L = Schema.Array(Schema.Struct({ type: Schema.String })).check(distinct);
    expect(paths(L, [{ type: "a" }, null])).toEqual(["1"]);
  });

  it("keeps a problem to one line", () => {
    const U = Schema.Union([
      Schema.Struct({ a: Schema.Number }),
      Schema.Struct({ b: Schema.Number }),
    ]);
    const result = Effect.runSync(Effect.result(decoderFor(U)({ a: 1, b: 2, extra: 1 })));
    const messages = Result.isFailure(result) ? result.failure.problems.map((p) => p.message) : [];
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(m).not.toContain("\n");
  });
});
