/**
 * Format registration for the dbt connector.
 *
 * Bundles the dbt importer and exporter into a single `FormatDescriptor`
 * and registers it with the unified registry from `@barwise/core`. This
 * mirrors `registerCodeFormats()` in `@barwise/code-analysis`: the
 * connector owns its filesystem and subprocess I/O and plugs into core
 * through the registry rather than core shipping the format itself.
 */

import { type FormatDescriptor, formatRegistry, registerFormat } from "@barwise/core";
import { DbtExportFormat } from "./DbtExportFormat.js";
import { DbtImportFormat } from "./DbtImportFormat.js";

/**
 * The dbt format descriptor: bidirectional (import a dbt project
 * directory, export dbt schema YAML + SQL models).
 */
export function createDbtFormat(): FormatDescriptor {
  return {
    name: "dbt",
    description: "dbt project (schema YAML + SQL models)",
    importer: new DbtImportFormat(),
    exporter: new DbtExportFormat(),
  };
}

/**
 * Register the dbt format with the unified registry.
 *
 * Call this at tool startup (CLI main, MCP server init, etc.). Safe to
 * call multiple times -- skips the format if it is already registered.
 */
export function registerDbtFormats(): void {
  const descriptor = createDbtFormat();
  if (!formatRegistry.get(descriptor.name)) {
    registerFormat(descriptor);
  }
}
