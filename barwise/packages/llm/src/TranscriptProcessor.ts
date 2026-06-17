/**
 * Orchestrates the full transcript-to-model pipeline.
 *
 * Pipeline:
 *   Raw Transcript -> LLM Extraction -> JSON Parsing -> Conformance Validation -> OrmModel Construction
 *
 * The processor is the main entry point for the LLM package. It coordinates
 * the prompt construction, LLM call, response parsing, and model building.
 */

import type { OrmModel } from "@barwise/core";
import { diffModels } from "@barwise/core/diff";
import { parseDraftModel } from "./DraftModelParser.js";
import { enforceConformance } from "./ExtractionConformance.js";
import {
  buildResponseSchema,
  buildSystemPrompt,
  buildUserMessage,
  parseExtractionResponse,
} from "./ExtractionPrompt.js";
import type { CandidateFraming, DraftModelResult, ExtractionResponse } from "./ExtractionTypes.js";
import type { LlmClient } from "./LlmClient.js";

export interface ProcessorOptions {
  /** Name for the resulting model. Defaults to "Extracted Model". */
  readonly modelName?: string;
  /**
   * Summary of entity/value/fact types that already exist in the base
   * model.  When provided, the LLM is instructed to reference these
   * types by name and avoid redefining them.
   */
  readonly existingModelContext?: string;
  /**
   * When true, also ask the LLM for one alternative framing at the
   * highest-impact structural fork and diff it against the primary.
   * Opt-in; default false (no change to output or cost).
   */
  readonly alternatives?: boolean;
}

/**
 * Process a transcript through the LLM extraction pipeline.
 *
 * @param transcript - The raw transcript text
 * @param client - The LLM client to use for extraction
 * @param options - Optional configuration
 * @returns A draft model with provenance metadata and warnings
 */
export async function processTranscript(
  transcript: string,
  client: LlmClient,
  options?: ProcessorOptions,
): Promise<DraftModelResult> {
  if (!transcript.trim()) {
    throw new Error("Transcript is empty.");
  }

  const includeAlternatives = options?.alternatives ?? false;
  const systemPrompt = buildSystemPrompt(includeAlternatives);
  const userMessage = buildUserMessage(transcript, options?.existingModelContext);
  const responseSchema = buildResponseSchema(includeAlternatives);

  const response = await client.complete({
    systemPrompt,
    userMessage,
    responseSchema,
  });

  let extraction: ExtractionResponse;
  try {
    const parsed = JSON.parse(response.content);
    extraction = parseExtractionResponse(parsed);
  } catch (err) {
    throw new Error(
      `Failed to parse LLM extraction response: ${(err as Error).message}`,
      { cause: err },
    );
  }

  // Apply deterministic conformance checks before model construction.
  const { response: cleaned, corrections } = enforceConformance(extraction);

  const modelName = options?.modelName ?? "Extracted Model";
  const result = parseDraftModel(cleaned, modelName);
  const conformanceWarnings = corrections.map((c) => c.description);

  const altWarnings: string[] = [];
  const alternatives = includeAlternatives
    ? buildCandidateFramings(extraction, result.model, modelName, altWarnings)
    : [];

  return {
    ...result,
    warnings: [...conformanceWarnings, ...result.warnings, ...altWarnings],
    ...(alternatives.length > 0 ? { alternatives } : {}),
    modelUsed: response.modelUsed,
    usage: response.usage,
    latencyMs: response.latencyMs,
    rawResponse: response.content,
  };
}

/**
 * Parse each alternative framing into a model and diff it against the
 * primary. Generation stayed in the LLM; the diff is deterministic core.
 * A malformed alternative is dropped with a warning -- never fatal.
 */
function buildCandidateFramings(
  extraction: ExtractionResponse,
  primaryModel: OrmModel,
  modelName: string,
  warnings: string[],
): CandidateFraming[] {
  const framings: CandidateFraming[] = [];
  for (const alt of extraction.alternatives ?? []) {
    try {
      const body: ExtractionResponse = {
        object_types: alt.object_types,
        fact_types: alt.fact_types,
        subtypes: alt.subtypes,
        inferred_constraints: alt.inferred_constraints,
        objectified_fact_types: alt.objectified_fact_types,
        populations: alt.populations,
        ambiguities: [],
      };
      const { response: cleaned } = enforceConformance(body);
      const altResult = parseDraftModel(cleaned, `${modelName} (alternative)`);
      framings.push({
        rationale: alt.rationale,
        ambiguityDescription: alt.ambiguity_description,
        model: altResult.model,
        diff: diffModels(primaryModel, altResult.model),
      });
    } catch (err) {
      warnings.push(
        `Dropped an alternative framing: ${(err as Error).message}`,
      );
    }
  }
  return framings;
}

/**
 * Parse a pre-existing extraction response JSON string into a model.
 * Useful for re-processing saved LLM responses without making a new API call.
 */
export function parseExtractionFromJson(
  json: string,
  modelName: string,
): DraftModelResult {
  const parsed = JSON.parse(json);
  const extraction = parseExtractionResponse(parsed);
  const { response: cleaned, corrections } = enforceConformance(extraction);
  const result = parseDraftModel(cleaned, modelName);
  const conformanceWarnings = corrections.map((c) => c.description);
  return {
    ...result,
    warnings: [...conformanceWarnings, ...result.warnings],
  };
}
