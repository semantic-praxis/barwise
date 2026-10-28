/**
 * dbt export format adapter.
 *
 * Wraps the existing renderDbt() function as an ExportFormatAdapter, adding:
 * - Validation with strict mode support
 * - Annotation support (TODO/NOTE comments in schema.yml)
 * - Multi-file ExportResult with individual model files
 */

import {
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  ValidationEngine,
} from "@barwise/core";
import { generateDdlLineage } from "@barwise/core/lineage";
import {
  annotateDbtExport,
  RelationalMapper,
  type RelationalSchema,
  renderDbt,
  routeUniqueOnly,
  type Table,
  withConstraintSpecs,
} from "@barwise/core/mapping";

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
    const schema = mapper.map(model, {
      preferredIdentifierStrategy: options?.preferredIdentifierStrategy,
      surrogateKeys: options?.surrogateKeys === true,
    });

    // Extract dbt-specific options.
    const sourceName = (options?.sourceName as string | undefined) ?? "raw";
    const generateRelationshipTests = (options?.generateRelationshipTests as boolean | undefined)
      ?? true;
    // Where the model files and schema.yml go. The editor writes into an
    // existing project under models/staging, where a top-level
    // models/schema.yml is the file most likely to exist already.
    const modelsDir = resolveModelsDir(options?.modelsDir);

    // The uniquenesses the DDL export writes as UNIQUE clauses, by the
    // router's own decision, are written as dbt tests; the rest are
    // reported (dbt-alternate-uniqueness.spec.md).
    const { uniques, constraintSpecs } = routeUniqueOnly(model, schema);

    // Render dbt project.
    const dbtProject = renderDbt(schema, {
      sourceName,
      generateRelationshipTests,
      uniques,
    });

    // Optionally annotate the schema.yml with TODO/NOTE comments.
    let schemaYaml = dbtProject.schemaYaml;
    let annotations: ExportResult["annotations"];

    if (annotate) {
      const annotationResult = annotateDbtExport(schemaYaml, model, schema, uniques);
      schemaYaml = annotationResult.schemaYaml;
      annotations = annotationResult.annotations;
    }

    // Build individual files.
    const files: Array<{ name: string; content: string; }> = [];

    // Add model SQL files.
    for (const modelFile of dbtProject.models) {
      files.push({
        name: `${modelsDir}/${modelFile.name}.sql`,
        content: modelFile.sql,
      });
    }

    // Add schema.yml.
    files.push({
      name: `${modelsDir}/schema.yml`,
      content: schemaYaml,
    });

    // Add seed CSV files from populations if requested. Not with generated
    // keys, which barwise computes no value for (surrogate-key-export.spec.md).
    const seedFiles = includeExamples ? renderPopulationAsSeeds(model, schema) : [];
    const seedsWithheld = seedFiles.length > 0 && options?.surrogateKeys === true;
    if (!seedsWithheld) {
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

    if (seedsWithheld) {
      sections.push(
        "# Seeds are not written with generated keys: barwise computes no hash, and a\n"
          + "# row without its key would violate its model (surrogate-key-export.spec.md).",
      );
    }

    // Add schema.yml as the primary text.
    sections.push(`# schema.yml\n${schemaYaml}`);

    // Add model files.
    for (const modelFile of dbtProject.models) {
      sections.push(`# ${modelsDir}/${modelFile.name}.sql\n${modelFile.sql}`);
    }

    const text = sections.join("\n\n---\n\n");

    return {
      text,
      // What each artifact was built from, for `lineage impact`. No format
      // set it, so every manifest recorded `sources: []` (barwise-ofb).
      lineage: generateDdlLineage(model, schema),
      files,
      annotations,
      // The constraints neither the schema nor a dbt test carries, by the
      // DDL router's own rule (schema-export-constraint-specs.spec.md).
      ...withConstraintSpecs(constraintSpecs),
    };
  }
}

/**
 * The `modelsDir` option as a relative path of plain segments. Anything
 * else is refused rather than written: an empty, absolute, or `..` path
 * would place files outside the project the caller writes into, and so
 * would a backslash or a drive letter once a Windows path join reads it.
 */
function resolveModelsDir(value: unknown): string {
  if (value === undefined) return "models";
  const segments = typeof value === "string" ? value.split("/").filter((s) => s !== "") : [];
  if (
    typeof value !== "string" || value.startsWith("/") || /[\\:]/.test(value)
    || segments.length === 0
    || segments.some((s) => s === "." || s === "..")
  ) {
    throw new Error(
      `modelsDir must be a relative path inside the project, got ${JSON.stringify(value)}`,
    );
  }
  return segments.join("/");
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
