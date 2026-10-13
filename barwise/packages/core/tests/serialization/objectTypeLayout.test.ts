/**
 * The YAML layout of an object type, byte for byte.
 *
 * Every other serialization test compares a model to a model: the
 * serialization law round-trips and checks idempotence, and the round-trip
 * integration test compares fields. None of them notices a field written
 * in a different position, because the reordered text deserializes to the
 * same model. Users notice -- a reordered key is a diff in every committed
 * `.orm.yaml` -- and the only check that did was promptlab's reference
 * drift test, whose ten models exercise 5 of the 10 optional object type
 * fields (docs/specs/effect-comparison.spec.md, gate G2). Moving
 * `reference_mode` to the end of `serializeObjectType` left all 1,932 core
 * tests green.
 *
 * One entity type and one value type, each carrying every field its kind
 * accepts, so the literal below pins the position of all of them.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const EXPECTED = `orm_version: "2.0"
model:
  name: Layout
  object_types:
    - id: ot-entity
      name: Customer
      kind: entity
      reference_mode: customer_id
      definition: A party that buys.
      source_context: sales
      aliases:
        - Client
        - Account
      independent: true
      note: Imported from CRM.
      cardinality:
        min: 1
        max: unbounded
    - id: ot-value
      name: Rating
      kind: value
      definition: A score.
      source_context: reviews
      value_constraint:
        values:
          - A
          - B
        ranges:
          - min: "1"
            max: "5"
            min_inclusive: false
      data_type:
        name: decimal
        length: 4
        scale: 1
      aliases:
        - Grade
      independent: true
      default_value: B
      note: Scale under review.
      cardinality:
        min: 0
        max: 10
`;

function fullyPopulatedModel(): OrmModel {
  const model = new OrmModel({ name: "Layout" });
  model.addObjectType({
    id: "ot-entity",
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
    definition: "A party that buys.",
    sourceContext: "sales",
    aliases: ["Client", "Account"],
    independent: true,
    note: "Imported from CRM.",
    cardinality: { min: 1, max: "unbounded" },
  });
  model.addObjectType({
    id: "ot-value",
    name: "Rating",
    kind: "value",
    definition: "A score.",
    sourceContext: "reviews",
    valueConstraint: {
      values: ["A", "B"],
      ranges: [{ min: "1", max: "5", minInclusive: false, maxInclusive: true }],
    },
    dataType: { name: "decimal", length: 4, scale: 1 },
    aliases: ["Grade"],
    independent: true,
    defaultValue: "B",
    note: "Scale under review.",
    cardinality: { min: 0, max: 10 },
  });
  return model;
}

describe("object type YAML layout", () => {
  const serializer = new OrmYamlSerializer();

  it("writes every object type field in its fixed position", () => {
    expect(serializer.serialize(fullyPopulatedModel())).toBe(EXPECTED);
  });

  it("reads the same layout back to the same text", () => {
    expect(serializer.serialize(serializer.deserialize(EXPECTED))).toBe(EXPECTED);
  });
});
