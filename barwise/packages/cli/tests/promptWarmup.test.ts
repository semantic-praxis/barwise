/**
 * Every test file under tests/commands that runs the `prompt` command
 * warms it first
 * (`warmPromptCommand` in tests/workspace/run.ts, barwise-xlw). A file that
 * forgets pays the command's first import inside a test, under the 30s
 * default, which is the timeout this exists to prevent; and the omission is
 * silent until a loaded pre-push run. Files that register every command
 * (cli.test.ts, commandRouting.test.ts) load it too and are not covered
 * here; barwise-xlw holds the general fix.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const commandsDir = join(dirname(fileURLToPath(import.meta.url)), "commands");

describe("prompt command warm-up", () => {
  it("is called by every command test file that runs the prompt command", () => {
    const callers = readdirSync(commandsDir)
      .filter((f) => f.endsWith(".test.ts"))
      // An argument list that starts with "prompt", passed straight to runCli
      // or kept in a table of commands, as apiKeyFlag.test.ts does.
      .filter((f) => /\[\s*"prompt"\s*[,\]]/.test(readFileSync(join(commandsDir, f), "utf8")));
    expect(callers.length).toBeGreaterThanOrEqual(4);
    const unwarmed = callers.filter((f) =>
      !/^\s*warmPromptCommand\(\);/m.test(readFileSync(join(commandsDir, f), "utf8"))
    );
    expect(unwarmed).toEqual([]);
  });
});
