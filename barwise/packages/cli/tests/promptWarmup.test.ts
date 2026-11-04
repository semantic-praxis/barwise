/**
 * Every test file that runs the `prompt` command warms it first, at top
 * level (`warmPromptCommand` in tests/workspace/run.ts, barwise-xlw). A
 * file that forgets pays the command's first import inside a test, under
 * the 30s default, which is the timeout this exists to prevent; and the
 * omission is silent until a loaded pre-push run. The call must be at top
 * level because inside a `describe` its hook covers only that block, and a
 * prompt test outside it would pay the import. Files that load every
 * command load it too without naming it, so this check cannot see them:
 * cli.test.ts, commandRouting.test.ts and
 * docs/gettingStartedDocs.test.ts. barwise-xlw holds the general fix.
 * The check is textual, and asks only for the one form the helper is
 * called in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));

function testFiles(): { name: string; text: string; }[] {
  return readdirSync(testsDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => ({ name: f, text: readFileSync(join(testsDir, f), "utf8") }));
}

describe("prompt command warm-up", () => {
  it("is called at top level by every test file that runs the prompt command", () => {
    // An argument list that starts with "prompt", passed straight to runCli
    // or kept in a table of commands, as apiKeyFlag.test.ts does.
    const callers = testFiles().filter((f) => /\[\s*"prompt"\s*[,\]]/.test(f.text));
    expect(callers.length).toBeGreaterThanOrEqual(4);
    const unwarmed = callers.filter((f) => !/^warmPromptCommand\(\);/m.test(f.text));
    expect(unwarmed.map((f) => f.name)).toEqual([]);
  });
});
