/**
 * dbt project importer.
 *
 * Public facade for importing dbt schema YAML files into an OrmModel.
 * Wraps the parser and mapper, providing a single entry point.
 *
 * @example
 * ```ts
 * import { importDbtProject } from "@barwise/dbt";
 *
 * const result = importDbtProject([
 *   fs.readFileSync("models/marts/customers.yml", "utf-8"),
 *   fs.readFileSync("models/marts/orders.yml", "utf-8"),
 *   fs.readFileSync("models/staging/_sources.yml", "utf-8"),
 * ]);
 *
 * console.log(result.model.objectTypes);     // inferred entity & value types
 * console.log(result.report.entries);         // what was inferred vs. explicit
 * ```
 */

import { OrmModel } from "@barwise/core";
import type { DbtImportReport } from "./DbtImportReport.js";
import { DbtParseError, parseDbtSchema } from "./DbtSchemaParser.js";
import { DbtMappingError, mapDbtToOrm } from "./DbtToOrmMapper.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of importing a dbt project.
 */
export interface DbtImportResult {
  /** The inferred ORM 2 model. */
  readonly model: OrmModel;
  /** Gap report: what was explicit, inferred, or unknown. */
  readonly report: DbtImportReport;
}

/**
 * Error thrown when dbt project import fails.
 */
export class DbtImportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DbtImportError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import one or more dbt schema YAML files into an OrmModel.
 *
 * Pass the raw string contents of each `.yml` file. The importer
 * aggregates models and sources across all files, then maps them
 * to ORM 2 concepts with a structured gap report.
 *
 * @param yamlContents - Array of YAML file contents.
 * @returns The inferred OrmModel and a gap report.
 * @throws DbtImportError if parsing or mapping fails.
 */
export function importDbtProject(
  yamlContents: readonly string[],
): DbtImportResult {
  try {
    const doc = parseDbtSchema(yamlContents);
    const { model, report } = mapDbtToOrm(doc);
    return { model, report };
  } catch (err) {
    if (err instanceof DbtParseError || err instanceof DbtMappingError) {
      throw new DbtImportError(`dbt import failed: ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  }
}
