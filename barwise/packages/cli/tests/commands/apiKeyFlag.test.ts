/**
 * `--api-key` is refused, on every command, before any body sees it.
 *
 * A credential in argv reaches shell history, CI logs and
 * `/proc/<pid>/cmdline`, and cannot be withdrawn from any of them. Two
 * documents have warned against passing it since August while the flag kept
 * accepting one, which is the shape CLAUDE.md's rule names: a finding is
 * closed by a check or a fix, not by a document
 * (docs/specs/keyless-model-access.spec.md, barwise-1031).
 *
 * Run through `runCli` in process, like every other command test -- a
 * subprocess is not instrumented by the parent's coverage collector.
 */
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

// Assembled, not a literal: `check:secrets` scans this repository's history
// including this file, so a realistic key shape here would make that gate
// fail on its own test.
const KEY = "sk-ant-" + "api03-" + "7Kq2Vx9mTwRbN4yLp" + "Z3jHcF8sAdE6gUn1oIxBvCz";

/**
 * One case per command that declares the flag, because the refusal lives on
 * the ROOT program and "it works on the one I tried" is not the claim. The
 * two `prompt` subcommands are both covered: they are separate declarations.
 */
const COMMANDS: ReadonlyArray<readonly string[]> = [
  ["import", "transcript", "/dev/null"],
  // `--model` is a REQUIRED option here, and commander validates required
  // arguments and options BEFORE preAction hooks run. Each invocation
  // therefore has to be otherwise well-formed, or the refusal is preempted
  // by the other error -- see the ordering test below, which pins that the
  // key is still never used in that case.
  ["import", "batch", "/dev/null", "--model", "claude-haiku-4-5"],
  ["review", "/dev/null"],
  ["prompt", "eval"],
  ["prompt", "run", "/dev/null"],
];

describe("--api-key is refused", () => {
  for (const argv of COMMANDS) {
    it(`refuses it on \`${argv.join(" ")}\``, async () => {
      const r = await runCli([...argv, "--api-key", KEY]);

      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/--api-key was removed/);
      // The replacement has to be named, or a user with a working script
      // learns only that it broke.
      expect(r.stderr).toMatch(/ANTHROPIC_API_KEY/);

      // The refusal must not echo the credential it refused -- stderr goes
      // to CI logs, which is one of the three places the flag was removed
      // for reaching.
      expect(r.stderr).not.toContain(KEY);
      expect(r.stdout).not.toContain(KEY);
    });
  }

  it("says to rotate, because argv exposure is not undone by stopping", async () => {
    const r = await runCli(["review", "/dev/null", "--api-key", KEY]);
    expect(r.stderr).toMatch(/rotate/i);
  });

  it("refuses an empty value too: supplying the flag at all is the hazard", async () => {
    // `--api-key ""` is still a flag in argv. Commander gives the option an
    // empty string rather than `undefined`, and the guard tests for
    // `undefined` precisely so this case is refused rather than waved past.
    const r = await runCli(["review", "/dev/null", "--api-key", ""]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/--api-key was removed/);
  });

  it("does not use the key even when another error preempts the refusal", async () => {
    // Commander validates required arguments and options before preAction
    // hooks, so a malformed invocation reports that instead. The refusal not
    // firing is fine; the key reaching a command body would not be. Neither
    // the value nor a completed action may result.
    const r = await runCli(["import", "batch", "/dev/null", "--api-key", KEY]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/required option/);
    expect(r.stderr).not.toContain(KEY);
    expect(r.stdout).not.toContain(KEY);
  });

  it("does not fire when the flag is absent", async () => {
    // The guard must not refuse every command in the CLI. `--help` exits
    // through commander without running an action, so use a real command
    // whose failure mode is its own: a missing file, not a refused flag.
    const r = await runCli(["review", "/definitely/not/a/model.orm.yaml"]);
    expect(r.stderr).not.toMatch(/--api-key was removed/);
  });
});
