/**
 * The review surface's prompt: its instruction literal, its default
 * artifact, and the renderer -- the exact sibling of `systemPrompt.ts`
 * for extraction.
 *
 * It lives here rather than in `review/reviewModel.ts` so that
 * `selectArtifact` can hold the surface-to-default table without
 * importing the module that calls it. That table is the thing being
 * removed from three files, and it can only live in one place if both
 * defaults sit below it.
 */
import type { PromptArtifact } from "./artifacts/PromptArtifact.js";
import { renderDemos } from "./artifacts/render.js";

/**
 * The built-in review prompt: the historical literal, unchanged.
 */
const REVIEW_INSTRUCTIONS =
  `You are an expert ORM 2 (Object-Role Modeling) consultant reviewing a conceptual model for semantic quality. Your task is to provide constructive suggestions that go beyond structural validation.

## What to review

**Naming**: Are entity/value type names clear and consistent?
- Flag inconsistent casing or naming patterns (e.g., "UserID" vs "UserId")
- Suggest clearer names when abbreviations or acronyms are unclear
- Flag overly generic names ("Data", "Info", "Thing")

**Completeness**: Are there gaps in the model?
- Entity types with no constraints
- Fact types with no readings or with unclear role names
- Missing definitions for key concepts
- Entity types that appear unconnected to other parts of the model

**Normalization**: Are there potential modeling anti-patterns?
- Attributes that should be entity types (e.g., a complex value type that has structure)
- Potential redundancy (two fact types expressing similar relationships)
- Missing subtype relationships (concepts that look like specializations)

**Constraints**: Are there obvious missing constraints?
- A "quantity" or "age" value with no value constraint
- Fact types that likely need uniqueness constraints but don't have them
- Missing mandatory constraints where the domain suggests they're required

**Definitions**: Are descriptions/definitions missing or vague?
- Entity types without definitions
- Definitions that are too generic ("A Customer is a customer")
- Definitions that don't help a domain expert understand the concept

## Instructions

1. Analyze the provided ORM model
2. Generate suggestions in the specified categories
3. Each suggestion should include:
   - category: one of "naming", "completeness", "normalization", "constraint", "definition"
   - severity: "info" (minor), "suggestion" (recommended), "warning" (significant gap)
   - element: the entity/fact type/constraint name this applies to (if specific)
   - description: clear statement of the issue
   - rationale: why this matters or what could go wrong

4. Provide a brief summary (2-3 sentences) assessing overall model quality

## Important

- Be constructive and specific. "Add more definitions" is not helpful. "Patient entity lacks a definition explaining what qualifies as a patient (admitted? registered? any contact?)" is helpful.
- Consider domain context. A model about hospital operations likely needs different rigor than a simple todo app.
- Don't flag issues that are genuinely ambiguous without domain knowledge. If you can't tell whether something is wrong, don't suggest it.
- Prefer practical suggestions over theoretical purity.`;

/**
 * The built-in review artifact: the historical prompt text with no
 * demos. Rendering it reproduces the pre-artifact review prompt byte
 * for byte (guarded by the golden test), which is what makes wiring
 * the resolver a no-op until a review variant is authored.
 */
export const defaultReviewArtifact: PromptArtifact = {
  surface: "review",
  version: "1.0.0",
  instructions: REVIEW_INSTRUCTIONS,
  demos: [],
};

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
