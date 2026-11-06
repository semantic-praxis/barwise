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
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinArtifacts } from "../../src/prompt/artifacts/builtins.generated.js";
import type { PromptArtifact } from "../../src/prompt/artifacts/PromptArtifact.js";
import { defaultReviewArtifact } from "../../src/prompt/reviewPrompt.js";
import { assertArtifactSurface, selectArtifact } from "../../src/prompt/selectArtifact.js";
import { defaultExtractionArtifact } from "../../src/prompt/systemPrompt.js";
import { readCode, sourceFiles } from "../helpers/sourceText.js";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "../../..");

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

  it("prefers an explicit override to the variant the target would resolve [adr:production-prompt-resolution#library-seam]", () => {
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

  it("does not consult the filesystem [adr:production-prompt-resolution#shipped-only]", () => {
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

  it("names the surface the artifact declared and the one it cannot drive [adr:production-prompt-resolution#library-seam]", () => {
    // Both halves: a message naming only one of them leaves the reader
    // to guess which end is wrong.
    expect(() => assertArtifactSurface(reviewOverride, "extraction"))
      .toThrow('Prompt artifact surface "review" cannot drive transcript extraction.');
    expect(() => assertArtifactSurface(extractionOverride, "review"))
      .toThrow('Prompt artifact surface "extraction" cannot drive model review.');
  });
});

/**
 * Production can only send a shipped artifact
 * (docs/adr/production-prompt-resolution.md, `shipped-only`;
 * docs/specs/model-access-held.spec.md, Scope item 6). Three halves: what
 * the resolver can reach, what it does when a candidate is lying around
 * anyway, and whether a production call site hands it one.
 */
describe("shipped-only", () => {
  /** Every module specifier the file imports, static or dynamic. */
  function importsOf(code: string): string[] {
    const found: string[] = [];
    for (const m of code.matchAll(/\bimport\s+(?:type\s+)?[^"';]*?\bfrom\s*["']([^"']+)["']/g)) {
      found.push(m[1]!);
    }
    for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) found.push(m[1]!);
    for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*([^)]*)\)/g)) {
      found.push(`dynamic:${m[1]!.trim()}`);
    }
    return found.sort();
  }

  it("selectArtifact.ts imports exactly the five modules it has today [adr:production-prompt-resolution#shipped-only]", () => {
    // A new import -- a directory loader, node:fs, node:os -- fails here
    // until someone reviews whether it widens the candidate set.
    const code = readCode(join(packagesDir, "llm/src/prompt/selectArtifact.ts"));
    // Other ways to reach a module or the environment than a static import:
    // `process` (process.env, process.getBuiltinModule), require(),
    // import(), and a re-export, which importsOf does not read.
    const otherReaches = code.split("\n").filter((line) =>
      /\bprocess\b|\brequire\s*\(|\bimport\s*\(|\bexport\b[^;]*\bfrom\b/.test(line)
    );
    expect(otherReaches).toEqual([]);
    expect(importsOf(code)).toEqual([
      "./artifacts/PromptArtifact.js",
      "./artifacts/builtins.generated.js",
      "./artifacts/resolveArtifact.js",
      "./reviewPrompt.js",
      "./systemPrompt.js",
    ]);
  });

  describe("with candidates planted where a loader would look", () => {
    const ENV_VARS = [
      "HOME",
      "XDG_CONFIG_HOME",
      "BARWISE_PROMPTS",
      "BARWISE_PROMPT_DIR",
      "BARWISE_PROMPTS_DIR",
      "BARWISE_ARTIFACTS",
      "BARWISE_ARTIFACTS_DIR",
      "BARWISE_PROMPT_ARTIFACTS",
    ] as const;
    const saved = new Map<string, string | undefined>();
    let root: string;

    /** A candidate per surface that would win resolution if it were read. */
    function plant(dir: string): void {
      mkdirSync(dir, { recursive: true });
      for (const surface of ["extraction", "review"]) {
        writeFileSync(
          join(dir, `${surface}.planted.prompt.yaml`),
          `surface: ${surface}\nversion: planted\nmatch:\n  provider: anthropic\n`
            + `  modelPrefix: claude\ninstructions: planted\ndemos: []\n`,
        );
      }
    }

    beforeEach(() => {
      for (const k of ENV_VARS) saved.set(k, process.env[k]);
      root = mkdtempSync(join(tmpdir(), "shipped-only-"));
      const home = join(root, "home");
      const xdg = join(root, "xdg");
      const envDir = join(root, "env-prompts");
      for (
        const d of [
          join(home, ".barwise/prompts"),
          join(home, ".config/barwise/prompts"),
          join(xdg, "barwise/prompts"),
          envDir,
        ]
      ) {
        plant(d);
      }
      process.env["HOME"] = home;
      process.env["XDG_CONFIG_HOME"] = xdg;
      for (const k of ENV_VARS.slice(2)) process.env[k] = envDir;
    });

    afterEach(() => {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(root, { recursive: true, force: true });
    });

    it("still returns an element of builtinArtifacts on both surfaces [adr:production-prompt-resolution#shipped-only]", () => {
      const clients = [
        { provider: "anthropic", model: "claude-haiku-4-5" },
        { provider: "anthropic", model: "claude-opus-5" },
        { provider: "ollama", model: "llama3" },
        {},
      ];
      for (const surface of ["extraction", "review"] as const) {
        for (const client of clients) {
          const chosen = selectArtifact(surface, client);
          expect(builtinArtifacts).toContain(chosen);
          expect(chosen.version).not.toBe("planted");
        }
      }
    });
  });

  /**
   * The prompt lane: the only files outside llm and promptlab that may name
   * an artifact, because choosing one is their job.
   */
  const PROMPT_LANE: Readonly<Record<string, string>> = {
    "cli/src/commands/prompt.ts":
      "barwise prompt eval/artifact/run: the dev lane that sends candidates",
    "cli/src/workspace/promptArtifacts.ts":
      "artifactCandidates(dir): the dev lane's candidate loader",
  };

  /**
   * Files using "artifact" in the lineage sense -- an exported file such as
   * a DDL script -- which is not a prompt artifact. Exempt only while the
   * file does not import @barwise/llm (asserted below): a file that cannot
   * reach processTranscript or reviewModel cannot hand either one an
   * artifact. One that starts importing llm loses the exemption.
   */
  const LINEAGE_SENSE: Readonly<Record<string, string>> = {
    "cli/src/commands/export.ts": "records the exported file in the lineage manifest",
    "cli/src/commands/lineage.ts": "reports stale and affected exported files",
    "core/src/export/types.ts": "the lineage export entry type",
    "core/src/lineage/generate.ts": "lineage manifest generation",
    "core/src/lineage/impact.ts": "impact analysis over exported files",
    "core/src/lineage/manifest.ts": "lineage manifest merge",
    "core/src/lineage/resolveArtifact.ts": "resolves an exported file to its source",
    "core/src/lineage/staleness.ts": "staleness over exported files",
    "core/src/lineage/types.ts": "lineage manifest types",
    "mcp/src/tools/describeDomain.ts": "resolves an exported file back to its model",
    "mcp/src/tools/exportModel.ts": "the exported file a call produces",
  };

  it("no src file outside llm, promptlab and the prompt lane names an artifact in code [adr:production-prompt-resolution#shipped-only]", () => {
    // Any use of the identifier, not only `artifact:` -- the shorthand
    // `{ artifact }` and a call site nobody listed both count. Comments are
    // stripped: several production files explain, in one, the very property
    // they must not pass.
    const offenders: string[] = [];
    const exemptions: string[] = [];
    let scanned = 0;
    for (const pkg of readdirSync(packagesDir)) {
      if (pkg === "llm" || pkg === "promptlab") continue;
      let files: string[];
      try {
        files = sourceFiles(join(packagesDir, pkg, "src"));
      } catch {
        continue; // no src directory
      }
      for (const file of files) {
        scanned++;
        const rel = relative(packagesDir, file).split(sep).join("/");
        if (rel in PROMPT_LANE) continue;
        const code = readCode(file);
        if (rel in LINEAGE_SENSE) {
          if (/from\s*["']@barwise\/llm["']/.test(code)) {
            exemptions.push(
              `${rel} imports @barwise/llm, so its lineage exemption no longer holds`,
            );
          }
          continue;
        }
        code.split("\n").forEach((line, i) => {
          if (/\bartifact\b/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(exemptions).toEqual([]);
    expect(offenders).toEqual([]);
  });
});
