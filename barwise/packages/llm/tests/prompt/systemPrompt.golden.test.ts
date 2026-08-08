/**
 * Golden tests for the artifact seam refactor: the default artifact must
 * render byte-identically to the pre-artifact buildSystemPrompt output.
 * The golden files were generated from the build preceding the refactor;
 * regenerating them requires a deliberate prompt change.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PromptArtifact } from "../../src/prompt/artifacts/PromptArtifact.js";
import { buildSystemPrompt, defaultExtractionArtifact } from "../../src/prompt/systemPrompt.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/prompts",
);

function golden(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

describe("buildSystemPrompt golden output", () => {
  it("renders the default artifact byte-identically to the pre-artifact prompt", () => {
    expect(buildSystemPrompt(false)).toBe(golden("extraction-default.golden.txt"));
  });

  it("renders the alternatives variant byte-identically", () => {
    expect(buildSystemPrompt(true)).toBe(
      golden("extraction-default-alternatives.golden.txt"),
    );
  });

  it("passing the default artifact explicitly changes nothing", () => {
    expect(buildSystemPrompt(false, defaultExtractionArtifact)).toBe(
      buildSystemPrompt(false),
    );
    expect(buildSystemPrompt(true, defaultExtractionArtifact)).toBe(
      buildSystemPrompt(true),
    );
  });
});

describe("buildSystemPrompt with a variant artifact", () => {
  const variant: PromptArtifact = {
    surface: "extraction",
    version: "2.0.0",
    instructions: "Custom extraction instructions.",
    demos: [
      { transcriptExcerpt: "Customer Alice placed Order 1.", extraction: `{"object_types": []}` },
    ],
  };

  it("uses the variant instructions and renders demos inline", () => {
    const prompt = buildSystemPrompt(false, variant);
    expect(prompt.startsWith("Custom extraction instructions.")).toBe(true);
    expect(prompt).toContain("## Worked Examples");
    expect(prompt).toContain("Customer Alice placed Order 1.");
    expect(prompt).toContain(`{"object_types": []}`);
  });

  it("appends the alternatives section after the demos", () => {
    const prompt = buildSystemPrompt(true, variant);
    expect(prompt).toContain("## Alternative framings");
    expect(prompt.indexOf("## Worked Examples")).toBeLessThan(
      prompt.indexOf("## Alternative framings"),
    );
  });
});
