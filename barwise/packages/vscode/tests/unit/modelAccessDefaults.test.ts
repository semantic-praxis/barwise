/**
 * What the extension's manifest promises about model access
 * (docs/specs/model-access-held.spec.md, Scope items 3 and 7).
 *
 * Read from `package.json` because that is where VS Code reads both: the
 * setting's default is what a fresh install runs with, and a language-model
 * tool's `inputSchema` is the whole of what a calling model can send.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Manifest {
  contributes: {
    configuration: { properties: Record<string, { default?: unknown; }>; };
    languageModelTools: Array<{
      name: string;
      inputSchema?: { properties?: Record<string, unknown>; };
    }>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
) as Manifest;

describe("model access defaults", () => {
  it("barwise.llmProvider defaults to copilot, the provider that needs no key [adr:keyless-model-access#keyless-defaults]", () => {
    expect(manifest.contributes.configuration.properties["barwise.llmProvider"]?.default)
      .toBe("copilot");
  });
});

describe("production tools offer no prompt override", () => {
  for (const name of ["barwise_import_transcript", "barwise_review_model"]) {
    it(`${name}'s inputSchema has no artifact, prompt or candidate property [adr:production-prompt-resolution#candidates-in-prompt-lane]`, () => {
      const tool = manifest.contributes.languageModelTools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const props = Object.keys(tool!.inputSchema?.properties ?? {});
      // Non-empty, or a schema read from the wrong place passes vacuously.
      expect(props.length).toBeGreaterThan(0);
      expect(props.filter((p) => /artifacts?|prompt|candidate/i.test(p))).toEqual([]);
    });
  }
});
