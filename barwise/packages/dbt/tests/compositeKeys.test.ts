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
});
