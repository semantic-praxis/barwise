/**
 * Unified format descriptor types.
 *
 * A FormatDescriptor bundles an optional importer and optional exporter
 * under a single name. This replaces the separate import and export
 * registries with a single registry that exposes both directions.
 *
 * The underlying ImportFormat and ExportFormatAdapter interfaces are
 * unchanged -- the descriptor composes them rather than replacing them.
 */

import type { ExportFormatAdapter } from "../export/types.js";
import type { ImportFormat } from "../import/types.js";

/**
 * A format descriptor that bundles import and/or export capabilities
 * under a single name.
 *
 * At least one of `importer` or `exporter` must be defined. A format
 * that supports both directions (e.g., DDL, OpenAPI) provides both.
 * A format that only supports one direction (e.g., NORMA XML import,
 * Avro export) provides only the relevant field.
 */
export interface FormatDescriptor {
  /** Format identifier (e.g., "ddl", "openapi", "norma", "dbt", "avro"). */
  readonly name: string;

  /** Human-readable description of the format. */
  readonly description: string;

  /**
   * File extension (without the dot) for exported artifacts, e.g.
   * "sql" for DDL. Declared here so every surface writes the same
   * extension: three surfaces previously answered this independently
   * (`.ddl` vs `.sql` vs hardcoded per-command) because the registry
   * had nothing to consult (barwise-867).
   */
  readonly extension?: string;

  /** Import capability, if the format supports importing. */
  readonly importer?: ImportFormat;

  /** Export capability, if the format supports exporting. */
  readonly exporter?: ExportFormatAdapter;
}
