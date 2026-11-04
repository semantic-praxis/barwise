/**
 * A declared primary key, and the uniquenesses beside it
 * (dbt-alternate-uniqueness.spec.md). The agreement with the DDL importer on
 * each uniqueness is cli's uniquenessParity test; this covers the key and
 * what only the dbt side reports.
 */
import { describe, expect, it } from "vitest";
import { importDbtProject } from "../src/DbtProjectImporter.js";
import { parseDbtSchema } from "../src/DbtSchemaParser.js";

describe("the parser", () => {
  it("reads the first model-level primary_key constraint naming a column", () => {
    const doc = parseDbtSchema([`models:
  - name: room
    constraints:
      - type: foreign_key
        columns: [a, b]
        to: ref('x')
      - type: primary_key
        columns: []
      - type: primary_key
        columns: [room_id]
  - name: plain
`]);
    expect(doc.models[0]!.primaryKey).toEqual(["room_id"]);
    expect(doc.models[1]!.primaryKey).toBeUndefined();
  });

  it("reads a column-level primary_key constraint, dbt's usual form for one column", () => {
    const doc = parseDbtSchema([`models:
  - name: customer
    columns:
      - name: email
        data_tests: [not_null, unique]
      - name: customer_id
        constraints: [{ type: primary_key }]
`]);
    expect(doc.models[0]!.primaryKey).toEqual(["customer_id"]);
  });
});

describe("a declared primary key", () => {
  const person = (key: string) =>
    `models:
  - name: person
    constraints:
      - type: primary_key
        columns: [${key}]
    columns:
      - name: email
        data_tests: [not_null, unique]
      - name: person_id
        data_tests: [not_null, unique]
`;

  it("is the key, though a unique NOT NULL column comes first", () => {
    const { model, report } = importDbtProject([person("person_id")]);
    expect(model.getObjectTypeByName("Person")?.referenceMode).toBe("person_id");
    expect(report.entries.map((e) => e.message)).toContain(
      `Primary identifier "person_id" declared by the primary_key constraint.`,
    );
  });

  it("over values alone, is no key this importer reads: the tests find it", () => {
    const { model, report } = importDbtProject([`models:
  - name: room
    constraints:
      - type: primary_key
        columns: [building, room_number]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [building, room_number]
    columns:
      - name: building
        data_tests: [not_null]
      - name: room_number
        data_tests: [not_null]
      - name: room_uuid
        data_tests: [not_null, unique]
`]);
    expect(model.getObjectTypeByName("Room")?.referenceMode).toBe("room_uuid");
    expect(report.entries.map((e) => e.message)).toContain(
      "The primary_key constraint (building, room_number) is no key this importer reads; the key is found from its tests instead.",
    );
  });

  it("is reported and set aside when it names a column the model lacks", () => {
    const { model, report } = importDbtProject([person("nope")]);
    // The guess takes the first unique NOT NULL column, as before.
    expect(model.getObjectTypeByName("Person")?.referenceMode).toBe("email");
    expect(report.entries.map((e) => e.message)).toContain(
      "The primary_key constraint names (nope), and not every one is a column of the model; the key is found from its tests instead.",
    );
  });

  it("over several columns, is the key among two combination tests that could each be", () => {
    const { model, report } = importDbtProject([`models:
  - name: encounter
    columns:
      - name: encounter_id
        data_tests: [unique, not_null]
  - name: diagnosis
    columns:
      - name: icd_code
        data_tests: [unique, not_null]
  - name: encounter_diagnosis
    constraints:
      - type: primary_key
        columns: [encounter_id, icd_code]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [encounter_id, diagnosis_rank]
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [encounter_id, icd_code]
    columns:
      - name: encounter_id
        data_tests: [not_null, { relationships: { to: "ref('encounter')", field: encounter_id } }]
      - name: icd_code
        data_tests: [not_null, { relationships: { to: "ref('diagnosis')", field: icd_code } }]
      - name: diagnosis_rank
        data_tests: [not_null]
`]);
    const messages = report.entries.map((e) => e.message);
    expect(messages.some((m) => /none is marked preferred/.test(m))).toBe(false);
    expect(messages).toContain(
      "Composite key (encounter_id, icd_code) from dbt_utils.unique_combination_of_columns: imported as a fact type over encounter_id, icd_code, diagnosis_rank.",
    );
    // The other combination is the fact type's second uniqueness.
    const ft = model.factTypes.find((f) => f.roles.length === 3)!;
    expect(ft.internalConstraints.filter((c) => c.type === "internal_uniqueness")).toHaveLength(2);
  });
});

describe("a uniqueness the importer cannot read", () => {
  const person = (tests: string) =>
    `models:
  - name: person
    constraints:
      - type: primary_key
        columns: [person_id]
    data_tests:
${tests}    columns:
      - name: person_id
        data_tests: [not_null, unique]
      - name: email
        data_tests: [not_null]
      - name: nick
        data_tests: [not_null]
`;

  it("filtered to some rows is named for review, not read as a uniqueness", () => {
    const { model, report } = importDbtProject([
      person(`      - dbt_utils.unique_combination_of_columns:
          arguments: { combination_of_columns: [email, nick] }
          config: { where: "status = 'active'" }
`),
    ]);
    expect(model.constraints.filter((c) => c.type === "external_uniqueness")).toEqual([]);
    expect(report.entries.map((e) => e.message)).toContain(
      `Model-level custom test "dbt_utils.unique_combination_of_columns" (email, nick) is filtered to some rows, so it is no uniqueness of the model -- manual review needed.`,
    );
  });

  it("is read when its only filter is the one the export writes over nullable columns", () => {
    const { model } = importDbtProject([person(`      - dbt_utils.unique_combination_of_columns:
          arguments: { combination_of_columns: [email, nick] }
          config: { where: "email is not null and nick is not null" }
`)]);
    expect(model.constraints.filter((c) => c.type === "external_uniqueness")).toHaveLength(1);
  });

  it("over one column is that column's own uniqueness, not an external one over one role", () => {
    const { model } = importDbtProject([person(`      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [email]
`)]);
    expect(model.constraints.filter((c) => c.type === "external_uniqueness")).toEqual([]);
    const ft = model.factTypes.find((f) => f.name === "Person has Email")!;
    expect(ft.internalConstraints.filter((c) => c.type === "internal_uniqueness")).toHaveLength(2);
  });

  it("naming a column of two foreign keys is refused, as the DDL importer refuses it", () => {
    const { model, report } = importDbtProject([`models:
  - name: policy
    columns:
      - name: policy_id
        data_tests: [unique, not_null]
  - name: period
    constraints:
      - type: primary_key
        columns: [policy_id, term_number]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [policy_id, term_number]
    columns:
      - name: policy_id
        data_tests: [not_null, { relationships: { to: "ref('policy')", field: policy_id } }]
      - name: term_number
        data_tests: [not_null]
      - name: starts
        data_tests: [not_null]
  - name: claim
    constraints:
      - type: primary_key
        columns: [claim_id]
      - type: foreign_key
        columns: [policy_id, term_number]
        to: ref('period')
        to_columns: [policy_id, term_number]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [policy_id, code]
    columns:
      - name: claim_id
        data_tests: [not_null, unique]
      - name: policy_id
        data_tests: [not_null, { relationships: { to: "ref('policy')", field: policy_id } }]
      - name: term_number
        data_tests: [not_null]
      - name: code
        data_tests: [not_null]
`]);
    expect(model.constraints.filter((c) => c.type === "external_uniqueness")).toEqual([]);
    expect(report.entries.map((e) => e.message)).toContain(
      `Model-level custom test "dbt_utils.unique_combination_of_columns" (policy_id, code) names "policy_id", a column of two foreign keys -- manual review needed.`,
    );
  });

  it("with no column is named for review", () => {
    const { report } = importDbtProject([person(`      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: []
`)]);
    expect(report.entries.map((e) => e.message)).toContain(
      `Model-level custom test "dbt_utils.unique_combination_of_columns" () names no column -- manual review needed.`,
    );
  });

  it("over one column of a multi-column foreign key is named for review", () => {
    const { report } = importDbtProject([`models:
  - name: period
    constraints:
      - type: primary_key
        columns: [policy_id, term_number]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [policy_id, term_number]
    columns:
      - name: policy_id
        data_tests: [not_null, { relationships: { to: "ref('policy')", field: policy_id } }]
      - name: term_number
        data_tests: [not_null]
      - name: starts
        data_tests: [not_null]
  - name: policy
    columns:
      - name: policy_id
        data_tests: [unique, not_null]
  - name: claim
    constraints:
      - type: primary_key
        columns: [claim_id]
      - type: foreign_key
        columns: [policy_id, term_number]
        to: ref('period')
        to_columns: [policy_id, term_number]
    columns:
      - name: claim_id
        data_tests: [not_null, unique]
      - name: policy_id
        data_tests: [not_null]
      - name: term_number
        data_tests: [not_null, unique]
`]);
    expect(report.entries.map((e) => e.message)).toContain(
      `Unique test on column "term_number" (term_number) covers only part of the foreign key (policy_id, term_number) -- manual review needed.`,
    );
  });
});
