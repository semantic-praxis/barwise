/**
 * Phase 4: the uniquenesses beside a model's key, read as the DDL importer
 * reads the same UNIQUE clause (dbt-alternate-uniqueness.spec.md).
 *
 * A single `unique` column is read where its fact type is built: a value's
 * uniqueness (`buildConstraints`) or a reference's one-to-one
 * (`factTypes.ts`). What is left needs every column's fact type first, so
 * it is read here, after them:
 *
 * - on a composite-key model, a `unique` or combination test whose columns
 *   are all its fact type's roles: a uniqueness over those roles when it
 *   falls on whole roles (DDL step 1b);
 * - any other combination test: an external uniqueness over the role each
 *   column stands for (`farRoleIdMap`), as DDL step 3b reads `farRoleId`.
 *
 * The two importers keep their own code; `cli/tests/uniquenessParity.test.ts`
 * fails when they disagree.
 */

import {
  combinationOf,
  compositeKeyOf,
  compositeRoleColumns,
  holdsForEveryRow,
  isReferenceUniqueness,
  sameColumns,
} from "./compositeKeys.js";
import { hasTest } from "./constraints.js";
import { type DbtMapperContext, readsAsReference, type RelationshipInfo } from "./context.js";

export function createUniqueness(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const info = ctx.compositeMap.get(m.name);
    if (!ctx.entityIdMap.has(m.name) && !info) {
      // A model imported as nothing: its key gap says why, and each
      // combination test is still named for review, as before.
      for (const test of m.modelTests) {
        if (test.type === "custom" && combinationOf(test) !== undefined) {
          ctx.report.warning(
            "macro",
            m.name,
            `Model-level custom test "${test.name}" -- manual review needed.`,
          );
        }
      }
      continue;
    }
    const roleCols = compositeRoleColumns(ctx, m.name);
    const key = ctx.pkMap.has(m.name) ? undefined : compositeKeyOf(m);
    const references = (ctx.relMap.get(m.name) ?? []).filter((r) => readsAsReference(ctx, r));

    // What is read here: every combination test but the key and a foreign
    // key's one-to-one (read with the reference), and a `unique` column of
    // the relationship, which its own fact type does not read.
    const sets: { columns: string[]; test: string; }[] = [];
    for (const test of m.modelTests) {
      const names = combinationOf(test);
      if (!names) continue;
      const testName = test.type === "custom" ? test.name : "";
      if (names.length === 0) {
        review(ctx, m.name, testName, names, "names no column");
        continue;
      }
      if (key && sameColumns(names, key)) continue;
      if (!holdsForEveryRow(test)) {
        review(
          ctx,
          m.name,
          testName,
          names,
          "is filtered to some rows, so it is no uniqueness of the model",
        );
        continue;
      }
      // Read with the reference (factTypes.ts), unless the foreign key is a
      // role of the composite fact type, which no reference fact type reads.
      if (isReferenceUniqueness(m, names) && !names.every((c) => roleCols.has(c))) continue;
      sets.push({ columns: names, test: testName });
    }
    for (const col of m.columns) {
      if (!hasTest(col, "unique")) continue;
      // A column of a multi-column reference: no role stands for it alone.
      const inMulti = references.some((r) => r.columns.length > 1 && r.columns.includes(col.name));
      if (roleCols.has(col.name) || inMulti) sets.push({ columns: [col.name], test: "unique" });
    }

    for (const { columns, test } of sets) {
      const reason = info && columns.every((c) => roleCols.has(c))
        ? overRoles(ctx, m.name, columns)
        : external(ctx, m.name, columns, references);
      if (reason) review(ctx, m.name, test, columns, reason);
    }
  }
}

/** Name a uniqueness this phase cannot read, for review. */
function review(
  ctx: DbtMapperContext,
  modelName: string,
  test: string,
  columns: readonly string[],
  reason: string,
): void {
  const what = test === "unique"
    ? `Unique test on column "${columns[0]}"`
    : `Model-level custom test "${test}"`;
  ctx.report.warning(
    "constraint",
    modelName,
    `${what} (${columns.join(", ")}) ${reason} -- manual review needed.`,
    columns.length === 1 ? columns[0] : undefined,
  );
}

/** A uniqueness over whole roles of the model's composite fact type; why not, else. */
function overRoles(
  ctx: DbtMapperContext,
  modelName: string,
  columns: readonly string[],
): string | undefined {
  const info = ctx.compositeMap.get(modelName)!;
  const roles = info.roles.filter((r) => r.some((c) => columns.includes(c)));
  if (roles.flat().length !== columns.length) {
    return "covers only part of a role of the model's fact type";
  }
  const roleIds = roles.map((r) => ctx.columnRoleIdMap.get(`${modelName}::${r[0]}`)!);
  const factType = ctx.model.factTypes.find((f) => f.roles.some((r) => r.id === roleIds[0]));
  if (!factType) return "names a role of a fact type that was not built";
  const same = factType.internalConstraints.some((c) =>
    c.type === "internal_uniqueness" && sameColumns(c.roleIds, roleIds)
  );
  if (!same) factType.addConstraint({ type: "internal_uniqueness", roleIds });
  return undefined;
}

/** An external uniqueness over the role each column stands for; why not, else. */
function external(
  ctx: DbtMapperContext,
  modelName: string,
  columns: readonly string[],
  references: readonly RelationshipInfo[],
): string | undefined {
  // Asked first, as DDL step 3b asks it first.
  const named = columns.find((c) => ctx.sharedReferenceColumns.has(`${modelName}::${c}`));
  if (named) return `names "${named}", a column of two foreign keys`;
  const partial = references.find((r) =>
    r.columns.length > 1 && r.columns.some((c) => columns.includes(c))
    && !r.columns.every((c) => columns.includes(c))
  );
  if (partial) return `covers only part of the foreign key (${partial.columns.join(", ")})`;
  const roleIds = columns.map((c) => ctx.farRoleIdMap.get(`${modelName}::${c}`));
  if (roleIds.some((r) => r === undefined)) {
    return "spans a column that imported as no fact type of the model's entity";
  }
  const distinct = [...new Set(roleIds as string[])];
  if (distinct.length > 1) {
    ctx.model.addConstraint({ type: "external_uniqueness", roleIds: distinct });
    return undefined;
  }
  // One role (a combination over one column): that role's own uniqueness,
  // as `unique` on the column reads, not an external one over one role.
  const factType = ctx.model.factTypes.find((f) => f.roles.some((r) => r.id === distinct[0]));
  const held = factType?.internalConstraints.some((c) =>
    c.type === "internal_uniqueness" && c.roleIds.length === 1 && c.roleIds[0] === distinct[0]
  );
  if (factType && !held) factType.addConstraint({ type: "internal_uniqueness", roleIds: distinct });
  return undefined;
}
