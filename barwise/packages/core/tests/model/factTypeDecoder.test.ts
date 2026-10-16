/**
 * The fact type decoder's problems: one per thing wrong, each naming the fact
 * type and the field in the file's spelling (S4 of effect-adoption.spec.md).
 * Constraints are left to the constraint decoder.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { decodeFactTypes, type FactTypeProblem } from "../../src/model/factTypeDecoder.js";
import { readDerivation } from "../../src/model/factTypeSchema.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { deserializeDerivation } from "../../src/serialization/yaml/derivation.js";
import {
  deserializeFactType,
  type OrmYamlFactType,
} from "../../src/serialization/yaml/factType.js";
import { corpusDocuments } from "../helpers/modelCorpus.js";

const ROLE = { id: "r-1", player: "ot-1", role_name: "has" };
const VALID = { id: "ft-1", name: "Person has Age", roles: [ROLE], readings: ["{0} has"] };

function problems(doc: unknown): readonly FactTypeProblem[] {
  const [result] = Effect.runSync(decodeFactTypes([doc]));
  if (result === undefined || Result.isSuccess(result)) throw new Error("expected problems");
  return result.failure.problems;
}

describe("a fact type's problems", () => {
  it.each([
    [{ ...VALID, colour: "red" }, ["colour"], 'has an unknown field "colour".'],
    [
      { ...VALID, roles: [{ ...ROLE, colour: 1 }] },
      ["roles", 0, "colour"],
      'has an unknown field "roles.0.colour".',
    ],
    [
      { ...VALID, roles: [{ id: "r-1", role_name: "has" }] },
      ["roles", 0, "player"],
      'is missing "roles.0.player".',
    ],
    [{ ...VALID, readings: ["{0} has {5}"] }, ["readings", 0], undefined],
  ])("%j is reported at %j", (doc, path, predicate) => {
    const found = problems(doc);
    expect(found.map((p) => p.path)).toEqual([path]);
    expect(found[0]!.message.startsWith('Fact type "Person has Age" ')).toBe(true);
    if (predicate !== undefined) {
      expect(found[0]!.message).toBe(`Fact type "Person has Age" ${predicate}`);
    }
  });

  it("names the reading at fault and what is wrong with it", () => {
    expect(problems({ ...VALID, readings: ["{0} has {5}"] })[0]!.message).toBe(
      'Fact type "Person has Age" has an invalid readings.0: Reading template "{0} has {5}" '
        + "references {5} but the fact type only has 1 roles.",
    );
  });

  it("reports every problem in one pass", () => {
    const found = problems({ ...VALID, roles: [], readings: [], colour: 1 });
    expect(found.map((p) => String(p.path[0])).sort()).toEqual(["colour", "readings", "roles"]);
  });

  it("reports a bad reading beside an unknown field, not on the next load", () => {
    // The reading rule is not a Schema check (Effect would skip it beside a
    // field error); the decoder runs it after every decode.
    const found = problems({ ...VALID, colour: 1, readings: ["{0} has {5}"] });
    expect(found.map((p) => p.path)).toEqual([["colour"], ["readings", 0]]);
  });

  it("judges the string readings beside one that is not a string", () => {
    const found = problems({ ...VALID, readings: ["{0} has {5}", 7] });
    expect(found.map((p) => p.path)).toEqual([["readings", 0], ["readings", 1]]);
  });

  it("reports an empty reading once, as the field rule words it", () => {
    const found = problems({ ...VALID, readings: [""] });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/has an invalid readings\.0: Expected a value with a length/);
  });

  it("reports readings that are not a list, without judging them", () => {
    const found = problems({ ...VALID, readings: "{0} has" });
    expect(found.map((p) => p.path)).toEqual([["readings"]]);
  });

  it("does not judge readings when there are no roles to count", () => {
    for (const roles of [[], "r-1", undefined]) {
      const found = problems({ ...VALID, roles, readings: ["{0} has {5}"] });
      expect(found.some((p) => p.path[0] === "readings")).toBe(false);
    }
  });

  it("is named as a model element problem when only the decoder refuses", () => {
    const yaml = `orm_version: "2.0"
model:
  name: M
  object_types:
    - {id: ot-p, name: Person, kind: entity, reference_mode: id}
  fact_types:
    - {id: ft-1, name: Person exists, roles: [{id: r-1, player: ot-p, role_name: exists}], readings: ["{0} exists {1}"]}
`;
    expect(() => new OrmYamlSerializer().deserialize(yaml)).toThrow(
      /^YAML holds malformed model elements: \/model\/fact_types\/0\/readings\/0: Fact type "Person exists" /,
    );
  });

  it("names a fact type with no name by its id, then by its position", () => {
    expect(problems({ ...VALID, name: "" })[0]!.message).toMatch(/^Fact type with id "ft-1" /);
    expect(problems("oops")).toEqual([{
      path: [],
      message: "Fact type at fact_types/0 must be a mapping.",
    }]);
  });

  it("leaves constraints to the constraint decoder", () => {
    const [result] = Effect.runSync(
      decodeFactTypes([{ ...VALID, constraints: [{ type: "nope" }] }]),
    );
    expect(result !== undefined && Result.isSuccess(result)).toBe(true);
  });

  it("reads a role's file keys into the record", () => {
    const [result] = Effect.runSync(decodeFactTypes([{
      ...VALID,
      derivation: { kind: "derived", expression: "x", is_formal: false },
    }]));
    expect(result !== undefined && Result.isSuccess(result) && result.success).toEqual({
      id: "ft-1",
      name: "Person has Age",
      roles: [{ id: "r-1", name: "has", playerId: "ot-1" }],
      readings: ["{0} has"],
      derivation: { kind: "derived", expression: "x" },
    });
  });
});

describe("the fact type decoder over this repository's model files (S1)", () => {
  // Every fact type in the files main's rules accept (tests/helpers/
  // modelCorpus.ts) reads to the record today's reader gives, constraints
  // aside (they have their own corpus test).
  const factTypes = corpusDocuments().flatMap(({ file, doc }) =>
    ((doc.model as { fact_types?: OrmYamlFactType[]; } | undefined)?.fact_types ?? [])
      .map((ft) => ({ file, ft }))
  );

  it("finds fact types to read", () => {
    expect(factTypes.length).toBeGreaterThan(1400);
  });

  it("reads every one as today's reader does", () => {
    const results = Effect.runSync(decodeFactTypes(factTypes.map(({ ft }) => ft)));
    const differ = factTypes.flatMap(({ file, ft }, i) => {
      const { constraints: _constraints, ...expected } = deserializeFactType({
        ...ft,
        constraints: [],
      });
      const result = results[i]!;
      const actual = Result.isSuccess(result) ? result.success : result.failure.problems;
      return isDeepStrictEqual(actual, withoutUndefined(expected))
        ? []
        : [{ file, id: ft.id, actual, expected }];
    });
    expect(differ.slice(0, 3)).toEqual([]);
  });
});

/** Today's reader writes absent optional fields as `undefined` keys; the record omits them. */
function withoutUndefined(o: object): object {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

describe("readDerivation and the serializer's deserializeDerivation", () => {
  // A copy kept so the model does not import from serialization; held to the
  // original over every combination of the file's fields.
  it("read every derivation the file can spell the same way", () => {
    const differ = [];
    for (const kind of ["derived", "semiderived"] as const) {
      for (const storage of [undefined, "derive_on_request", "derived_and_stored"] as const) {
        for (const is_formal of [undefined, false, true]) {
          const d = {
            kind,
            expression: "x",
            ...(storage !== undefined ? { storage } : {}),
            ...(is_formal !== undefined ? { is_formal } : {}),
          };
          if (!isDeepStrictEqual(readDerivation(d), deserializeDerivation(d))) differ.push(d);
        }
      }
    }
    expect(differ).toEqual([]);
  });
});
