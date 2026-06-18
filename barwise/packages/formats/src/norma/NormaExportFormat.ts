/**
 * NORMA XML export format adapter.
 *
 * Composes the two new pure modules into the ExportFormatAdapter shape that
 * the unified format registry expects: validate -> write -> serialize. The
 * writer turns the OrmModel into a NormaDocument; the serializer turns that
 * into NORMA .orm XML. This is the inverse of NormaImportFormat
 * (parser -> mapper) and mirrors how DdlExportFormat wraps its renderer.
 *
 * Output is semantic-only: no ORMDiagram geometry. A model with no layout
 * exports to a complete .orm whose diagram surface opens empty in NORMA.
 */

import {
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  ValidationEngine,
} from "@barwise/core";
import { serializeNormaDocument } from "./NormaXmlSerializer.js";
import { writeOrmToNorma } from "./NormaXmlWriter.js";

/**
 * NORMA .orm XML export format.
 *
 * Produces NORMA-loadable XML from an ORM model for the full representable
 * conceptual subset (object types, reference schemes, fact types, readings,
 * Phase 1/2 constraints, subtypes, objectification, conceptual data types).
 */
export class NormaExportFormat implements ExportFormatAdapter {
  readonly name = "norma";
  readonly description = "NORMA .orm XML files";

  export(model: OrmModel, options?: ExportOptions): ExportResult {
    const strict = options?.strict ?? false;

    // Run validation. In strict mode, refuse to export on errors.
    const engine = new ValidationEngine();
    const diagnostics = engine.validate(model);
    const errors = diagnostics.filter((d) => d.severity === "error");

    if (strict && errors.length > 0) {
      const errorMessages = errors.map((e) => e.message).join("\n");
      throw new Error(
        `Cannot export model with validation errors in strict mode:\n${errorMessages}`,
      );
    }

    const document = writeOrmToNorma(model);
    const text = serializeNormaDocument(document);

    return { text };
  }
}
