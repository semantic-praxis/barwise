/**
 * Apache Ossie ontology export format
 * (`docs/specs/ossie-ontology-format.spec.md`, WS2).
 *
 * Writes the model as an Ossie ontology document in YAML. Every construct
 * the document cannot carry is a line in a comment block at its top, and
 * each unexpressible constraint with roles is also a `constraintSpecs`
 * entry, which the export surfaces report beside the artifact.
 *
 * The writer's lines are predictions; the written text is then read back
 * through the Ossie importer, the path a user's import takes, and every
 * element that comes back different with no line naming it gets one
 * (`docs/specs/ossie-export-verified-by-reimport.spec.md`).
 */
import type { ExportFormatAdapter, ExportOptions, ExportResult, OrmModel } from "@barwise/core";
import { withConstraintSpecs } from "@barwise/core/mapping";
import { stringify } from "yaml";
import { OssieImportFormat } from "./OssieImportFormat.js";
import { verifyOssie } from "./verifyOssie.js";
import { writeOssie } from "./writeOssie.js";

/** The prefix of each loss line in the written document. */
export const OSSIE_LOSS_PREFIX = "# barwise: ";

export class OssieExportFormat implements ExportFormatAdapter {
  readonly name = "ossie";
  readonly description = "Export ORM model as an Apache Ossie ontology document";

  export(model: OrmModel, _options?: ExportOptions): ExportResult {
    const written = writeOssie(model);
    const body = stringify(written.document, { lineWidth: 0 });
    const verified = readBack(model, body, written);
    const losses = [...written.losses, ...verified.losses];
    const constraintSpecs = [...written.constraintSpecs, ...verified.constraintSpecs];
    const header = losses.length > 0
      ? [
        "# barwise: what this document could not carry from the model:",
        ...losses.map((l) => `${OSSIE_LOSS_PREFIX}${l}`),
        "",
      ].join("\n")
      : "";
    const text = header + body;
    return { text, ...withConstraintSpecs(constraintSpecs) };
  }
}

/**
 * The verified losses of the written text. A document the importer refuses
 * is still returned, with a line saying so: the export never fails where it
 * succeeded before (the spec's Open decision 3).
 */
function readBack(
  model: OrmModel,
  body: string,
  written: ReturnType<typeof writeOssie>,
): ReturnType<typeof verifyOssie> {
  let back: OrmModel;
  try {
    back = new OssieImportFormat().parse(body).model;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { losses: [`model: the document does not read back: ${message}`], constraintSpecs: [] };
  }
  return verifyOssie(model, back, written.written, written.reported);
}
