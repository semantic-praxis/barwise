/**
 * Population rendering utilities for export formats.
 *
 * Renders sample population data as SQL INSERT statements, OpenAPI examples,
 * or other format-specific representations.
 */

import type { RelationalSchema, Table } from "../mapping/RelationalSchema.js";
import { preferredIdentifiers } from "../model/identification.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { FactInstance } from "../model/Population.js";

/**
 * Render populations as SQL INSERT statements.
 *
 * Maps population fact instances to table rows using the RelationalSchema
 * traceability. Used by DDL export when includeExamples is true.
 *
 * @param model - The ORM model containing populations
 * @param schema - The relational schema with traceability information
 * @returns SQL INSERT statements as a string, or empty string if no populations
 */
export function renderPopulationAsSql(
  model: OrmModel,
  schema: RelationalSchema,
): string {
  if (model.populations.length === 0) {
    return "";
  }

  const insertStatements: string[] = [];

  // Group populations by fact type
  for (const population of model.populations) {
    const factType = model.getFactType(population.factTypeId);
    if (!factType) {
      continue; // Skip if fact type not found
    }

    // Find the table(s) that represent this fact type
    const tables = schema.tables.filter(
      (t) => t.sourceElementId === factType.id,
    );

    if (tables.length === 0) {
      continue; // Skip if no table represents this fact type
    }

    // For each instance, generate INSERT statements
    for (const instance of population.instances) {
      for (const table of tables) {
        const insertStmt = renderInstanceAsInsert(
          instance,
          table,
          factType.id,
          model,
        );
        if (insertStmt) {
          insertStatements.push(insertStmt);
        }
      }
    }
  }

  return insertStatements.length > 0
    ? "\n\n-- Sample data from populations\n" + insertStatements.join("\n")
    : "";
}

/**
 * Render a single fact instance as an INSERT statement.
 */
function renderInstanceAsInsert(
  instance: FactInstance,
  table: Table,
  _factTypeId: string,
  _model: OrmModel,
): string | undefined {
  const columns: string[] = [];
  const values: string[] = [];

  // Map role values to table columns
  for (const column of table.columns) {
    if (!column.sourceRoleId) {
      continue; // Skip columns without role traceability
    }

    const roleValue = instance.roleValues[column.sourceRoleId];
    if (roleValue !== undefined) {
      columns.push(quoteIdent(column.name));
      values.push(quoteLiteral(roleValue));
    }
  }

  if (columns.length === 0) {
    return undefined; // No mappable values
  }

  return `INSERT INTO ${quoteIdent(table.name)} (${columns.join(", ")}) VALUES (${
    values.join(", ")
  });`;
}

/**
 * Render populations as OpenAPI example values.
 *
 * Returns a map of schema name to example object. Each example object
 * contains property values derived from population instances.
 *
 * @param model - The ORM model containing populations
 * @returns Map of schema name to example object
 */
export function renderPopulationAsOpenApiExamples(
  model: OrmModel,
): ReadonlyMap<string, Record<string, unknown>> {
  const examples = new Map<string, Record<string, unknown>>();
  const identifiers = preferredIdentifiers(model);

  // For each entity type, look for populations of identifier fact types
  for (const objectType of model.objectTypes) {
    if (objectType.kind !== "entity") {
      continue;
    }

    // The binary that identifies the entity, to a value type or another
    // entity, as the example has always taken it.
    const identifying = identifiers.byEntity.get(objectType.id)?.factType;
    const idFactType = identifying?.roles.length === 2
        && identifying.roles.some((r) => r.playerId === objectType.id)
      ? identifying
      : undefined;
    if (idFactType) {
      const populations = model.populationsForFactType(idFactType.id);
      if (populations.length === 0) {
        continue;
      }

      // Use first instance as example
      const firstPopulation = populations[0];
      if (!firstPopulation || firstPopulation.instances.length === 0) {
        continue;
      }

      const firstInstance = firstPopulation.instances[0];
      if (!firstInstance) {
        continue;
      }

      // Build example object from instance values
      const example: Record<string, unknown> = {};
      for (const role of idFactType.roles) {
        const roleValue = firstInstance.roleValues[role.id];
        if (roleValue !== undefined) {
          const rolePlayer = model.getObjectType(role.playerId);
          if (rolePlayer) {
            example[role.name] = roleValue;
          }
        }
      }

      if (Object.keys(example).length > 0) {
        examples.set(objectType.name, example);
      }
    }
  }

  return examples;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Quote an identifier (table or column name) for SQL.
 */
function quoteIdent(name: string): string {
  // Simple quoting: wrap in double quotes if the name contains special chars,
  // otherwise return as-is.
  if (/^[a-z_][a-z0-9_]*$/.test(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quote a string literal for SQL.
 */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
