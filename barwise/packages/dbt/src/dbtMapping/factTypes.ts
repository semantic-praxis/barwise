/**
 * Phase 3: create fact types with roles and constraints.
 */

import type { Constraint } from "@barwise/core";
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
      const vtName = toPascalCase(col.name);
      const factName = `${entityName} has ${vtName}`;

      const role1Id = `${factName}::role1`;
      const role2Id = `${factName}::role2`;

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

    // Create fact types for FK (relationship) columns.
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
      const factName = `${sourceEntityName} has ${targetEntityName}`;

      const role1Id = `${factName}::role1`;
      const role2Id = `${factName}::role2`;

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
        readings: [
          `{0} has {1}`,
          `{1} is of {0}`,
        ],
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
