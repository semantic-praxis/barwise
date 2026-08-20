/**
 * Tests for how processTranscript chooses its prompt artifact: the
 * client's own provider and model resolve a variant, an explicit
 * `artifact` option overrides that, a client matching no variant gets
 * the default byte for byte, and a non-extraction artifact is rejected
 * before any LLM call.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import { builtinArtifacts } from "../src/prompt/artifacts/builtins.generated.js";
import type { PromptArtifact } from "../src/prompt/artifacts/PromptArtifact.js";
import { buildSystemPrompt, defaultExtractionArtifact } from "../src/prompt/systemPrompt.js";
import { processTranscript } from "../src/TranscriptProcessor.js";

const EMPTY_EXTRACTION = JSON.stringify({
  object_types: [],
  fact_types: [],
  subtypes: [],
  inferred_constraints: [],
  objectified_fact_types: [],
  populations: [],
  ambiguities: [],
});

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
      return Promise.resolve({ content: EMPTY_EXTRACTION });
    },
  };
  return { client, requests };
}

/** The checked-in Haiku variant, which drives the resolution tests. */
const haikuVariant = builtinArtifacts.find(
  (a) => a.match?.modelPrefix === "claude-haiku",
);

const variant: PromptArtifact = {
  surface: "extraction",
  version: "2.0.0",
  instructions: "Variant instructions for testing.",
  demos: [],
};

describe("processTranscript artifact option", () => {
  it("renders the variant artifact into the system prompt", async () => {
    const { client, requests } = capturingClient();
    await processTranscript("Customer places Order.", client, { artifact: variant });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false, variant));
  });

  it("uses the byte-identical default prompt when nothing resolves", async () => {
    const { client, requests } = capturingClient();
    await processTranscript("Customer places Order.", client);
    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false));
  });

  it("rejects a non-extraction artifact before calling the LLM", async () => {
    const { client, requests } = capturingClient();
    const review: PromptArtifact = { ...variant, surface: "review" };
    await expect(
      processTranscript("Customer places Order.", client, { artifact: review }),
    ).rejects.toThrow(/surface "review"/);
    expect(requests).toHaveLength(0);
  });
});

describe("processTranscript variant resolution", () => {
  it("renders the variant the client's own provider and model select", async () => {
    // The acceptance criterion for workstream 2: a client that reports
    // claude-haiku-4-5 gets the Haiku variant without the caller
    // naming it.
    expect(haikuVariant, "the Haiku variant should be checked in").toBeDefined();
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await processTranscript("Customer places Order.", client);

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false, haikuVariant));
    expect(requests[0]!.systemPrompt).not.toBe(buildSystemPrompt(false));
  });

  it("falls back to the default for a model with no authored variant", async () => {
    // The Anthropic provider's own fallback model. It matches no
    // variant, so the unconfigured path is unchanged by this wiring.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });

    await processTranscript("Customer places Order.", client);

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false));
  });

  it("falls back to the default when the client cannot name its model", async () => {
    // CopilotLlmClient's shape: the host picks the model inside
    // complete(), so nothing is known in time to choose a prompt.
    const { client, requests } = capturingClient({
      provider: "copilot",
      model: undefined,
    });

    await processTranscript("Customer places Order.", client);

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false));
  });

  it("lets an explicit artifact override the resolved variant", async () => {
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await processTranscript("Customer places Order.", client, { artifact: variant });

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false, variant));
  });

  it("pins the default when the caller passes defaultExtractionArtifact", async () => {
    // How a reproducible run holds the prompt fixed independent of
    // which model it runs against -- no separate opt-out flag needed.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await processTranscript("Customer places Order.", client, {
      artifact: defaultExtractionArtifact,
    });

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(false));
  });

  it("keeps the alternatives section on top of a resolved variant", async () => {
    // Resolution replaces the instructions, not the alternatives
    // branch; the two compose.
    const { client, requests } = capturingClient({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await processTranscript("Customer places Order.", client, { alternatives: true });

    expect(requests[0]!.systemPrompt).toBe(buildSystemPrompt(true, haikuVariant));
    expect(requests[0]!.systemPrompt).toContain("Alternative framings");
  });
});
