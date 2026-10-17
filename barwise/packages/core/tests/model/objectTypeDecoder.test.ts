/**
 * The object type decoder (docs/specs/effect-comparison.spec.md, the Effect
 * arm): every problem in one pass, each naming the object type and the
 * field, and every id required, none minted (effect-adoption.spec.md,
 * decision 8).
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "../../src/model/id.js";
import { requireName } from "../../src/model/name.js";
import { createObjectType, type ObjectType } from "../../src/model/ObjectType.js";
import {
  decodeObjectType,
  decodeObjectTypeConfig,
  ObjectTypeError,
  type ObjectTypeProblem,
  type ObjectTypeProblems,
  runObjectTypeDecode,
} from "../../src/model/objectTypeDecoder.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";

afterEach(() => {
  setIdGenerator(undefined);
});

/** Run a decode, returning the record or the problems. */
function run(
  decoded: Effect.Effect<ObjectType, ObjectTypeProblems>,
): Result.Result<ObjectType, readonly ObjectTypeProblem[]> {
  return Effect.runSync(decoded.pipe(Effect.mapError((e) => e.problems), Effect.result));
}

function problems(decoded: Effect.Effect<ObjectType, ObjectTypeProblems>) {
  const result = run(decoded);
  if (Result.isSuccess(result)) throw new Error("expected the decode to fail");
  return result.failure;
}

describe("decodeObjectType", () => {
  it("decodes a file's value type into the record, defaults applied", () => {
    const result = run(decodeObjectType({
      id: "ot-1",
      name: "  Rating ",
      kind: "value",
      data_type: { name: "text", length: 2 },
      value_constraint: { ranges: [{ min: "A", max_inclusive: false }] },
    }));
    expect(Result.isSuccess(result) && result.success).toEqual({
      id: "ot-1",
      name: "Rating",
      kind: "value",
      aliases: [],
      independent: false,
      dataType: { name: "text", length: 2 },
      valueConstraint: { values: [], ranges: [{ min: "A", maxInclusive: false }] },
    });
  });

  it("reports every problem with one object type in one pass, each naming it and the field", () => {
    const found = problems(decodeObjectType({
      id: "ot-supplier",
      name: "Supplier",
      kind: "entity",
      data_type: { name: "integer" },
      default_value: "x",
      cardinality: { min: 5, max: 2 },
      colour: "red",
    }));
    expect(found.map((p) => p.field).sort()).toEqual(
      ["cardinality", "colour", "data_type", "default_value", "reference_mode"],
    );
    for (const p of found) {
      expect(p.objectType).toBe("Supplier");
      expect(p.message).toMatch(/^Entity type "Supplier" /);
    }
    expect(found.find((p) => p.field === "colour")?.message).toBe(
      'Entity type "Supplier" has an unknown field "colour".',
    );
  });

  it("names the object type by its id when the name is the problem", () => {
    const [problem, ...rest] = problems(
      decodeObjectType({ id: "ot-9", name: "  ", kind: "value" }),
    );
    expect(rest).toEqual([]);
    expect(problem).toEqual({
      objectType: "ot-9",
      field: "name",
      message: 'Value type with id "ot-9" must have a non-empty name.',
    });
  });

  it("reports a check on a decoded struct at the key the file used", () => {
    const [problem] = problems(decodeObjectType({
      id: "ot-1",
      name: "Colour",
      kind: "value",
      value_constraint: { values: [] },
    }));
    expect(problem?.field).toBe("value_constraint");
  });

  it("reports an unknown kind as one problem at kind", () => {
    expect(problems(decodeObjectType({ id: "ot-1", name: "Thing", kind: "both" }))).toEqual([{
      objectType: "Thing",
      field: "kind",
      message: 'Object type "Thing" must have kind "entity" or "value".',
    }]);
  });

  it("refuses a camelCase key in a file rather than reading it", () => {
    const found = problems(decodeObjectType({
      id: "ot-1",
      name: "Rating",
      kind: "value",
      dataType: { name: "text" },
    }));
    expect(found.map((p) => p.message)).toEqual([
      'Value type "Rating" has an unknown field "dataType".',
    ]);
  });
});

describe("ids", () => {
  // An installed generator that would be noticed: the decoder must not reach
  // it, whatever a caller has installed.
  const refuseGenerator = () =>
    setIdGenerator(() => {
      throw new Error("the decoder reached the installed generator");
    });

  it("are required: the decoder refuses a config without one, and mints none", () => {
    refuseGenerator();
    expect(problems(decodeObjectTypeConfig({ name: "Rating", kind: "value" }))).toEqual([{
      objectType: "Rating",
      field: "id",
      message: 'Value type "Rating" is missing "id".',
    }]);
  });

  it("are read from the input when present, without the generator", () => {
    refuseGenerator();
    const result = run(decodeObjectType({ id: "ot-1", name: "Rating", kind: "value" }));
    expect(Result.isSuccess(result) && result.success.id).toBe("ot-1");
  });

  it("is supplied by OrmModel.addObjectType from the installed generator", () => {
    setIdGenerator(() => "from-the-installed-generator");
    const ot = new OrmModel({ name: "M" }).addObjectType({ name: "Rating", kind: "value" });
    expect(ot.id).toBe("from-the-installed-generator");
  });
});

describe("decodeObjectTypeConfig", () => {
  it("treats a key holding undefined as absent, as createObjectType always did", () => {
    const result = run(decodeObjectTypeConfig({
      name: "Rating",
      kind: "value",
      id: "ot-1",
      referenceMode: undefined,
      dataType: { name: "text", length: undefined },
    }));
    expect(Result.isSuccess(result) && result.success).toEqual({
      id: "ot-1",
      name: "Rating",
      kind: "value",
      aliases: [],
      independent: false,
      dataType: { name: "text" },
    });
  });

  it("returns a frozen record", () => {
    const ot = runObjectTypeDecode(
      decodeObjectTypeConfig({ id: "ot-1", name: "Rating", kind: "value", aliases: ["Grade"] }),
    );
    expect(Object.isFrozen(ot)).toBe(true);
    expect(Object.isFrozen(ot.aliases)).toBe(true);
  });

  it("is thrown at the boundary as one error carrying every problem", () => {
    let caught: unknown;
    try {
      createObjectType({ name: "Customer", kind: "entity", cardinality: { min: -1, max: 2 } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ObjectTypeError);
    const error = caught as ObjectTypeError;
    expect(error.problems.map((p) => p.field).sort()).toEqual(["cardinality", "referenceMode"]);
    expect(error.message).toBe(
      'Entity type "Customer" must have a non-negative cardinality minimum.\n'
        + 'Entity type "Customer" must have a reference mode.',
    );
  });
});

describe("the naming rule", () => {
  // `requireName` is the rule every other element follows; the decoder
  // states it in schema terms. Two statements of one rule, so they are
  // checked against each other rather than trusted to agree.
  it("accepts exactly the names requireName accepts, and stores them the same way", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(" ", "\t", "\n", " ", "a", "B") }),
        (name) => {
          let expected: string | undefined;
          try {
            expected = requireName(name);
          } catch {
            expected = undefined;
          }
          const result = run(decodeObjectTypeConfig({ id: "ot-1", name, kind: "value" }));
          expect(Result.isSuccess(result) ? result.success.name : undefined).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("OrmYamlSerializer.deserialize", () => {
  const serializer = new OrmYamlSerializer();

  function errorsOf(yaml: string) {
    try {
      serializer.deserialize(yaml);
    } catch (e) {
      expect(e).toBeInstanceOf(DeserializationError);
      return (e as DeserializationError).validationResult!.errors;
    }
    throw new Error("expected the load to fail");
  }

  it("reports object type problems beside schema errors elsewhere in the file", () => {
    const errors = errorsOf(`
orm_version: "2.0"
model:
  name: M
  object_types:
    - id: ot-1
      name: Size
      kind: value
      cardinality: { min: 5, max: 2 }
  fact_types:
    - id: ft-1
`);
    expect(errors.map((e) => e.path)).toContain("/model/object_types/0/cardinality");
    expect(errors.some((e) => e.path.startsWith("/model/fact_types/0"))).toBe(true);
  });

  it("reports a file's missing id once, as the decoder's problem", () => {
    // The decoder requires every id, so its problem replaces the schema's.
    const errors = errorsOf(`
orm_version: "2.0"
model:
  name: M
  object_types:
    - name: Rating
      kind: value
`);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("/model/object_types/0/id");
    expect(errors[0]!.message).toContain("id");
  });
});
