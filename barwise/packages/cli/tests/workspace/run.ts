/**
 * Test helper for invoking the CLI program and capturing output.
 *
 * Creates a Commander program via createProgram(), overrides stdout
 * and stderr writes, and invokes parseAsync with the given args. The
 * program is built the way the bin entry builds it -- only the command the
 * arguments name, or every command when they name none -- so each command
 * test runs the command as production loads it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll } from "vitest";
import { commandNameIn, createProgram } from "../../src/cli.js";

// Mirror the bin entry: supply the real version so `--version` tests see
// it (createProgram itself no longer reads package.json).
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string; };

/**
 * Load the `prompt` command in a `beforeAll`, so no test pays for it. The
 * first call into it imports the command and its dependencies (promptlab,
 * llm) through vitest's transform: the first test of prompt.test.ts took
 * about 4.2s alone under coverage, and 35-38s in the pre-push coverage gate,
 * which runs every package's suite at once on a 4-core machine. That
 * exceeded the 30s test default on four pushes of
 * semantic-praxis/barwise#689. In the hook the load gets its own limit and
 * the tests keep the default, so a hung test still fails in 30s; with the
 * hook that first test takes about 1.2s alone. Only the import is warmed:
 * work an action does on each call, such as loading the eval suite, stays
 * in the test. Every test file under tests/commands that runs `prompt`
 * calls this once (tests/promptWarmup.test.ts checks). Why the import costs
 * what it does is barwise-xlw.
 */
export function warmPromptCommand(): void {
  beforeAll(async () => {
    // createProgram rather than runCli: runCli turns any throw into exit 1,
    // so a failed import would reach here without its message.
    const program = await createProgram(version, "prompt");
    if (!program.commands.some((c) => c.name() === "prompt")) {
      throw new Error('createProgram(version, "prompt") registered no prompt command.');
    }
  }, 120_000);
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Run the CLI with the given arguments and capture output.
 *
 * @param args - CLI arguments (without "node" and script name)
 */
export async function runCli(args: string[]): Promise<RunResult> {
  let stdout = "";
  let stderr = "";

  // Save originals.
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;

  // Reset exit code.
  process.exitCode = 0;

  // Intercept writes.
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    const program = await createProgram(version, commandNameIn(args));
    // Prevent Commander from calling process.exit on errors.
    program.exitOverride();
    await program.parseAsync(["node", "barwise", ...args]);
  } catch (err) {
    // Commander throws on exitOverride -- capture the code.
    const exitErr = err as { exitCode?: number; code?: string; };
    if (
      exitErr.code === "commander.helpDisplayed"
      || exitErr.code === "commander.version"
    ) {
      // Help and version are not errors.
    } else if (exitErr.exitCode !== undefined) {
      process.exitCode = exitErr.exitCode;
    } else {
      process.exitCode = 1;
    }
  } finally {
    // Restore originals.
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  const exitCode = process.exitCode ?? 0;
  process.exitCode = originalExitCode;

  return { stdout, stderr, exitCode };
}
