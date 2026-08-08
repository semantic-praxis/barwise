/**
 * Tests for the artifact option on processTranscript: a variant
 * artifact drives the system prompt, omitting it preserves the default
 * byte for byte, and a non-extraction artifact is rejected before any
 * LLM call.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import type { PromptArtifact } from "../src/prompt/artifacts/PromptArtifact.js";
import { buildSystemPrompt } from "../src/prompt/systemPrompt.js";
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

function capturingClient(): { client: LlmClient; requests: CompletionRequest[]; } {
  const requests: CompletionRequest[] = [];
  const client: LlmClient = {
    complete: (request) => {
      requests.push(request);
      return Promise.resolve({ content: EMPTY_EXTRACTION });
    },
  };
  return { client, requests };
}

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

  it("uses the byte-identical default prompt when omitted", async () => {
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
