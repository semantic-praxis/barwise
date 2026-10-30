/**
 * The constraint decoder agrees with today's reader before it is on the
 * load path (docs/specs/effect-adoption.spec.md, 1r, R2): it accepts exactly
 * the constraints today's schema accepts in each list, to the record
 * `deserializeConstraint` builds with the modality stated; every corpus
 * constraint decodes so; every derived value is one today's schema accepts
 * (M1); and every 3.0 malformed constraint case is refused at its field.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import {
  ConstraintFile,
  type ConstraintFileValue,
  InternalConstraintsFile,
  runExternalConstraintsDecode,
  runInternalConstraintsDecode,
} from "../../src/decode/constraint.js";
import { DecodeError, decoderFor } from "../../src/decode/decoder.js";
import { elementOf } from "../../src/decode/problems.js";
import { CONSTRAINT_TYPES, placementOf } from "../../src/model/Constraint.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import {
  deserializeConstraint,
  type OrmYamlConstraint,
} from "../../src/serialization/yaml/constraint.js";
import { type ConstraintKind, derivedConstraints } from "../helpers/derivedConstraints.js";
import { fromJsonSchema } from "../helpers/jsonSchemaArbitrary.js";
import { corpusConstraints } from "../helpers/modelCorpus.js";

type Where = "internal" | "external";

const validator = new SchemaValidator();
const defs = (schema as unknown as { definitions: Record<string, Record<string, unknown>>; })
  .definitions;

/** The smallest valid fact type around an internal constraint. */
const FACT_TYPE = {
  id: "ft",
  name: "F",
  roles: [
    { id: "r1", player: "ot", role_name: "a" },
    { id: "r2", player: "ot", role_name: "b" },
  ],
  readings: ["{0} f {1}"],
};

/** The smallest document listing one constraint where `where` says. */
const wrap = (where: Where, c: unknown) => ({
  orm_version: "3.0",
  model: where === "internal"
    ? { name: "M", fact_types: [{ ...FACT_TYPE, constraints: [c] }] }
    : { name: "M", constraints: [c] },
});

/** Today's record, with barwise-973's narrowing: the modality stated. */
const todays = (c: unknown) => ({
  modality: "alethic",
  ...deserializeConstraint(c as OrmYamlConstraint),
});

const run = (where: Where, docs: unknown) =>
  where === "internal" ? runInternalConstraintsDecode(docs) : runExternalConstraintsDecode(docs);

type Reading = { ok: true; record: unknown; } | { ok: false; };

/** Values of one kind, derived from its own Schema (M1). */
const derived = (type: ConstraintKind) => derivedConstraints(type);

/** Whether today's reader accepts one constraint where it is listed, and its record. */
function todaysReading(where: Where, value: unknown): Reading {
  if (!validator.validateModel(wrap(where, value)).valid) return { ok: false };
  return { ok: true, record: todays(value) };
}

function decodersReading(where: Where, value: unknown): Reading {
  try {
    return { ok: true, record: run(where, [value])[0] };
  } catch (e) {
    if (e instanceof DecodeError) return { ok: false };
    throw e;
  }
}

describe("the constraint decoder, against today's reader", () => {
  it.each(["internal", "external"] as const)(
    "accepts exactly what today's reader accepts in the %s list, drawn from the hand-written schema",
    (where) => {
      // Both lists' definitions feed each list, so a kind listed in the
      // wrong place is compared too, and every kind's refusals with it.
      const drawn = fc.oneof(
        fromJsonSchema(schema as Record<string, unknown>, defs.internal_constraint!),
        fromJsonSchema(schema as Record<string, unknown>, defs.external_constraint!),
      );
      const kinds = new Set<string>();
      let accepted = 0;
      fc.assert(
        fc.property(drawn, (value) => {
          const today = todaysReading(where, value);
          const decoded = decodersReading(where, value);
          expect([JSON.stringify(value), decoded.ok]).toEqual([JSON.stringify(value), today.ok]);
          if (today.ok && decoded.ok) {
            accepted++;
            kinds.add((value as { type: string; }).type);
            expect(decoded.record).toEqual(today.record);
          }
        }),
        { numRuns: 3000, seed: 13 },
      );
      // Not vacuous: a fair share valid, and every kind of the list among them.
      expect(accepted).toBeGreaterThan(900);
      expect([...kinds].sort()).toEqual(
        CONSTRAINT_TYPES.filter((t) => placementOf(t) === where).sort(),
      );
    },
  );

  const corpus = corpusConstraints();

  it("decodes every corpus constraint to today's record", () => {
    expect(corpus.filter((c) => c.where === "internal").length).toBeGreaterThan(2000);
    expect(corpus.filter((c) => c.where === "external").length).toBeGreaterThan(50);
    for (const { file, where, constraint } of corpus) {
      expect([file, constraint.id, run(where, [constraint])[0]]).toEqual([
        file,
        constraint.id,
        todays(constraint),
      ]);
    }
  });

  /**
   * Derived from the Schema under test, checked against an answer key it
   * did not write: the hand-written schema, in the list the kind lives in.
   */
  const holdsToToday = (values: readonly ConstraintFileValue[]) => {
    for (const value of values) {
      const where = placementOf(value.type)!;
      expect([value, validator.validateModel(wrap(where, value)).errors]).toEqual([value, []]);
      expect(run(where, [value])[0]).toEqual(todays(value));
    }
  };

  it("derives the union, and decodes only what today's schema accepts, to the same record (M1)", () => {
    const values = Effect.runSync(
      Arbitrary.sampleEffect(Arbitrary.schema(ConstraintFile), { count: 1000, seed: 1 }),
    ) as ConstraintFileValue[];
    holdsToToday(values);
    expect(new Set(values.map((v) => v.type)).size).toBe(CONSTRAINT_TYPES.length);
  });

  it.each(CONSTRAINT_TYPES.map((t) => [t] as const))(
    "derives %s from its own Schema (M1)",
    (type) => {
      const values = derived(type);
      expect(values.map((v) => v.type)).toEqual(values.map(() => type));
      holdsToToday(values);
    },
  );
});

const MALFORMED = resolve(import.meta.dirname, "../fixtures/malformed/3.0");

interface Case {
  readonly file: string;
  readonly kind?: string;
  readonly field: string;
  readonly constraint?: number;
}

/** A case's constraint, and the list it is in. */
function caseConstraint(c: Case): { where: Where; constraint: Record<string, unknown>; } {
  const doc = parse(readFileSync(resolve(MALFORMED, c.file), "utf8"));
  return c.kind === "constraint"
    ? { where: "external", constraint: doc.model.constraints[0] }
    : { where: "internal", constraint: doc.model.fact_types[0].constraints[c.constraint!] };
}

describe("the 3.0 malformed constraint cases", () => {
  const { cases } = JSON.parse(readFileSync(resolve(MALFORMED, "cases.json"), "utf8")) as {
    cases: Case[];
  };
  const constraintCases = cases.filter((c) =>
    c.kind === "constraint" || c.constraint !== undefined
  );
  /**
   * Loaded today and reported by validation, not by the reader: a decoder
   * that refused it would load less than `main` does, which gate S1 reads
   * as a difference.
   */
  const VALIDATIONS = ["frequency-max-below-min.orm.yaml"];

  it.each(
    constraintCases.filter((c) => !VALIDATIONS.includes(c.file)).map((c) => [c.file, c] as const),
  )("%s is refused at its field", (_, c) => {
    const { where, constraint } = caseConstraint(c);
    let error: unknown;
    try {
      run(where, [constraint]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DecodeError);
    const problems = (error as DecodeError).problems;
    // A fixture holds one problem, so every problem is at the declared field.
    expect(problems.map((p) => String(p.path[0] ?? ""))).toEqual(problems.map(() => c.field));
    for (const p of problems) {
      expect(p.message).toContain(c.field);
      if (typeof constraint.id === "string") expect(p.message).toContain(`"${constraint.id}"`);
    }
  });

  it.each(VALIDATIONS)("%s loads, as it does today: its problem is validation's", (file) => {
    const c = constraintCases.find((x) => x.file === file)!;
    const { where, constraint } = caseConstraint(c);
    expect(todaysReading(where, constraint).ok).toBe(true);
    expect(run(where, [constraint])[0]).toEqual(todays(constraint));
  });

  it("covers every constraint case", () => {
    expect(constraintCases.length).toBe(14);
  });
});

describe("a constraint listed in the wrong place", () => {
  // One valid constraint of each kind, from the kind's own derivation.
  const byKind = new Map(CONSTRAINT_TYPES.map((t) => [t, derived(t)[0]!]));

  const problemsOf = (where: Where, value: unknown) => {
    try {
      run(where, [value]);
      return [];
    } catch (e) {
      return (e as DecodeError).problems.map((p) => [p.path.join("."), p.message]);
    }
  };

  it.each(CONSTRAINT_TYPES.map((t) => [t] as const))(
    "%s is refused by name in the other list",
    (type) => {
      const c = byKind.get(type)!;
      const home = placementOf(type)!;
      const other: Where = home === "internal" ? "external" : "internal";
      expect(problemsOf(home, c)).toEqual([]);
      expect(problemsOf(other, c)).toEqual([[
        "",
        home === "external"
          ? `The ${type} constraint "${c.id}" is listed under a fact type, but its kind lives in the `
            + "model: move it to model.constraints."
          : `The ${type} constraint "${c.id}" is listed in model.constraints, but its kind lives in `
            + "its fact type: move it under the fact type whose roles it names.",
      ]]);
    },
  );

  it("is refused beside its other problems, in one pass", () => {
    const c = { ...byKind.get("exclusion")!, colour: 1 };
    expect(problemsOf("internal", c).map(([path]) => path).sort()).toEqual(["", "colour"]);
  });

  it("names the fact type it is listed under, in the sentence format30.test.ts pins", () => {
    // R3's fact type encloses the list; the sentence names it whatever the
    // enclosing element's Schema is.
    const FactType = Schema.Struct({ name: Schema.String, constraints: InternalConstraintsFile })
      .annotate(elementOf({
        noun: "Fact type",
        badTag: "",
        describe: (raw) => ({
          label: `Fact type "${(raw as { name: string; }).name}"`,
          identity: (raw as { name: string; }).name,
        }),
      }));
    const result = Effect.runSync(Effect.result(
      decoderFor(FactType)({
        name: "Customer has CustomerId",
        constraints: [{ id: "x-key", type: "external_uniqueness", roles: ["r1", "r2"] }],
      }),
    ));
    const messages = Result.isFailure(result) ? result.failure.problems.map((p) => p.message) : [];
    expect(messages).toEqual([
      'The external_uniqueness constraint "x-key" is listed under fact type "Customer has CustomerId", '
      + "but its kind lives in the model: move it to model.constraints.",
    ]);
  });
});

describe("a constraint that is not a mapping", () => {
  it.each([[null], ["x"], [[1]], [3]])("%j is refused as not a mapping, once", (value) => {
    let error: unknown;
    try {
      runInternalConstraintsDecode([value]);
    } catch (e) {
      error = e;
    }
    const problems = (error as DecodeError).problems;
    expect(problems.map((p) => [p.at, p.message])).toEqual([[
      [0],
      "Constraint at 0 must be a mapping of fields.",
    ]]);
  });
});
