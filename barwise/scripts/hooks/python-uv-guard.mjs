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
 * One rule is the hook's alone: where a `uv run` runs. `--frozen` means
 * nothing unless uv discovers barwise's pyproject.toml, which it finds by
 * walking UP from the working directory -- from the repo root or /tmp it
 * finds none, runs a bare uv-managed interpreter, and exits 0 (root
 * CLAUDE.md). A tracked script's working directory is its caller's
 * business; an agent's is in the hook's input, so it is checked here.
 *
 * Exit codes follow Claude Code's hook contract, not the repo's gate
 * contract: 0 lets the command run, 2 blocks it and hands stderr to the
 * agent, and anything else is shown to the user without blocking. That
 * last one is this hook's "could not answer": blocking every command on
 * a harness change would be worse than missing one.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blankQuoted,
  commandSegments,
  logicalLines,
  shellCommandFindings,
  UV_RUN,
  withoutHeredocBodies,
} from "../lib/python-uv-rules.mjs";

/** The directory holding barwise's pyproject.toml and uv.lock. */
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Falls through to the refusal below.
}
const command = input?.tool_input?.command;
if (typeof command !== "string") {
  console.error("python-uv-guard: could not read tool_input.command from stdin; not checked.");
  process.exit(1);
}

/** A literal path with `$CLAUDE_PROJECT_DIR`, `$HOME` and `~` expanded, or null. */
function literalPath(word, from) {
  if (from === null) return null;
  const expanded = word
    .replace(/^["']|["']$/g, "")
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$\{?(CLAUDE_PROJECT_DIR|HOME)\}?/g, (_, v) => process.env[v] ?? "\0");
  if (/[$`\0]/.test(expanded)) return null;
  return isAbsolute(expanded) ? expanded : resolve(from, expanded);
}

const inProject = (dir) => dir === PROJECT || dir?.startsWith(PROJECT + sep);

/**
 * `uv run`/`uv sync` commands that would run outside barwise/. `cd` is
 * followed through the command; one it cannot resolve (a variable, a
 * substitution) makes the directory unknown, and an unknown directory
 * needs an explicit `--project`.
 */
function unscopedUv() {
  const out = [];
  let dir = typeof input.cwd === "string" ? input.cwd : null;
  const raw = withoutHeredocBodies(command).split("\n");
  for (const { line, text } of logicalLines(blankQuoted(withoutHeredocBodies(command)))) {
    const rawLine = raw[line - 1];
    for (const seg of commandSegments(text)) {
      const words = rawLine.slice(seg.start, seg.start + seg.text.length).trim()
        .replace(/^[({]\s*/, "").split(/\s+/);
      if (words[0] === "cd") {
        dir = words[1] ? literalPath(words[1], dir) : homedir();
        continue;
      }
      if (!UV_RUN.test(seg.text)) continue;
      const flag = words.findIndex((w) => /^--(project|directory)(=|$)/.test(w));
      const target = flag < 0
        ? dir
        : literalPath(words[flag].includes("=") ? words[flag].split("=")[1] : words[flag + 1], dir);
      if (flag < 0 ? !inProject(target) : target !== PROJECT) {
        out.push({
          line,
          what: `\`uv run\`/\`uv sync\` outside barwise/ (${target ?? "an unresolved directory"}): `
            + "uv finds no pyproject.toml there, so --frozen resolves nothing",
          raw: rawLine,
        });
      }
    }
  }
  return out;
}

const findings = [...shellCommandFindings(command), ...unscopedUv()];
if (findings.length === 0) process.exit(0);

console.error("Refused: this command runs Python outside the project lockfile.\n");
for (const f of findings) {
  console.error(`  line ${f.line}: ${f.what}\n      ${f.raw.trim().slice(0, 110)}`);
}
console.error(
  "\nRun Python as `uv run --frozen [--only-group <group>] python ...` from inside\n"
    + `barwise/, or pass --project ${join("$CLAUDE_PROJECT_DIR", "barwise")}. For a one-off,\n`
    + "put the script in the repo and run it that way. To edit a file, use node or the\n"
    + "Edit tool instead.",
);
process.exit(2);
