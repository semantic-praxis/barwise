/**
 * dbt-to-ORM mapper.
 *
 * Maps a DbtProjectDocument into an OrmModel, inferring ORM 2 concepts
 * from dbt schema YAML structure:
 *
 *   - Models with a unique+not_null column become entity types
 *   - Non-FK columns become value types with binary fact types
 *   - Columns with relationship tests become entity-to-entity fact types
 *   - not_null tests become mandatory constraints
 *   - unique tests become internal uniqueness constraints
 *   - accepted_values tests become value constraints
 *   - Descriptions are used when present; inferred from naming when absent
 *   - Recognizable custom tests (expression_is_true) noted in report
 *
 * Mapping proceeds in phases to respect OrmModel dependency ordering:
 *   Phase 1: Identify entity types from models
 *   Phase 2: Create value types for non-FK columns
 *   Phase 3: Create fact types with roles and constraints
 *   Phase 4: Apply descriptions (explicit or inferred)
 */

import type { OrmModel } from "@barwise/core";
import type { DbtImportReport } from "./DbtImportReport.js";
import { analyzeModels } from "./dbtMapping/analyze.js";
import { createContext } from "./dbtMapping/context.js";
import { createEntityTypes } from "./dbtMapping/entityTypes.js";
import { createFactTypes } from "./dbtMapping/factTypes.js";
import { indexSourceDataTypes } from "./dbtMapping/sourceTypes.js";
import { createValueTypes } from "./dbtMapping/valueTypes.js";
import type { DbtProjectDocument } from "./DbtSchemaTypes.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Error thrown when dbt-to-ORM mapping fails.
 */
export class DbtMappingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DbtMappingError";
  }
}

/**
 * Result of mapping a DbtProjectDocument to an OrmModel.
 */
export interface DbtMapResult {
  readonly model: OrmModel;
  readonly report: DbtImportReport;
}

/**
 * Map a parsed dbt project document into an OrmModel with a gap report.
 */
export function mapDbtToOrm(doc: DbtProjectDocument): DbtMapResult {
  const ctx = createContext(doc);
  indexSourceDataTypes(ctx);
  analyzeModels(ctx);
  createEntityTypes(ctx);
  createValueTypes(ctx);
  createFactTypes(ctx);
  return { model: ctx.model, report: ctx.report.build() };
}
