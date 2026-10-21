/**
 * The fields only a value type may carry, stated once (barwise-5fg).
 *
 * `VALUE_ONLY_FIELDS` in `ObjectType.ts` is the list; the JSON Schema forbids
 * the same fields under its entity branch, in their YAML spelling. Two lists
 * that must agree, so this test derives one from the other: change either
 * alone and it fails, rather than leaving a file and a direct caller with
 * different rules about what an entity may carry. Every case below is
 * generated from the list, so a field added to it is tested without anyone
 * writing a case -- and a field with no sample value fails here first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createObjectType, VALUE_ONLY_FIELDS } from "../../src/model/ObjectType.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
) as { definitions: { object_type: { then: { properties: Record<string, unknown>; }; }; }; };

const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A valid value for each field, in model and YAML form. */
const SAMPLES: Record<string, { model: unknown; yaml: unknown; }> = {
  dataType: { model: { name: "integer" }, yaml: { name: "integer" } },
  valueConstraint: { model: { values: ["A"] }, yaml: { values: ["A"] } },
  defaultValue: { model: "A", yaml: "A" },
};

describe("value-only fields", () => {
  it("the schema forbids on an entity exactly the fields the constructor refuses", () => {
    const forbidden = Object.entries(schema.definitions.object_type.then.properties)
      .filter(([, rule]) => rule === false)
      .map(([field]) => field)
      .sort();
    expect(forbidden).toEqual(VALUE_ONLY_FIELDS.map(([field]) => snake(field)).sort());
  });

  it("every field has a sample, so every case below runs", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(VALUE_ONLY_FIELDS.map(([f]) => f).sort());
  });

  const validator = new SchemaValidator();

  for (const [field, label] of VALUE_ONLY_FIELDS) {
    it(`createObjectType refuses ${field} on an entity type, naming the type`, () => {
      expect(() =>
        createObjectType(
          {
            name: "Supplier",
            kind: "entity",
            referenceMode: "supplier_id",
            [field]: SAMPLES[field]!.model,
          } as Parameters<typeof createObjectType>[0],
        )
      ).toThrow(`Entity type "Supplier" cannot have ${label}`);
    });

    it(`the schema rejects ${snake(field)} on an entity type, naming the type and the field`, () => {
      const result = validator.validateModel({
        orm_version: "3.0",
        model: {
          name: "Test",
          object_types: [{
            id: "ot-1",
            name: "Supplier",
            kind: "entity",
            reference_mode: "supplier_id",
            [snake(field)]: SAMPLES[field]!.yaml,
          }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: `/model/object_types/0/${snake(field)}`,
        message: 'is not allowed here (in "Supplier")',
      });
    });
  }

  it("an entity with an empty value constraint is told it cannot have one", () => {
    // The value-only check runs first; otherwise the emptiness check fires
    // and tells the reader to add a value to a field they must remove.
    expect(() =>
      createObjectType({
        name: "Carrier",
        kind: "entity",
        referenceMode: "carrier_id",
        valueConstraint: { values: [] },
      })
    ).toThrow('Entity type "Carrier" cannot have a value constraint');
  });

  it("a value type may still carry all of them", () => {
    const fields = Object.fromEntries(
      VALUE_ONLY_FIELDS.map(([f]) => [snake(f), SAMPLES[f]!.yaml]),
    );
    const result = validator.validateModel({
      orm_version: "3.0",
      model: {
        name: "Test",
        object_types: [{ id: "ot-1", name: "Rating", kind: "value", ...fields }],
      },
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
