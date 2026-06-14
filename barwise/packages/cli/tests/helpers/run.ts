/**
 * Test helper for invoking the CLI program and capturing output.
 *
 * Creates a Commander program via createProgram(), overrides stdout
 * and stderr writes, and invokes parseAsync with the given args.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProgram } from "../../src/cli.js";

// Mirror the bin entry: supply the real version so `--version` tests see
// it (createProgram itself no longer reads package.json).
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string; };

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
    const program = createProgram(version);
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
