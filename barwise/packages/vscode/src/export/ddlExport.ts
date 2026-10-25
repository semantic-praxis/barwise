/**
 * The editor's one DDL export: the registered `ddl` exporter with its
 * default options, what `barwise export --format ddl` writes. The diagram's
 * DDL tab and the palette's "As DDL" command both call it, so one open
 * model gives one DDL in both places (palette-ddl-export-routing.spec.md).
 * Pure module: no `vscode` import.
 */
import { type ExportResult, getExporter, type OrmModel } from "@barwise/core";
import { registerStandardFormats } from "@barwise/formats";

// Registration is idempotent across the extension's entry points.
registerStandardFormats();

/** The export, or why there is none. */
export type DdlExport =
  | { readonly ok: true; readonly result: ExportResult; }
  | { readonly ok: false; readonly reason: string; };

export function exportDdl(model: OrmModel): DdlExport {
  const exporter = getExporter("ddl");
  if (!exporter) return { ok: false, reason: "DDL exporter is not registered." };
  try {
    return { ok: true, result: exporter.export(model) };
  } catch (err) {
    return {
      ok: false,
      reason: `DDL export failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
