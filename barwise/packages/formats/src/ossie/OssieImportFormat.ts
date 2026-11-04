/**
 * Apache Ossie ontology import format
 * (`docs/specs/ossie-ontology-format.spec.md`, WS1).
 *
 * Reads an Ossie ontology document (YAML or JSON) at the pinned version
 * and maps it to an ORM model. Confidence is high when nothing was
 * dropped, medium when a warning names something the model does not carry
 * or a field the pinned schema does not define. The second kind comes
 * first: it is about the document's shape, the first about the model.
 */
import type { ImportFormat, ImportOptions, ImportResult } from "@barwise/core";
import { mapOssieToOrm } from "./mapOssieToOrm.js";
import { parseOssie } from "./parseOssie.js";

export class OssieImportFormat implements ImportFormat {
  readonly name = "ossie";
  readonly description = "Import ORM model from an Apache Ossie ontology document";
  readonly inputKind = "text" as const;

  parse(input: string, options?: ImportOptions): ImportResult {
    const parsed = parseOssie(input);
    const mapped = mapOssieToOrm(parsed.document, options?.modelName);
    const warnings = [...parsed.warnings, ...mapped.warnings];
    return { model: mapped.model, warnings, confidence: warnings.length === 0 ? "high" : "medium" };
  }
}
