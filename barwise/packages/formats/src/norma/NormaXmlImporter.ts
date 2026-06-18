/**
 * Public facade for importing NORMA .orm XML files into Barwise models.
 *
 * Usage:
 * ```ts
 * import { importNormaXml } from "@barwise/core";
 *
 * const model = importNormaXml(xmlString);
 * // model is a fully populated OrmModel
 * ```
 *
 * The importer uses a two-stage pipeline:
 * 1. NormaXmlParser: XML text -> NormaDocument (intermediate representation)
 * 2. NormaToOrmMapper: NormaDocument -> OrmModel
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 */
import type { OrmModel } from "@barwise/core";
import { mapNormaToOrm, NormaMappingError } from "./NormaToOrmMapper.js";
import { NormaParseError, parseNormaXml } from "./NormaXmlParser.js";

/**
 * Error thrown when NORMA XML import fails at any stage.
 */
export class NormaImportError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "NormaImportError";
  }
}

/**
 * Import a NORMA .orm XML string and produce an OrmModel.
 *
 * @param xml - The raw XML content of a NORMA .orm file.
 * @returns A fully populated OrmModel.
 * @throws NormaImportError if parsing or mapping fails.
 */
export function importNormaXml(xml: string): OrmModel {
  let doc;
  try {
    doc = parseNormaXml(xml);
  } catch (err) {
    if (err instanceof NormaParseError) {
      throw new NormaImportError(`Parse error: ${err.message}`, err);
    }
    throw new NormaImportError(
      `Unexpected parse error: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }

  try {
    return mapNormaToOrm(doc);
  } catch (err) {
    if (err instanceof NormaMappingError) {
      throw new NormaImportError(`Mapping error: ${err.message}`, err);
    }
    throw new NormaImportError(
      `Unexpected mapping error: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
}
