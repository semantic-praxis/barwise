/**
 * Gap report for dbt project import.
 *
 * Tracks what was explicitly provided in the dbt YAML, what was
 * inferred by heuristics, and what could not be determined. This
 * gives modelers a clear picture of the import quality and where
 * human review is needed.
 */

// ---------------------------------------------------------------------------
// Report entry types
// ---------------------------------------------------------------------------

export type ReportSeverity = "info" | "warning" | "gap";

/**
 * A single entry in the import report.
 */
export interface ReportEntry {
  /** Severity: info (explicit data used), warning (inference applied), gap (could not determine). */
  readonly severity: ReportSeverity;
  /** Category of the entry. */
  readonly category: ReportCategory;
  /** The dbt model name this entry relates to. */
  readonly modelName: string;
  /** The dbt column name, if applicable. */
  readonly columnName?: string;
  /** Human-readable description of what happened. */
  readonly message: string;
}

export type ReportCategory =
  | "identifier" // PK identification
  | "data_type" // Data type resolution
  | "description" // Description inference
  | "relationship" // FK / relationship inference
  | "constraint" // Constraint inference
  | "macro" // Custom macro / test
  | "model_scope"; // Model classification (staging vs. mart, computed columns)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The complete import report, returned alongside the OrmModel.
 */
export interface DbtImportReport {
  /** All report entries. */
  readonly entries: readonly ReportEntry[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Mutable builder for constructing a DbtImportReport during mapping.
 */
export class ReportBuilder {
  private readonly _entries: ReportEntry[] = [];

  info(
    category: ReportCategory,
    modelName: string,
    message: string,
    columnName?: string,
  ): void {
    this._entries.push({ severity: "info", category, modelName, message, columnName });
  }

  warning(
    category: ReportCategory,
    modelName: string,
    message: string,
    columnName?: string,
  ): void {
    this._entries.push({ severity: "warning", category, modelName, message, columnName });
  }

  gap(
    category: ReportCategory,
    modelName: string,
    message: string,
    columnName?: string,
  ): void {
    this._entries.push({ severity: "gap", category, modelName, message, columnName });
  }

  build(): DbtImportReport {
    return { entries: [...this._entries] };
  }

  /** Number of entries at a given severity. */
  countBySeverity(severity: ReportSeverity): number {
    return this._entries.filter((e) => e.severity === severity).length;
  }
}
