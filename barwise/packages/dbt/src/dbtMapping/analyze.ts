/**
 * Analysis phase: identify PKs, FKs, and custom tests across models.
 */

import { DBT_KEY_TEST } from "@barwise/core/mapping";
import {
  candidateKeysOf,
  combinationOf,
  compositeKeyOf,
  isReferenceUniqueness,
} from "./compositeKeys.js";
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
    } else if (!compositeKeyOf(m)) {
      const candidates = candidateKeysOf(m);
      ctx.report.gap(
        "identifier",
        m.name,
        candidates.length > 1
          ? `${candidates.length} ${DBT_KEY_TEST} tests each name a possible key (${
            candidates.map((k) => `(${k.join(", ")})`).join(", ")
          }) and none is marked preferred. Cannot determine primary identifier.`
          : `No column with both unique and not_null tests found. Cannot determine primary identifier.`,
      );
    }

    // Find references: relationship columns, and foreign keys over
    // several columns, each one reference.
    const rels: RelationshipInfo[] = [];
    for (const col of m.columns) {
      const relTest = findRelationshipTest(col);
      if (relTest) {
        rels.push({
          columns: [col.name],
          targetModelName: relTest.to,
          targetFields: [relTest.field],
        });
      }
    }
    for (const fk of m.foreignKeys) {
      rels.push({ columns: fk.columns, targetModelName: fk.to, targetFields: fk.toColumns });
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

    // Report model-level custom tests. The one combination test read as
    // the model's key is read, not reviewed (compositeKeys.ts); any other,
    // including a second combination or one beside a single-column key,
    // still is (PR #621 review). Compared as column sets: the same key
    // stated again in another order is read too (candidateKeysOf).
    const asSet = (cols: string[] | undefined) => cols && [...cols].sort().join("\0");
    // A combination over exactly one foreign key's columns is read too, as
    // that reference's one-to-one (factTypes.ts).
    const consumed = pkCol ? undefined : asSet(compositeKeyOf(m));
    for (const test of m.modelTests) {
      const names = combinationOf(test);
      if (
        test.type === "custom"
        && (consumed === undefined || asSet(names) !== consumed)
        && !(names && isReferenceUniqueness(m, names))
      ) {
        ctx.report.warning(
          "macro",
          m.name,
          `Model-level custom test "${test.name}" -- manual review needed.`,
        );
      }
    }
  }
}
