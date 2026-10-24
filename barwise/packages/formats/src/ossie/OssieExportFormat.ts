/**
 * Apache Ossie ontology export format
 * (`docs/specs/ossie-ontology-format.spec.md`, WS2).
 *
 * Writes the model as an Ossie ontology document in YAML. Every construct
 * the document cannot carry is a line in a comment block at its top --
 * nothing in the CLI, MCP or editor reads `constraintSpecs` yet
 * (barwise-wc0), so the block is where a reader sees what was lost -- and
 * each unexpressible constraint with roles is also a `constraintSpecs`
 * entry.
 */
import type { ExportFormatAdapter, ExportOptions, ExportResult, OrmModel } from "@barwise/core";
import { stringify } from "yaml";
import { writeOssie } from "./writeOssie.js";

/** The prefix of each loss line in the written document. */
export const OSSIE_LOSS_PREFIX = "# barwise: ";

export class OssieExportFormat implements ExportFormatAdapter {
  readonly name = "ossie";
  readonly description = "Export ORM model as an Apache Ossie ontology document";

  export(model: OrmModel, _options?: ExportOptions): ExportResult {
    const { document, losses, constraintSpecs } = writeOssie(model);
    const header = losses.length > 0
      ? [
        "# barwise: what this document could not carry from the model:",
        ...losses.map((l) => `${OSSIE_LOSS_PREFIX}${l}`),
        "",
      ].join("\n")
      : "";
    const text = header + stringify(document, { lineWidth: 0 });
    return { text, ...(constraintSpecs.length > 0 ? { constraintSpecs } : {}) };
  }
}
