# A failure the command's status hid is reported anyway

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/exit-recorder.cjs,
+barwise/scripts/hooks/masked-exit.mjs, +barwise/scripts/lib/exit-log.mjs,
+barwise/scripts/tests/masked-exit.test.mjs,
barwise/scripts/tests/expected-counts.json, barwise/test-plan/cli-checks.sh,
.claude/settings.json, CLAUDE.md

In one sentence: each node process an agent's Bash command starts
directly records its own exit code, and when the call exits 0 while one
of those processes failed, a PostToolUse hook tells the agent which one
-- so a red gate behind a pipe or a later command no longer reads green.

## Principle

A gate that cannot report its own failure reads the same as one that
passed. The repo's contract says so for the gates themselves (exit 2 for
"could not answer", `gate-refusal-contract.spec.md`); this is the same
failure one layer out, at the call site. A Bash command reports its last
command's status, so `npm run test:scripts | tail -2` reports `tail`'s,
and so does `npm run test:scripts > log; tail log`.

It is not hypothetical. barwise-906 names it as trap (b), from its
instance (2): the pre-push hook's status read as `PIPESTATUS[0]` of
`echo | sh hook | tail`, which is `echo`'s. On 2026-10-23 it happened
twice more in one session (barwise-40a): `mutate.mjs ... | tail -1; echo
$?` printed 0 while mutate had refused with exit 2, and `npm run
test:scripts | tail -2; echo $?` printed 0 with a test failing. Both were
caught only because the printed text disagreed with the status. Writing
the trap down did not stop it, so the fix is a mechanism.

The property is "a gate's failure reaches the reader". The first three
drafts of this spec checked a shadow of it, the shape of the command
line, and each plan review (`/code-review`, 2026-10-23) found shapes
bash allows that the rule got wrong: `2>&1` read as a separator, quoted
script paths blanked, `gate > log; tail log`, `|| true`, a backgrounded
gate, `|&`, `pipefail` followed by another command, `s=$?` never
raised, a `PIPESTATUS` index naming the wrong stage, launchers the
matcher did not know. That is CLAUDE.md's "shadow and the property" at
small scale. This design reads the property: the exit codes themselves.

## Which processes count? (resolved: the first node process in each chain consumes the variable)

`NODE_OPTIONS=--require=<recorder>` loads a recorder into every node
process a Bash command starts. The recorder records only when
`BARWISE_EXIT_LOG` is set, and it **deletes that variable from its own
environment** before anything else runs, so no process it starts can
record. Each command the shell starts directly sees the variable; every
descendant of a node process does not. So:

- `npm run test:scripts | tail` records npm, whose code is the script's;
  the node processes npm starts see no variable.
- `timeout -s KILL 600 npm test`, `CI=1 npx vitest run`, `bash -c 'npm
  test'`, `(cd pkg && npx vitest run)`, `node .../at-root.mjs
  test:scripts`: no wrapper is node, so the first node process records,
  however the command is spelled. Nothing parses the command.
- `git push` runs `.husky/pre-push`, which runs `npm run ci:local`: npm
  records. `echo | sh .husky/pre-push | tail` likewise.
- `turbo run test` is reached through `npm` or `npx`, which consumed the
  variable, and turbo's strict environment mode drops unknown variables
  anyway (measured with turbo 2.11.3: it passes `NODE_OPTIONS` and drops
  `BARWISE_*`), so its tasks load the recorder and record nothing.
- A test suite that spawns gates on purpose (`gates.test.mjs` runs
  hundreds expecting exit 1 and 2) is itself a node process: its
  children see no variable.

A prototype on 2026-10-23 confirmed the mechanism: `npm run bad | tail
-1` recorded npm with code 1 and nothing for its child; `timeout`, a
subshell and an uncaught throw each recorded their real code.

The recorder never writes to stdout or stderr and never changes an exit
code; if it cannot append, it does nothing. It records the exit code,
the time, and a short label: the basename of the script or tool
(`argv[1]`), `-e` for an inline script, and for npm and npx the
subcommand and script name. Never the full argv: argv is where a
credential typed on a command line sits (root CLAUDE.md, "A key has
nowhere to be written down"). Files are created 0600 in a 0700
directory.

## Which call does a process belong to? (resolved: entries since the call began, each reported once)

The environment cannot carry a per-call id. Measured in this session on
2026-10-23: the SessionStart env file is read once, when the session
starts, and its text is inlined into every command's shell line, so a
line appended later never runs, and a dynamic line would make every Bash
call depend on that line not failing. So the environment carries only
static values, `NODE_OPTIONS` and one session log path in
`BARWISE_EXIT_LOG`, written as plain `export NAME="value"` lines, the
form `.claude/hooks/session-start.sh` already uses for `PATH`.

Attribution lives in the hooks, which do know the call:

1. **PreToolUse** on Bash records the call's start: `tool_use_id` and the
   time, in the session directory.
2. **PostToolUse** (the call exited 0) reads the log from the offset where
   the last read stopped, keeps the entries at or after its call's start,
   reports the non-zero ones, and advances the offset past everything it
   read.
3. **PostToolUseFailure** (the call exited non-zero, so its status was
   visible) advances the offset the same way and reports nothing, so a
   failure the agent already saw is never reported later.

Each entry is reported at most once, and each read costs only what was
appended since the last. A process that outlives its call (a
backgrounded `npm run ci:local | tail &`) is reported by the first call
that ends after it exits, with its own time on the line: the masked
background case, which matters most. Two Bash calls running at the same
time can claim each other's entries; the report names the process and
its time, so a misattribution is visible, not silent. That is the one
remaining attribution gap, and it is declared.

## When does the hook speak? (resolved: only when the call exited 0)

Claude Code runs PostToolUse only when a tool completes successfully; a
Bash command that exits non-zero goes to PostToolUseFailure (hooks
reference, code.claude.com/docs/en/hooks; the non-zero case is shown by
example, carrying `Exit code 1`). So in PostToolUse, a recorded non-zero
exit is a failure the call's status did not carry. The hook exits 2 with
stderr, the documented way to put a warning in front of the model:

```
This command exited 0, but processes it started exited non-zero:
  npm run test:scripts   exit 1   22:41:07
  mutate.mjs             exit 2   22:41:09
If you printed or handled that status, ignore this; otherwise the
command's status was hidden (a pipe, or a later command).
```

It does not suggest `exit $s`: a non-zero result cancels the parallel
tool calls beside it, which a reader may not want.

**This repeats statuses an agent printed on purpose.** `npm run lint >
log; echo "exit=$?"` with lint failing prints `exit=1` and still gets
the report. The cost is one redundant notice, only when something
failed, which is when attention is warranted; telling "printed" from
"hidden" would mean reading the output, the text-matching this design
replaced. Probes that fail by design (`beads-crud show X || create ...`)
are reported too, for the same reason; a script that runs expected
failures as its job declares the opt-out below.

## Scope

In scope:

- When a session starts, the SessionStart hook shall copy the recorder to
  the session directory outside the repository (so checking out a commit
  without it, or stashing it, cannot break every node command), and
  append to `$CLAUDE_ENV_FILE`, each only if not already present, two
  static lines: `export NODE_OPTIONS="--require=<copy>"`, keeping any
  value `NODE_OPTIONS` had when the hook ran, and `export
  BARWISE_EXIT_LOG="<session dir>/exits.jsonl"`. If the copy fails, it
  writes neither line.
- When a node process starts with `BARWISE_EXIT_LOG` set, the recorder
  shall delete it from its environment and append its exit code, time
  and label to that file on exit.
- When a Bash call exits 0 and the log holds an unreported non-zero entry
  from at or after the call's start, the PostToolUse hook shall exit 2
  and name each such process, its code and its time.
- When it finds none, it shall exit 0 silently.
- When a Bash call exits non-zero, the PostToolUseFailure hook shall mark
  the entries up to now as read, and say nothing.
- When the session directory or the recorder copy is absent, the recorder
  was not set up, and the PostToolUse hook shall say so once per session
  (exit 1, shown to the user, not the model), so "not armed" never reads
  as "nothing failed".
- When a script runs node processes that fail by design and checks them
  itself, it shall `unset BARWISE_EXIT_LOG` at its top: a declared
  opt-out. Today that is `test-plan/cli-checks.sh`, which asserts the
  CLI's exit codes.

Out of scope, each named so the gap is visible:

- **Gates that are not node processes**: `scripts/check-beads.sh` and the
  other pure-bash scripts, `pytest` through `uv run`, `gitleaks`,
  `shellcheck`. A `BASH_ENV` recorder could cover bash scripts the same
  way; it is a follow-up, because the Bash tool's own shell is bash too
  and telling the two apart is its own design.
- **A gate killed by a signal** (no `exit` event).
- **Two Bash calls running at the same time** (the attribution gap above).

## Inventory

| Path                                      | Today                                  | After                                                                      |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `barwise/scripts/hooks/exit-recorder.cjs` | Does not exist                         | The `--require` preload: consume the variable, append on exit, never throw |
| `barwise/scripts/lib/exit-log.mjs`        | Does not exist                         | Session directory, call starts, the read offset: one home                  |
| `barwise/scripts/hooks/masked-exit.mjs`   | Does not exist                         | `session`, `pre`, `post` and `failure` modes for the four hook events      |
| `barwise/test-plan/cli-checks.sh`         | Asserts the CLI's exit codes           | Also `unset BARWISE_EXIT_LOG` (the declared opt-out)                       |
| `.claude/settings.json`                   | SessionStart and PreToolUse hooks      | Plus SessionStart, PreToolUse, PostToolUse and PostToolUseFailure entries  |
| `CLAUDE.md`                               | Monorepo Commands names the pgrep trap | One sentence beside it: what the report means                              |

One script with four modes rather than four scripts: the modes share
every path rule, and one `exit-log.mjs` behind one entry point keeps the
layout in one place. The recorder is separate because `--require` loads
CommonJS and it must stay one `fs` call per node start; it reads its path
from the variable rather than computing it, so the path rule is not
written twice.

The session directory is `os.tmpdir()/barwise-exit/<session_id>/`:
outside the repository, never committed, removed with the container.
The existing `.claude/hooks/session-start.sh` is not used because it
runs only in remote sessions; this applies locally too. Its
`persist_env` helper's rule (append a line only if not already present,
barwise-1035) is the rule the new SessionStart mode follows.

## Alternatives considered

- **Refuse commands whose shape masks a status** (the first three
  drafts). Each review round found shapes the rule got wrong; parsing
  bash to predict an exit code is the shadow, recording it the property.
- **A depth counter** for "started directly" (the fourth draft). Turbo
  strips it and passes `NODE_OPTIONS`; consuming one variable has no
  counter to strip.
- **Windows from `duration_ms`** (the fourth draft). Clipped fast
  processes, because `duration_ms` excludes hook latency.
- **A per-call id exported from the env file** (the fifth draft). The
  file is read once at session start, so the id would never change;
  measured.
- **Make every gate print its status on its last line.** Edits every
  gate, the line is cut by `tail` or `grep`, and it moves the reading
  back into text.
- **A PreToolUse hook that adds `set -o pipefail`.** Pipes only.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down; the owner chose a mechanism on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The recorder and the report

The new files, the settings entries, the cli-checks opt-out and the
CLAUDE.md sentence, in one PR. The test drives the hooks as Claude Code
does (JSON on stdin) and the recorder as the shell does (real processes
with `NODE_OPTIONS` and `BARWISE_EXIT_LOG` set). Each rule is watched
failing with it removed:

- the recorded commands, run for real under the recorder: `node -e
  'process.exit(2)' | tail -1; echo $?` (the mutate shape), an `npm run`
  of a fixture script that exits 1 piped to `tail` (the test:scripts
  shape), and `echo | sh <fixture hook running npm> | tail; echo
  ${PIPESTATUS[0]}` (barwise-906), each produce a report naming the
  process and its code;
- `gate > log; tail log` and `gate || true` produce a report too;
- a node process started by a node process records nothing;
- `unset BARWISE_EXIT_LOG` records nothing;
- a process exiting after its call ended is reported by the next call
  that ends, once, with its time;
- an entry before the call's start is not reported;
- after a PostToolUseFailure, the failure it saw is never reported;
- no non-zero entry: exit 0, no output;
- no session directory: exit 1 once per session;
- the recorder with an unwritable or absent log leaves the observed
  process's output and exit code unchanged, and records no argv beyond
  the label;
- the SessionStart mode keeps an existing `NODE_OPTIONS`, writes each
  line once across repeated starts (resume, clear and compact all fire
  SessionStart), writes nothing when the copy fails, and works with a
  space in the path;
- the PR body measures the recorder's cost per node start.

## Open decisions (for review)

None. The owner chose a mechanism on 2026-10-23.

## Risks and testing

- **`NODE_OPTIONS` reaches every node process in the session.** A tool
  that rejects `--require` in `NODE_OPTIONS` (Electron, under
  `vscode-test`) would fail to start; if the integration suite does, it
  gets a declared opt-out in the PR that finds it.
- **The premise rests on the harness.** If Claude Code ever ran
  PostToolUse for non-zero Bash exits, the report would repeat what the
  status already showed: redundant, not wrong.
- **Settings take effect at the next session start**, because
  `$CLAUDE_ENV_FILE` is written by SessionStart and read once.
- **Harness contract.** PostToolUse exit 2 shows stderr to the model; any
  other non-zero status is shown to the user only, so a crash in the hook
  fails quiet.

## Non-goals

- Blocking any command. The report adds information after the fact.
- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
