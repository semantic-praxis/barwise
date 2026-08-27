/**
 * The ORM extraction system prompt. Instructs the LLM to identify entity
 * and value types, fact types, subtypes, populations, and to infer
 * constraints and flag ambiguities, with source references throughout.
 */

import { builtinArtifacts } from "./artifacts/builtins.generated.js";
import type { PromptArtifact } from "./artifacts/PromptArtifact.js";
import { renderDemos } from "./artifacts/render.js";

const ALTERNATIVES_SECTION = `

## Alternative framings

After the primary extraction, review the ambiguities you flagged and pick the single most consequential STRUCTURAL fork -- one of: an attribute that could be a value type or its own entity type; a relationship that could be a subtype or a role; a binary fact type that could be objectified; or a choice between candidate identifiers. For that one fork only, produce an alternative framing in the "alternatives" array: a full model (object_types, fact_types, subtypes, inferred_constraints, and any objectified_fact_types or populations) that takes the OTHER side of the fork, plus:
- rationale: one sentence naming what this framing does differently (e.g. "models Email as the preferred identifier instead of customer_id").
- ambiguity_description: the description of the ambiguity this framing resolves.

Produce AT MOST ONE alternative, and only when a genuine structural fork exists. If there is none, omit "alternatives" or leave it empty. Do NOT produce alternatives for mere cardinality or optionality questions -- those are constraint choices, not framings.`;

const extractionDefault = builtinArtifacts.find(
  (a) => a.surface === "extraction" && a.match === undefined,
);
if (extractionDefault === undefined) {
  throw new Error(
    "builtins.generated.ts carries no default extraction artifact -- run `npm run regen:builtins`.",
  );
}

/**
 * The extraction default: the matchless artifact authored in
 * `prompts/extraction.default.prompt.yaml` and compiled in via
 * `regen:builtins` like every variant, so all extraction prompts share
 * one authoring home (docs/specs/extraction-default-parity.spec.md).
 * `resolveArtifact` never returns a matchless artifact; this is
 * reachable only through the explicit fallback in `selectArtifact`.
 * Rendering it reproduces the pre-artifact `buildSystemPrompt` output
 * byte for byte (guarded by the golden test).
 */
export const defaultExtractionArtifact: PromptArtifact = extractionDefault;

/**
 * Build the system prompt for transcript extraction.
 *
 * @param includeAlternatives - When true, also ask for one alternative
 *   framing at the highest-impact structural fork.
 * @param artifact - Prompt artifact to render instead of the built-in
 *   default (a variant selected via `resolveArtifact`).
 */
export function buildSystemPrompt(
  includeAlternatives = false,
  artifact?: PromptArtifact,
): string {
  const active = artifact ?? defaultExtractionArtifact;
  const suffix = includeAlternatives ? ALTERNATIVES_SECTION : "";
  return active.instructions + renderDemos(active.demos) + suffix;
}
