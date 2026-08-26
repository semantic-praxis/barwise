/**
 * The review surface's prompt: its default artifact and the renderer
 * -- the exact sibling of `systemPrompt.ts` for extraction.
 *
 * It lives here rather than in `review/reviewModel.ts` so that
 * `selectArtifact` can hold the surface-to-default table without
 * importing the module that calls it. That table is the thing being
 * removed from three files, and it can only live in one place if both
 * defaults sit below it.
 */
import { builtinArtifacts } from "./artifacts/builtins.generated.js";
import type { PromptArtifact } from "./artifacts/PromptArtifact.js";
import { renderDemos } from "./artifacts/render.js";

const reviewDefault = builtinArtifacts.find(
  (a) => a.surface === "review" && a.match === undefined,
);
if (reviewDefault === undefined) {
  throw new Error(
    "builtins.generated.ts carries no default review artifact -- run `npm run regen:builtins`.",
  );
}

/**
 * The review default: the matchless artifact authored in
 * `prompts/review.default.prompt.yaml`, compiled in via
 * `regen:builtins` -- same authoring home as the extraction default
 * (docs/specs/extraction-default-parity.spec.md). Rendering it
 * reproduces the pre-artifact review prompt byte for byte (guarded by
 * the golden test), which is what makes wiring the resolver a no-op
 * until a review variant is authored.
 */
export const defaultReviewArtifact: PromptArtifact = reviewDefault;

/**
 * Build the system prompt for model review.
 *
 * @param artifact - Prompt artifact to render instead of the built-in
 *   default (a variant selected via `resolveArtifact`).
 *
 * Demos render through the same `renderDemos` the extraction surface
 * uses. `PromptDemo` is shaped for extraction -- a transcript excerpt
 * and its payload -- so no review artifact is expected to carry any,
 * and none does; rendering them anyway keeps one path for demos rather
 * than silently discarding a field an author declared.
 */
export function buildReviewSystemPrompt(artifact?: PromptArtifact): string {
  const active = artifact ?? defaultReviewArtifact;
  return active.instructions + renderDemos(active.demos);
}
