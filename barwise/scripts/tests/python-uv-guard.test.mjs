/**
 * The agent-shell hook refuses what check:python-uv refuses, before the
 * command runs (agent-python-uv-hook.spec.md). Driven as Claude Code
 * drives it: JSON on stdin, the verdict in the exit code.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "python-uv-guard.mjs");

function run(input) {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });
}
const bash = (command) => run({ tool_name: "Bash", tool_input: { command } });

const REFUSED = [
  [
    "the heredoc that ran twice (barwise-1060)",
    "python3 - <<'EOF'\nprint(1)\nEOF",
    /bare `python3`/,
  ],
  ["a bare interpreter after &&", "cd barwise && python -c 'print(1)'", /bare `python`/],
  ["a bare interpreter in $( )", "x=$(python3 -V)", /bare `python3`/],
  ["pip", "pip install sqlglot", /bare `pip`/],
  ["a wrapped interpreter", "timeout 60 python3 script.py", /bare `python3`/],
  ["an env-assigned interpreter", "PYTHONPATH=. python3 x.py", /bare `python3`/],
  ["uv run with no lock flag", "uv run python -V", /neither --frozen nor --locked/],
  ["uv run --with", "uv run --frozen --with sqlglot python -V", /--with/],
  ["uv pip", "uv pip install x", /`uv pip`/],
  ["uvx", "uvx ruff check", /uvx/],
  ["a second line", "echo ok\npython3 x.py", /line 2: bare `python3`/],
];
for (const [name, command, reason] of REFUSED) {
  test(`refuses ${name}`, () => {
    const r = bash(command);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, reason);
    assert.match(r.stderr, /uv run --frozen/);
  });
}

const ALLOWED = [
  ["uv run --frozen", "uv run --frozen --only-group sqlglot python -c 'print(1)'"],
  ["uv sync --locked", "uv sync --locked"],
  ["a quoted mention", 'grep -rn "python3" scripts'],
  ["a word that only contains the name", "cat .python-version && ls python-lib"],
  ["an ordinary command", "npm run build && git status"],
  // The hook refused its own commit: the message was blanked line by line.
  [
    "a multi-line quoted commit message",
    'git commit -m "Refuse bare interpreters\n\nuvx, uv pip and\n(timeout 60 python3) are refused"',
  ],
];
for (const [name, command] of ALLOWED) {
  test(`allows ${name}`, () => {
    const r = bash(command);
    assert.equal(r.status, 0, r.stderr);
  });
}

test("input it cannot read is reported without blocking: exit 1, not 0 or 2", () => {
  for (const input of ["not json", JSON.stringify({ tool_input: {} })]) {
    const r = run(input);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not read/);
  }
});
