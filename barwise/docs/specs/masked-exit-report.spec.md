# A failure the command's status hid is reported anyway

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/exit-recorder.mjs,
+barwise/scripts/hooks/masked-exit.mjs, +barwise/scripts/lib/exit-log.mjs,
+barwise/scripts/tests/masked-exit.test.mjs,
barwise/scripts/tests/expected-counts.json, barwise/test-plan/cli-checks.sh,
.claude/settings.json, CLAUDE.md

In one sentence: each node process an agent's Bash command starts
directly records its own exit code, and when a call exits 0 while one of
those processes failed, a PostToolUse hook tells the agent which one --
so a red gate behind a pipe or a later command no longer reads green.

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

## Which processes count? (resolved: the first node process in each chain consumes a switch)

The session environment carries two static values: `BARWISE_EXIT_DIR`,
the absolute base directory the SessionStart hook chose, which is also
the switch, and a `NODE_OPTIONS` entry that loads the recorder into
every node process. The recorder records only when `BARWISE_EXIT_DIR` is
set, and it **deletes it from its own environment** before anything else
runs, so no process it starts can record. Each command the shell starts
directly sees the switch; every descendant of a node process does not.
So:

- `npm run test:scripts | tail` records npm, whose code is the script's;
  the node processes npm starts see no switch.
- `timeout -s KILL 600 npm test`, `CI=1 npx vitest run`, `bash -c 'npm
  test'`, `(cd pkg && npx vitest run)`, `node .../at-root.mjs
  test:scripts`: no wrapper is node, so the first node process records,
  however the command is spelled. Nothing parses the command.
- `git push` runs `.husky/pre-push`, which runs `npm run ci:local`: npm
  records. `echo | sh .husky/pre-push | tail` likewise.
- `turbo run test` is reached through `npm` or `npx`, which consumed the
  switch, and turbo's strict environment mode drops unknown variables
  anyway (measured with turbo 2.11.3: it passes `NODE_OPTIONS` and drops
  `BARWISE_*`).
- A test suite that spawns gates on purpose (`gates.test.mjs` runs
  hundreds expecting exit 1 and 2) is itself a node process: its
  children see no switch.

The log is `<BARWISE_EXIT_DIR>/<session id>/exits.jsonl`. The base is
fixed by the SessionStart hook from its own `os.tmpdir()` and handed to
the recorder through the environment, so a sandbox that gives Bash
commands a different `TMPDIR` cannot split the two. The session id comes
from each side's own source: the Bash environment carries
`CLAUDE_CODE_SESSION_ID`, equal to the hooks' `session_id` (checked in
this session), so a `/clear` that starts a new session moves both
together, and if the two ever diverge the log the hooks read stays empty
and the not-armed notice below says so. The join rule is one line in two
files, because the recorder is inlined (below) and cannot import; a
drift test asserts both compute the same path, per root CLAUDE.md's rule
for a must-agree copy.

**The recorder is inlined, not a file.** `NODE_OPTIONS` names it as
`--import=data:text/javascript,<source>`, with the source encoded by
`encodeURIComponent` (which leaves no `#`, space, `"`, `$` or backtick to
end the URL or disturb the double-quoted export line). A `--require` of a
file is fatal when the file is missing (measured: every node command
exits 1 with MODULE_NOT_FOUND), and a path with a space splits
`NODE_OPTIONS`; an inline module has neither failure. The SessionStart
hook encodes `barwise/scripts/hooks/exit-recorder.mjs` into the URL, so
the file in the repository stays the one source. A prototype on
2026-10-23 confirmed the inline form: about 1.1 KB of URL, npm recorded
with code 1, nothing for a node process's child, directory 0700 and
file 0600.

The recorder records **every** directly started node process, exit 0
included, so the hook can tell "recorded nothing failed" from "recorded
nothing". It never writes to stdout or stderr and never changes an exit
code; if it cannot append, it does nothing. Each entry is the exit code,
the time, and a short label: the basename of the script or tool, `node
-e` for an inline script, and for npm and npx the first argument that is
one of their own subcommands (`run`, `run-script`, `test`, `t`, `exec`,
`x`, `ci`, `install`, `i`) plus, after `run`, `run-script`, `exec` or
`x`, the next argument. No other word is ever taken, because npm takes
config flags before the subcommand (`npm --//registry.npmjs.org/:_authToken=...
whoami`) and argv is where a credential typed on a command line sits
(root CLAUDE.md, "A key has nowhere to be written down").

The code recorded is the one the first `exit` listener sees. The
recorder registers first, so a later listener that changes
`process.exitCode` (measured: `process.on("exit", () => { process.exitCode = 3 })` exits 3 while the recorder sees 0) is recorded as it was before
the change. npm does this only on its own crash path, where it turns 0
into 1; that case is declared out of scope below rather than chased into
Node's internals.

## Which call reports an entry? (resolved: the first successful call that reads it)

The environment cannot carry a per-call id. Measured on 2026-10-23: the
SessionStart env file is read once, when the session starts, and its
text is inlined into every command's shell line, so a line appended
later never runs, and a dynamic line would make every Bash call depend on
that line not failing. So attribution lives in the hooks:

1. **PreToolUse** on Bash records the call's start time, by
   `tool_use_id`.
2. **PostToolUseFailure** (the call exited non-zero with code N, given as
   the `Exit code N` first line of its `error`) marks as seen exactly one
   entry: the latest one at or after its own start whose code is N. That
   is the one failure whose status the agent saw. Every other entry stays
   unread, so `npm run build 2>&1 | tail -3; npm test`, with both failing,
   still reports the masked build, and a background failure that exits
   during a failing call is not swallowed.
3. **PostToolUse** (the call exited 0) reads the log from where the last
   read stopped, to the last complete line, reports every unread non-zero
   entry not marked seen, and moves the read position past them.

Each entry is reported at most once, and each read costs only what was
appended since the last. A process that outlives its call (a
backgrounded `npm run ci:local | tail &`) is reported by the first
successful call after it exits, with its time on the line: the masked
background case, which matters most. The one failure a call's status
showed is seen, not reported. A complete line that does not parse (an
older recorder's format, a corrupted write) is reported as "1 unreadable
entry" and skipped, so one bad line cannot stop every later read. Two
Bash calls running at the
same time can claim each other's entries; the report names the process
and its time, so a misattribution is visible, not silent. That is the
one remaining attribution gap, and it is declared.

## When does the hook speak? (resolved: on a successful call, or when the recorder is silent)

Claude Code runs PostToolUse only when a tool completes successfully; a
Bash command that exits non-zero goes to PostToolUseFailure (hooks
reference, code.claude.com/docs/en/hooks; the non-zero case is shown by
example, carrying `Exit code 1`). So in PostToolUse, an unread,
unseen non-zero entry is a failure no call's status carried. The hook
exits 2 with stderr, the documented way to put a warning in front of the
model:

```
A command exited 0, but processes started directly by Bash commands
exited non-zero without the command's status showing it:
  npm run test:scripts   exit 1   22:41:07
  mutate.mjs             exit 2   22:41:09
If you printed or handled that status, ignore this; otherwise it was
hidden (a pipe, or a later command).
```

It does not suggest `exit $s`: a non-zero result cancels the parallel
tool calls beside it, which a reader may not want.

**Not armed is said to the model, once per session.** When the call's
command names `node`, `npm` or `npx` and the log has never received an
entry, the recorder is not running (an env file that did not take
effect, a sandbox that refuses the write, a session from before this
landed). The hook exits 2 with "the exit recorder is not recording;
masked failures will not be reported", once per session. Exit 1 would
reach only a verbose transcript, never the agent misreading the status.
The word match is a diagnostic, not a gate: it decides only whether to
say the recorder is silent, and the notice says to ignore it if the
command started no node process (`grep npm file` matches the word).

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

- When a session starts, the SessionStart hook shall append to
  `$CLAUDE_ENV_FILE`, each only if not already present, two static
  lines, written literally so the shell expands them:
  `export BARWISE_EXIT_DIR="<abs base>"` and
  `export NODE_OPTIONS="--import=<data URL>${NODE_OPTIONS:+ $NODE_OPTIONS}"`.
  If it cannot read or encode the recorder, it writes neither line.
- When a node process starts with `BARWISE_EXIT_DIR` and
  `CLAUDE_CODE_SESSION_ID` set, the recorder shall delete
  `BARWISE_EXIT_DIR` from its environment and append its exit code, time
  and label to the session log on exit.
- When a Bash call exits 0 and the log holds an unread, unseen non-zero
  entry, the PostToolUse hook shall exit 2 and name each such process,
  its code and its time.
- When it finds none, it shall exit 0 silently.
- When a Bash call exits non-zero with code N, the PostToolUseFailure
  hook shall mark as seen the latest entry since that call's start whose
  code is N, and say nothing.
- When a call's command names node, npm or npx and the log has never
  received an entry, the PostToolUse hook shall exit 2 once per session
  saying the recorder is not recording.
- When the PostToolUse hook cannot read its input or the log, it shall
  exit 2 saying so: in PostToolUse exit 2 does not block, and exit 1
  reaches only a verbose transcript, so "could not answer" would
  otherwise read as "nothing failed". The PreToolUse, PostToolUseFailure
  and SessionStart modes exit 1 on the same condition, because for them
  the notice has no model-facing use and PreToolUse exit 2 would block
  the command.
- When a script runs node processes that fail by design and checks them
  itself, it shall `unset BARWISE_EXIT_DIR` at its top: a declared
  opt-out. Today that is `test-plan/cli-checks.sh`, which asserts the
  CLI's exit codes.

Out of scope, each named so the gap is visible:

- **Gates that are not node processes**: `scripts/check-beads.sh` and the
  other pure-bash scripts, `pytest` through `uv run`, `gitleaks`,
  `shellcheck`. A `BASH_ENV` recorder could cover bash scripts the same
  way; it is a follow-up, because the Bash tool's own shell is bash too
  and telling the two apart is its own design.
- **A gate killed by a signal** (no `exit` event), and **a code changed
  by a later `exit` listener** (recorded as first seen; above).
- **Two Bash calls running at the same time** (the attribution gap above).

## Inventory

| Path                                      | Today                                  | After                                                                                                                |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/hooks/exit-recorder.mjs` | Does not exist                         | The recorder's source: consume the switch, append on exit, never throw                                               |
| `barwise/scripts/lib/exit-log.mjs`        | Does not exist                         | The log path for a session id, call starts, seen entries, the read position                                          |
| `barwise/scripts/hooks/masked-exit.mjs`   | Does not exist                         | `session`, `pre`, `post` and `failure` modes for the four hook events                                                |
| `barwise/test-plan/cli-checks.sh`         | Asserts the CLI's exit codes           | Also `unset BARWISE_EXIT_DIR` (the declared opt-out)                                                                 |
| `.claude/settings.json`                   | SessionStart and PreToolUse hooks      | Plus a SessionStart entry (matcher `""`) and PreToolUse, PostToolUse and PostToolUseFailure entries (matcher `Bash`) |
| `CLAUDE.md`                               | Monorepo Commands names the pgrep trap | One sentence beside it: what the report means                                                                        |

One script with four modes rather than four scripts: the modes share
every rule in `exit-log.mjs`, and one entry point keeps the layout in
one place. The recorder is separate because it is inlined into
`NODE_OPTIONS` and must stand alone.

The session directory is `<BARWISE_EXIT_DIR>/<session id>/`, with the
base `os.tmpdir()/barwise-exit` as the SessionStart hook sees it,
created 0700: outside the repository, never committed, removed with the
container. The existing `.claude/hooks/session-start.sh` is not used
because it runs only in remote sessions; this applies locally too. Its
`persist_env` rule (append a line only if not already present,
barwise-1035) is the rule the SessionStart mode follows, and its PATH
line (`export PATH="...:$PATH"`, expanded by the shell) is the form the
`NODE_OPTIONS` line copies.

## Alternatives considered

- **Refuse commands whose shape masks a status** (drafts 1-3). Each
  review round found shapes the rule got wrong; parsing bash to predict
  an exit code is the shadow, recording it the property.
- **A depth counter** for "started directly" (draft 4). Turbo strips it
  and passes `NODE_OPTIONS`; consuming one switch has no counter to
  strip.
- **Windows from `duration_ms`** (draft 4). Clipped fast processes,
  because `duration_ms` excludes hook latency.
- **A per-call id exported from the env file** (draft 5). The file is
  read once at session start, so the id would never change; measured.
- **A start filter on reported entries** (draft 6). Dropped a background
  failure that exited between calls, the case that matters most.
- **A `--require` of a copied file** (draft 6). Fatal to every node
  command if the copy goes missing, and broken by a space in the path;
  both measured.
- **`set -o pipefail` in the env file**, which is inlined into every
  command. One line, and it fixes both barwise-40a instances at the
  status itself. It loses on what it changes and what it misses: every
  agent command's meaning shifts (`yes | head` exits 141, `grep -q` on a
  pipe can fail a command that succeeded), and `gate > log; tail log`,
  `gate || true` and barwise-906's explicit `PIPESTATUS[0]` read green
  still.
- **Make every gate print its status on its last line.** Edits every
  gate, the line is cut by `tail` or `grep`, and it moves the reading
  back into text.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down; the owner chose a mechanism on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The recorder and the report

The new files, the settings entries, the cli-checks opt-out and the
CLAUDE.md sentence, in one PR. The test drives the hooks as Claude Code
does (JSON on stdin) and the recorder as the shell does (real processes
with the inlined `NODE_OPTIONS` and the switch set). Each rule is watched
failing with it removed:

- the recorded commands, run for real under the recorder: `node -e
  'process.exit(2)' | tail -1; echo $?` (the mutate shape), an `npm run`
  of a fixture script that exits 1 piped to `tail` (the test:scripts
  shape), and `echo | sh <fixture hook running npm> | tail; echo
  ${PIPESTATUS[0]}` (barwise-906), each produce a report naming the
  process and its code;
- `gate > log; tail log` and `gate || true` produce a report too;
- a node process started by a node process records nothing;
- `unset BARWISE_EXIT_DIR` records nothing;
- a failure that exits between calls is reported by the next successful
  call, once, with its time;
- the failure a non-zero call's status showed is never reported; a
  second, masked failure in the same call (`npm run build 2>&1 | tail -3;
  npm test`, both failing) is; and an older unread masked failure, or a
  background one that exits during the failing call, survives it;
- a complete line that does not parse is reported as unreadable and
  skipped, and the next entry is still read;
- an npm label never contains a config flag or its value
  (`npm --//registry.npmjs.org/:_authToken=X whoami` records `npm`);
- a torn last line (a write in progress) is left for the next read;
- no non-zero entry: exit 0, no output;
- a command naming npm with an empty log: exit 2 once per session;
- the recorder with an unwritable log leaves the observed process's
  output and exit code unchanged, and records no argv beyond the label;
- the SessionStart mode writes each line once across repeated starts
  (resume, clear and compact all fire SessionStart), writes the
  `NODE_OPTIONS` line with the literal `${NODE_OPTIONS:+ ...}` so an
  existing value survives, and writes nothing when the recorder cannot
  be read;
- end to end: the SessionStart mode writes an env file, a bash process
  sources it as the harness does, and `node -e 'process.exit(1)' | tail`
  under it produces an entry, so the encoding, the quoting and Node's
  parsing of `NODE_OPTIONS` are tested together, not each in isolation;
- the drift test: the recorder and `exit-log.mjs` compute the same path;
- the wiring: a test parses `.claude/settings.json` and asserts the four
  entries, their matchers (`""` for SessionStart, `Bash` for the rest)
  and their mode arguments, so a misspelled event cannot leave the
  mechanism inert behind a green suite;
- isolation: every fixture sets its own `CLAUDE_CODE_SESSION_ID` and
  `BARWISE_EXIT_DIR` (a temp directory), so running the suite inside a
  session never writes to that session's log;
- the PR body measures the recorder's cost per node start.

## Open decisions (for review)

None. The owner chose a mechanism on 2026-10-23.

## Risks and testing

- **`NODE_OPTIONS` reaches every node process in the session.** A tool
  that rejects `--import` in `NODE_OPTIONS` (Electron, under
  `vscode-test`) would fail to start; if the integration suite does, it
  gets a declared opt-out in the PR that finds it.
- **The premise rests on the harness.** If Claude Code ever ran
  PostToolUse for non-zero Bash exits, a visible failure would be
  reported once more: redundant, not wrong. `CLAUDE_CODE_SESSION_ID` is
  likewise the harness's; if it is absent, nothing records and the
  not-armed notice says so.
- **Settings take effect at the next session start**, because
  `$CLAUDE_ENV_FILE` is written by SessionStart and read once.
- **Harness contract.** PostToolUse exit 2 shows stderr to the model; any
  other non-zero status is shown to the user only. An uncaught exception
  in the post mode is caught at its top and turned into exit 2 with the
  error, so a crash says so rather than reading as "nothing failed".

## Non-goals

- Blocking any command. The report adds information after the fact.
- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
