/**
 * The one call the editor makes to a registered exporter.
 *
 * The palette's DDL, Avro and dbt commands and the diagram's DDL tab all
 * go through it, so the editor writes what the CLI and the MCP tool write
 * for the same model and options (palette-ddl-export-routing.spec.md,
 * palette-file-export-routing.spec.md). No vscode import, so it is
 * testable without the editor.
 */
import { type ExportOptions, type ExportResult, getExporter, type OrmModel } from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";

registerStandardFormats();
registerDbtFormats();

/** How a format is named to the user; the registry id where none is set. */
export function formatLabel(format: string): string {
  return ({ ddl: "DDL", avro: "Avro", dbt: "dbt" } as Record<string, string>)[format] ?? format;
}

export type RegisteredExport =
  | { readonly ok: true; readonly result: ExportResult; }
  | { readonly ok: false; readonly reason: string; };

/** The registered exporter's result, or why there is none. */
export function exportWith(
  format: string,
  model: OrmModel,
  options?: ExportOptions,
): RegisteredExport {
  const exporter = getExporter(format);
  if (!exporter) {
    return { ok: false, reason: `The ${formatLabel(format)} exporter is not registered.` };
  }
  try {
    return { ok: true, result: exporter.export(model, options) };
  } catch (err) {
    return {
      ok: false,
      reason: `${formatLabel(format)} export failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
