/**
 * Converts an LLM extraction response into an OrmModel.
 *
 * This is a best-effort parser: it constructs as much of the model
 * as possible, collecting warnings for elements that cannot be created
 * (e.g., a fact type referencing an object type the LLM didn't extract).
 */

import { OrmModel } from "@barwise/core";
import type {
  ConstraintProvenance,
  DraftModelResult,
  ElementProvenance,
  ExtractionResponse,
  ObjectificationProvenance,
  SubtypeProvenance,
} from "./ExtractionTypes.js";
import { parseConstraints } from "./parse/constraints.js";
import { parseFactTypes } from "./parse/factTypes.js";
import { parseObjectifications } from "./parse/objectifications.js";
import { parseObjectTypes } from "./parse/objectTypes.js";
import { parsePopulations } from "./parse/populations.js";
import { parseSubtypes } from "./parse/subtypes.js";

/**
 * Parse an extraction response into an ORM model with provenance metadata.
 *
 * @param response - The structured extraction from the LLM
 * @param modelName - Name for the resulting model
 */
export function parseDraftModel(
  response: ExtractionResponse,
  modelName: string,
): DraftModelResult {
  const model = new OrmModel({ name: modelName });
  const warnings: string[] = [];

  // Pass 1: Create object types.
  const objectTypeProvenance: ElementProvenance[] = parseObjectTypes(
    response.object_types,
    model,
    warnings,
  );

  // Pass 2: Create fact types.
  const factTypeProvenance: ElementProvenance[] = parseFactTypes(
    response.fact_types,
    model,
    warnings,
  );

  // Pass 3: Apply inferred constraints (resolves roles against fact types
  // built in pass 2 -- order matters).
  const constraintProvenance: ConstraintProvenance[] = parseConstraints(
    response.inferred_constraints,
    model,
    warnings,
  );

  // Pass 4: Create subtype facts.
  const subtypeProvenance: SubtypeProvenance[] = parseSubtypes(
    response.subtypes ?? [],
    model,
    warnings,
  );

  // Pass 5: Create populations.
  parsePopulations(response.populations ?? [], model, warnings);

  // Pass 6: Create objectified fact types.
  const objectificationProvenance: ObjectificationProvenance[] = parseObjectifications(
    response.objectified_fact_types ?? [],
    model,
    warnings,
  );

  return {
    model,
    objectTypeProvenance,
    factTypeProvenance,
    subtypeProvenance,
    constraintProvenance,
    objectificationProvenance,
    ambiguities: response.ambiguities ?? [],
    warnings,
  };
}
