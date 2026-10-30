/**
 * The reads check follows a rule below the top level (barwise-nh5): a rule
 * that reads `a.b`, or an item of a list, is recorded as reading that path,
 * so a rule reading a nested field it does not declare fails the harness
 * test, as a top-level one always has.
 */
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { crossField } from "../../src/decode/harness.js";
import { keysRead, markedChecks } from "./decodeHarness.js";

const readsOf = (schema: Schema.Top) =>
  markedChecks(schema.ast).map(({ node, check }) => keysRead(check, node));

describe("keysRead", () => {
  it("records a top-level read, and a comparison of two fields as two reads", () => {
    const S = Schema.Struct({ min: Schema.Number, max: Schema.Number }).check(
      crossField(
        { id: "order", reads: ["min", "max"] },
        (v: { readonly min: number; readonly max: number; }) => v.max >= v.min,
        "m",
      ),
    );
    expect(readsOf(S)).toEqual([["max", "min"]]);
  });

  it("records a nested read as its dotted path", () => {
    const S = Schema.Struct({ operand: Schema.Struct({ root: Schema.String }) }).check(
      crossField(
        { id: "root", reads: ["operand.root"] },
        (v: { readonly operand: { readonly root: string; }; }) => v.operand.root !== "",
        "m",
      ),
    );
    expect(readsOf(S)).toEqual([["operand.root"]]);
  });

  it("records a read of every item of a list as *", () => {
    const L = Schema.Array(Schema.Struct({ type: Schema.String })).check(
      crossField(
        { id: "types", reads: ["*.type"] },
        (items: readonly { readonly type: string; }[]) =>
          new Set(items.map((i) => i.type)).size === items.length,
        "m",
      ),
    );
    expect(readsOf(L)).toEqual([["*.type"]]);
  });

  it("does not count a list's own length as a read below it", () => {
    const S = Schema.Struct({ roles: Schema.Array(Schema.String) }).check(
      crossField(
        { id: "two", reads: ["roles"] },
        (v: { readonly roles: readonly string[]; }) => v.roles.length >= 2,
        "m",
      ),
    );
    expect(readsOf(S)).toEqual([["roles"]]);
  });

  it("catches a nested read the rule does not declare", () => {
    // The planted defect barwise-nh5 names: declared `operand`, reads
    // `operand.path.root` and `ring_type` as well.
    const S = Schema.Struct({
      operand: Schema.Struct({ path: Schema.Struct({ root: Schema.String }) }),
      ring_type: Schema.String,
    }).check(
      crossField(
        { id: "planted", reads: ["operand"] },
        (v: { readonly operand: { path: { root: string; }; }; readonly ring_type: string; }) =>
          v.operand.path.root !== v.ring_type,
        "m",
      ),
    );
    const mark = markedChecks(S.ast)[0]!.mark;
    expect(readsOf(S)[0]).not.toEqual(mark.reads);
    expect(readsOf(S)).toEqual([["operand.path.root", "ring_type"]]);
  });
});
