/**
 * Pure constraint-building and dbt test helpers for dbt-to-ORM mapping.
 */

import type { Constraint } from "@barwise/core";
import type { ReportBuilder } from "../DbtImportReport.js";
import type { DbtColumn, DbtTest } from "../DbtSchemaTypes.js";

// ---------------------------------------------------------------------------
// Constraint building
// ---------------------------------------------------------------------------

export function buildConstraints(
  col: DbtColumn,
  role1Id: string,
  role2Id: string,
  report: ReportBuilder,
  modelName: string,
): Constraint[] {
  const constraints: Constraint[] = [];

  // Entity has Value: uniqueness on role1 means each entity has at most one value.
  // This is the default for value-type attributes.
  constraints.push({ type: "internal_uniqueness", roleIds: [role1Id] });

  // not_null on the column -> mandatory on role1 (entity must have this value).
  if (hasTest(col, "not_null")) {
    constraints.push({ type: "mandatory", roleId: role1Id });
  }

  // unique on a non-PK column -> the value is unique across entities
  // (i.e., each value belongs to at most one entity).
  if (hasTest(col, "unique")) {
    constraints.push({ type: "internal_uniqueness", roleIds: [role2Id] });
  }

  // accepted_values -> value constraint on the value type's role.
  const avTest = col.tests.find(
    (t): t is Extract<DbtTest, { type: "accepted_values"; }> => t.type === "accepted_values",
  );
  if (avTest) {
    if (avTest.values.length > 0) {
      constraints.push({
        type: "value_constraint",
        roleId: role2Id,
        values: avTest.values as string[],
      });
    } else {
      report.warning(
        "constraint",
        modelName,
        `accepted_values test on column "${col.name}" has an empty values list -- no value constraint generated. Check the dbt schema YAML.`,
        col.name,
      );
    }
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function hasTest(col: DbtColumn, testType: string): boolean {
  return col.tests.some((t) => t.type === testType);
}

export function findRelationshipTest(
  col: DbtColumn,
): Extract<DbtTest, { type: "relationships"; }> | undefined {
  return col.tests.find(
    (t): t is Extract<DbtTest, { type: "relationships"; }> => t.type === "relationships",
  );
}
