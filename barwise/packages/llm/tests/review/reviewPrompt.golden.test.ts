/**
 * Golden test for the review artifact seam: the default artifact must
 * render byte-identically to the literal `reviewModel` sent before the
 * resolver was wired in. The golden file was captured from the build
 * preceding the wiring, so regenerating it requires a deliberate
 * prompt change (docs/specs/review-surface-evals.spec.md, workstream 1).
 */
import { OrmModel } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../../src/LlmClient.js";
import { builtinArtifacts } from "../../src/prompt/artifacts/builtins.generated.js";
import type { PromptArtifact } from "../../src/prompt/artifacts/PromptArtifact.js";
import { buildReviewSystemPrompt, defaultReviewArtifact } from "../../src/prompt/reviewPrompt.js";
import { reviewModel } from "../../src/review/reviewModel.js";

const goldenPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/prompts/review-default.golden.txt",
);

const golden = readFileSync(goldenPath, "utf8");

function capturingClient(
  identity: { provider: string; model: string | undefined; } = {
    provider: "test",
    model: undefined,
  },
): { client: LlmClient; requests: CompletionRequest[]; } {
  const requests: CompletionRequest[] = [];
  const client: LlmClient = {
    ...identity,
    complete: (request) => {
      requests.push(request);
      return Promise.resolve({
        content: JSON.stringify({ suggestions: [], summary: "ok" }),
      });
    },
  };
  return { client, requests };
}

describe("buildReviewSystemPrompt golden output", () => {
  it("renders the default artifact byte-identically to the pre-artifact prompt", () => {
    expect(buildReviewSystemPrompt()).toBe(golden);
  });

  it("passing the default artifact explicitly changes nothing", () => {
    expect(buildReviewSystemPrompt(defaultReviewArtifact)).toBe(golden);
  });

  it("renders a variant's instructions and its demos inline", () => {
    const variant: PromptArtifact = {
      surface: "review",
      version: "2.0.0",
      instructions: "Custom review instructions.",
      demos: [{ transcriptExcerpt: "Customer places Order.", extraction: `{"a": 1}` }],
    };

    const prompt = buildReviewSystemPrompt(variant);
    expect(prompt.startsWith("Custom review instructions.")).toBe(true);
    expect(prompt).toContain("## Worked Examples");
    expect(prompt).not.toContain(golden);
  });
});

describe("the wired seam is a no-op until a review artifact exists", () => {
  it("ships no review variant yet", () => {
    // The premise of the test below, and of the spec's claim that
    // wiring the resolver changes nothing for any of the three
    // surfaces. When a review variant is authored this assertion is
    // the one that must be revisited deliberately. The matchless
    // default artifact is excluded: it ships in the registry as the
    // surface's default (extraction-default-parity.spec.md) and is
    // invisible to resolveArtifact, so it cannot make the seam a
    // non-no-op.
    expect(
      builtinArtifacts.filter((a) => a.surface === "review" && a.match !== undefined),
    ).toEqual([]);
  });

  it("sends the golden prompt for a client that resolves an extraction variant", async () => {
    // claude-haiku-4-5 has an authored *extraction* variant. Review
    // must not pick it up: a surface mismatch is not a near miss.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(new OrmModel({ name: "Test" }), client);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.systemPrompt).toBe(golden);
  });

  it("does not ask the provider to cache the review system prompt", async () => {
    // Decided on measurement, not left open: the prompt is ~650 tokens
    // against Haiku 4.5's 4,096-token minimum cacheable prefix, so a
    // breakpoint here would be inert. Revisit if the prompt grows past
    // that (docs/specs/review-surface-evals.spec.md, Non-goals).
    const { client, requests } = capturingClient();

    await reviewModel(new OrmModel({ name: "Test" }), client);

    expect(requests[0]!.cacheSystemPrompt).toBeUndefined();
  });
});
