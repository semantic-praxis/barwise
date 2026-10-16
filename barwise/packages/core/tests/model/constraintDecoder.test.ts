/**
 * The constraint decoder's problems: one per thing wrong, each naming the
 * fact type, the constraint (by the id its file gave, else its position) and
 * the field in the file's spelling (S4 of effect-adoption.spec.md).
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONSTRAINT_FILE_SPELLINGS,
  type ConstraintFailure,
  type ConstraintProblem,
  decodeConstraints,
} from "../../src/model/constraintDecoder.js";
import { ConstraintSchema, ConstraintYamlCodec } from "../../src/model/constraintSchema.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";

const FT = 'Fact type "Person has Age"';

function run(docs: readonly unknown[]) {
  let n = 0;
  return Effect.runSync(decodeConstraints(docs, FT, () => `filled-${++n}`));
}

/** The problems of the one constraint given. */
function problems(doc: unknown): readonly ConstraintProblem[] {
  const [result] = run([doc]);
  if (result === undefined || Result.isSuccess(result)) throw new Error("expected problems");
  return result.failure.problems;
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
      "must not have an empty values list; omit it.",
    ],
    [
      { id: "c-1", type: "value_constraint", role: "a" },
      ["values"],
      'must have "values" or "ranges".',
    ],
    [{ id: "c-1", type: "frequency", min: 1, max: 2 }, ["role"], 'must have "role" or "roles".'],
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

  // Effect runs a struct's checks only once all its fields pass, so these
  // "one of" rules would go unreported beside any field error; the decoder
  // checks them on the raw input from the schema's own anyOf.
  it("reports a missing role beside an unknown field", () => {
    const found = problems({ id: "c-1", type: "frequency", min: 1, max: 2, w: 1 });
    expect(found.map((p) => p.message)).toEqual([
      `Constraint "c-1" in ${FT} has an unknown field "w".`,
      `Constraint "c-1" in ${FT} must have "role" or "roles".`,
    ]);
  });

  it("reports a range with neither bound in the same words however it was found", () => {
    const found = problems({ id: "c-1", type: "value_constraint", ranges: [{}], w: 1 });
    expect(found.map((p) => p.path)).toEqual([["w"], ["ranges", 0]]);
    expect(found[1]!.message).toBe(`Constraint "c-1" in ${FT} must have a min or a max.`);
  });

  it("reports a range with neither bound beside an unknown field in the range", () => {
    const found = problems({ id: "c-1", type: "value_constraint", ranges: [{ z: 1 }] });
    expect(found.map((p) => p.message)).toEqual([
      `Constraint "c-1" in ${FT} has an unknown field "ranges.0.z".`,
      `Constraint "c-1" in ${FT} must have a min or a max.`,
    ]);
  });

  it("does not check the ranges of a kind that has none", () => {
    const found = problems({
      id: "c-1",
      type: "frequency",
      role: "a",
      min: 1,
      max: 2,
      ranges: [{}],
    });
    expect(found.map((p) => p.path)).toEqual([["ranges"]]);
  });

  it("reports an entry that is not a mapping as one problem at the constraint", () => {
    expect(problems("oops")).toEqual([{
      index: 0,
      path: [],
      message: `Constraint at constraints/0 in ${FT} must be a mapping.`,
    }]);
  });

  it("names a constraint without an id by its position, not by the id it was filled with", () => {
    const [, second] = run([
      { type: "mandatory", role: "a" },
      { type: "mandatory" },
    ]);
    expect(second !== undefined && Result.isFailure(second)).toBe(true);
    const [problem] = (second as Result.Failure<unknown, ConstraintFailure>).failure.problems;
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

describe("the decoder refuses what the schema refuses, field by field", () => {
  // For each rule the schema states on a field of each kind, a constraint
  // breaking that rule alone must be refused by both, and the decoder must
  // name the field. Not what keeps a rule from being lost -- the loader keeps
  // any schema error the decoder did not report (constraintBranchRecheck) --
  // but what keeps the report in the decoder's words rather than ajv's.
  const schema = JSON.parse(
    readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
  ) as {
    definitions: {
      constraint: {
        oneOf: { properties: Record<string, PropertyRule> & { type: { const: string; }; }; }[];
      };
    };
  };
  const validator = new SchemaValidator();
  const encode = Schema.encodeSync(ConstraintYamlCodec);
  const samples = Effect.runSync(
    Arbitrary.sampleEffect(Arbitrary.schema(ConstraintSchema), { count: 500, seed: 2 }),
  );
  /** A valid value for each optional field a generated sample may lack. */
  const OPTIONAL: Record<string, unknown> = {
    modality: "deontic",
    role: "r-1",
    roles: ["r-1"],
    values: ["a"],
    ranges: [{ min: "1" }],
    is_preferred: true,
  };

  /**
   * A sample of a kind with every field the schema allows present, so a
   * broken field is the only thing wrong: with a value constraint's `ranges`
   * absent, empty `values` would be refused by the "values or ranges" rule
   * instead, and the test would pass whether or not the decoder states the
   * field's own rule.
   */
  const sampleOf = (type: string, fields: readonly string[]) => {
    const sample = encode(samples.find((r) => r.type === type)!) as Record<string, unknown>;
    const filled = fields.filter((f) => !(f in sample) && f in OPTIONAL);
    return { ...Object.fromEntries(filled.map((f) => [f, OPTIONAL[f]])), ...sample };
  };

  const cases = schema.definitions.constraint.oneOf.flatMap((branch) => {
    const type = branch.properties.type.const;
    return Object.entries(branch.properties)
      .filter(([field]) => !["type", "id"].includes(field))
      .flatMap(([field, rule]) =>
        violationsOf(rule).map((bad) => ({
          type,
          field,
          bad,
          fields: Object.keys(branch.properties),
        }))
      );
  });

  it("finds rules to break on every kind that states one", () => {
    expect(new Set(cases.map((c) => c.type)).size).toBeGreaterThanOrEqual(13);
    expect(cases.length).toBeGreaterThan(40);
  });

  it("states its one-of-these-keys rules only in the shape the decoder reads", () => {
    // The decoder reads each anyOf as "at least one of these keys", one key
    // per alternative. Any other shape, or another combinator on a kind,
    // would still be kept by the loader from the schema, but in ajv's words,
    // and the decoder's wording of it would be wrong: revisit both together.
    const raw = schema as unknown as {
      definitions: {
        constraint: { oneOf: Record<string, unknown>[]; };
        value_range_def: Record<string, unknown>;
      };
    };
    const shapes = [...raw.definitions.constraint.oneOf, raw.definitions.value_range_def];
    for (const branch of shapes) {
      for (const k of ["not", "oneOf", "allOf", "if", "dependentRequired", "dependencies"]) {
        expect(branch[k]).toBeUndefined();
      }
      for (const alternative of (branch.anyOf as Record<string, unknown>[] | undefined) ?? []) {
        expect(Object.keys(alternative)).toEqual(["required"]);
        expect(alternative.required).toHaveLength(1);
      }
    }
  });

  it("knows how to break every keyword the schema uses on a field", () => {
    // A keyword violationsOf cannot break would yield no case, and the test
    // below would pass without looking at that rule.
    const used = schema.definitions.constraint.oneOf.flatMap((branch) =>
      Object.values(branch.properties).flatMap(keywordsOf)
    );
    expect([...new Set(used)].filter((k) => !BREAKABLE.has(k))).toEqual([]);
  });

  it("refuses each, naming the field", () => {
    const missed = cases.flatMap(({ type, field, bad: violation, fields }) => {
      const sample = sampleOf(type, fields);
      const bad = typeof violation === "function" ? violation(sample[field]) : violation;
      const doc = { ...sample, id: "c-1", [field]: bad };
      const schemaRefuses = !validator.validateModel(documentWith(doc)).valid;
      const [result] = run([doc]);
      const named = result !== undefined && Result.isFailure(result)
        && result.failure.problems.some((p) => p.path[0] === field);
      return schemaRefuses && named ? [] : [{ type, field, bad, schemaRefuses, named }];
    });
    expect(missed).toEqual([]);
  });
});

interface PropertyRule {
  readonly type?: string;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly enum?: readonly string[];
  readonly items?: PropertyRule;
  readonly oneOf?: readonly PropertyRule[];
  readonly $ref?: string;
}

/**
 * The keywords violationsOf can break, plus those that state no rule of their
 * own here (`description`; `const`, which only the `type` field uses and is
 * the union's tag; `$ref`, whose target's rules are its own definition's).
 */
const BREAKABLE: ReadonlySet<string> = new Set([
  "type",
  "items",
  "minItems",
  "minLength",
  "minimum",
  "enum",
  "oneOf",
  "$ref",
  "const",
  "description",
]);

function keywordsOf(rule: PropertyRule): string[] {
  return [
    ...Object.keys(rule),
    ...(rule.items ? keywordsOf(rule.items) : []),
    ...(rule.oneOf ?? []).flatMap(keywordsOf),
  ];
}

/**
 * Values that break exactly one rule of a property, one per rule. A list of
 * `$ref` items is cut from the sample's own list, so it is one short of its
 * minimum with every item valid.
 */
function violationsOf(rule: PropertyRule): unknown[] {
  if (rule.oneOf) return rule.oneOf.flatMap(violationsOf).filter((v) => typeof v === "number");
  const out: unknown[] = [];
  const pad = (items: unknown[]) => {
    while (items.length < (rule.minItems ?? 0)) items.push("r");
    return items;
  };
  if (rule.minItems !== undefined && rule.items?.$ref === undefined) {
    out.push(Array.from({ length: rule.minItems - 1 }, () => "r"));
  }
  if (rule.minItems !== undefined && rule.items?.$ref !== undefined) {
    const minItems = rule.minItems;
    out.push((list: unknown) => (list as unknown[]).slice(0, minItems - 1));
  }
  if (rule.items?.minLength !== undefined) out.push(pad([""]));
  if (rule.minLength !== undefined) out.push("");
  if (rule.enum !== undefined) out.push("zzz");
  if (rule.minimum !== undefined) out.push(rule.minimum - 1);
  if (rule.type === "integer") out.push(1.5);
  if (rule.type === "boolean") out.push("yes");
  return out;
}

/** The smallest valid document around one constraint. */
function documentWith(constraint: unknown) {
  return {
    orm_version: "2.0",
    model: {
      name: "M",
      object_types: [{ id: "ot-1", name: "Thing", kind: "entity", reference_mode: "id" }],
      fact_types: [{
        id: "ft-1",
        name: "Thing exists",
        roles: [{ id: "r-1", player: "ot-1", role_name: "exists" }],
        readings: ["{0} exists"],
        constraints: [constraint],
      }],
    },
  };
}
