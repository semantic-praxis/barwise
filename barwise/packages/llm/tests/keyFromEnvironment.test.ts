/**
 * Only `@barwise/llm` reads a model key from the environment
 * (docs/adr/keyless-model-access.md, `measurement-key`, first clause;
 * docs/specs/model-access-held.spec.md, Scope item 5).
 *
 * Read from source, because the decision is about where a read may be
 * written: a run would only see the reads a test happened to reach. Comments
 * are stripped first, since the files that explain the rule name the keys.
 * The credential fingerprint the ADR's second clause asks for is WS3's.
 */
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCode, sourceFiles } from "./helpers/sourceText.js";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "../..");

/** A variable name that looks like a credential. */
const CREDENTIAL = /KEY|TOKEN|SECRET/i;

/**
 * The one shape a read may take: `process.env` followed directly by a
 * literal name -- `.NAME`, `?.NAME`, `["NAME"]` or `?.["NAME"]`.
 */
const LITERAL_READ = /^(?:\??\.\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\[\s*(["'])([^"'\\]*)\2\s*\])/;

/**
 * Each finding, so a failure names what to look at.
 *
 * An allowlist rather than a list of bad forms: every occurrence of
 * `process.env` must be a read of a literal name that is not a credential,
 * and anything else -- an alias, a destructure, a computed index, the object
 * handed to a function -- fails, because each one is a way to read a key
 * this scan could not name. `env` imported from `node:process`, and a
 * namespace import of it, fail outright for the same reason.
 */
function keyReads(code: string): string[] {
  const found: string[] = [];

  for (const m of code.matchAll(/\bprocess\s*(?:\?\.|\.)\s*env\b/g)) {
    const rest = code.slice(m.index! + m[0].length);
    const read = LITERAL_READ.exec(rest);
    const context = (m[0] + rest.slice(0, 30)).split("\n")[0]!.trim();
    if (read === null) {
      found.push(`${context} (not a read of a literal name)`);
      continue;
    }
    const name = read[1] ?? read[3]!;
    if (CREDENTIAL.test(name)) found.push(`${context} (credential name)`);
  }

  // process["env"], or the object reached any other computed way
  for (const m of code.matchAll(/\bprocess\s*(?:\?\.)?\[[^\]]*\]/g)) {
    found.push(`${m[0]} (computed access to process)`);
  }

  for (const m of code.matchAll(/\bimport\s+([^;]*?)\s*from\s*["'](?:node:)?process["']/g)) {
    const clause = m[1]!;
    if (/\*\s*as\b/.test(clause)) found.push(`${m[0]} (namespace import)`);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named !== null && named[1]!.split(",").some((p) => /^\s*env\b/.test(p))) {
      found.push(`${m[0]} (env imported)`);
    }
  }
  for (const m of code.matchAll(/\brequire\s*\(\s*["'](?:node:)?process["']\s*\)/g)) {
    found.push(`${m[0]} (process required)`);
  }

  return found;
}

describe("model keys are read from the environment only inside @barwise/llm", () => {
  it("the detector sees every form it is meant to (self-check)", () => {
    // Without this, a regex that matched nothing would pass the tree scan
    // below for the wrong reason.
    const positives = [
      `const k = process.env.ANTHROPIC_API_KEY;`,
      `const k = process.env["OPENAI_API_KEY"];`,
      `const k = process.env?.GH_TOKEN;`,
      `const k = process.env?.["MY_SECRET"];`,
      `const k = process.env[name];`,
      `const { HOME } = process.env;`,
      `const { HOME }: NodeJS.ProcessEnv = process.env;`,
      `const e = process.env;`,
      `spawn("x", { env: process.env });`,
      `const k = process["env"].HOME;`,
      `import { env } from "node:process";`,
      `import { env as e } from "process";`,
      `import * as p from "node:process";`,
    ];
    for (const code of positives) {
      expect(keyReads(code), code).not.toEqual([]);
    }
    const negatives = [
      `const h = process.env["HOME"];`,
      `const x = process.env.XDG_STATE_HOME;`,
      `const h = process.env?.["HOME"] ?? process.env?.USERPROFILE;`,
      `import { argv } from "node:process";`,
    ];
    for (const code of negatives) {
      expect(keyReads(code), code).toEqual([]);
    }
  });

  it("no package's src outside packages/llm touches process.env except to read a literal, non-credential name, or imports env from node:process [adr:keyless-model-access#measurement-key]", () => {
    const packages = readdirSync(packagesDir).filter((p) => p !== "llm");
    // The scan must have something to scan, or an empty glob passes.
    expect(packages).toContain("cli");
    expect(packages).toContain("mcp");
    expect(packages).toContain("vscode");

    const findings: string[] = [];
    let scanned = 0;
    for (const pkg of packages) {
      const src = join(packagesDir, pkg, "src");
      let files: string[];
      try {
        files = sourceFiles(src);
      } catch {
        continue; // a package with no src directory
      }
      for (const file of files) {
        scanned++;
        for (const f of keyReads(readCode(file))) {
          findings.push(`${relative(packagesDir, file)}: ${f}`);
        }
      }
    }

    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});
