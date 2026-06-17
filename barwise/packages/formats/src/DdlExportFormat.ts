/**
 * DDL export format adapter.
 *
 * Wraps the existing renderDdl() function as an ExportFormat, adding:
 * - Validation with strict mode support
 * - Annotation support (TODO/NOTE SQL comments from ExportAnnotationCollector)
 * - ExportResult structure with annotations array
 */

import {
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  ValidationEngine,
} from "@barwise/core";
import { collectExportAnnotations, type ExportAnnotation } from "@barwise/core/annotation";
import { RelationalMapper, renderDdl, renderPopulationAsSql } from "@barwise/core/mapping";

/**
 * DDL (SQL CREATE TABLE) export format.
 *
 * Produces SQL DDL from an ORM model via relational mapping.
 */
export class DdlExportFormat implements ExportFormatAdapter {
  readonly name = "ddl";
  readonly description = "SQL DDL (CREATE TABLE statements)";

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

    // Collect annotations from the model and schema.
    const annotations = annotate
      ? collectExportAnnotations(model, schema)
      : [];

    // Render DDL.
    let ddlText = renderDdl(schema);

    // If annotate is true, add source/definition comments and
    // TODO/NOTE annotations as SQL comments.
    if (annotate) {
      ddlText = this.addConstraintAnnotations(ddlText, model, schema);
      ddlText = injectAnnotationComments(ddlText, annotations);
    }

    // Append population INSERT statements if requested.
    if (includeExamples) {
      const populationSql = renderPopulationAsSql(model, schema);
      if (populationSql) {
        ddlText += populationSql;
      }
    }

    // Include validation diagnostics as warnings in the result if present.
    const validationWarnings = errors.length > 0
      ? `-- Validation warnings:\n${errors.map((e) => `-- ERROR: ${e.message}`).join("\n")}\n\n`
      : "";

    const text = validationWarnings + ddlText;

    return {
      text,
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  }

  /**
   * Add constraint annotations as SQL comments.
   *
   * This is a placeholder implementation for Stage A. Stage B will expand
   * this to include detailed constraint specifications (verbalization,
   * pseudocode, examples) for constraints that DDL cannot express natively.
   *
   * For now, we add simple comments for each table indicating which ORM
   * element it came from.
   */
  private addConstraintAnnotations(
    ddl: string,
    model: OrmModel,
    schema: ReturnType<InstanceType<typeof RelationalMapper>["map"]>,
  ): string {
    const lines = ddl.split("\n");
    const result: string[] = [];

    for (const table of schema.tables) {
      // Find the CREATE TABLE line for this table.
      const createTablePattern = new RegExp(
        `^CREATE TABLE ("|)${table.name}("|) \\(`,
      );

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        if (createTablePattern.test(line)) {
          // Find the source element (entity or fact type) that produced this table.
          const sourceElement = model.objectTypes.find((ot) => ot.id === table.sourceElementId)
            ?? model.factTypes.find((ft) => ft.id === table.sourceElementId);

          if (sourceElement) {
            result.push(`-- Table: ${table.name}`);
            result.push(`-- Source: ${sourceElement.name} (${sourceElement.id})`);

            // If the source has a definition, include it.
            if ("definition" in sourceElement && sourceElement.definition) {
              result.push(`-- Definition: ${sourceElement.definition}`);
            }
          }
        }

        result.push(line);
      }
    }

    return result.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Annotation injection
// ---------------------------------------------------------------------------

/**
 * Format a severity tag for SQL comments.
 */
function formatSqlAnnotation(severity: "todo" | "note", message: string): string {
  const prefix = severity === "note" ? "NOTE(barwise)" : "TODO(barwise)";
  return `-- ${prefix}: ${message}`;
}

/**
 * Inject TODO/NOTE annotation comments into rendered DDL.
 *
 * - Table-level annotations are placed above the `CREATE TABLE` line.
 * - Column-level annotations are placed above the column definition line.
 */
function injectAnnotationComments(
  ddl: string,
  annotations: readonly ExportAnnotation[],
): string {
  if (annotations.length === 0) return ddl;

  // Index annotations by table and table::column.
  const tableAnnotations = new Map<string, ExportAnnotation[]>();
  const columnAnnotations = new Map<string, ExportAnnotation[]>();

  for (const a of annotations) {
    if (a.columnName) {
      const key = `${a.tableName}::${a.columnName}`;
      const existing = columnAnnotations.get(key) ?? [];
      existing.push(a);
      columnAnnotations.set(key, existing);
    } else {
      const existing = tableAnnotations.get(a.tableName) ?? [];
      existing.push(a);
      tableAnnotations.set(a.tableName, existing);
    }
  }

  const lines = ddl.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Detect CREATE TABLE lines.
    const createMatch = line.match(/^CREATE TABLE (?:"|)([a-z_][a-z0-9_]*)(?:"|) \(/);
    if (createMatch) {
      const tableName = createMatch[1]!;
      const tAnnotations = tableAnnotations.get(tableName);
      if (tAnnotations) {
        for (const a of tAnnotations) {
          result.push(formatSqlAnnotation(a.severity, a.message));
        }
      }
      result.push(line);
      continue;
    }

    // Detect column definition lines (indented with 2 spaces).
    const colMatch = line.match(/^\s{2}(?:"|)([a-z_][a-z0-9_]*)(?:"|)\s+/);
    if (colMatch) {
      const colName = colMatch[1]!;
      // Find which table we're in by looking backwards for the most
      // recent CREATE TABLE.
      const currentTable = findCurrentTable(result);
      if (currentTable) {
        const key = `${currentTable}::${colName}`;
        const cAnnotations = columnAnnotations.get(key);
        if (cAnnotations) {
          for (const a of cAnnotations) {
            result.push(`  ${formatSqlAnnotation(a.severity, a.message)}`);
          }
        }
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Scan backwards through already-emitted lines to find the current
 * table name from the most recent CREATE TABLE statement.
 */
function findCurrentTable(lines: readonly string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]!.match(/^CREATE TABLE (?:"|)([a-z_][a-z0-9_]*)(?:"|) \(/);
    if (match) return match[1];
  }
  return undefined;
}
