/**
 * Intermediate types for dbt schema YAML parsing.
 *
 * These types represent the parsed-but-not-yet-mapped content of dbt
 * schema YAML files. They are produced by DbtSchemaParser and consumed
 * by DbtToOrmMapper.
 */

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * A standard dbt test on a column.
 */
export type DbtStandardTest =
  | { readonly type: "not_null"; }
  | { readonly type: "unique"; }
  | {
    readonly type: "accepted_values";
    readonly values: readonly string[];
  }
  | {
    readonly type: "relationships";
    readonly to: string; // model name extracted from ref('model_name')
    readonly field: string; // referenced column name
  };

/**
 * A custom or macro-based test (e.g. expression_is_true, dbt_utils tests).
 */
export interface DbtCustomTest {
  readonly type: "custom";
  readonly name: string; // e.g. "dbt_utils.expression_is_true"
  readonly config: Record<string, unknown>;
}

/**
 * Any test on a column or model.
 */
export type DbtTest = DbtStandardTest | DbtCustomTest;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface DbtColumn {
  readonly name: string;
  readonly description?: string;
  readonly dataType?: string;
  readonly tests: readonly DbtTest[];
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface DbtModel {
  readonly name: string;
  readonly description?: string;
  readonly columns: readonly DbtColumn[];
  /** Model-level tests (e.g. expression_is_true). */
  readonly modelTests: readonly DbtTest[];
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface DbtSourceTable {
  readonly name: string;
  readonly description?: string;
  readonly columns: readonly DbtColumn[];
}

export interface DbtSource {
  readonly name: string;
  readonly description?: string;
  readonly tables: readonly DbtSourceTable[];
}

// ---------------------------------------------------------------------------
// Project document
// ---------------------------------------------------------------------------

/**
 * The parsed content of one or more dbt schema YAML files.
 * Aggregates all models and sources found across the files.
 */
export interface DbtProjectDocument {
  readonly models: readonly DbtModel[];
  readonly sources: readonly DbtSource[];
}
