/**
 * DDL export format adapter.
 *
 * Wraps the existing renderDdl() function as an ExportFormat, adding:
 * - Validation with strict mode support
 * - Annotation support (TODO/NOTE SQL comments from ExportAnnotationCollector)
 * - Dialect-targeted constraint routing (sql-dialect-capability spec,
 *   WS2): a per-dialect capability profile routes each constraint to a
 *   native clause, an informational clause (e.g. `NOT ENFORCED`), or
 *   the ConstraintSpec spillway plus a SQL comment -- degradation is
 *   visible output, never silent dropping. Core's renderer stays
 *   dialect-free; the judgment lives here.
 * - ExportResult structure with annotations and constraintSpecs arrays
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
import {
  type ConstraintRouting,
  routeConstraints,
  type RoutedClause,
  type SpilledConstraint,
} from "./constraintRouting.js";
import { type DialectCapabilityProfile, resolveDialectProfile } from "./dialectCapabilities.js";

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
    const dialect = (options?.["dialect"] as string | undefined) ?? "ansi";
    const profile = resolveDialectProfile(dialect);

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

    // Render DDL (dialect-free), then route constraints through the
    // dialect capability profile: extra UNIQUE/CHECK clauses,
    // informational markers, and spillway comments.
    let ddlText = renderDdl(schema);
    const routing = routeConstraints(model, schema, profile, dialect);
    ddlText = applyConstraintRouting(ddlText, routing, profile, dialect);

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
      constraintSpecs: routing.spilled.length > 0
        ? routing.spilled.map((s) => s.spec)
        : undefined,
    };
  }

  /**
   * Add table source/definition annotations as SQL comments for each
   * table indicating which ORM element it came from. (Constraint
   * specifications for inexpressible constraints are handled by the
   * constraint routing pass.)
   */
  private addConstraintAnnotations(
    ddl: string,
    model: OrmModel,
    schema: ReturnType<InstanceType<typeof RelationalMapper>["map"]>,
  ): string {
    const lines = ddl.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const match = /^CREATE TABLE "?(.+?)"? \($/.exec(line);
      const table = match
        ? schema.tables.find((t) => t.name === match[1])
        : undefined;

      if (table) {
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

    return result.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Dialect constraint routing (text pass)
// ---------------------------------------------------------------------------

/**
 * Apply a constraint routing to rendered DDL:
 *
 * - inject routed UNIQUE/CHECK clauses into their CREATE TABLE bodies
 * - mark PRIMARY KEY / FOREIGN KEY clauses the dialect treats as
 *   informational (suffix such as ` NOT ENFORCED`, or a trailing
 *   comment when the dialect has no marker syntax)
 * - emit a comment above each table for every constraint that spilled
 *   to the ConstraintSpec channel, so the degradation is visible in
 *   the artifact itself
 */
function applyConstraintRouting(
  ddl: string,
  routing: ConstraintRouting,
  profile: DialectCapabilityProfile,
  dialectName: string,
): string {
  if (
    routing.clauses.length === 0
    && routing.spilled.length === 0
    && profile.primaryKey !== "informational"
    && profile.foreignKey !== "informational"
  ) {
    return ddl;
  }

  const informationalComment = `informational: not enforced by ${dialectName}`;

  const clausesByTable = new Map<string, RoutedClause[]>();
  for (const clause of routing.clauses) {
    const list = clausesByTable.get(clause.tableName) ?? [];
    list.push(clause);
    clausesByTable.set(clause.tableName, list);
  }

  const spillsByTable = new Map<string, SpilledConstraint[]>();
  const unplacedSpills: SpilledConstraint[] = [];
  for (const spill of routing.spilled) {
    if (spill.tableName) {
      const list = spillsByTable.get(spill.tableName) ?? [];
      list.push(spill);
      spillsByTable.set(spill.tableName, list);
    } else {
      unplacedSpills.push(spill);
    }
  }

  const lines = ddl.split("\n");
  const out: string[] = [];
  let currentTable: string | undefined;

  for (const line of lines) {
    const create = /^CREATE TABLE "?(.+?)"? \($/.exec(line);
    if (create) {
      currentTable = create[1]!;
      for (const spill of spillsByTable.get(currentTable) ?? []) {
        out.push(`-- Constraint (${spill.reason}): ${spill.spec.verbalization}`);
      }
      out.push(line);
      continue;
    }

    if (currentTable) {
      if (profile.primaryKey === "informational" && /^\s{2}PRIMARY KEY \(/.test(line)) {
        out.push(markInformational(line, profile.informationalSuffix, informationalComment));
        continue;
      }
      if (profile.foreignKey === "informational" && /^\s{2}FOREIGN KEY \(/.test(line)) {
        out.push(markInformational(line, profile.informationalSuffix, informationalComment));
        continue;
      }
      if (line === ");") {
        const additions = clausesByTable.get(currentTable) ?? [];
        if (additions.length > 0 && out.length > 0) {
          out[out.length - 1] = appendComma(out[out.length - 1]!);
          additions.forEach((clause, i) => {
            let text = `  ${clause.sql}`;
            if (clause.channel === "informational") text += profile.informationalSuffix;
            if (i < additions.length - 1) text += ",";
            if (clause.channel === "informational" && profile.informationalSuffix === "") {
              text += ` -- ${informationalComment}`;
            }
            out.push(text);
          });
        }
        out.push(line);
        currentTable = undefined;
        continue;
      }
    }

    out.push(line);
  }

  for (const spill of unplacedSpills) {
    out.push(`-- Constraint (${spill.reason}): ${spill.spec.verbalization}`);
  }

  return out.join("\n");
}

/**
 * Mark an existing PK/FK clause line as informational: append the
 * dialect's suffix before any trailing comma, or a trailing comment
 * when the dialect has no marker syntax.
 */
function markInformational(line: string, suffix: string, comment: string): string {
  const trimmed = line.trimEnd();
  const hasComma = trimmed.endsWith(",");
  const base = hasComma ? trimmed.slice(0, -1) : trimmed;
  const marked = `${base}${suffix}${hasComma ? "," : ""}`;
  return suffix === "" ? `${marked} -- ${comment}` : marked;
}

/** Append a comma to a clause line, keeping any trailing comment last. */
function appendComma(line: string): string {
  const commentIdx = line.indexOf(" --");
  if (commentIdx === -1) return `${line},`;
  return `${line.slice(0, commentIdx)},${line.slice(commentIdx)}`;
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
