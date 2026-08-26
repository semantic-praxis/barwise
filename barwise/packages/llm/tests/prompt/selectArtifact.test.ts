/**
 * `selectArtifact` is the one answer to "which prompt gets sent"
 * (docs/specs/artifact-resolution-parity.spec.md, workstream 1).
 *
 * The assertions worth having here are the ones a consumer test cannot
 * make. Both production surfaces fall back to their default, so a
 * resolver that silently lost `builtinArtifacts` still produces a
 * plausible extraction and a plausible review -- which is exactly how
 * barwise-850 survived for months. So this pins the candidate set and
 * the per-surface default directly, not through a surface.
 */
import { describe, expect, it } from "vitest";
import { builtinArtifacts } from "../../src/prompt/artifacts/builtins.generated.js";
import type { PromptArtifact } from "../../src/prompt/artifacts/PromptArtifact.js";
import { defaultReviewArtifact } from "../../src/prompt/reviewPrompt.js";
import { assertArtifactSurface, selectArtifact } from "../../src/prompt/selectArtifact.js";
import { defaultExtractionArtifact } from "../../src/prompt/systemPrompt.js";

const reviewOverride: PromptArtifact = {
  surface: "review",
  version: "test-review",
  instructions: "review instructions",
  demos: [],
};

const extractionOverride: PromptArtifact = {
  surface: "extraction",
  version: "test-extraction",
  instructions: "extraction instructions",
  demos: [],
};

describe("selectArtifact", () => {
  it("returns the surface's default when no variant matches", () => {
    expect(selectArtifact("extraction", { provider: "ollama", model: "llama3" }))
      .toBe(defaultExtractionArtifact);
    expect(selectArtifact("review", { provider: "ollama", model: "llama3" }))
      .toBe(defaultReviewArtifact);
  });

  it("maps each surface to its own default, not to one of them twice", () => {
    // The bug this catches is a copy-paste in the surface-to-default
    // table, which every consumer would render happily.
    const extraction = selectArtifact("extraction", {});
    const review = selectArtifact("review", {});
    expect(extraction.surface).toBe("extraction");
    expect(review.surface).toBe("review");
    expect(extraction).not.toBe(review);
  });

  it("resolves a shipped variant from the built-in set", () => {
    // Not "some array": the compiled-in set production reads.
    const haiku = builtinArtifacts.find((a) => a.match?.modelPrefix === "claude-haiku");
    expect(haiku, "the haiku variant should exist to make this meaningful").toBeDefined();
    expect(selectArtifact("extraction", {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    })).toBe(haiku);
  });

  it("prefers an explicit override to the variant the target would resolve", () => {
    expect(selectArtifact("extraction", {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    }, extractionOverride)).toBe(extractionOverride);
  });

  it("rejects an override authored for another surface", () => {
    expect(() => selectArtifact("extraction", {}, reviewOverride))
      .toThrow(/surface "review" cannot drive transcript extraction/);
    expect(() => selectArtifact("review", {}, extractionOverride))
      .toThrow(/surface "extraction" cannot drive model review/);
  });

  it("does not consult the filesystem", () => {
    // The candidate set is compiled in. A resolver that read a
    // directory would work in this repo and fail in a global install,
    // a published package, and the VS Code bundle alike.
    expect(builtinArtifacts).toContain(
      selectArtifact("extraction", { provider: "anthropic", model: "claude-haiku-4-5" }),
    );
  });
});

describe("assertArtifactSurface", () => {
  it("accepts an artifact for its own surface", () => {
    expect(() => assertArtifactSurface(reviewOverride, "review")).not.toThrow();
    expect(() => assertArtifactSurface(extractionOverride, "extraction")).not.toThrow();
  });

  it("names the surface the artifact declared and the one it cannot drive", () => {
    // Both halves: a message naming only one of them leaves the reader
    // to guess which end is wrong.
    expect(() => assertArtifactSurface(reviewOverride, "extraction"))
      .toThrow('Prompt artifact surface "review" cannot drive transcript extraction.');
    expect(() => assertArtifactSurface(extractionOverride, "review"))
      .toThrow('Prompt artifact surface "extraction" cannot drive model review.');
  });
});
