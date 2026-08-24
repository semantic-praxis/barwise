/**
 * How reviewModel chooses its prompt artifact: the client's own
 * provider and model resolve a variant, an explicit `artifact` option
 * overrides that, a client matching no variant gets the default byte
 * for byte, and a non-review artifact is rejected before any LLM call.
 *
 * The builtin registry is mocked because no review variant is checked
 * in yet -- and the resolution has to be exercised against one, or the
 * seam would pass its tests with the resolver call deleted. The
 * unmocked registry's state is asserted in reviewPrompt.golden.test.ts.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it, vi } from "vitest";
import type { CompletionRequest, LlmClient } from "../../src/LlmClient.js";
import type { PromptArtifact } from "../../src/prompt/artifacts/PromptArtifact.js";
import {
  buildReviewSystemPrompt,
  defaultReviewArtifact,
  reviewModel,
} from "../../src/review/reviewModel.js";

// Hoisted so the mock factory -- which vitest lifts above the imports
// -- and the assertions below read the same two artifacts rather than
// two copies that can drift.
const { haikuReviewVariant, haikuExtractionVariant } = vi.hoisted(() => ({
  haikuReviewVariant: {
    surface: "review",
    version: "review-haiku-1",
    match: { provider: "anthropic", modelPrefix: "claude-haiku" },
    instructions: "Haiku review instructions.",
    demos: [],
  } as PromptArtifact,
  /** An extraction variant that must never answer a review query. */
  haikuExtractionVariant: {
    surface: "extraction",
    version: "extraction-haiku-1",
    match: { provider: "anthropic", modelPrefix: "claude-haiku" },
    instructions: "Haiku extraction instructions.",
    demos: [],
  } as PromptArtifact,
}));

vi.mock("../../src/prompt/artifacts/builtins.generated.js", () => ({
  builtinArtifacts: [haikuReviewVariant, haikuExtractionVariant],
}));

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

const model = new OrmModel({ name: "Test Model" });

describe("reviewModel variant resolution", () => {
  it("renders the variant the client's own provider and model select", async () => {
    // The acceptance shape of the seam: no caller names the artifact,
    // and nothing about the three call sites changes.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(model, client);

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt(haikuReviewVariant));
    expect(requests[0]!.systemPrompt).not.toBe(buildReviewSystemPrompt());
  });

  it("ignores an extraction variant matching the same client", async () => {
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(model, client);

    expect(requests[0]!.systemPrompt).not.toContain(haikuExtractionVariant.instructions);
  });

  it("falls back to the default for a model with no authored variant", async () => {
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });

    await reviewModel(model, client);

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt());
  });

  it("falls back to the default when the client cannot name its model", async () => {
    // CopilotLlmClient's shape: the host picks the model inside
    // complete(), so nothing is known in time to choose a prompt.
    const { client, requests } = capturingClient({ provider: "copilot", model: undefined });

    await reviewModel(model, client);

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt());
  });
});

describe("reviewModel artifact option", () => {
  it("lets an explicit artifact override the resolved variant", async () => {
    const explicit: PromptArtifact = {
      surface: "review",
      version: "explicit-1",
      instructions: "Explicit review instructions.",
      demos: [],
    };
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(model, client, { artifact: explicit });

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt(explicit));
  });

  it("pins the default when the caller passes defaultReviewArtifact", async () => {
    // How a reproducible run holds the prompt fixed independent of
    // which model it runs against -- no separate opt-out flag needed.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(model, client, { artifact: defaultReviewArtifact });

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt());
  });

  it("rejects a non-review artifact before calling the LLM", async () => {
    const { client, requests } = capturingClient();

    await expect(
      reviewModel(model, client, { artifact: haikuExtractionVariant }),
    ).rejects.toThrow(/surface "extraction"/);
    expect(requests).toHaveLength(0);
  });

  it("keeps honouring focus alongside a resolved variant", async () => {
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await reviewModel(model, client, { focus: "Customer" });

    expect(requests[0]!.systemPrompt).toBe(buildReviewSystemPrompt(haikuReviewVariant));
    expect(requests[0]!.userMessage).toContain("focusing on: Customer");
  });
});
