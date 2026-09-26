/**
 * Phase 3: create fact types with roles and constraints.
 */

import { type Constraint, generateId } from "@barwise/core";
import { buildConstraints, hasTest } from "./constraints.js";
import type { DbtMapperContext } from "./context.js";
import { toPascalCase } from "./naming.js";

export function createFactTypes(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const entityId = ctx.entityIdMap.get(m.name);
    if (!entityId) continue;

    const pk = ctx.pkMap.get(m.name);
    const rels = ctx.relMap.get(m.name) ?? [];
    const relColNames = new Set(rels.map((r) => r.columnName));

    // Create fact types for value columns.
    for (const col of m.columns) {
      if (col.name === pk?.columnName) continue;
      if (relColNames.has(col.name)) continue;

      const vtId = ctx.valueTypeIdMap.get(`${m.name}::${col.name}`);
      if (!vtId) continue;

      const entityName = toPascalCase(m.name);
      // The value type's own name, which differs from the column's when
      // valueTypes.ts had to avoid a name another object type holds.
      const vtName = ctx.model.getObjectType(vtId)?.name ?? toPascalCase(col.name);
      const factName = `${entityName} has ${vtName}`;

      // Minted, never built from names: the id policy is generateId's, and
      // the surface installs UUIDv7 behind it (importer-role-ids.spec.md).
      const role1Id = generateId();
      const role2Id = generateId();
      ctx.columnRoleIdMap.set(`${m.name}::${col.name}`, role1Id);

      // Build constraints from tests.
      const constraints = buildConstraints(col, role1Id, role2Id, ctx.report, m.name);

      ctx.model.addFactType({
        name: factName,
        roles: [
          { id: role1Id, name: "has", playerId: entityId },
          { id: role2Id, name: "is of", playerId: vtId },
        ],
        readings: [`{0} has {1}`, `{1} is of {0}`],
        constraints,
      });
    }

    // Create fact types for FK (relationship) columns. A target reached
    // by more than one relationship would give every one of them the name
    // "<Source> has <Target>", and addFactType throws on the second: a leg
    // with an origin and a destination port failed the whole import, and
    // barwise's own dbt export writes that shape from any ring or pair of
    // foreign keys to one table (barwise-bvl). Those relationships are
    // named from their columns instead.
    const relsPerTarget = new Map<string, number>();
    for (const rel of rels) {
      relsPerTarget.set(rel.targetModelName, (relsPerTarget.get(rel.targetModelName) ?? 0) + 1);
    }
    for (const rel of rels) {
      const targetEntityId = ctx.entityIdMap.get(rel.targetModelName);
      if (!targetEntityId) {
        ctx.report.gap(
          "relationship",
          m.name,
          `Relationship column "${rel.columnName}" references model "${rel.targetModelName}" which has no identifiable PK -- skipped.`,
          rel.columnName,
        );
        continue;
      }

      // Resolve the target model name to find the staging vs. mart name.
      // dbt refs might point to staging (stg_customers) but we want the
      // entity name (Customer). Try the target model name directly first.
      const sourceEntityName = toPascalCase(m.name);
      const targetEntityName = toPascalCase(rel.targetModelName);
      const qualifier = (relsPerTarget.get(rel.targetModelName) ?? 0) > 1
        ? relationshipQualifier(rel.columnName, rel.targetField)
        : "";
      const plainName = qualifier
        ? `${sourceEntityName} has ${qualifier} ${targetEntityName}`
        : `${sourceEntityName} has ${targetEntityName}`;
      const factName = freeFactTypeName(ctx, plainName, rel.columnName);
      if (factName !== plainName) {
        ctx.report.warning(
          "relationship",
          m.name,
          `Relationship "${rel.columnName}" would be named "${plainName}", which another fact type already has; named "${factName}" instead.`,
          rel.columnName,
        );
      }

      // Minted, never built from names: the id policy is generateId's, and
      // the surface installs UUIDv7 behind it (importer-role-ids.spec.md).
      const role1Id = generateId();
      const role2Id = generateId();

      // FK column: find the column to get its tests.
      const fkCol = m.columns.find((c) => c.name === rel.columnName);
      const isMandatory = fkCol ? hasTest(fkCol, "not_null") : false;

      const constraints: Constraint[] = [
        // The FK side (role2) gets uniqueness -- each target entity appears
        // at most once per source entity in this relationship.
        // This is a heuristic: many-to-one is the common case.
        { type: "internal_uniqueness", roleIds: [role2Id] },
      ];

      if (isMandatory) {
        constraints.push({ type: "mandatory", roleId: role2Id });
      }

      ctx.model.addFactType({
        name: factName,
        roles: [
          { id: role1Id, name: "has", playerId: targetEntityId },
          { id: role2Id, name: "is of", playerId: entityId },
        ],
        // A qualified relationship reads source-first ("Leg has origin
        // Port"). The unqualified one keeps its existing readings so no
        // import that worked before moves (spec R3).
        readings: qualifier
          ? [`{1} has ${qualifier} {0}`, `{0} is ${qualifier} of {1}`]
          : [`{0} has {1}`, `{1} is of {0}`],
        constraints,
      });

      ctx.report.info(
        "relationship",
        m.name,
        `Relationship "${rel.columnName}" -> "${rel.targetModelName}.${rel.targetField}" mapped as many-to-one fact type.`,
        rel.columnName,
      );
    }
  }
}

/**
 * The words a foreign-key column adds to the key it references:
 * `origin_port_code` against key `port_code` gives "origin". A column
 * that does not end in the key falls back to dropping `_id`; one that
 * adds nothing (the key's own name) gives "", and keeps the plain name.
 */
function relationshipQualifier(columnName: string, targetField: string): string {
  const base = columnName === targetField
    ? ""
    : columnName.endsWith(`_${targetField}`)
    ? columnName.slice(0, -(targetField.length + 1))
    : columnName.replace(/_id$/i, "");
  return base.split("_").filter(Boolean).join(" ");
}

/**
 * `name` if no fact type holds it, else the first free `name (column)`,
 * then numbered. `OrmModel.addFactType` throws on a duplicate name, so
 * the name is made free rather than assumed free (spec R2).
 */
function freeFactTypeName(ctx: DbtMapperContext, name: string, columnName: string): string {
  if (!ctx.model.getFactTypeByName(name)) return name;
  const withColumn = `${name} (${columnName})`;
  if (!ctx.model.getFactTypeByName(withColumn)) return withColumn;
  for (let i = 2;; i += 1) {
    const numbered = `${withColumn} ${i}`;
    if (!ctx.model.getFactTypeByName(numbered)) return numbered;
  }
}
