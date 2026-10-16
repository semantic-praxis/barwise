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
