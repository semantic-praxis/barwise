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
import { suggestMaxTokens } from "./budget.js";
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
import type { ExtractionLogSink } from "./observe/extractionLog.js";
import { emitExtractionRecord, summariseExtraction } from "./observe/extractionLog.js";
import type { PromptArtifact } from "./prompt/artifacts/PromptArtifact.js";
import { selectArtifact } from "./prompt/selectArtifact.js";

export interface ProcessorOptions {
  /** Name for the resulting model. Defaults to "Extracted Model". */
  readonly modelName?: string;
  /**
   * Where to record what this extraction changed, and when.
   *
   * Conformance rewrites the payload before the parser sees it, and
   * until now the only trace was prose folded into `warnings` -- so no
   * caller could count corrections by category, and "did that fix
   * land" was answerable only by paying for a fresh eval run. The sink
   * is supplied rather than chosen here for the same reason the run
   * date and the build provenance are: this package does no I/O.
   *
   * Omitted, nothing is recorded and nothing is computed, which is
   * what every caller before this got
   * (docs/specs/pipeline-observability.spec.md).
   */
  readonly observer?: ExtractionLogSink;
  /**
   * Clock for the observation record. Injected so this package keeps
   * its no-clocks rule; defaults to the wall clock only when an
   * observer is present and the caller did not supply one.
   */
  readonly now?: () => string;
  /** Groups this extraction with the calls of the same operation. */
  readonly correlationId?: string;
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
  /**
   * Prompt artifact to render, overriding the variant that the
   * client's provider and model would otherwise resolve to. Must be an
   * "extraction" artifact.
   *
   * This is also how a caller pins the prompt: passing
   * `defaultExtractionArtifact` renders the default regardless of
   * which model is about to run, which is what a reproducible
   * regression run wants.
   */
  readonly artifact?: PromptArtifact;
  /**
   * Output-token ceiling for the extraction call. Omitted, one is
   * derived from the transcript's own length (`suggestMaxTokens`),
   * which is never below the client's default -- a transcript that fit
   * before still fits.
   */
  readonly maxTokens?: number;
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

  // An explicit artifact wins; otherwise the client's own identity
  // picks a variant, and a model with no authored variant falls back
  // to the default -- byte-identical to the pre-resolution output.
  // The surface guard and the fallback both live in `selectArtifact`,
  // so this call site and `reviewModel` cannot answer differently.
  const artifact = selectArtifact("extraction", client, options?.artifact);

  const includeAlternatives = options?.alternatives ?? false;
  const systemPrompt = buildSystemPrompt(includeAlternatives, artifact);
  const userMessage = buildUserMessage(transcript, options?.existingModelContext);
  const responseSchema = buildResponseSchema(includeAlternatives);

  const response = await client.complete({
    systemPrompt,
    userMessage,
    responseSchema,
    maxTokens: options?.maxTokens ?? suggestMaxTokens(transcript),
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
  // The prose stays: surfaces render these to users, and a user who
  // stopped being told their constraint was dropped would be worse off
  // than before. The record below is additive, not a replacement.
  const conformanceWarnings = corrections.map((c) => c.description);

  // What this extraction changed, for whoever is keeping the log.
  // Computed only when someone is listening.
  if (options?.observer !== undefined) {
    const clock = options.now ?? (() => new Date().toISOString());
    emitExtractionRecord(
      options.observer,
      summariseExtraction({
        startedAt: clock(),
        ...(options.correlationId !== undefined
          ? { correlationId: options.correlationId }
          : {}),
        corrections,
        parserWarnings: result.warnings,
        constraintsSkipped: result.constraintProvenance.filter((p) => !p.applied).length,
        built: {
          objectTypes: result.model.objectTypes.length,
          factTypes: result.model.factTypes.length,
          constraints: result.model.factTypes.reduce(
            (n, ft) => n + ft.constraints.length,
            0,
          ),
        },
      }),
    );
  }

  const altWarnings: string[] = [];
  const alternatives = includeAlternatives
    ? buildCandidateFramings(extraction, result.model, modelName, altWarnings)
    : [];

  // A truncated extraction still parses -- a cut-off tool_use block
  // arrives as well-formed JSON holding whatever fields completed -- so
  // without this the user gets half a model and no indication that half
  // is missing. A warning rather than an error: the partial model is
  // still the best available answer, and discarding it would cost the
  // call for nothing.
  const truncationWarnings = response.truncated === true
    ? [
      "The model's response was cut off at the output-token limit, so this"
      + " model is incomplete. Re-run with a higher maxTokens, or split the"
      + " transcript.",
    ]
    : [];

  return {
    ...result,
    warnings: [
      ...truncationWarnings,
      ...conformanceWarnings,
      ...result.warnings,
      ...altWarnings,
    ],
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
