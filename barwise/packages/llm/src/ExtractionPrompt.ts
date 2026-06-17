/**
 * Extraction prompt assembly: the transcript user message and response
 * parsing. The large system prompt and JSON response schema live in
 * `./prompt/` and are re-exported here so the public surface is unchanged.
 */

import type { ExtractionResponse } from "./ExtractionTypes.js";

export { buildResponseSchema } from "./prompt/responseSchema.js";
export { buildSystemPrompt } from "./prompt/systemPrompt.js";

/**
 * Build the user message containing the transcript.
 *
 * @param transcript - The raw transcript text.
 * @param existingModelContext - Optional summary of types already in
 *   the base model.  When provided, the LLM avoids redefining them.
 */
export function buildUserMessage(
  transcript: string,
  existingModelContext?: string,
): string {
  const contextBlock = existingModelContext
    ? `\n<existing_model>\n${existingModelContext}\n</existing_model>\n\nThe types listed above already exist in the base model. Do NOT include them in your object_types output -- only output genuinely NEW types. When creating new fact types, reference existing types by their exact names as role players. Do NOT create identifier fact types for existing entity types.\n\n`
    : "";

  return `Extract an ORM conceptual model from the following business working session transcript. Number each line for source reference tracking.
${contextBlock}
<transcript>
${numberLines(transcript)}
</transcript>

Analyze this transcript and produce the structured extraction.`;
}

/**
 * Validate that a parsed JSON object conforms to the ExtractionResponse shape.
 * Returns a typed result or throws with a descriptive message.
 */
export function parseExtractionResponse(json: unknown): ExtractionResponse {
  if (typeof json !== "object" || json === null) {
    throw new Error("Extraction response must be a JSON object.");
  }

  const obj = json as Record<string, unknown>;

  const objectTypes = Array.isArray(obj["object_types"])
    ? obj["object_types"]
    : [];
  const factTypes = Array.isArray(obj["fact_types"])
    ? obj["fact_types"]
    : [];
  const subtypes = Array.isArray(obj["subtypes"])
    ? obj["subtypes"]
    : [];
  const inferredConstraints = Array.isArray(obj["inferred_constraints"])
    ? obj["inferred_constraints"]
    : [];
  const objectifiedFactTypes = Array.isArray(obj["objectified_fact_types"])
    ? obj["objectified_fact_types"]
    : [];
  const populations = Array.isArray(obj["populations"])
    ? obj["populations"]
    : [];
  const ambiguities = Array.isArray(obj["ambiguities"])
    ? obj["ambiguities"]
    : [];
  const alternatives = Array.isArray(obj["alternatives"])
    ? (obj["alternatives"] as ExtractionResponse["alternatives"])
    : undefined;

  return {
    object_types: objectTypes as ExtractionResponse["object_types"],
    fact_types: factTypes as ExtractionResponse["fact_types"],
    subtypes: subtypes as ExtractionResponse["subtypes"],
    inferred_constraints: inferredConstraints as ExtractionResponse["inferred_constraints"],
    objectified_fact_types: objectifiedFactTypes as ExtractionResponse["objectified_fact_types"],
    populations: populations as ExtractionResponse["populations"],
    ambiguities: ambiguities as ExtractionResponse["ambiguities"],
    ...(alternatives ? { alternatives } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numberLines(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}
