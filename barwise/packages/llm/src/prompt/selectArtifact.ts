/**
 * The one answer to "which prompt gets sent"
 * (docs/specs/artifact-resolution-parity.spec.md, workstream 1).
 *
 * `resolveArtifact` matches a query against a candidate list its caller
 * supplies. That is deliberately only half the question: the other half
 * is which list, and which artifact to render when the list yields
 * nothing. Before this module, both halves were re-answered at every
 * call site -- `processTranscript`, `reviewModel`, and (over a wider
 * candidate set) the CLI's two `prompt` commands -- with the
 * surface-to-default mapping spread across three files and restated in
 * prose in a fourth.
 *
 * The cost was change amplification rather than duplication as such.
 * `PromptSurface` is shaped to grow, and adding a third surface meant
 * editing every copy and hoping none was missed. barwise-850 is the
 * precedent: two commands, one question, two answers, and the
 * divergence went unnoticed for months because falling back to the
 * default is indistinguishable from choosing it.
 *
 * The `select` / `resolve` split in the names is load-bearing. A caller
 * that wants the whole answer over the shipped set calls
 * `selectArtifact`; a caller that wants to ask about a wider set --
 * `barwise prompt eval --artifacts`, which measures candidates that are
 * not shipped -- keeps calling `resolveArtifact` with its own list, and
 * a reader can tell from the call site which question was asked.
 */
import { builtinArtifacts } from "./artifacts/builtins.generated.js";
import type { PromptArtifact, PromptSurface } from "./artifacts/PromptArtifact.js";
import { resolveArtifact } from "./artifacts/resolveArtifact.js";
import { defaultReviewArtifact } from "./reviewPrompt.js";
import { defaultExtractionArtifact } from "./systemPrompt.js";

/**
 * What each surface renders when no variant matches.
 *
 * The table is the reason `defaultReviewArtifact` moved out of
 * `review/reviewModel.ts`: a map that lives above both callers cannot
 * be imported by a module one of them defines.
 */
const DEFAULT_FOR: Readonly<Record<PromptSurface, PromptArtifact>> = {
  extraction: defaultExtractionArtifact,
  review: defaultReviewArtifact,
};

/**
 * How each surface names itself when rejecting an artifact meant for
 * another one. Separate strings because they are what an operator
 * reads, and "cannot drive review" would be a worse message than the
 * one this replaces.
 */
const DRIVES: Readonly<Record<PromptSurface, string>> = {
  extraction: "transcript extraction",
  review: "model review",
};

/**
 * Reject an artifact authored for a different surface, before the call.
 *
 * Exported because `promptlab`'s suite runner receives an artifact
 * already resolved by the CLI and so cannot call `selectArtifact`, but
 * needs the identical check -- it carried a byte-identical copy of this
 * message until now.
 */
export function assertArtifactSurface(
  artifact: PromptArtifact,
  surface: PromptSurface,
): void {
  if (artifact.surface !== surface) {
    throw new Error(
      `Prompt artifact surface "${artifact.surface}" cannot drive ${DRIVES[surface]}.`,
    );
  }
}

/** The identity a client declares before the call, and all this needs. */
export interface ArtifactTarget {
  readonly provider?: string;
  readonly model?: string;
}

/**
 * The artifact a call on this surface will render.
 *
 * An explicit `override` wins; otherwise the target's own provider and
 * model pick a shipped variant, and a target with no authored variant
 * falls back to the surface's default.
 *
 * The candidate set is `builtinArtifacts` and nothing else, which is
 * what makes the prompt a production run sent recoverable after the
 * fact: it is a pure function of the barwise version, the surface, the
 * provider and the model, and `barwise prompt artifact` computes that
 * function offline. A directory of unshipped candidates deliberately
 * cannot reach this path; that override lives on the `prompt` commands,
 * whose job is to measure candidates rather than to send them.
 */
export function selectArtifact(
  surface: PromptSurface,
  target: ArtifactTarget,
  override?: PromptArtifact,
): PromptArtifact {
  if (override !== undefined) {
    assertArtifactSurface(override, surface);
    return override;
  }
  return resolveArtifact(builtinArtifacts, {
    surface,
    ...(target.provider !== undefined ? { provider: target.provider } : {}),
    ...(target.model !== undefined ? { model: target.model } : {}),
  }) ?? DEFAULT_FOR[surface];
}
