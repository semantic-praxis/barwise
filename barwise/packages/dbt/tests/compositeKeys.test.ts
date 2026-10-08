/**
 * A model keyed by a model-level dbt_utils.unique_combination_of_columns
 * imports as the fact type it states (composite-key-tables.spec.md). The
 * rule's agreement with the DDL importer is cli's compositeKeyParity
 * test; this covers what only the dbt side reports.
 */
import { describe, expect, it } from "vitest";
import { importDbtProject } from "../src/DbtProjectImporter.js";

const yaml = `
models:
  - name: course
    columns:
      - name: course_id
        data_tests: [unique, not_null]
  - name: section
    columns:
      - name: crn
        data_tests: [unique, not_null]
  - name: offering
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [course_id, crn]
    columns:
      - name: course_id
        data_tests:
          - not_null
          - relationships: { to: "ref('course')", field: course_id }
      - name: crn
        data_tests:
          - not_null
          - relationships: { to: "ref('section')", field: crn }
  - name: waitlist
    columns:
      - name: waitlist_id
        data_tests: [unique, not_null]
      - name: course_id
        data_tests:
          - relationships: { to: "ref('offering')", field: course_id }
`;

describe("a composite-key dbt model", () => {
  it("is no longer reported as a model with no identifier", () => {
    const { report } = importDbtProject([yaml]);
    const text = JSON.stringify(report);
    expect(text).toContain("Composite key (course_id, crn)");
    expect(text).not.toContain("Cannot determine primary identifier");
    expect(text).not.toMatch(/Model-level custom test "dbt_utils\.unique_combination_of_columns"/);
  });

  it("is objectified when another model references it, so the reference has a player", () => {
    const { model } = importDbtProject([yaml]);
    const objectified = model.objectifiedFactTypes.map((o) =>
      model.getObjectType(o.objectTypeId)?.name
    );
    expect(objectified).toEqual(["Offering"]);
    const relationship = model.factTypes.find((f) =>
      f.id === model.objectifiedFactTypes[0]!.factTypeId
    )!;
    expect(relationship.roles.map((r) => model.getObjectType(r.playerId)?.name)).toEqual([
      "Course",
      "Section",
    ]);
    expect(
      model.factTypes.some((f) =>
        f.roles.some((r) => model.getObjectType(r.playerId)?.name === "Offering")
        && f.roles.some((r) => model.getObjectType(r.playerId)?.name === "Waitlist")
      ),
    ).toBe(true);
  });

  it("is no key when a column of the combination may be null", () => {
    // The combination test proves uniqueness, not presence (PR #620 review).
    const nullable = yaml.replace(
      "      - name: crn\n        data_tests:\n          - not_null\n          - relationships: { to: \"ref('section')\", field: crn }",
      "      - name: crn\n        data_tests:\n          - relationships: { to: \"ref('section')\", field: crn }",
    );
    expect(nullable).not.toEqual(yaml);
    const { model, report } = importDbtProject([nullable]);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("Composite key (course_id, crn)");
  });

  it("is no key when two combinations qualify, and names both", () => {
    // Two candidate keys, neither marked preferred (PR #620 review).
    const twoKeys = yaml.replace(
      "          combination_of_columns: [course_id, crn]\n",
      "          combination_of_columns: [course_id, crn]\n"
        + "      - dbt_utils.unique_combination_of_columns:\n"
        + "          combination_of_columns: [crn, course_id]\n",
    );
    expect(twoKeys).not.toEqual(yaml);
    const { model, report } = importDbtProject([twoKeys]);
    expect(model.objectifiedFactTypes).toEqual([]);
    const text = JSON.stringify(report);
    expect(text).not.toContain("Composite key (");
    expect(text).toContain("(course_id, crn), (crn, course_id)) and none is marked preferred");
  });

  it("a combination of values alone is no key, and the model is still reported as having none", () => {
    // The gap was suppressed by a check that did not ask for a relationships
    // column, while the mapping skipped the model for lacking one (PR #621
    // review).
    const { report } = importDbtProject([`
models:
  - name: exchange_rate
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [currency, rate_date]
    columns:
      - name: currency
        data_tests: [not_null]
      - name: rate_date
        data_tests: [not_null]
`]);
    const text = JSON.stringify(report);
    expect(text).toContain("Cannot determine primary identifier");
    expect(text).not.toContain("Composite key (");
  });

  it("warns on every combination test except the one read as the key", () => {
    // A second, nullable combination is not the key, so it is reviewed.
    const extra = yaml.replace(
      "          combination_of_columns: [course_id, crn]\n",
      "          combination_of_columns: [course_id, crn]\n"
        + "      - dbt_utils.unique_combination_of_columns:\n"
        + "          combination_of_columns: [crn, room]\n",
    ).replace(
      "      - name: crn\n        data_tests:\n          - not_null\n          - relationships: { to: \"ref('section')\", field: crn }\n",
      "      - name: crn\n        data_tests:\n          - not_null\n          - relationships: { to: \"ref('section')\", field: crn }\n      - name: room\n",
    );
    expect(extra).toContain("- name: room");
    const { report } = importDbtProject([extra]);
    const text = JSON.stringify(report);
    expect(text).toContain("Composite key (course_id, crn)");
    expect(text.match(/Model-level custom test \\"dbt_utils\.unique_combination_of_columns\\"/g))
      .toHaveLength(1);
  });

  it("keeps an accepted_values test on a value role as its value constraint", () => {
    const { model } = importDbtProject([`
models:
  - name: meter
    columns:
      - name: meter_id
        data_tests: [unique, not_null]
  - name: meter_reading
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [meter_id, channel]
    columns:
      - name: meter_id
        data_tests:
          - not_null
          - relationships: { to: "ref('meter')", field: meter_id }
      - name: channel
        data_tests:
          - not_null
          - accepted_values: { values: [A, B] }
`]);
    const values = model.factTypes.flatMap((f) => f.constraints)
      .filter((c) => c.type === "value_constraint");
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ values: ["A", "B"] });
  });

  it("is skipped and reported, with no entity, when a role references a model with no key", () => {
    // The objectifier used to be created before the fact type was known to
    // be buildable, leaving an entity with an invented key (PR #621 review).
    const { model, report } = importDbtProject([`
models:
  - name: course
    columns:
      - name: course_id
        data_tests: [not_null]
  - name: section
    columns:
      - name: crn
        data_tests: [unique, not_null]
  - name: offering
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [course_id, crn]
    columns:
      - name: course_id
        data_tests:
          - not_null
          - relationships: { to: "ref('course')", field: course_id }
      - name: crn
        data_tests:
          - not_null
          - relationships: { to: "ref('section')", field: crn }
      - name: room
        data_tests: [not_null]
      - name: seats
`]);
    expect(model.objectTypes.some((o) => o.name === "Offering")).toBe(false);
    expect(JSON.stringify(report)).toContain(
      `column \\"course_id\\" references model \\"course\\", which has no identifiable key`,
    );
  });

  it("describes a value role's value type as any column's", () => {
    const { model } = importDbtProject([`
models:
  - name: meter
    columns:
      - name: meter_id
        data_tests: [unique, not_null]
  - name: meter_reading
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [meter_id, channel]
    columns:
      - name: meter_id
        data_tests:
          - not_null
          - relationships: { to: "ref('meter')", field: meter_id }
      - name: channel
        description: The register a reading comes from.
        data_tests: [not_null]
`]);
    expect(model.getObjectTypeByName("Channel")?.definition).toBe(
      "The register a reading comes from.",
    );
  });
});
