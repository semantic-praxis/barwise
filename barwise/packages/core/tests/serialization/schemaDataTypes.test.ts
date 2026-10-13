/**
 * The JSON Schema's data type list and the metamodel's are one list
 * (barwise-0lf).
 *
 * `orm-model.schema.json` enumerates the data type names a `.orm.yaml` may
 * use, and the loader validates against it before the model sees the file;
 * `CONCEPTUAL_DATA_TYPE_NAMES` is the metamodel's list, compile-checked
 * against the `ConceptualDataTypeName` union. A name in only one of them is
 * either a type the model supports and every file is refused for using, or
 * one the loader admits and the model has never heard of.
 *
 * Nothing tied them before this test. The serialization law would notice a
 * name dropped from the schema only if its arbitrary generated that name,
 * and it samples a hand-picked 5 of the 14: removing "other" from the
 * schema left all 1,932 core tests green. Every other enum in the schema
 * was checked the same way and is caught
 * (docs/specs/effect-comparison.spec.md, "How each criterion was tested").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONCEPTUAL_DATA_TYPE_NAMES } from "../../src/model/ObjectType.js";

interface SchemaWithDataTypes {
  readonly definitions: {
    readonly data_type_def: {
      readonly properties: { readonly name: { readonly enum: readonly string[]; }; };
    };
  };
}

const schema = JSON.parse(
  readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
) as SchemaWithDataTypes;

describe("data type names", () => {
  it("are the same set in the JSON Schema and the metamodel", () => {
    const inSchema = [...schema.definitions.data_type_def.properties.name.enum].sort();
    const inModel = [...CONCEPTUAL_DATA_TYPE_NAMES].sort();
    expect(inSchema).toEqual(inModel);
  });
});
