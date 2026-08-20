/**
 * The compiled-in artifacts must equal what the loader reads from
 * prompts/ (artifact-resolution-in-production spec, workstream 1).
 *
 * `builtins.generated.ts` is committed, so nothing forces it to stay in
 * step with the YAML it came from. This is the guard, mirroring the
 * drift tests over docs/tutorial/ and examples/output/: regenerate
 * intentionally with `npm run regen:builtins` and review the diff.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinArtifacts } from "../../../src/prompt/artifacts/builtins.generated.js";
import { loadArtifactsFromDir } from "../../../src/prompt/artifacts/loadArtifact.js";
import { resolveArtifact } from "../../../src/prompt/artifacts/resolveArtifact.js";

const llmRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fromDisk = loadArtifactsFromDir(resolve(llmRoot, "prompts"));

describe("builtinArtifacts", () => {
  it("matches what the loader reads from prompts/, element for element", () => {
    expect(builtinArtifacts).toEqual(fromDisk);
  });

  it("carries every checked-in variant", () => {
    expect(builtinArtifacts.length).toBe(fromDisk.length);
    expect(builtinArtifacts.length).toBeGreaterThan(0);
  });

  it("declares a match block on every variant", () => {
    // A variant with no match block would apply to nothing --
    // resolveArtifact filters those out, so it would be dead weight.
    for (const a of builtinArtifacts) {
      expect(a.match, a.version).toBeDefined();
    }
  });

  it("resolves the same way whether loaded from disk or compiled in", () => {
    // The point of the generated file: identical resolution behavior
    // without touching the filesystem.
    const queries = [
      { surface: "extraction" as const, provider: "anthropic", model: "claude-haiku-4-5" },
      { surface: "extraction" as const, provider: "anthropic", model: "claude-sonnet-5" },
      { surface: "extraction" as const, provider: "anthropic", model: "claude-opus-4-1" },
      { surface: "extraction" as const, provider: "openai", model: "gpt-5" },
      { surface: "extraction" as const },
    ];
    for (const q of queries) {
      expect(resolveArtifact(builtinArtifacts, q), JSON.stringify(q))
        .toEqual(resolveArtifact(fromDisk, q));
    }
  });

  it("resolves nothing for a provider with no authored variant", () => {
    // Non-Anthropic providers benefit through the default, not a
    // variant; this pins that until someone authors one.
    expect(
      resolveArtifact(builtinArtifacts, {
        surface: "extraction",
        provider: "ollama",
        model: "llama3",
      }),
    ).toBeUndefined();
  });

  it("reaches production: extraction renders the variant for a matching model", async () => {
    // Workstream 1 compiled these in without wiring them to anything,
    // and this test asserted the inertness. Workstream 2 wired them, so
    // the expectation flipped: a client on claude-haiku-4-5 now gets
    // the haiku45-2 variant. The point of asserting it here, next to
    // the drift guard, is that it proves the compiled-in copy is what
    // production actually reads -- not just that resolution works on
    // some array.
    const { buildSystemPrompt, processTranscript } = await import("../../../src/index.js");
    let sent = "";
    const client = {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      complete: (request: { systemPrompt: string; }) => {
        sent = request.systemPrompt;
        return Promise.resolve({
          content: JSON.stringify({
            object_types: [],
            fact_types: [],
            inferred_constraints: [],
            ambiguities: [],
          }),
          modelUsed: "claude-haiku-4-5",
        });
      },
    };

    await processTranscript("Facilitator: anything.", client, { modelName: "t" });

    const haiku = builtinArtifacts.find((a) => a.match?.modelPrefix === "claude-haiku");
    expect(haiku, "the haiku variant should exist to make this meaningful").toBeDefined();
    expect(sent).toBe(buildSystemPrompt(false, haiku));
    expect(sent).not.toBe(buildSystemPrompt(false));
  });
});
