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

/** Each finding as `file: form`, so a failure names what to look at. */
function keyReads(code: string): string[] {
  const found: string[] = [];

  // process.env.X
  for (const m of code.matchAll(/process\.env\.([A-Za-z_$][\w$]*)/g)) {
    if (CREDENTIAL.test(m[1]!)) found.push(`process.env.${m[1]}`);
  }

  // process.env["X"], and any index that is not a plain string literal
  for (const m of code.matchAll(/process\.env\s*\[\s*([^\]]*)\]/g)) {
    const index = m[1]!.trim();
    const literal = /^(["'])([^"'`]*)\1$/.exec(index) ?? /^`([^`$]*)`$/.exec(index);
    if (literal === null) {
      found.push(`process.env[${index}] (computed)`);
      continue;
    }
    const name = literal[2] ?? literal[1]!;
    if (CREDENTIAL.test(name)) found.push(`process.env[${index}]`);
  }

  // const { X } = process.env
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().replace(/^\.\.\./, "").split(/[:=]/)[0]!.trim();
      if (name !== "" && CREDENTIAL.test(name)) found.push(`{ ${name} } = process.env`);
    }
  }

  // env.X after `import { env } from "node:process"` (or `env as e`)
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?process["']/g)) {
    for (const part of m[1]!.split(",")) {
      const spec = /^\s*env(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (spec === null) continue;
      const local = spec[1] ?? "env";
      const dotted = new RegExp(`(?<![\\w$.])${local}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const r of code.matchAll(dotted)) {
        if (CREDENTIAL.test(r[1]!)) found.push(`${local}.${r[1]} (from node:process)`);
      }
      const indexed = new RegExp(`(?<![\\w$.])${local}\\s*\\[\\s*([^\\]]*)\\]`, "g");
      for (const r of code.matchAll(indexed)) {
        const index = r[1]!.trim();
        const literal = /^(["'])([^"'`]*)\1$/.exec(index);
        if (literal === null || CREDENTIAL.test(literal[2]!)) {
          found.push(`${local}[${index}] (from node:process)`);
        }
      }
    }
  }

  return found;
}

describe("model keys are read from the environment only inside @barwise/llm", () => {
  it("the detector sees every form it is meant to (self-check)", () => {
    // Without this, a regex that matched nothing would pass the tree scan
    // below for the wrong reason.
    expect(keyReads(`const k = process.env.ANTHROPIC_API_KEY;`)).toHaveLength(1);
    expect(keyReads(`const k = process.env["OPENAI_API_KEY"];`)).toHaveLength(1);
    expect(keyReads(`const k = process.env[name];`)).toHaveLength(1);
    expect(keyReads(`const { GH_TOKEN, HOME } = process.env;`)).toEqual([
      "{ GH_TOKEN } = process.env",
    ]);
    expect(keyReads(`import { env } from "node:process";\nenv.MY_SECRET;`)).toHaveLength(1);
    expect(keyReads(`const h = process.env["HOME"]; const x = process.env.XDG_STATE_HOME;`))
      .toEqual([]);
  });

  it("no package's src outside packages/llm reads a KEY, TOKEN or SECRET variable or indexes process.env by a computed name [adr:keyless-model-access#measurement-key]", () => {
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
