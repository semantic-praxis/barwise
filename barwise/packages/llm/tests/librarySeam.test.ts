/**
 * The library seam accepts an explicit artifact, and guards it
 * (docs/adr/production-prompt-resolution.md, `library-seam`;
 * docs/specs/model-access-held.spec.md, Scope item 9).
 *
 * The artifacts are shipped ones, from the real `builtinArtifacts`, so the
 * guard is exercised on what an embedder could actually pass. The client
 * records every call: "throws" alone would also pass for a guard that ran
 * after the completion it was meant to prevent.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import type { LlmClient } from "../src/LlmClient.js";
import { builtinArtifacts } from "../src/prompt/artifacts/builtins.generated.js";
import type { PromptSurface } from "../src/prompt/artifacts/PromptArtifact.js";
import { reviewModel } from "../src/review/reviewModel.js";
import { processTranscript } from "../src/TranscriptProcessor.js";

function shipped(surface: PromptSurface) {
  const a = builtinArtifacts.find((x) => x.surface === surface);
  if (a === undefined) throw new Error(`no shipped ${surface} artifact`);
  return a;
}

function recordingClient(): { client: LlmClient; calls: number[]; } {
  const calls: number[] = [];
  return {
    calls,
    client: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      complete: () => {
        calls.push(1);
        return Promise.reject(new Error("the client must not be called"));
      },
    },
  };
}

describe("library-seam", () => {
  it("processTranscript given a shipped review artifact throws the guard's error and never calls the client [adr:production-prompt-resolution#library-seam]", async () => {
    const { client, calls } = recordingClient();
    await expect(
      processTranscript("Customer places Order.", client, { artifact: shipped("review") }),
    ).rejects.toThrow(/surface "review" cannot drive transcript extraction/);
    expect(calls).toHaveLength(0);
  });

  it("reviewModel given a shipped extraction artifact throws the guard's error and never calls the client [adr:production-prompt-resolution#library-seam]", async () => {
    const { client, calls } = recordingClient();
    await expect(
      reviewModel(new OrmModel({ name: "Seam" }), client, { artifact: shipped("extraction") }),
    ).rejects.toThrow(/surface "extraction" cannot drive model review/);
    expect(calls).toHaveLength(0);
  });
});
