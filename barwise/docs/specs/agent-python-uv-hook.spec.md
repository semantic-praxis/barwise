# Agent shell commands run Python only through uv

Status: Implemented 2026-09-26 -- the single workstream

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1060

The repo's rule is that every Python execution resolves from the lockfile:
`uv run --frozen ...`, never a bare `python3`, `python` or `pip`, and never
`--with`, `--isolated`, `uv pip` or `uvx`. `npm run check:python-uv`
enforces that on tracked files. Nothing enforces it on the commands an
agent runs in its own shell. Twice on 2026-09-26 an agent command of the
form `python3 - <<EOF ... || node -e ...` ran a bare interpreter; both
times it was harmless only by luck (the second time an edit silently did
not happen). After this change, a Claude Code agent command that would
run Python outside uv is refused before it runs, with the uv form to use
instead.

## Principle

**A copy that must agree is never guarded by a comment.** The rule
already exists as code in `check-python-uv.mjs`. The hook must refuse
exactly what the gate refuses, so the matching moves into one module
both call, rather than being written a second time.

## Requirements

- **R1.** A `PreToolUse` hook on the `Bash` tool shall refuse (exit 2,
  reason on stderr) a command that, on any line, runs a bare `python3`,
  `python`, `pip` or `pip3` in command position; runs `uvx` or `uv tool
  run`; runs `uv pip`; passes `--with`, `--with-requirements`,
  `--isolated` or `--no-project` to `uv run` or `uv sync`; or runs
  `uv run` or `uv sync` with neither `--frozen` nor `--locked`. Each
  command on a line is judged on its own flags, and a `#` comment is not
  part of any command.
- **R2.** Command position includes the start of a line, after `;`,
  `&&`, `||`, `|`, `(` or `$(`, after environment assignments, and after
  the wrappers `env`, `exec`, `time`, `nohup`, `nice` and `timeout`,
  each with its own options and operands (`env -i FOO=1`, `nice -n 5`,
  `timeout -s KILL 60`).
- **R3.** The matching rules shall live in one module,
  `scripts/lib/python-uv-rules.mjs`, used by both the hook and
  `check-python-uv.mjs`.
- **R4.** Text inside quotes is not matched, as in the gate: `grep
  "python3" file` and `echo "uv sync"` pass.
- **R5.** When the hook cannot read its input (no JSON, no command), it
  shall exit 1 and say so. Claude Code shows exit 1 to the user without
  blocking the command. Exit 2 would block every command on a harness
  change. Exit 0 would read as a pass.
- **R6.** The hook shall refuse a `uv run` or `uv sync` that would run
  outside `barwise/`, following `cd` from the working directory in its
  input, unless it passes `--project` or `--directory` naming
  `barwise/`. uv finds `pyproject.toml` by walking up from the working
  directory, so from the repository root or `/tmp` `--frozen` resolves
  nothing and exits 0 (root CLAUDE.md). A `cd` the hook cannot resolve
  (a variable other than `$CLAUDE_PROJECT_DIR` or `$HOME`) makes the
  directory unknown, which needs `--project`. R6 is the hook's alone: a
  tracked script's working directory is set by whoever calls it.
- **R7.** A heredoc body is not read as commands. It is data on a
  command's stdin, and the interpreter that reads it is on the `<<` line.

## Scope

In: the shared rules module, the hook script
`scripts/hooks/python-uv-guard.mjs`, its registration in
`.claude/settings.json`, and the gate's switch to the shared module.
Out: other agents' shells and hand-typed commands. The gate still
covers anything that lands in a tracked file.

## Workstream (single)

Extract the rules, point the gate at them (its tests must pass
unchanged), add the hook and its tests, register it.

## Risks and testing

- **Misses from R7.** `bash <<EOF` runs its body as shell, and a
  `python3` in that body is not seen. That is rarer than the false
  refusals R7 removes, and the gate still reads any such script once it
  is tracked.
- **Misses.** `bash -c "python3 ..."`, an interpreter held in a
  variable, and a backtick substitution are not seen. These are the gate's
  existing blind spots, stated in its header.
- **R2 widens the gate.** The wrappers apply to tracked files too. Run
  the gate over the repo before landing. A new finding there is a real
  violation to fix, not a reason to narrow R2.
- Tests: each R1 form refused, the uv forms and quoted mentions allowed,
  and unreadable input exits 1. The existing `gates.test.mjs` cases for
  the gate must pass unchanged.

## Open decisions

None.

## Implementation notes

- The first version refused its own commit. Quotes were blanked one line
  at a time, so the prose of a multi-line `git commit -m "..."` was read
  as commands ("uvx, uv pip", "timeout 60 python3"). The hook now blanks
  quotes over the whole command before splitting it into lines, with a
  test for that case. The gate still reads its files line by line, which
  is unchanged.
- The PR #575 review found three bypasses: a wrapper's own options
  (`env FOO=1 python3`), a lock flag belonging to another command on
  the line (`uv run python -V && echo --frozen`), and a frozen run
  outside the project (`cd /tmp && uv run --frozen ...`). They became the
  second half of R1, the options in R2, and R6, each with a test.
- The hook then refused an agent's own `node - <<'EOF'` edit, because a
  regex in the script read `(?:run|sync|pip)`. A body apostrophe also
  paired with a quote lines later. Both became R7.
