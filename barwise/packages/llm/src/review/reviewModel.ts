/**
 * Model review: LLM-powered semantic quality assessment of ORM models.
 *
 * Unlike validation (deterministic structural rules), review provides
 * subjective suggestions about modeling quality: missing definitions,
 * potential subtype relationships, unconstrained fact types, vague
 * descriptions, edge cases worth testing with populations.
 */

import type { OrmModel } from "@barwise/core";
import type { LlmClient } from "../LlmClient.js";
import type { PromptArtifact } from "../prompt/artifacts/PromptArtifact.js";
import { buildReviewSystemPrompt } from "../prompt/reviewPrompt.js";
import { selectArtifact } from "../prompt/selectArtifact.js";

export interface ReviewOptions {
  readonly focus?: string; // Focus on specific entity/fact type, or undefined for full review
  /**
   * Prompt artifact to render, overriding the variant that the
   * client's provider and model would otherwise resolve to. Must be a
   * "review" artifact.
   *
   * Matches `ProcessorOptions.artifact`, including how a caller pins
   * the prompt: passing `defaultReviewArtifact` renders the default
   * regardless of which model is about to run, which is what a
   * reproducible regression run wants.
   */
  readonly artifact?: PromptArtifact;
}

/**
 * The categories and severities the prompt asks for, declared once so
 * the response schema, the `ReviewSuggestion` type, and the validation
 * that rejects an out-of-enum answer cannot drift apart.
 */
const REVIEW_CATEGORIES = [
  "naming",
  "completeness",
  "normalization",
  "constraint",
  "definition",
] as const;

const REVIEW_SEVERITIES = ["info", "suggestion", "warning"] as const;

export interface ReviewSuggestion {
  readonly category: (typeof REVIEW_CATEGORIES)[number];
  readonly severity: (typeof REVIEW_SEVERITIES)[number];
  readonly element?: string; // Which model element this applies to
  readonly description: string; // Human-readable description
  readonly rationale: string; // Why this is a potential issue
}

export interface ReviewResult {
  readonly suggestions: readonly ReviewSuggestion[];
  readonly summary: string; // Brief overall assessment
}

/**
 * Build the user message containing the model to review.
 */
function buildReviewUserMessage(model: OrmModel, focus?: string): string {
  const modelSummary = serializeModelForReview(model, focus);

  if (focus) {
    return `Review the following ORM model, focusing on: ${focus}

${modelSummary}

Provide suggestions focused on the specified area.`;
  }

  return `Review the following ORM model for semantic quality:

${modelSummary}

Provide suggestions across all categories.`;
}

/**
 * Serialize the model (or focused subset) for LLM review.
 */
function serializeModelForReview(model: OrmModel, focus?: string): string {
  const lines: string[] = [];

  lines.push(`Model: ${model.name}`);
  lines.push("");

  // Filter elements if focus is provided
  const focusLower = focus?.toLowerCase();
  const objectTypes = focusLower
    ? model.objectTypes.filter(ot => ot.name.toLowerCase().includes(focusLower))
    : model.objectTypes;
  const factTypes = focusLower
    ? model.factTypes.filter(ft => ft.name.toLowerCase().includes(focusLower))
    : model.factTypes;

  // Object types
  if (objectTypes.length > 0) {
    lines.push("## Object Types");
    for (const ot of objectTypes) {
      lines.push(`- ${ot.name} (${ot.kind})`);
      if (ot.definition) {
        lines.push(`  Definition: ${ot.definition}`);
      } else {
        lines.push(`  Definition: (none)`);
      }
      if (ot.kind === "entity" && ot.referenceMode) {
        lines.push(`  Reference mode: ${ot.referenceMode}`);
      }
      if (ot.dataType) {
        lines.push(
          `  Data type: ${ot.dataType.name}${
            ot.dataType.length ? ` (length: ${ot.dataType.length})` : ""
          }`,
        );
      }
      if (ot.valueConstraint) {
        lines.push(`  Value constraint: ${ot.valueConstraint.values.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Fact types
  if (factTypes.length > 0) {
    lines.push("## Fact Types");
    for (const ft of factTypes) {
      lines.push(`- ${ft.name}`);
      const roleNames = ft.roles.map(r => {
        const playerName = model.getObjectType(r.playerId)?.name || "Unknown";
        return `${playerName} (${r.name})`;
      }).join(", ");
      lines.push(`  Roles: ${roleNames}`);
      if (ft.readings.length > 0) {
        lines.push(`  Readings: ${ft.readings.map(ro => ro.template).join(" / ")}`);
      } else {
        lines.push(`  Readings: (none)`);
      }
    }
    lines.push("");
  }

  // Constraints summary
  // Collect all constraints from fact types
  const allConstraints: Array<{ type: string; }> = [];
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      allConstraints.push({ type: c.type });
    }
  }

  if (allConstraints.length > 0) {
    lines.push("## Constraints");
    lines.push(`Total constraints: ${allConstraints.length}`);

    // Count by type
    const counts = new Map<string, number>();
    for (const c of allConstraints) {
      const count = counts.get(c.type) || 0;
      counts.set(c.type, count + 1);
    }
    for (const [type, count] of counts.entries()) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push("");
  }

  // Subtype relationships
  const subtypeFacts = model.subtypeFacts || [];
  if (subtypeFacts.length > 0) {
    lines.push("## Subtypes");
    for (const st of subtypeFacts) {
      const subName = model.getObjectType(st.subtypeId)?.name || "Unknown";
      const superName = model.getObjectType(st.supertypeId)?.name || "Unknown";
      lines.push(`- ${subName} is a ${superName}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Response schema for LLM review output.
 *
 * Exported for the same reason `buildResponseSchema` is: `barwise
 * prompt schema` prints the structured-output contract per surface, and
 * a surface whose schema only exists inside its own call site cannot be
 * printed (barwise-855).
 */
export function buildReviewResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [...REVIEW_CATEGORIES],
            },
            severity: {
              type: "string",
              enum: [...REVIEW_SEVERITIES],
            },
            element: { type: "string" },
            description: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["category", "severity", "description", "rationale"],
        },
      },
      summary: { type: "string" },
    },
    required: ["suggestions", "summary"],
  };
}

function isMember<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Narrow one element of the response's `suggestions` array.
 *
 * The array arrives as `unknown[]` and used to be cast whole, so a
 * model answering `category: "style"` -- outside the five the prompt
 * declares -- produced a value the type system swore was a
 * `ReviewSuggestion` and was not. That is load-bearing beyond
 * tidiness now that the review eval matches a planted defect on its
 * category (docs/specs/review-surface-evals.spec.md): an uninspected
 * category matches nothing and the score blames the model for a defect
 * it may well have found.
 *
 * A malformed suggestion is dropped rather than thrown, so one bad
 * entry does not discard the well-formed ones beside it.
 */
function toReviewSuggestion(value: unknown): ReviewSuggestion | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const s = value as Record<string, unknown>;
  if (!isMember(REVIEW_CATEGORIES, s.category)) return undefined;
  if (!isMember(REVIEW_SEVERITIES, s.severity)) return undefined;
  if (typeof s.description !== "string") return undefined;
  if (typeof s.rationale !== "string") return undefined;
  if (s.element !== undefined && typeof s.element !== "string") return undefined;

  return {
    category: s.category,
    severity: s.severity,
    ...(s.element !== undefined ? { element: s.element } : {}),
    description: s.description,
    rationale: s.rationale,
  };
}

/**
 * Parse the LLM response into a ReviewResult.
 */
function parseReviewResponse(responseContent: string): ReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseContent);
  } catch (e) {
    throw new Error(
      `Failed to parse LLM response as JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.suggestions)) {
    throw new Error("LLM response missing 'suggestions' array");
  }

  if (typeof obj.summary !== "string") {
    throw new Error("LLM response missing 'summary' string");
  }

  return {
    suggestions: obj.suggestions
      .map(toReviewSuggestion)
      .filter((s): s is ReviewSuggestion => s !== undefined),
    summary: obj.summary,
  };
}

/**
 * Review an ORM model for semantic quality using an LLM.
 *
 * This is distinct from validation (which checks structural rules).
 * Review provides subjective suggestions about modeling quality.
 *
 * @param model The ORM model to review
 * @param llmClient The LLM client to use for review
 * @param options Optional focus parameter to limit review scope
 * @returns A ReviewResult with suggestions and a summary
 */
export async function reviewModel(
  model: OrmModel,
  llmClient: LlmClient,
  options?: ReviewOptions,
): Promise<ReviewResult> {
  // Resolved exactly as extraction resolves it, through the one
  // function that owns the candidate set, the surface guard and the
  // per-surface default.
  const artifact = selectArtifact("review", llmClient, options?.artifact);

  const systemPrompt = buildReviewSystemPrompt(artifact);
  const userMessage = buildReviewUserMessage(model, options?.focus);
  const responseSchema = buildReviewResponseSchema();

  const response = await llmClient.complete({
    systemPrompt,
    userMessage,
    responseSchema,
  });

  return parseReviewResponse(response.content);
}
