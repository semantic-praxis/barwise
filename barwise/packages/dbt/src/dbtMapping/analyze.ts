/**
 * Analysis phase: identify PKs, FKs, and custom tests across models.
 */

import { findRelationshipTest, hasTest } from "./constraints.js";
import { type DbtMapperContext, type RelationshipInfo } from "./context.js";

export function analyzeModels(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    // Find PK column: has both unique and not_null tests.
    const pkCol = m.columns.find(
      (c) => hasTest(c, "unique") && hasTest(c, "not_null"),
    );

    if (pkCol) {
      ctx.pkMap.set(m.name, {
        columnName: pkCol.name,
        modelName: m.name,
      });
      ctx.report.info(
        "identifier",
        m.name,
        `Primary identifier "${pkCol.name}" detected from unique + not_null tests.`,
        pkCol.name,
      );
    } else {
      ctx.report.gap(
        "identifier",
        m.name,
        `No column with both unique and not_null tests found. Cannot determine primary identifier.`,
      );
    }

    // Find relationship columns.
    const rels: RelationshipInfo[] = [];
    for (const col of m.columns) {
      const relTest = findRelationshipTest(col);
      if (relTest) {
        rels.push({
          columnName: col.name,
          targetModelName: relTest.to,
          targetField: relTest.field,
        });
      }
    }
    if (rels.length > 0) {
      ctx.relMap.set(m.name, rels);
    }

    // Report custom tests.
    for (const col of m.columns) {
      for (const test of col.tests) {
        if (test.type === "custom") {
          ctx.report.warning(
            "macro",
            m.name,
            `Custom test "${test.name}" on column "${col.name}" -- manual review needed to determine if this implies an ORM constraint.`,
            col.name,
          );
        }
      }
    }

    // Report model-level custom tests.
    for (const test of m.modelTests) {
      if (test.type === "custom") {
        ctx.report.warning(
          "macro",
          m.name,
          `Model-level custom test "${test.name}" -- manual review needed.`,
        );
      }
    }
  }
}
