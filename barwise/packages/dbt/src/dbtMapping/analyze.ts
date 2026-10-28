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
    // The key column: the one a primary_key constraint declares, else the
    // first with both unique and not_null tests. Declared, a secondary
    // unique NOT NULL column is not taken for it (dbt-alternate-uniqueness.spec.md).
    const declared = m.primaryKey;
    const declaredCol = declared?.length === 1
      ? m.columns.find((c) => c.name === declared[0])
      : undefined;
    if (declared && declared.some((n) => !m.columns.some((c) => c.name === n))) {
      ctx.report.warning(
        "identifier",
        m.name,
        `The primary_key constraint names (${
          declared.join(", ")
        }), and not every one is a column of the model; the key is found from its tests instead.`,
      );
    }
    const keyDeclared = declared !== undefined
      && declared.every((n) => m.columns.some((c) => c.name === n));
    const pkCol = keyDeclared
      ? declaredCol
      : m.columns.find((c) => hasTest(c, "unique") && hasTest(c, "not_null"));

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
      : keyDeclared
      ? (isReferenceUniqueness(m, declared!) && declared!.every(notNull)
        ? [...declared!]
        : undefined)
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

    // Report model-level custom tests. A combination test is the key, a
    // foreign key's one-to-one, or a uniqueness `createUniqueness` reads,
    // and that phase names any it cannot read (dbt-alternate-uniqueness.spec.md);
    // any other custom test is reviewed here.
    for (const test of m.modelTests) {
      if (test.type === "custom" && combinationOf(test) === undefined) {
        ctx.report.warning(
          "macro",
          m.name,
          `Model-level custom test "${test.name}" -- manual review needed.`,
        );
      }
    }
  }
}
