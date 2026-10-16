/**
 * The constraint decoder's problems: one per thing wrong, each naming the
 * fact type, the constraint (by the id its file gave, else its position) and
 * the field in the file's spelling (S4 of effect-adoption.spec.md).
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  CONSTRAINT_FILE_SPELLINGS,
  type ConstraintProblem,
  decodeConstraints,
} from "../../src/model/constraintDecoder.js";
import { ConstraintSchema, ConstraintYamlCodec } from "../../src/model/constraintSchema.js";

const FT = 'Fact type "Person has Age"';

function run(docs: readonly unknown[]) {
  let n = 0;
  return Effect.runSync(decodeConstraints(docs, FT, () => `filled-${++n}`));
}

/** The problems of the one constraint given. */
function problems(doc: unknown): readonly ConstraintProblem[] {
  const [result] = run([doc]);
  if (result === undefined || Result.isSuccess(result)) throw new Error("expected problems");
  return result.failure;
}

describe("a constraint's problems", () => {
  it.each([
    [{ id: "c-1", type: "nope", roles: ["r"] }, ["type"], 'has an unknown type "nope".'],
    [
      { id: "c-1", type: "internal_uniqueness", roles: [] },
      ["roles"],
      "has an invalid roles: Expected a value with a length of at least 1.",
    ],
    [
      { id: "c-1", type: "frequency", roles: [], min: 1, max: 2 },
      ["roles"],
      "has an invalid roles: Expected a value with a length of at least 1.",
    ],
    [{ id: "c-1", type: "mandatory" }, ["role"], 'is missing "role".'],
    [
      { id: "c-1", type: "ring", role_1: "a", role_2: "b", ring_type: "bad" },
      ["ring_type"],
      'has an invalid ring_type: Expected "irreflexive" | "asymmetric" | "antisymmetric" | "intransitive" | "acyclic" | "symmetric" | "transitive" | "purely_reflexive".',
    ],
    [
      { id: "c-1", type: "frequency", role: "a", min: 3, max: 2 },
      ["max"],
      "must have max >= min.",
    ],
    [
      { id: "c-1", type: "frequency", role: "a", min: 0, max: 2 },
      ["min"],
      "has an invalid min: Expected a value greater than or equal to 1.",
    ],
    [
      { id: "c-1", type: "mandatory", role: "a", weight: 3 },
      ["weight"],
      'has an unknown field "weight".',
    ],
    [
      { id: "c-1", type: "mandatory", role: "a", modality: "x" },
      ["modality"],
      'has an invalid modality: Expected "alethic" | "deontic".',
    ],
    [
      { id: "c-1", type: "value_constraint", values: [] },
      ["values"],
      "must have values or ranges.",
    ],
  ])("%j is reported at %j", (doc, path, predicate) => {
    const found = problems(doc);
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toEqual(path);
    expect(found[0]!.message).toBe(`Constraint "c-1" in ${FT} ${predicate}`);
  });

  it("names a join's missing second operand under operands", () => {
    const found = problems({
      id: "c-1",
      type: "join_equality",
      operands: [{ path: { root: "a", steps: [] }, projection: [0] }],
    });
    expect(found.map((p) => p.path)).toEqual([["operands", 1]]);
  });

  it("reports every problem in one constraint", () => {
    const found = problems({ id: "c-1", type: "frequency", roles: [], min: 0, max: 2, w: 1 });
    expect(found.map((p) => String(p.path[0])).sort()).toEqual(["min", "roles", "w"]);
  });

  it("names a constraint without an id by its position, not by the id it was filled with", () => {
    const [, second] = run([
      { type: "mandatory", role: "a" },
      { type: "mandatory" },
    ]);
    expect(second !== undefined && Result.isFailure(second)).toBe(true);
    const [problem] = (second as Result.Failure<unknown, readonly ConstraintProblem[]>).failure;
    expect(problem).toEqual({
      index: 1,
      path: ["role"],
      message: `Constraint at constraints/1 in ${FT} is missing "role".`,
    });
  });

  it("fills a missing or empty id, and keeps one the file gave", () => {
    const results = run([
      { type: "mandatory", role: "a" },
      { id: "", type: "mandatory", role: "a" },
      { id: "c-9", type: "mandatory", role: "a" },
    ]);
    expect(results.map((r) => Result.isSuccess(r) ? r.success.id : "failed")).toEqual([
      "filled-1",
      "filled-2",
      "c-9",
    ]);
  });

  it("decodes the next constraint after one with problems", () => {
    const results = run([{ id: "c-1", type: "mandatory" }, {
      id: "c-2",
      type: "mandatory",
      role: "a",
    }]);
    expect(results.map(Result.isSuccess)).toEqual([false, true]);
  });
});

describe("CONSTRAINT_FILE_SPELLINGS against the codec", () => {
  // The map restates which file key each record key comes from. Held here to
  // the codec itself: every record key of every kind either keeps its name in
  // the file or has a spelling listed that the codec writes.
  const records = Effect.runSync(
    Arbitrary.sampleEffect(Arbitrary.schema(ConstraintSchema), { count: 500, seed: 1 }),
  );
  const encode = Schema.encodeSync(ConstraintYamlCodec);

  it("reaches all 16 kinds", () => {
    expect(new Set(records.map((r) => r.type)).size).toBe(16);
  });

  it("spells every record key the way the codec writes it", () => {
    const unspelled = new Set<string>();
    for (const record of records) {
      const file = encode(record) as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key in file || key === "modality") continue;
        if (!(CONSTRAINT_FILE_SPELLINGS[key] ?? []).some((k) => k in file)) {
          unspelled.add(`${record.type}.${key}`);
        }
      }
    }
    expect([...unspelled]).toEqual([]);
  });

  it("lists no spelling the codec never writes", () => {
    const written = new Set(records.flatMap((r) => Object.keys(encode(r) as object)));
    const ranges = ["min_inclusive", "max_inclusive"];
    const listed = Object.values(CONSTRAINT_FILE_SPELLINGS).flat();
    expect(listed.filter((k) => !written.has(k) && !ranges.includes(k))).toEqual([]);
  });
});
