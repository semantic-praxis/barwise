#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for the Bash tool: refuse a command that
 * runs Python outside the lockfile, before it runs
 * (agent-python-uv-hook.spec.md, barwise-1060).
 *
 * `check:python-uv` already refuses these forms in tracked files; an
 * agent's own shell commands were unchecked, and twice on 2026-09-26 a
 * `python3 - <<EOF` ran. The rules are the gate's, from the shared
 * module, so the two cannot disagree.
 *
 * Exit codes follow Claude Code's hook contract, not the repo's gate
 * contract: 0 lets the command run, 2 blocks it and hands stderr to the
 * agent, and anything else is shown to the user without blocking. That
 * last one is this hook's "could not answer": blocking every command on
 * a harness change would be worse than missing one.
 */
import { readFileSync } from "node:fs";
import { shellCommandFindings } from "../lib/python-uv-rules.mjs";

let command;
try {
  command = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command;
} catch {
  // Falls through to the refusal below.
}
if (typeof command !== "string") {
  console.error("python-uv-guard: could not read tool_input.command from stdin; not checked.");
  process.exit(1);
}

const findings = shellCommandFindings(command);
if (findings.length === 0) process.exit(0);

console.error("Refused: this command runs Python outside the project lockfile.\n");
for (const f of findings) {
  console.error(`  line ${f.line}: ${f.what}\n      ${f.raw.trim().slice(0, 110)}`);
}
console.error(
  "\nRun Python as `uv run --frozen [--only-group <group>] python ...` from inside\n"
    + "barwise/ (see the root CLAUDE.md). For a one-off, put the script in the repo\n"
    + "and run it that way. To edit a file, use node or the Edit tool instead.",
);
process.exit(2);
