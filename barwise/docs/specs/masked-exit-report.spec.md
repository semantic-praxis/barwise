# A failure the command's status hid is reported anyway

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/exit-recorder.cjs,
+barwise/scripts/hooks/exit-recorder-env.mjs,
+barwise/scripts/hooks/masked-exit-report.mjs, +barwise/scripts/lib/exit-log.mjs,
+barwise/scripts/tests/masked-exit-report.test.mjs,
barwise/scripts/tests/expected-counts.json, barwise/test-plan/cli-checks.sh,
.claude/settings.json, CLAUDE.md

In one sentence: every node process an agent's Bash command starts
directly records its own exit code, and when the command as a whole
exits 0 while one of those processes failed, a PostToolUse hook tells
the agent which one -- so a red gate behind a pipe or a later command no
longer reads green.

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
the trap down did not stop it, so the fix is a mechanism, not a rule.

The property is "a gate's failure reaches the reader". The first three
drafts of this spec checked a shadow of it -- the shape of the command
line -- and each plan review (`/code-review`, three rounds, 2026-10-23)
found shapes bash allows that the check got wrong: `2>&1` split as a
separator, quoted script paths blanked, `gate > log; tail log`, `||
true`, a backgrounded gate, `|&`, `pipefail` followed by another
command, `s=$?` never raised, a `PIPESTATUS` index naming the wrong
stage, launchers the matcher did not know, a gate named only through
`at-root.mjs`. That is CLAUDE.md's "shadow and the property" at small
scale: the command text correlates with whether a status is kept, and
diverges exactly where bash is clever. This design reads the property:
the exit codes themselves.

## How is "a process the command started directly" known? (resolved: a depth counter in the environment)

`NODE_OPTIONS=--require=<abs>/exit-recorder.cjs` loads a recorder into
every node process the session's Bash commands start. The recorder reads
`BARWISE_EXIT_DEPTH` (absent means 0), sets it to one more for its own
children, and only at depth 0 registers `process.on("exit")` to append
`{ t, code, argv, execArgv, cwd }` to the session's exit log (`execArgv`
because `node -e` leaves `argv` empty). A prototype run on 2026-10-23
confirmed the mechanism: `npm run bad | tail -1` recorded npm with code 1
and nothing for the node process npm started; `timeout`, a subshell and
an uncaught throw were each recorded at depth 0 with their real code. So:

- `npm run test:scripts | tail` records npm, whose code is the script's;
  the node processes npm starts inherit depth 1 and record nothing.
- `timeout -s KILL 600 npm test`, `CI=1 npx vitest run`, `bash -c 'npm
  test'`, `(cd pkg && npx vitest run)`, `node .../at-root.mjs
  test:scripts`: none of the wrappers is node, so the first node process
  is depth 0 however the command is spelled. Nothing parses the command.
- `git push` runs husky's pre-push, which runs `node ci-local.mjs` at
  depth 0: recorded.
- A test suite that spawns gates on purpose (`gates.test.mjs` runs
  hundreds expecting exit 1 and 2) runs them at depth 1 or more: not
  recorded.

The recorder never writes to stdout or stderr and never changes an exit
code; if it cannot append, it does nothing. A failure in the recorder
must not become a failure of the command it observes.

## When does the hook speak? (resolved: only when the command exited 0)

Claude Code runs PostToolUse only when a tool completes successfully;
a Bash command that exits non-zero goes to PostToolUseFailure instead
(hooks reference, code.claude.com/docs/en/hooks). So a PostToolUse hook
sees exactly the commands whose status was 0, and in those, any
recorded non-zero exit is by definition a failure the command's status
did not carry. The hook reads the entries whose time falls inside the
call (its input carries `duration_ms`), and if any has a non-zero code,
it exits 2 with stderr, which the docs give as the way to put a warning
in front of the model:

```
The command exited 0, but these processes it started exited non-zero:
  npm run test:scripts   exit 1
  node barwise/scripts/mutate.mjs ...   exit 2
Their status was hidden (a pipe, or a later command). Re-run with the
status kept: <cmd> > log 2>&1; s=$?; tail -20 log; exit $s
```

A command whose status already showed the failure goes to
PostToolUseFailure, where this hook does not run, so the agent never
hears it twice. Nothing is blocked: the command has run, and the report
adds what its status left out.

## Scope

In scope:

- When a SessionStart hook runs, `exit-recorder-env.mjs` shall append to
  `$CLAUDE_ENV_FILE` an `export` of `BARWISE_EXIT_LOG` (the session's log,
  from `session_id`) and of `NODE_OPTIONS` with the recorder's absolute
  path added to any existing value.
- When a node process starts with `BARWISE_EXIT_DEPTH` absent or 0, the
  recorder shall set it to 1 for children and append its exit code,
  argv, cwd and time to `BARWISE_EXIT_LOG` on exit; at any other depth it
  shall increment the counter and record nothing.
- When a Bash command exits 0 and the log holds an entry inside the
  call's window with a non-zero code, `masked-exit-report.mjs` shall exit
  2 and name each such process and its code.
- When it finds none, it shall exit 0 silently.
- When it cannot read its input or the log is absent although
  `BARWISE_EXIT_LOG` is set, it shall exit 1 (shown to the user, not to
  the model): the "could not answer" its sibling `python-uv-guard.mjs`
  uses under Claude Code's hook contract.
- When a script runs node processes that are expected to fail and checks
  them itself, it shall export `BARWISE_EXIT_DEPTH=1` at its top, a
  declared opt-out. Today that is one script, `test-plan/cli-checks.sh`,
  which asserts exit codes of the CLI by design.

Out of scope, each named so the gap is visible:

- **Gates that are not node processes**: `scripts/check-beads.sh` and
  the other pure-bash scripts, `pytest` through `uv run`, `gitleaks`,
  `shellcheck`. A `BASH_ENV` recorder could cover bash scripts the same
  way; it is filed as a follow-up rather than built, because the Bash
  tool's own shell is bash too and telling the two apart is its own
  design.
- **A gate killed by a signal** (no `exit` event) or **backgrounded**
  past the end of the call.
- **Two Bash calls running at once**: their windows overlap and an
  entry may be reported against the wrong one. The report names the
  process, so a misattribution is visible.
- **Sessions without the SessionStart hook** (a local session started
  before this lands): nothing is recorded and the report hook stays
  silent.

## Inventory

| Path                                           | Today                                  | After                                                                        |
| ---------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `barwise/scripts/hooks/exit-recorder.cjs`      | Does not exist                         | The `--require` preload: depth counter, append on exit, never throws         |
| `barwise/scripts/lib/exit-log.mjs`             | Does not exist                         | The log path for a session id, and reading a time window; one home for both  |
| `barwise/scripts/hooks/exit-recorder-env.mjs`  | Does not exist                         | SessionStart: writes the two exports to `$CLAUDE_ENV_FILE`                   |
| `barwise/scripts/hooks/masked-exit-report.mjs` | Does not exist                         | PostToolUse on Bash: reads the window, reports non-zero entries              |
| `barwise/test-plan/cli-checks.sh`              | Asserts CLI exit codes                 | Also exports `BARWISE_EXIT_DEPTH=1` (the declared opt-out)                   |
| `.claude/settings.json`                        | SessionStart and PreToolUse hooks      | Plus one SessionStart entry and one PostToolUse Bash entry                   |
| `CLAUDE.md`                                    | Monorepo Commands names the pgrep trap | One sentence beside it: what the report means and the form that keeps status |

The recorder is CommonJS because `--require` loads CommonJS; it reads
the log path from the environment rather than importing `exit-log.mjs`,
so the preload costs one `fs` call per node start and nothing else. The
path rule therefore lives in `exit-log.mjs` and is handed to the
recorder through `BARWISE_EXIT_LOG`, not computed twice.

The log lives under `os.tmpdir()/barwise-exit/<session_id>.jsonl`: in
the container's temp space, outside the repository, never committed.

## Alternatives considered

- **Refuse commands whose shape masks a status** (the first three
  drafts: a pipe rule, then a list of masking shapes, then a list of
  safe shapes). Each round of review found shapes the rule got wrong in
  one direction or the other; the reasons are in the Principle. Parsing
  bash to predict an exit code is the shadow; recording the exit code is
  the property.
- **Make every gate print its status on its last line.** Edits every
  gate, and the line is cut by `| tail -0` or `grep`. It moves the
  reading back into text the agent must notice.
- **A PreToolUse hook that adds `set -o pipefail`.** Fixes pipes only;
  `gate > log; tail log` still reports `tail`'s status.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down; the owner chose a mechanism on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The recorder and the report

The four new files, the settings entries, the cli-checks opt-out and the
CLAUDE.md sentence, in one PR. The test drives the hooks as Claude Code
does (JSON on stdin) and the recorder as the shell does (real node
processes with `NODE_OPTIONS` set). Each rule is watched failing with it
removed:

- the recorded barwise-40a commands, run for real under the recorder in
  a temp directory (`node -e 'process.exit(2)' | tail -1`, an `npm run`
  of a fixture script that exits 1 piped to `tail`), produce a report
  naming the process and its code;
- `gate > log; tail log` and `gate || true` produce a report too;
- a node process at depth 1 (started by another node process) is not
  recorded;
- the opt-out: a process started under `BARWISE_EXIT_DEPTH=1` is not
  recorded;
- an entry outside the call's window is not reported;
- no non-zero entry: exit 0 and no output;
- the recorder with an unwritable log path leaves the observed
  process's output and exit code unchanged;
- `exit-recorder-env.mjs` keeps an existing `NODE_OPTIONS` value and
  writes a path that works with spaces in it;
- the PR body measures the recorder's cost per node start.

## Open decisions (for review)

None. The owner chose a mechanism on 2026-10-23; the design questions
are resolved above.

## Risks and testing

- **`NODE_OPTIONS` reaches every node process in the session.** A tool
  that rejects `--require` in `NODE_OPTIONS` (Electron, under
  `vscode-test`) would fail to start. The integration suite is the one
  known case; if it fails, it gets the same declared opt-out
  (`NODE_OPTIONS` cleared for that script) in the PR that finds it.
- **Noise.** A deliberately handled failure (`node probe.mjs || echo
  missing`) is reported. The report says the status was hidden, which is
  true; the agent judges whether it mattered. If one source dominates,
  it gets the declared opt-out.
- **Settings take effect at the next session start**, because
  `$CLAUDE_ENV_FILE` is written by SessionStart.
- **Harness contract.** PostToolUse exit 2 shows stderr to the model;
  any other non-zero status is shown to the user only, so a crash in the
  report fails quiet rather than noisy, as its sibling does.

## Non-goals

- Blocking any command. The report adds information after the fact.
- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
