/**
 * A model-level `foreign_key` constraint over several columns is one
 * reference, read wherever a `relationships` column is one
 * (composite-foreign-key-round-trip.spec.md). Before, the importer read no
 * `constraints:` at all, so such a reference came back as its columns'
 * values. The agreement with the DDL importer is cli's compositeKeyParity
 * test; this covers each rule on the dbt side.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { importDbtProject } from "../src/DbtProjectImporter.js";
import { parseDbtSchema } from "../src/DbtSchemaParser.js";

const PERIOD = `models:
  - name: policy
    columns:
      - name: policy_id
        data_tests: [unique, not_null]
  - name: policy_period
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
`;

const FK = `    constraints:
      - type: foreign_key
        columns: [policy_id, term_number]
        to: ref('policy_period')
        to_columns: [policy_id, term_number]
`;

/** A claim model referencing a period through both columns; `tests` adds model-level tests. */
const claim = (opts: { notNull?: boolean; tests?: string; } = {}) =>
  `${PERIOD}  - name: claim
${FK}${opts.tests ?? ""}    columns:
      - name: claim_id
        data_tests: [unique, not_null]
      - name: policy_id
${opts.notNull === false ? "" : "        data_tests: [not_null]\n"}      - name: term_number
        data_tests: [not_null]
`;

/** Each fact type a player plays in, by players and the roles its constraints fall on. */
function factsOf(model: OrmModel, player: string) {
  const id = model.getObjectTypeByName(player)!.id;
  return model.factTypes.filter((f) => f.roles.some((r) => r.playerId === id)).map((f) => ({
    players: f.roles.map((r) => model.getObjectType(r.playerId)!.name),
    constraints: f.internalConstraints.map((c) =>
      `${c.type} ${
        ("roleIds" in c ? c.roleIds : [c.roleId]).map((r) => f.roles.findIndex((x) => x.id === r))
          .join(",")
      }`
    ),
  }));
}

describe("the parser", () => {
  it("reads a foreign_key constraint over several columns, and no other constraint", () => {
    const doc = parseDbtSchema([`models:
  - name: claim
    constraints:
      - type: foreign_key
        columns: [policy_id, term_number]
        to: ref('policy_period')
        to_columns: [policy_id, term_number]
      - type: foreign_key
        columns: [policy_id]
        to: ref('policy')
      - type: primary_key
        columns: [claim_id]
      - type: foreign_key
        columns: [a, b]
    columns:
      - name: claim_id
`]);
    expect(doc.models[0]!.foreignKeys).toEqual([
      {
        columns: ["policy_id", "term_number"],
        to: "policy_period",
        toColumns: ["policy_id", "term_number"],
      },
    ]);
  });
});

describe("a multi-column foreign key outside the key", () => {
  it("is one reference, mandatory when every column is not_null, its columns no values", () => {
    const { model } = importDbtProject([claim()]);
    expect(factsOf(model, "Claim")).toEqual([
      {
        players: ["Claim", "ClaimId"],
        constraints: ["internal_uniqueness 1", "internal_uniqueness 0", "mandatory 0"],
      },
      {
        players: ["PolicyPeriod", "Claim"],
        constraints: ["internal_uniqueness 1", "mandatory 1"],
      },
    ]);
  });

  it("is optional when any column may be null", () => {
    const { model } = importDbtProject([claim({ notNull: false })]);
    expect(factsOf(model, "Claim")[1]).toEqual({
      players: ["PolicyPeriod", "Claim"],
      constraints: ["internal_uniqueness 1"],
    });
  });

  it("is one-to-one when a combination test names exactly its columns, which is no key", () => {
    const { model, report } = importDbtProject([claim({
      tests: `    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [term_number, policy_id]
`,
    })]);
    expect(factsOf(model, "Claim")[1]).toEqual({
      players: ["PolicyPeriod", "Claim"],
      constraints: ["internal_uniqueness 1", "mandatory 1", "internal_uniqueness 0"],
    });
    // Read, so neither a second candidate key nor a test left for review.
    expect(
      report.entries.filter((e) => e.modelName === "claim" && e.severity !== "info")
        .map((e) => e.message).filter((m) => /identifier|manual review/.test(m)),
    ).toEqual([]);
  });

  it("keeps its columns as values, with a gap, when its target has no entity", () => {
    const { model, report } = importDbtProject([
      claim().replace(
        "to: ref('policy_period')",
        "to: ref('unknown_model')",
      ),
    ]);
    expect(factsOf(model, "Claim").map((f) => f.players)).toEqual([
      ["Claim", "ClaimId"],
      ["Claim", "PolicyId"],
      ["Claim", "TermNumber"],
    ]);
    expect(report.entries.map((e) => e.message)).toContain(
      `Foreign key (policy_id, term_number) references model "unknown_model" which has no identifiable PK -- its columns are kept as values.`,
    );
  });
});

describe("a multi-column foreign key in a composite key", () => {
  const applies = (columns: string, key: string) =>
    `${PERIOD}  - name: coverage_applies
${FK}    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [${key}]
    columns:
${columns}`;
  const col = (name: string) => `      - name: ${name}\n        data_tests: [not_null]\n`;

  it("is one role, and its columns each record it, so no rename is reported", () => {
    const { model, report } = importDbtProject([applies(
      col("coverage_code") + col("policy_id") + col("term_number"),
      "coverage_code, policy_id, term_number",
    )]);
    expect(factsOf(model, "PolicyPeriod").map((f) => f.players)).toContainEqual([
      "CoverageCode",
      "PolicyPeriod",
    ]);
    expect(report.entries.filter((e) => / will export as /.test(e.message))).toEqual([]);
  });

  it("as the one role beside the key, is played by its own target, though its first column has another reference", () => {
    const { model } = importDbtProject([`${PERIOD}  - name: coverage
    columns:
      - name: coverage_code
        data_tests: [unique, not_null]
  - name: coverage_applies
${FK}    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [coverage_code, note]
    columns:
      - name: coverage_code
        data_tests: [not_null, { relationships: { to: "ref('coverage')", field: coverage_code } }]
${col("note")}      - name: policy_id
        data_tests: [not_null, { relationships: { to: "ref('policy')", field: policy_id } }]
${col("term_number")}`]);
    expect(factsOf(model, "PolicyPeriod").map((f) => f.players)).toContainEqual([
      "Coverage",
      "Note",
      "PolicyPeriod",
    ]);
  });

  it("sets the reference aside when it lies only partly inside the key, keeping the earlier reading", () => {
    // policy_id also has a relationships test, so the key reads as it did
    // before foreign_key constraints were read: one role per key column.
    const { model, report } = importDbtProject([applies(
      col("coverage_code")
        + "      - name: policy_id\n        data_tests: [not_null, { relationships: { to: \"ref('policy')\", field: policy_id } }]\n"
        + col("term_number"),
      "coverage_code, policy_id",
    )]);
    // term_number, the one column left, is the third role, as before.
    expect(factsOf(model, "Policy").map((f) => f.players)).toContainEqual([
      "CoverageCode",
      "Policy",
      "TermNumber",
    ]);
    expect(report.entries.map((e) => e.message)).toContain(
      "Foreign key (policy_id, term_number) lies partly inside the composite key (coverage_code, policy_id) or shares a key column with another reference; it is not read, and its columns are kept as values.",
    );
  });

  it("is an entity with a one-to-one reference when the key is exactly that one reference", () => {
    // As the DDL importer reads a table whose key is one foreign key.
    const { model, report } = importDbtProject([applies(
      col("policy_id") + col("term_number") + col("note"),
      "policy_id, term_number",
    )]);
    expect(model.getObjectTypeByName("CoverageApplies")?.referenceMode).toBe("coverage_applies_id");
    expect(factsOf(model, "CoverageApplies")).toContainEqual({
      players: ["PolicyPeriod", "CoverageApplies"],
      constraints: ["internal_uniqueness 1", "mandatory 1", "internal_uniqueness 0"],
    });
    expect(
      report.entries.filter((e) => e.modelName === "coverage_applies" && e.severity === "gap")
        .map((e) => e.message).filter((m) => /identifier/.test(m)),
    ).toEqual([]);
  });
});
