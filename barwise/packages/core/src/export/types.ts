/**
 * Export format types for the tool surface redesign.
 *
 * This module defines the foundational types for the unified export system.
 * Each export format (DDL, dbt, Avro, OpenAPI, SVG, etc.) implements the
 * ExportFormat interface, producing an ExportResult with the artifact text,
 * optional file breakdown, annotations, constraint specifications, and lineage.
 */

import type { ExportAnnotation } from "../mapping/renderers/DbtExportAnnotator.js";
import type { OrmModel } from "../model/OrmModel.js";

/**
 * The result of an export operation.
 *
 * Always includes `text` (the primary output as a single string). For multi-file
 * formats (dbt, Avro), also includes `files[]` with individual file names and
 * contents. Tool consumers (MCP, Language Model Tools) use `text`; file-writing
 * consumers (CLI, VS Code commands) use `files` when present.
 */
export interface ExportResult {
  /**
   * Primary output as text (for tools, stdout, single-file formats).
   * For multi-file formats, this is typically a combined view or manifest.
   */
  readonly text: string;

  /**
   * Individual files (for multi-file formats like dbt, Avro).
   * Each entry has a name (relative path) and content.
   */
  readonly files?: ReadonlyArray<{ name: string; content: string; }>;

  /**
   * Annotations injected into the output (for reporting).
   * Present even when annotations are not rendered into the artifact text.
   */
  readonly annotations?: readonly ExportAnnotation[];

  /**
   * Constraints the format could not express natively.
   * Each spec provides verbalization, pseudocode, and example for implementation.
   */
  readonly constraintSpecs?: readonly ConstraintSpec[];

  /**
   * Per-artifact lineage: which ORM elements produced each output.
   * Stage B will populate this; the type exists now for interface stability.
   */
  readonly lineage?: readonly LineageEntry[];
}

/**
 * Options for export operations.
 *
 * All options are optional. Formats define their own additional options
 * via the index signature.
 */
export interface ExportOptions {
  /**
   * Include TODO/NOTE annotations in output (default: true).
   * When true, the format injects comments flagging missing descriptions,
   * default data types, value constraints available for tests, etc.
   */
  readonly annotate?: boolean;

  /**
   * Include population examples in output (default: true).
   * Renders as INSERT statements (DDL), seed files (dbt), example values
   * (OpenAPI), or doc fields (Avro).
   */
  readonly includeExamples?: boolean;

  /**
   * When true, refuse to export if the model has validation errors (default: false).
   * When false, export proceeds and validation errors are included as warnings.
   */
  readonly strict?: boolean;

  /**
   * Format-specific options.
   * Examples:
   * - ddl: { dialect: "ansi" | "postgres" | "mysql" | "snowflake" | "bigquery" | "redshift" | "databricks" }
   * - openapi: { title, apiVersion, basePath }
   * - avro: { namespace }
   * - dbt: { sourceName, generateRelationshipTests }
   */
  readonly [key: string]: unknown;
}

/**
 * An export format adapter.
 *
 * Each format (DDL, dbt, Avro, OpenAPI, SVG, etc.) implements this interface.
 * Relational formats call RelationalMapper internally; conceptual formats
 * (diagrams, documentation) work directly from the ORM model.
 *
 * Note: The name "ExportFormatAdapter" is used to avoid conflict with the
 * existing string type `ExportFormat` in OrmProject.ts.
 */
export interface ExportFormatAdapter {
  /** Format identifier (e.g., "ddl", "dbt", "avro", "openapi"). */
  readonly name: string;

  /** Human-readable description of the format. */
  readonly description: string;

  /**
   * Export the model to this format.
   *
   * @param model - The ORM model to export.
   * @param options - Format-specific and common export options.
   * @returns The export result with text, files, annotations, and lineage.
   */
  export(model: OrmModel, options?: ExportOptions): ExportResult;
}

/**
 * A constraint specification for constraints the target format cannot
 * express natively.
 *
 * Provides pseudocode plus context -- enough for a human or AI agent
 * to implement the constraint in any language.
 */
export interface ConstraintSpec {
  /** FORML verbalization -- the business rule in natural language. */
  readonly verbalization: string;

  /** Pseudocode predicate that must hold. */
  readonly pseudocode: string;

  /** Concrete example showing a valid and invalid case. */
  readonly example: string;
}

/**
 * A reference from an exported artifact back to its ORM source.
 *
 * Used in lineage tracking (Stage B).
 */
export interface SourceReference {
  readonly elementId: string;
  readonly elementType:
    | "EntityType"
    | "ValueType"
    | "FactType"
    | "Constraint"
    | "SubtypeFact"
    | "Role";
  readonly elementName: string;
}

/**
 * Lineage for a single exported artifact.
 *
 * Stage B will populate this when ExportFormat implementations produce lineage.
 */
export interface LineageEntry {
  /** Output artifact (file path relative to project root). */
  readonly artifact: string;

  /** ORM elements that contributed to this artifact. */
  readonly sources: readonly SourceReference[];
}
