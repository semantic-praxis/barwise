/**
 * Format registration for the standard interop descriptors.
 *
 * Bundles the DDL, OpenAPI, Avro, NORMA, and SQL importers/exporters into
 * `FormatDescriptor`s and registers them with the unified registry from
 * `@barwise/core`. These are the formats core used to ship as "builtins";
 * they now register from outside core like every other connector, so core
 * ships no interop format -- only the registry and the interfaces.
 */

import { type FormatDescriptor, formatRegistry, registerFormat } from "@barwise/core";
import { AvroExportFormat } from "./AvroExportFormat.js";
import { DdlExportFormat } from "./DdlExportFormat.js";
import { DdlImportFormat } from "./DdlImportFormat.js";
import { NormaImportFormat } from "./NormaImportFormat.js";
import { OpenApiExportFormat } from "./OpenApiExportFormat.js";
import { OpenApiImportFormat } from "./OpenApiImportFormat.js";
import { SqlImportFormat } from "./SqlImportFormat.js";

/** DDL format: bidirectional (import SQL CREATE TABLE, export DDL). */
export const ddlFormat: FormatDescriptor = {
  name: "ddl",
  description: "SQL DDL (CREATE TABLE statements)",
  importer: new DdlImportFormat(),
  exporter: new DdlExportFormat(),
};

/** OpenAPI format: bidirectional (import OpenAPI 3.x, export OpenAPI JSON). */
export const openApiFormat: FormatDescriptor = {
  name: "openapi",
  description: "OpenAPI 3.0 specification",
  importer: new OpenApiImportFormat(),
  exporter: new OpenApiExportFormat(),
};

/** Avro format: export only (Avro schema definitions .avsc). */
export const avroFormat: FormatDescriptor = {
  name: "avro",
  description: "Apache Avro schema definitions (.avsc)",
  exporter: new AvroExportFormat(),
};

/** SQL format: import only (raw SQL files -- DDL, migrations, queries). */
export const sqlFormat: FormatDescriptor = {
  name: "sql",
  description: "Raw SQL files (DDL, migrations, queries)",
  importer: new SqlImportFormat(),
};

/** NORMA format: import only (NORMA .orm XML files). */
export const normaFormat: FormatDescriptor = {
  name: "norma",
  description: "NORMA .orm XML files",
  importer: new NormaImportFormat(),
};

/**
 * Register the standard interop format descriptors with the registry.
 *
 * Call this at tool startup (CLI main, MCP server init, etc.), alongside
 * `registerDbtFormats()` and `registerCodeFormats()`. Safe to call
 * multiple times -- skips formats that are already registered.
 */
export function registerStandardFormats(): void {
  const formats: readonly FormatDescriptor[] = [
    ddlFormat,
    openApiFormat,
    avroFormat,
    sqlFormat,
    normaFormat,
  ];

  for (const descriptor of formats) {
    if (!formatRegistry.get(descriptor.name)) {
      registerFormat(descriptor);
    }
  }
}
