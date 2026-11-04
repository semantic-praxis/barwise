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

/**
 * A model-level `foreign_key` constraint over two or more columns (dbt 1.9
 * and later): one reference, which no single-column `relationships` test
 * can state (composite-foreign-key-round-trip.spec.md).
 */
export interface DbtForeignKey {
  readonly columns: readonly string[];
  /** Model name extracted from ref('model_name'). */
  readonly to: string;
  readonly toColumns: readonly string[];
}

export interface DbtModel {
  readonly name: string;
  readonly description?: string;
  readonly columns: readonly DbtColumn[];
  /** Model-level tests (e.g. expression_is_true). */
  readonly modelTests: readonly DbtTest[];
  /** Model-level foreign_key constraints over two or more columns. */
  readonly foreignKeys: readonly DbtForeignKey[];
  /**
   * The model-level `primary_key` constraint's columns, when it declares
   * one: the key, so a secondary unique column is not guessed to be it
   * (dbt-alternate-uniqueness.spec.md).
   */
  readonly primaryKey?: readonly string[];
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
