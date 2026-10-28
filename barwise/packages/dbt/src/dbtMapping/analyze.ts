/**
 * Analysis phase: identify PKs, FKs, and custom tests across models.
 */

import { DBT_KEY_TEST } from "@barwise/core/mapping";
import {
  candidateKeysOf,
  combinationOf,
  compositeKeyOf,
  isReferenceUniqueness,
  keyRolesOf,
} from "./compositeKeys.js";
import { findRelationshipTest, hasTest } from "./constraints.js";
import { type DbtMapperContext, referenceName, type RelationshipInfo } from "./context.js";

export function analyzeModels(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    // Find PK column: has both unique and not_null tests.
    const pkCol = m.columns.find(
      (c) => hasTest(c, "unique") && hasTest(c, "not_null"),
    );

    // Find references: relationship columns, and foreign keys over
    // several columns, each one reference.
    const found: RelationshipInfo[] = [];
    for (const col of m.columns) {
      const relTest = findRelationshipTest(col);
      if (relTest) {
        found.push({
          columns: [col.name],
          targetModelName: relTest.to,
          targetFields: [relTest.field],
        });
      }
    }
    for (const fk of m.foreignKeys) {
      found.push({ columns: fk.columns, targetModelName: fk.to, targetFields: fk.toColumns });
    }
    // A composite key the DDL importer's reading declines (a foreign key
    // partly inside it, or one sharing a key column with another) keeps the
    // reading it had before such a foreign key was read at all: the foreign
    // key is set aside and its columns are values (PR review of barwise-ivl).
    const key = pkCol ? undefined : compositeKeyOf(m);
    const aside = key && !keyRolesOf(key, found)
      ? found.filter((r) => r.columns.length > 1 && r.columns.some((c) => key.includes(c)))
      : [];
    const rels = found.filter((r) => !aside.includes(r));
    for (const r of aside) {
      ctx.report.warning(
        "relationship",
        m.name,
        `Foreign key (${referenceName(r)}) lies partly inside the composite key (${
          key!.join(", ")
        }) or shares a key column with another reference; it is not read, and its columns are kept as values.`,
        r.columns[0],
      );
    }
    if (rels.length > 0) {
      ctx.relMap.set(m.name, rels);
    }

    // A model keyed only by a combination over exactly one foreign key's
    // columns is an entity with a key of its own and a one-to-one reference,
    // as the DDL importer reads a table whose key is one foreign key.
    const notNull = (n: string) => m.columns.some((c) => c.name === n && hasTest(c, "not_null"));
    const referenceKey = pkCol || key
      ? undefined
      : m.modelTests.map(combinationOf).find((names) =>
        names !== undefined && isReferenceUniqueness(m, names) && names.every(notNull)
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
    } else if (referenceKey) {
      ctx.referenceKeyed.add(m.name);
      ctx.report.info(
        "identifier",
        m.name,
        `Key (${
          referenceKey.join(", ")
        }) is one foreign key: imported as a one-to-one reference, the entity identified by "${m.name}_id".`,
      );
    } else if (!key) {
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
