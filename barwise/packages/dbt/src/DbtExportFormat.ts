/**
 * dbt export format adapter.
 *
 * Wraps the existing renderDbt() function as an ExportFormatAdapter, adding:
 * - Validation with strict mode support
 * - Annotation support (TODO/NOTE comments in schema.yml)
 * - Multi-file ExportResult with individual model files
 */

import {
  annotateDbtExport,
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  RelationalMapper,
  type RelationalSchema,
  renderDbt,
  type Table,
  ValidationEngine,
} from "@barwise/core";

/**
 * dbt (data build tool) export format.
 *
 * Produces dbt model SQL files and a schema.yml from an ORM model via
 * relational mapping. Each table becomes a dbt model file, and all
 * column metadata is captured in schema.yml.
 */
export class DbtExportFormat implements ExportFormatAdapter {
  readonly name = "dbt";
  readonly description = "dbt model files and schema.yml";

  export(model: OrmModel, options?: ExportOptions): ExportResult {
    const annotate = options?.annotate ?? true;
    const strict = options?.strict ?? false;
    const includeExamples = options?.includeExamples ?? true;

    // Run validation.
    const engine = new ValidationEngine();
    const diagnostics = engine.validate(model);
    const errors = diagnostics.filter((d) => d.severity === "error");

    // If strict mode and there are errors, throw.
    if (strict && errors.length > 0) {
      const errorMessages = errors.map((e) => e.message).join("\n");
      throw new Error(
        `Cannot export model with validation errors in strict mode:\n${errorMessages}`,
      );
    }

    // Map to relational schema.
    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    // Extract dbt-specific options.
    const sourceName = (options?.sourceName as string | undefined) ?? "raw";
    const generateRelationshipTests = (options?.generateRelationshipTests as boolean | undefined)
      ?? true;

    // Render dbt project.
    const dbtProject = renderDbt(schema, {
      sourceName,
      generateRelationshipTests,
    });

    // Optionally annotate the schema.yml with TODO/NOTE comments.
    let schemaYaml = dbtProject.schemaYaml;
    let annotations: ExportResult["annotations"];

    if (annotate) {
      const annotationResult = annotateDbtExport(schemaYaml, model, schema);
      schemaYaml = annotationResult.schemaYaml;
      annotations = annotationResult.annotations;
    }

    // Build individual files.
    const files: Array<{ name: string; content: string; }> = [];

    // Add model SQL files.
    for (const modelFile of dbtProject.models) {
      files.push({
        name: `models/${modelFile.name}.sql`,
        content: modelFile.sql,
      });
    }

    // Add schema.yml.
    files.push({
      name: "models/schema.yml",
      content: schemaYaml,
    });

    // Add seed CSV files from populations if requested.
    if (includeExamples) {
      const seedFiles = renderPopulationAsSeeds(model, schema);
      for (const seed of seedFiles) {
        files.push(seed);
      }
    }

    // Build combined text view (for tool consumers that use text only).
    const sections: string[] = [];

    // Include validation warnings if present.
    if (errors.length > 0) {
      sections.push(
        `# Validation warnings:\n${errors.map((e) => `# ERROR: ${e.message}`).join("\n")}`,
      );
    }

    // Add schema.yml as the primary text.
    sections.push(`# schema.yml\n${schemaYaml}`);

    // Add model files.
    for (const modelFile of dbtProject.models) {
      sections.push(`# models/${modelFile.name}.sql\n${modelFile.sql}`);
    }

    const text = sections.join("\n\n---\n\n");

    return {
      text,
      files,
      annotations,
    };
  }
}

/**
 * Render population data as dbt seed CSV files.
 *
 * Each table with population data gets a `seeds/<table_name>.csv` file.
 */
function renderPopulationAsSeeds(
  model: OrmModel,
  schema: RelationalSchema,
): Array<{ name: string; content: string; }> {
  const seeds: Array<{ name: string; content: string; }> = [];

  if (model.populations.length === 0) {
    return seeds;
  }

  for (const population of model.populations) {
    const factType = model.getFactType(population.factTypeId);
    if (!factType || population.instances.length === 0) {
      continue;
    }

    // Find the table(s) that represent this fact type.
    const tables = schema.tables.filter(
      (t) => t.sourceElementId === factType.id,
    );

    for (const table of tables) {
      const csv = renderTableSeedCsv(table, population.instances);
      if (csv) {
        seeds.push({
          name: `seeds/${table.name}.csv`,
          content: csv,
        });
      }
    }
  }

  return seeds;
}

/**
 * Render a table's population instances as CSV content.
 */
function renderTableSeedCsv(
  table: Table,
  instances: readonly { roleValues: Record<string, string>; }[],
): string | undefined {
  // Find columns that have role traceability.
  const mappableColumns = table.columns.filter((c) => c.sourceRoleId);
  if (mappableColumns.length === 0) {
    return undefined;
  }

  const header = mappableColumns.map((c) => c.name).join(",");
  const rows: string[] = [];

  for (const instance of instances) {
    const values = mappableColumns.map((col) => {
      const value = col.sourceRoleId
        ? instance.roleValues[col.sourceRoleId]
        : undefined;
      if (value === undefined) return "";
      // Escape CSV values: quote if contains comma, quote, or newline.
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    rows.push(values.join(","));
  }

  if (rows.length === 0) {
    return undefined;
  }

  return header + "\n" + rows.join("\n") + "\n";
}
