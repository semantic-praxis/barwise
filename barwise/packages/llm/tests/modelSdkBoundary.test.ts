/**
 * Only `@barwise/llm` imports a model SDK (docs/adr/determinism-in-core.md,
 * `one-layer-out`; docs/specs/purity-and-model-boundary.spec.md, Scope 4).
 *
 * Read from source, and through TypeScript's `preProcessFile` rather than a
 * regex: it lists every module a file references -- static and dynamic
 * imports, `export ... from`, `require`, type imports -- and never a word in
 * a string or comment, so the provider name `"openai"` in a schema enum (as
 * `mcp/src/tools/review.ts` has) is not an import. A depcruise rule cannot
 * hold this: `.dependency-cruiser.cjs` sets `includeOnly` to packages' src,
 * so an import of a package in node_modules is outside its graph.
 *
 * A plain `fetch` to a provider's host is not seen, and stays the gap the
 * ADR names.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "../..");

const SDKS = ["@anthropic-ai/sdk", "openai"];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** `openai` and `openai/resources/x` are the SDK; `openai-compat` is not. */
function isSdk(specifier: string): boolean {
  return SDKS.some((sdk) => specifier === sdk || specifier.startsWith(`${sdk}/`));
}

/** The SDK specifiers one file references, by TypeScript's reading. */
function sdkImports(code: string): string[] {
  return ts.preProcessFile(code, true, true).importedFiles
    .map((ref) => ref.fileName)
    .filter(isSdk);
}

/**
 * Every file TypeScript can parse, declaration files included. Wider than
 * `helpers/sourceText.ts`'s `sourceFiles` (.ts/.tsx, .d.ts excluded) on
 * purpose: an SDK imported from a .mjs or .js file in a package's src is
 * the same breach, and a scan of .ts alone would pass it.
 */
const SOURCE = /\.[cm]?[jt]sx?$/;

function scriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return scriptFiles(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

const packages = readdirSync(packagesDir).filter((p) => p !== "llm");

describe("only @barwise/llm imports a model SDK", () => {
  it("the detector sees every import form and no string (self-check)", () => {
    // Without this, a reading that found nothing would pass the scan below
    // for the wrong reason.
    const positives = [
      `import OpenAI from "openai";`,
      `import Anthropic from "@anthropic-ai/sdk";`,
      `import type { Message } from "@anthropic-ai/sdk/resources/messages";`,
      `const m = await import("openai");`,
      `const m = require("openai");`,
      `export { default } from "openai";`,
    ];
    for (const code of positives) {
      expect(sdkImports(code), code).not.toEqual([]);
    }
    const negatives = [
      `const provider = z.enum(["anthropic", "openai", "ollama"]);`,
      `// import OpenAI from "openai";`,
      `import compat from "openai-compat";`,
    ];
    for (const code of negatives) {
      expect(sdkImports(code), code).toEqual([]);
    }
  });

  it("no packages/*/src file outside llm imports one, and no other package.json lists one [adr:determinism-in-core#one-layer-out]", () => {
    // The scan must have something to scan, or an empty glob passes.
    expect(packages).toContain("cli");
    expect(packages).toContain("mcp");
    expect(packages).toContain("vscode");

    const findings: string[] = [];
    let scanned = 0;
    for (const pkg of packages) {
      const dir = join(packagesDir, pkg);
      let files: string[];
      try {
        files = scriptFiles(join(dir, "src"));
      } catch {
        files = []; // a package with no src directory
      }
      for (const file of files) {
        scanned++;
        for (const s of sdkImports(readFileSync(file, "utf8"))) {
          findings.push(`${relative(packagesDir, file)}: imports ${s}`);
        }
      }
      let manifest: Record<string, Record<string, string> | undefined>;
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      } catch {
        continue; // not a package
      }
      for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (isSdk(name)) findings.push(`${pkg}/package.json: ${field} lists ${name}`);
        }
      }
    }

    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});
