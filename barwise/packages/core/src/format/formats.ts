/**
 * Built-in format descriptors.
 *
 * Each descriptor bundles the existing import and/or export implementations
 * under a single name. Tool surfaces call registerBuiltinFormats() at
 * startup to populate the unified registry.
 */

import { AvroExportFormat } from "../export/AvroExportFormat.js";
import { DdlExportFormat } from "../export/DdlExportFormat.js";
import { OpenApiExportFormat } from "../export/OpenApiExportFormat.js";
import { DdlImportFormat } from "../import/DdlImportFormat.js";
import { NormaImportFormat } from "../import/NormaImportFormat.js";
import { OpenApiImportFormat } from "../import/OpenApiImportFormat.js";
import { SqlImportFormat } from "../import/SqlImportFormat.js";
import { formatRegistry, registerFormat } from "./registry.js";
import type { FormatDescriptor } from "./types.js";

// -- Descriptor instances ----------------------------------------------------

/**
 * DDL format: bidirectional (import SQL CREATE TABLE, export DDL).
 */
export const ddlFormat: FormatDescriptor = {
  name: "ddl",
  description: "SQL DDL (CREATE TABLE statements)",
  importer: new DdlImportFormat(),
  exporter: new DdlExportFormat(),
};

/**
 * OpenAPI format: bidirectional (import OpenAPI 3.x, export OpenAPI JSON).
 */
export const openApiFormat: FormatDescriptor = {
  name: "openapi",
  description: "OpenAPI 3.0 specification",
  importer: new OpenApiImportFormat(),
  exporter: new OpenApiExportFormat(),
};

/**
 * SQL format: import only (raw SQL files -- DDL, migrations, queries).
 */
export const sqlFormat: FormatDescriptor = {
  name: "sql",
  description: "Raw SQL files (DDL, migrations, queries)",
  importer: new SqlImportFormat(),
};

/**
 * NORMA format: import only (NORMA .orm XML files).
 */
export const normaFormat: FormatDescriptor = {
  name: "norma",
  description: "NORMA .orm XML files",
  importer: new NormaImportFormat(),
};

/**
 * Avro format: export only (Avro schema definitions .avsc).
 */
export const avroFormat: FormatDescriptor = {
  name: "avro",
  description: "Apache Avro schema definitions (.avsc)",
  exporter: new AvroExportFormat(),
};

// -- Registration helper -----------------------------------------------------

/**
 * Register all built-in format descriptors with the unified registry.
 *
 * Call this once at tool startup (CLI main, MCP server init, etc.).
 * Safe to call multiple times -- skips formats that are already registered.
 */
export function registerBuiltinFormats(): void {
  const builtins: readonly FormatDescriptor[] = [
    ddlFormat,
    openApiFormat,
    sqlFormat,
    normaFormat,
    avroFormat,
  ];

  for (const descriptor of builtins) {
    if (!formatRegistry.get(descriptor.name)) {
      registerFormat(descriptor);
    }
  }
}
