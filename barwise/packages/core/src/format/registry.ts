/**
 * Unified format registry.
 *
 * A single registry for all format descriptors, replacing the separate
 * import and export registries. Each descriptor bundles optional import
 * and/or export capabilities under one name.
 *
 * Tool surfaces (CLI, MCP, VS Code) register formats once at startup
 * and look them up by name. The registry provides filtered views for
 * listing importers vs. exporters.
 */

import type { ExportFormatAdapter } from "../export/types.js";
import type { ImportFormat } from "../import/types.js";
import type { FormatDescriptor } from "./types.js";

/**
 * Error thrown when a format registry operation fails.
 */
export class FormatRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatRegistryError";
  }
}

/**
 * Unified registry for format descriptors.
 */
class UnifiedFormatRegistry {
  private readonly formats = new Map<string, FormatDescriptor>();

  /**
   * Register a format descriptor.
   *
   * @param descriptor - The format descriptor to register.
   * @throws FormatRegistryError if a format with the same name is already
   *   registered, or if neither importer nor exporter is provided.
   */
  register(descriptor: FormatDescriptor): void {
    if (!descriptor.importer && !descriptor.exporter) {
      throw new FormatRegistryError(
        `Format "${descriptor.name}" must have at least one of importer or exporter.`,
      );
    }

    if (this.formats.has(descriptor.name)) {
      throw new FormatRegistryError(
        `Format "${descriptor.name}" is already registered.`,
      );
    }

    this.formats.set(descriptor.name, descriptor);
  }

  /**
   * Get a format descriptor by name.
   *
   * @param name - The format identifier (e.g., "ddl", "openapi").
   * @returns The descriptor, or undefined if not found.
   */
  get(name: string): FormatDescriptor | undefined {
    return this.formats.get(name);
  }

  /**
   * Get the importer for a format by name.
   *
   * Convenience method equivalent to `get(name)?.importer`.
   *
   * @param name - The format identifier.
   * @returns The import format, or undefined.
   */
  getImporter(name: string): ImportFormat | undefined {
    return this.formats.get(name)?.importer;
  }

  /**
   * Get the exporter for a format by name.
   *
   * Convenience method equivalent to `get(name)?.exporter`.
   *
   * @param name - The format identifier.
   * @returns The export format adapter, or undefined.
   */
  getExporter(name: string): ExportFormatAdapter | undefined {
    return this.formats.get(name)?.exporter;
  }

  /**
   * List all registered format descriptors.
   */
  list(): readonly FormatDescriptor[] {
    return Array.from(this.formats.values());
  }

  /**
   * List descriptors that have import capability.
   */
  listImporters(): readonly FormatDescriptor[] {
    return this.list().filter((d) => d.importer !== undefined);
  }

  /**
   * List descriptors that have export capability.
   */
  listExporters(): readonly FormatDescriptor[] {
    return this.list().filter((d) => d.exporter !== undefined);
  }

  /**
   * Clear all registered formats.
   *
   * Primarily for testing.
   */
  clear(): void {
    this.formats.clear();
  }
}

/**
 * Singleton registry instance.
 */
export const formatRegistry = new UnifiedFormatRegistry();

// -- Convenience functions ---------------------------------------------------

/**
 * Register a format descriptor with the global registry.
 */
export function registerFormat(descriptor: FormatDescriptor): void {
  formatRegistry.register(descriptor);
}

/**
 * Get a format descriptor by name.
 */
export function getFormat(name: string): FormatDescriptor | undefined {
  return formatRegistry.get(name);
}

/**
 * Get the importer for a format by name.
 */
export function getImporter(name: string): ImportFormat | undefined {
  return formatRegistry.getImporter(name);
}

/**
 * Get the exporter for a format by name.
 */
export function getExporter(
  name: string,
): ExportFormatAdapter | undefined {
  return formatRegistry.getExporter(name);
}

/**
 * List all registered format descriptors.
 */
export function listFormats(): readonly FormatDescriptor[] {
  return formatRegistry.list();
}

/**
 * List format descriptors that support import.
 */
export function listImporters(): readonly FormatDescriptor[] {
  return formatRegistry.listImporters();
}

/**
 * List format descriptors that support export.
 */
export function listExporters(): readonly FormatDescriptor[] {
  return formatRegistry.listExporters();
}

/** The exporters whose descriptors declare `surrogateKeys`, by name. */
export function surrogateKeyFormats(): string[] {
  return listExporters().filter((f) => f.surrogateKeys).map((f) => f.name);
}

/**
 * Why a format cannot take `surrogateKeys`, or undefined when its
 * descriptor declares it can. The CLI and MCP both refuse with this, so
 * the formats that honour the option are listed once, on their
 * descriptors (surrogate-key-export.spec.md).
 */
export function surrogateKeysRefusal(formatName: string): string | undefined {
  if (getFormat(formatName)?.surrogateKeys) return undefined;
  const taking = surrogateKeyFormats();
  return `The ${formatName} format does not take surrogate keys; ${
    taking.length > 0 ? `${taking.join(" and ")} do` : "no registered format does"
  }.`;
}

/**
 * Clear all registered formats (for testing).
 */
export function clearFormats(): void {
  formatRegistry.clear();
}
