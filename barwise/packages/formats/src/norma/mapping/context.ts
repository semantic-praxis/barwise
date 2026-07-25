/**
 * Shared state for the NORMA-to-ORM mapping phases.
 *
 * The mapper threads one explicit context through its phases (the same
 * shape as the dbt mapper's `DbtMapperContext`): the parsed document,
 * the model under construction, and the NORMA-id-to-Barwise-id lookup
 * maps the later phases resolve references through.
 */
import type { OrmModel } from "@barwise/core";
import type { NormaConstraint, NormaDataType, NormaDocument } from "../NormaXmlTypes.js";

/**
 * Error thrown when the mapper cannot resolve references or encounters
 * structural inconsistencies in the intermediate representation.
 */
export class NormaMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormaMappingError";
  }
}

/** Mutable state shared by the mapping phases. */
export interface NormaMappingContext {
  readonly doc: NormaDocument;
  readonly model: OrmModel;
  /** NORMA object-type id -> Barwise object-type id. */
  readonly objectTypeIdMap: Map<string, string>;
  /** NORMA role id -> Barwise role id. */
  readonly roleIdMap: Map<string, string>;
  /** NORMA fact id -> Barwise fact-type id. */
  readonly factTypeIdMap: Map<string, string>;
  /** NORMA data-type id -> parsed data-type definition. */
  readonly dataTypeById: Map<string, NormaDataType>;
  /** NORMA constraint id -> parsed constraint. */
  readonly constraintById: Map<string, NormaConstraint>;
}

/**
 * Collect all constraint IDs that are referenced from some fact type's
 * InternalConstraints section (and were therefore already applied while
 * mapping that fact type).
 */
export function collectProcessedRefs(doc: NormaDocument): Set<string> {
  const refs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      refs.add(ref);
    }
  }
  return refs;
}
