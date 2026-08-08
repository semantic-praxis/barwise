/**
 * Tests for the .prompt.yaml loader: fixture round-trip, directory
 * loading with stable order, and validation failures with the file
 * path in the message.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadArtifact, loadArtifactsFromDir } from "../../../src/prompt/artifacts/loadArtifact.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/prompts",
);

describe("loadArtifact", () => {
  it("loads the sample fixture with match, demos, and provenance", () => {
    const artifact = loadArtifact(join(fixturesDir, "anthropic-sample.prompt.yaml"));
    expect(artifact.surface).toBe("extraction");
    expect(artifact.version).toBe("2.1.0");
    expect(artifact.match).toEqual({ provider: "anthropic", modelPrefix: "claude-" });
    expect(artifact.instructions).toContain("Sample optimized instructions");
    expect(artifact.demos).toHaveLength(1);
    expect(artifact.demos[0]!.transcriptExcerpt).toContain("Alice");
    expect(artifact.provenance?.optimizer).toBe("dspy/MIPROv2");
    expect(artifact.provenance?.score).toBe(0.91);
  });

  it("rejects a missing surface with the file path in the message", () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    const file = join(dir, "bad.prompt.yaml");
    writeFileSync(file, "version: '1'\ninstructions: hi\n");
    expect(() => loadArtifact(file)).toThrow(/bad\.prompt\.yaml.*surface/);
  });

  it("rejects malformed demos", () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    const file = join(dir, "demos.prompt.yaml");
    writeFileSync(
      file,
      "surface: extraction\nversion: '1'\ninstructions: hi\ndemos:\n  - transcriptExcerpt: x\n",
    );
    expect(() => loadArtifact(file)).toThrow(/demos\[0\]/);
  });

  it("rejects a non-mapping document", () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    const file = join(dir, "list.prompt.yaml");
    writeFileSync(file, "- just\n- a\n- list\n");
    expect(() => loadArtifact(file)).toThrow(/YAML mapping/);
  });
});

describe("loadArtifactsFromDir", () => {
  it("loads only .prompt.yaml files, sorted by filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompts-"));
    writeFileSync(
      join(dir, "b.prompt.yaml"),
      "surface: extraction\nversion: b\ninstructions: second\n",
    );
    writeFileSync(
      join(dir, "a.prompt.yaml"),
      "surface: extraction\nversion: a\ninstructions: first\n",
    );
    writeFileSync(join(dir, "ignored.yaml"), "surface: extraction\n");
    const artifacts = loadArtifactsFromDir(dir);
    expect(artifacts.map((a) => a.version)).toEqual(["a", "b"]);
  });
});
