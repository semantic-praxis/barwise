/**
 * Reasoning-trail assembly.
 *
 * A reasoning trail captures the sensemaking behind a generated model:
 * the anchors it rests on, the ambiguities the extractor flagged, the
 * rival framings it discarded, and the low-confidence assumptions it
 * still carries. The anchors are recomputed deterministically from the
 * model (core); the rest comes from the import-time `DraftModelResult`.
 */

import type { ModelDiffResult } from "@barwise/core/diff";
import { type EntityAnchors, queryModel } from "@barwise/core/query";
import type { DraftModelResult } from "./ExtractionTypes.js";

/** A rival framing that was considered and set aside. */
export interface DiscardedFraming {
  readonly rationale: string;
  /** The ambiguity (fork) this framing would have resolved. */
  readonly resolves: string;
  /** A one-line summary of its diff against the chosen model. */
  readonly diffSummary: string;
}

/** A low-confidence inference the model still rests on. */
export interface TrailAssumption {
  readonly description: string;
  readonly confidence: string;
}

/** The assembled reasoning trail for a model. */
export interface ReasoningTrail {
  readonly modelName: string;
  readonly anchors: readonly EntityAnchors[];
  readonly ambiguities: readonly string[];
  readonly discardedFramings: readonly DiscardedFraming[];
  readonly assumptions: readonly TrailAssumption[];
}

/** Assemble the reasoning trail from an import result. */
export function buildReasoningTrail(result: DraftModelResult): ReasoningTrail {
  const anchorsResult = queryModel(result.model, { kind: "anchors" });
  return {
    modelName: result.model.name,
    anchors: anchorsResult.kind === "anchors" ? anchorsResult.anchors : [],
    ambiguities: result.ambiguities.map((a) => a.description),
    discardedFramings: (result.alternatives ?? []).map((alt) => ({
      rationale: alt.rationale,
      resolves: alt.ambiguityDescription,
      diffSummary: summarizeDiff(alt.diff),
    })),
    assumptions: result.constraintProvenance
      .filter((c) => c.confidence === "low")
      .map((c) => ({ description: c.description, confidence: c.confidence })),
  };
}

/** A one-line count summary of a diff. */
function summarizeDiff(diff: ModelDiffResult): string {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const d of diff.deltas) {
    if (d.kind === "added") added += 1;
    else if (d.kind === "removed") removed += 1;
    else if (d.kind === "modified") modified += 1;
  }
  return `${added} added, ${modified} modified, ${removed} removed`;
}
