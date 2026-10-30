/**
 * The fact type decoder agrees with the reader it replaced
 * (docs/specs/effect-adoption.spec.md, 1r, R3): it accepts exactly the fact
 * types the 3.0 schema and `FactType` constructor accept, to the config
 * `deserializeFactType` builds; every corpus fact type decodes so; and every
 * 3.0 malformed fact type case, and every constraint case inside one, is
 * refused at its field.
 */
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { DecodeError } from "../../src/decode/decoder.js";
import { runFactTypeDecode } from "../../src/decode/factType.js";
import { FactType } from "../../src/model/FactType.js";
import { deserializeFactType } from "../../src/serialization/reader20.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import type { OrmYamlFactType } from "../../src/serialization/yaml/factType.js";
import { fromJsonSchema } from "../helpers/jsonSchemaArbitrary.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

const validator = new SchemaValidator();
const defs = (schema as unknown as { definitions: Record<string, Record<string, unknown>>; })
  .definitions;

/** Today's config, its constraints with barwise-973's narrowing: the modality stated. */
function todays(doc: unknown) {
  const { config, constraints } = deserializeFactType(doc as OrmYamlFactType);
  return { ...config, constraints: constraints.map((c) => ({ modality: "alethic", ...c })) };
}

type Reading = { ok: true; config: unknown; } | { ok: false; };

/** Whether today's reader accepts one fact type: its schema, then its constructor. */
function todaysReading(value: unknown): Reading {
  const doc = { orm_version: "3.0", model: { name: "M", fact_types: [value] } };
  if (!validator.validateModel(doc).valid) return { ok: false };
  const config = todays(value);
  try {
    new FactType(config as ConstructorParameters<typeof FactType>[0]);
  } catch {
    return { ok: false };
  }
  return { ok: true, config };
}

function decodersReading(value: unknown): Reading {
  try {
    return { ok: true, config: runFactTypeDecode(value) };
  } catch (e) {
    if (e instanceof DecodeError) return { ok: false };
    throw e;
  }
}

/**
 * Values drawn from the hand-written schema, half of them given readings
 * that name each role once. A drawn reading almost never holds every
 * placeholder, so without these nearly every value would be refused for its
 * readings and the accepting side would go unexercised.
 */
const drawn = fc.tuple(
  fromJsonSchema(schema as Record<string, unknown>, defs.fact_type!),
  fc.boolean(),
).map(([value, fit]) => {
  const v = value as Record<string, unknown>;
  if (!fit || typeof v !== "object" || v === null || !Array.isArray(v.roles)) return value;
  const reading = v.roles.map((_, i) => `{${i}}`).join(" r ");
  return { ...v, readings: [reading === "" ? "x" : reading] };
});

describe("the fact type decoder, against today's reader", () => {
  it("accepts exactly what today's reader accepts, drawn from the hand-written schema", () => {
    let accepted = 0;
    fc.assert(
      fc.property(drawn, (value) => {
        const today = todaysReading(value);
        const decoded = decodersReading(value);
        expect([JSON.stringify(value), decoded.ok]).toEqual([JSON.stringify(value), today.ok]);
        if (today.ok && decoded.ok) {
          accepted++;
          expect(decoded.config).toEqual(today.config);
        }
      }),
      { numRuns: 2000, seed: 17 },
    );
    expect(accepted).toBeGreaterThan(500);
  });

  const factTypes = modelCorpus().flatMap(({ file, doc }) =>
    (doc.model.fact_types ?? []).map((ft) => ({ file, ft }))
  );

  it("decodes every corpus fact type to today's config", () => {
    expect(factTypes.length).toBeGreaterThan(1000);
    for (const { file, ft } of factTypes) {
      expect([file, ft.id, runFactTypeDecode(ft)]).toEqual([file, ft.id, todays(ft)]);
    }
  });
});

const MALFORMED = resolve(import.meta.dirname, "../fixtures/malformed/3.0");

interface Case {
  readonly file: string;
  readonly kind?: string;
  readonly field: string;
  readonly at?: string;
  readonly constraint?: number;
}

/**
 * A problem a case's defect brings with it, declared as the planted-defect
 * test declares consequences (R0's notes). None: a fact type with no roles
 * has a reading whose placeholders no role fills, which R0 declared, but
 * the reading rule leaves that to the roles list's minimum (review of R3).
 */
const CONSEQUENCES: Record<string, readonly string[]> = {};

/** Loaded today and reported by validation, not the reader (R2). */
const VALIDATIONS = ["frequency-max-below-min.orm.yaml"];

describe("the 3.0 malformed fact type cases", () => {
  const { cases } = JSON.parse(readFileSync(resolve(MALFORMED, "cases.json"), "utf8")) as {
    cases: Case[];
  };
  const factTypeCases = cases.filter((c) => c.kind === "fact_type");

  it.each(
    factTypeCases.filter((c) => !VALIDATIONS.includes(c.file)).map((c) => [c.file, c] as const),
  )("%s is refused at its field", (_, c) => {
    const [ft] = parse(readFileSync(resolve(MALFORMED, c.file), "utf8")).model.fact_types;
    let error: unknown;
    try {
      runFactTypeDecode(ft);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DecodeError);
    const problems = (error as DecodeError).problems;
    // Where each problem sits in the fact type -- its constraint's position
    // and the path below it, for a problem inside a constraint -- at or
    // below the declared field: a bad reading is reported at the reading.
    const declared = c.at ?? c.field;
    const at = (p: (typeof problems)[number]) => {
      const where = [...p.at, ...p.path].join(".");
      return where.startsWith(`${declared}.`) ? declared : where;
    };
    expect(problems.map(at).sort()).toEqual([declared, ...(CONSEQUENCES[c.file] ?? [])].sort());
    const atField = problems.find((p) => at(p) === declared)!;
    expect(atField.message).toContain(c.field);
    const named = c.constraint !== undefined ? ft.constraints[c.constraint].id : ft.name;
    if (typeof named === "string") expect(atField.message).toContain(`"${named}"`);
  });

  it("covers every fact type case, its constraints' included", () => {
    expect(factTypeCases.length).toBe(17);
  });
});

describe("a fact type's refusals in its own words (barwise-f9t)", () => {
  const FT = {
    id: "ft",
    name: "O has O",
    roles: [{ id: "r1", player: "ot", role_name: "a" }],
    readings: ["{0} exists"],
  };
  const messages = (doc: unknown) => {
    try {
      runFactTypeDecode(doc);
      return [];
    } catch (e) {
      return (e as DecodeError).problems.map((p) => p.message);
    }
  };

  it.each(
    [
      [
        "free text that is not a string",
        { ...FT, derivation: { kind: "derived", expression: 5 } },
        'Fact type "O has O": derivation.expression must be a string.',
      ],
      [
        "a flag that is not one",
        { ...FT, derivation: { kind: "derived", expression: "x", is_formal: "yes" } },
        'Fact type "O has O": derivation.is_formal must be true or false.',
      ],
      [
        "a note that is not a string",
        { ...FT, note: 3 },
        'Fact type "O has O": note must be a string.',
      ],
    ] as const,
  )("%s", (_, doc, message) => {
    expect(messages(doc)).toEqual([message]);
  });
});
