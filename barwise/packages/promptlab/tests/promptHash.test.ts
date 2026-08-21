/**
 * The rendered-prompt fingerprint
 * (eval-run-resolution-and-provenance spec, workstream 2).
 *
 * The load-bearing test is the last one: an artifact whose instructions
 * change while its `version:` stays put is exactly the trap the hash
 * exists to catch, and it is the reason `artifactVersion` alone cannot
 * identify a run.
 */
import type { PromptArtifact } from "@barwise/llm";
import { buildSystemPrompt } from "@barwise/llm";
import { describe, expect, it } from "vitest";
import { hashPrompt } from "../src/provenance/promptHash.js";

const base: PromptArtifact = {
  surface: "extraction",
  version: "test-1",
  instructions: "Extract an ORM model.",
  demos: [],
};

describe("hashPrompt", () => {
  it("is stable for the same bytes", () => {
    expect(hashPrompt("abc")).toBe(hashPrompt("abc"));
  });

  it("is twelve hex characters", () => {
    expect(hashPrompt("abc")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes for any change in the prompt", () => {
    expect(hashPrompt("abc")).not.toBe(hashPrompt("abd"));
    // Trailing whitespace is a real difference in a prompt, not noise.
    expect(hashPrompt("abc")).not.toBe(hashPrompt("abc "));
  });

  it("agrees when two artifacts render identical prompts", () => {
    // Same bytes by a different route: the default artifact and an
    // explicit copy of it render the same prompt, so they hash alike.
    const copy: PromptArtifact = { ...base, version: "test-2" };
    expect(hashPrompt(buildSystemPrompt(false, base)))
      .toBe(hashPrompt(buildSystemPrompt(false, copy)));
  });

  it("diverges when instructions change but the version does not", () => {
    // The whole point. Two artifacts agreeing on `version` while
    // disagreeing on what they tell the model is the silent failure
    // that made history rows unidentifiable.
    const edited: PromptArtifact = { ...base, instructions: "Extract an ORM model. Carefully." };
    expect(edited.version).toBe(base.version);
    expect(hashPrompt(buildSystemPrompt(false, edited)))
      .not.toBe(hashPrompt(buildSystemPrompt(false, base)));
  });

  it("separates the alternatives branch from the plain prompt", () => {
    // Same artifact, different rendered prompt. A run with alternatives
    // on did not send the same bytes as one without.
    expect(hashPrompt(buildSystemPrompt(true, base)))
      .not.toBe(hashPrompt(buildSystemPrompt(false, base)));
  });
});
