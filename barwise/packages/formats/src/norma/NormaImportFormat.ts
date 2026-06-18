/**
 * NORMA XML import format.
 *
 * Wraps the existing importNormaXml() facade as an ImportFormat for the
 * unified format registry. Accepts raw .orm XML text and produces an
 * OrmModel with high confidence (structured format, no heuristics).
 */

import type { ImportFormat, ImportOptions, ImportResult } from "@barwise/core";
import { importNormaXml, NormaImportError } from "./NormaXmlImporter.js";

/**
 * NORMA XML import format: parses .orm XML files into ORM models.
 *
 * Text-only (no directory support). The underlying two-stage pipeline
 * (NormaXmlParser -> NormaToOrmMapper) handles parsing and mapping.
 */
export class NormaImportFormat implements ImportFormat {
  readonly name = "norma";
  readonly description = "Import ORM model from NORMA .orm XML files";
  readonly inputKind = "text" as const;

  /**
   * Parse a NORMA .orm XML string into an ORM model.
   */
  parse(input: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];

    try {
      const model = importNormaXml(input);

      if (options?.modelName) {
        model.name = options.modelName;
      }

      return {
        model,
        warnings,
        confidence: "high",
      };
    } catch (err) {
      if (err instanceof NormaImportError) {
        throw err;
      }
      throw new NormaImportError(
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}
