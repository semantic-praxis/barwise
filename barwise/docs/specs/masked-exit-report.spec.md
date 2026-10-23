# A failure the command's status hid is reported anyway

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/exit-recorder.mjs,
+barwise/scripts/hooks/masked-exit.mjs, +barwise/scripts/lib/exit-log.mjs,
+barwise/scripts/tests/masked-exit.test.mjs,
barwise/scripts/tests/expected-counts.json, barwise/test-plan/cli-checks.sh,
barwise/eval-runner.sh, barwise/compile-runner.sh,
barwise/optimizer/barwise_optimizer/barwise_cli.py, .claude/settings.json,
CLAUDE.md

In one sentence: each node process an agent's Bash command starts
directly records its own exit code, and when a failure among them is one
the call's status did not show, a hook tells the agent which process
failed -- so a red gate behind a pipe or a later command no longer reads
green.

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
gate, `|&`, `pipefail` followed by another command, `s=$?` never raised,
a `PIPESTATUS` index naming the wrong stage, launchers the matcher did
not know. That is CLAUDE.md's "shadow and the property" at small scale.
This design reads the property: the exit codes themselves.

## Which processes count? (resolved: the first node process in each chain consumes a switch)

The session environment carries two static values: `BARWISE_EXIT_DIR`,
the absolute base directory the SessionStart hook chose, which is also
the switch; and a `NODE_OPTIONS` entry that loads the recorder into
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
- The hooks themselves are node processes. Every node hook entry in
  `.claude/settings.json`, including the existing `python-uv-guard.mjs`,
  runs as `env -u BARWISE_EXIT_DIR node ...`, so whether or not Claude
  Code applies the env file to hook commands, no hook records its own
  exit (otherwise a report's own exit 2 would be the next report, and a
  guard's refusal would read as a masked failure).

**Where the log is.** `<base>/<session id>/exits.jsonl`. The base is
`os.tmpdir()/barwise-exit` as the hooks see it; the SessionStart hook
hands that absolute path to the recorder in `BARWISE_EXIT_DIR`, so a
sandbox that gives Bash commands a different `TMPDIR` cannot split the
two, and the hooks, which all run in the harness's environment, compute
it the same way. The session id comes from each side's own source: the
Bash environment carries `CLAUDE_CODE_SESSION_ID`, equal to the hooks'
`session_id` (checked in this session). If the two ever diverge (a
`/clear` that changes one and not the other), the log the hooks read
stays empty and the not-armed notice below says so. The join rule is one
line in two files, because the recorder is inlined and cannot import; a
drift test asserts both compute the same path, per root CLAUDE.md's rule
for a must-agree copy. The recorder creates the directory (0700) on its
first write; an absent log is an empty log, never an error.

**The recorder is inlined, not a file.** `NODE_OPTIONS` names it as
`--import=data:text/javascript;base64,<source>`. A `--require` of a file
is fatal when the file is missing (measured: every node command exits 1
with MODULE_NOT_FOUND), and a path with a space splits `NODE_OPTIONS`; an
inline module has neither failure. Base64's alphabet (`A-Z a-z 0-9 + / =`)
has nothing a shell treats specially, so the export line cannot be broken
by the recorder's source however the harness quotes it. The SessionStart
hook encodes `barwise/scripts/hooks/exit-recorder.mjs`, so the file in
the repository stays the one source. A prototype on 2026-10-23 confirmed
the inline form (URL-encoded then; base64 is the same mechanism): about
1.1 KB, npm recorded with code 1, nothing for a node process's child,
directory 0700 and file 0600.

**What is recorded.** Every directly started node process, exit 0
included, so the hooks can tell "nothing failed" from "nothing recorded".
The recorder never writes to stdout or stderr and never changes an exit
code; if it cannot append, it does nothing. Each entry is the exit code,
the time, and a short label, and never any other argument, because argv
is where a credential typed on a command line sits (root CLAUDE.md, "A
key has nowhere to be written down"):

- `node <script>`: the script's basename; `node -e`: `node -e`;
- `npm`: `npm` plus the first argument that is one of npm's own
  subcommands (`run`, `run-script`, `test`, `t`, `exec`, `x`, `ci`,
  `install`, `i`), plus, after `run`, `run-script`, `exec` or `x`, the
  next argument not starting with `-`; arguments starting with `-` are
  never taken, so `npm --//registry.npmjs.org/:_authToken=X whoami` and
  `npm run --//...:_authToken=X build` record `npm` and `npm run build`;
- `npx`: `npx` plus its first argument not starting with `-` (the tool),
  and nothing after it;
- and in every case, a word is taken only if it matches
  `^[A-Za-z0-9][A-Za-z0-9_:.-]*$`: no `/`, `@` or `=`, so an option value
  after a space (`npx --registry https://u:TOKEN@host vitest`) is never
  a label; the label falls back to the bare command name.

The code recorded is the one the first `exit` listener sees. The
recorder registers first, so a later listener that changes
`process.exitCode` (measured: `process.on("exit", () => {
process.exitCode = 3 })` exits 3 while the recorder sees 0) is recorded as
before the change. npm does this only on its own crash path, where it
turns 0 into 1; that case is declared out of scope below.

## Who reports an entry? (resolved: the next call that ends, unless its own status showed it)

The environment cannot carry a per-call id. Measured on 2026-10-23: the
SessionStart env file is read once, when the session starts, and its
text is inlined into every command's shell line, so a line appended
later never runs, and a dynamic line would make every Bash call depend on
that line not failing. So attribution is by order: each hook reads the
log from the read position, which is the end of the last complete line
any hook read, and moves it to the end of the last complete line it
reads now. Every entry is read by exactly one hook, and each read costs
only what was appended since the last.

- **PostToolUse** (the call exited 0): every non-zero entry read is a
  failure no status showed. Report them all.
- **PostToolUseFailure** (the call exited non-zero with code N, from the
  `Exit code N` first line of its `error`): it stays silent only when
  the failure it read is provably the one the status showed, which needs
  all three of: the read holds exactly one non-zero entry; its code is N;
  and the call's command joins its commands with nothing but `&&` (no
  `|`, `;`, `||`, `&` or newline anywhere in it, quoted or not), so the
  first failure ends the chain and is the call's status. It also needs
  the entry to fall inside the call (its time no earlier than the hook's
  clock minus `duration_ms`; hook latency makes that bound late, which
  can only turn a silence into a redundant report). Everything else is
  reported, with N: `npm run build 2>&1 | tail -3; npm test` with both
  failing; `npm run lint | tail; grep -q x f`, where the 1 is grep's even
  though lint's is 1 too; `npm run build 2>&1 | tail -3; test -f dist/x`;
  `git push` where `npm run ci:local` exited 2 and the hook turned it
  into 1; a background failure that exited before the call. An `error`
  whose first line does not parse is reported too, so a format change
  reports rather than swallows. The separator test is a character test,
  not parsing: a separator inside quotes counts, which can only add a
  report, never remove one.

A process that outlives its call (a backgrounded `npm run ci:local | tail
&`) is read by the first call that ends after it exits, and reported
there with its time: the masked background case, which matters most. A
complete line that does not parse (an older recorder's format, a
corrupted write) is reported as "1 unreadable entry" and skipped, so one
bad line cannot stop every later read; a last line without its newline
(a write in progress) is left for the next read. Two Bash calls running
at the same time can read each other's entries; the report names the
process and its time, so a misattribution is visible, not silent. That
is the one remaining attribution gap, and it is declared.

## How does the agent hear it? (resolved: exit 2 with stderr)

Claude Code runs PostToolUse only when a tool completes successfully and
PostToolUseFailure when a Bash command exits non-zero (hooks reference,
code.claude.com/docs/en/hooks; the non-zero case is shown by example,
carrying `Exit code 1`). For both, exit 2 with stderr is the documented
way to put text in front of the model, and neither can block, because
the tool has already run:

```
Processes started directly by Bash commands exited non-zero without the
command's status showing it:
  npm run test:scripts   exit 1   22:41:07
  mutate.mjs             exit 2   22:41:09
If you printed or handled that status, ignore this; otherwise it was
hidden (a pipe, or a later command).
```

It does not suggest `exit $s`: a non-zero result cancels the parallel
tool calls beside it, which a reader may not want.

**Not armed is said to the model, once per session.** When three calls,
succeeded or failed, whose commands name `node`, `npm` or `npx` have ended and the log has
never received an entry, the recorder is not running (an env file that
did not take effect, a sandbox that refuses the write, a session id that
diverged, a session from before this landed). The PostToolUse hook exits
2 with "the exit recorder is not recording; masked failures will not be
reported", once per session. Three, not one, so a first node command
that is still running in the background does not trip it. The word match
is a diagnostic, not a gate: it decides only when to say the recorder is
silent.

**Could not answer is said to the model too.** If the PostToolUse or
PostToolUseFailure mode cannot read its input or the log, or throws, it
catches that at its top and exits 2 saying so, because exit 1 reaches
only a verbose transcript and "could not answer" would otherwise read as
"nothing failed". The SessionStart mode exits 1 on the same condition:
nothing the model does differs, and the not-armed notice covers the
consequence.

**This repeats statuses an agent printed on purpose.** `npm run lint >
log; echo "exit=$?"` with lint failing prints `exit=1` and still gets the
report. The cost is one redundant notice, only when something failed,
which is when attention is warranted; telling "printed" from "hidden"
would mean reading the output, the text-matching this design replaced.
Probes that fail by design (`beads-crud show X || create ...`) are
reported too, for the same reason; a script that runs expected failures
as its job declares the opt-out below.

## Scope

In scope:

- When a session starts, the SessionStart mode shall append to
  `$CLAUDE_ENV_FILE`, each only if not already present, two static lines
  written literally so the shell expands them: `export
  BARWISE_EXIT_DIR="<base>"` and `export
  NODE_OPTIONS="--import=data:text/javascript;base64,<b64>${NODE_OPTIONS:+
  $NODE_OPTIONS}"`. If it cannot read the recorder, or its own `node` is older than
  20.6 (the first to accept `--import` in `NODE_OPTIONS`; the repo's
  engines field asks for 26), it writes neither.
- When a node process starts with `BARWISE_EXIT_DIR` and
  `CLAUDE_CODE_SESSION_ID` set, the recorder shall delete
  `BARWISE_EXIT_DIR` from its environment and append its exit code, time
  and label to the session log on exit.
- When a Bash call exits 0 and the read holds a non-zero entry, the
  PostToolUse mode shall exit 2 naming each such process, its code and
  its time; otherwise it shall exit 0 silently.
- When a Bash call exits non-zero with code N, the PostToolUseFailure
  mode shall exit 0 silently if the read holds no non-zero entry, or
  exactly one, with code N, inside the call, from a command joined only
  by `&&`; otherwise it shall exit 2 naming each non-zero entry and N.
- When three calls naming node, npm or npx have ended, succeeded or
  failed, and the log has never received an entry, the PostToolUse or
  PostToolUseFailure mode that sees the third shall exit 2, once per
  session, saying the recorder is not recording.
- When the PostToolUse or PostToolUseFailure mode cannot read its input
  or the log, or throws, it shall exit 2 saying so.
- When a script runs node processes that fail by design and checks them
  itself, it shall unset `BARWISE_EXIT_DIR` for them: a declared
  opt-out. Today that is `test-plan/cli-checks.sh` (asserts the CLI's exit
  codes), `eval-runner.sh` and `compile-runner.sh` (probe the CLI with
  `if !`), and `optimizer/barwise_optimizer/barwise_cli.py`, the one
  place the optimizer lane starts the CLI, which drops it from the
  environment it passes. A launcher this list misses shows up in the
  report by name, and is added here in the PR that finds it.

Out of scope, each named so the gap is visible:

- **Gates that are not node processes**: `scripts/check-beads.sh` and the
  other pure-bash scripts, `pytest` through `uv run`, `gitleaks`,
  `shellcheck`. A `BASH_ENV` recorder could cover bash scripts the same
  way; it is a follow-up, because the Bash tool's own shell is bash too
  and telling the two apart is its own design.
- **A gate killed by a signal** (no `exit` event), and **a code changed
  by a later `exit` listener** (recorded as first seen; above).
- **Two Bash calls running at the same time** (the attribution gap).

## Inventory

| Path                                                                                     | Today                                  | After                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/hooks/exit-recorder.mjs`                                                | Does not exist                         | The recorder's source: consume the switch, label, append on exit, never throw                                                                                           |
| `barwise/scripts/lib/exit-log.mjs`                                                       | Does not exist                         | The base and log path, the read position, reading complete lines, the not-armed count                                                                                   |
| `barwise/scripts/hooks/masked-exit.mjs`                                                  | Does not exist                         | `session`, `post` and `failure` modes for the three hook events                                                                                                         |
| `barwise/scripts/tests/masked-exit.test.mjs`                                             | Does not exist                         | The tests below                                                                                                                                                         |
| `barwise/scripts/tests/expected-counts.json`                                             | The test-count manifest                | Records the new file, in the same commit (`npm run test:scripts -- --write`); run-script-tests refuses without                                                          |
| `barwise/test-plan/cli-checks.sh`, `barwise/eval-runner.sh`, `barwise/compile-runner.sh` | Start the CLI expecting failures       | Also `unset BARWISE_EXIT_DIR` (the declared opt-out)                                                                                                                    |
| `barwise/optimizer/barwise_optimizer/barwise_cli.py`                                     | Starts the CLI for the optimizer lane  | Drops `BARWISE_EXIT_DIR` from the environment it passes (the same opt-out)                                                                                              |
| `.claude/settings.json`                                                                  | SessionStart and PreToolUse hooks      | Plus SessionStart (matcher `""`), PostToolUse and PostToolUseFailure (matcher `Bash`); every node hook, the existing one included, runs under `env -u BARWISE_EXIT_DIR` |
| `CLAUDE.md`                                                                              | Monorepo Commands names the pgrep trap | One sentence beside it: what the report means                                                                                                                           |

One script with three modes rather than three scripts: the modes share
every rule in `exit-log.mjs`, and one entry point keeps the layout in
one place. The recorder is separate because it is inlined into
`NODE_OPTIONS` and must stand alone.

The base directory is outside the repository, never committed, and
removed with the container. The existing `.claude/hooks/session-start.sh`
is not used because it runs only in remote sessions; this applies
locally too. Its `persist_env` rule (append a line only if not already
present, barwise-1035) is the rule the SessionStart mode follows, and its
PATH line (`export PATH="...:$PATH"`, expanded by the shell) is the form
the `NODE_OPTIONS` line copies.

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
- **A start filter, and marking the entry whose code matches a failing
  call's code as seen** (drafts 6-8). The filter dropped background
  failures; the code match swallowed a masked failure that shared the
  visible one's code and re-reported one whose code a wrapper changed.
  "Exactly one non-zero entry, with the call's code" is the only case
  that is unambiguous, so it is the only one left unsaid.
- **A `--require` of a copied file** (draft 6). Fatal to every node
  command if the copy goes missing, and broken by a space in the path;
  both measured.
- **A URL-encoded data URL** (draft 7). `encodeURIComponent` leaves `'`,
  `(`, `)`, `!` and `*`, which a different quoting of the inlined line
  could break; base64 leaves nothing a shell reads.
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
under the inlined `NODE_OPTIONS`). Every fixture sets its own `TMPDIR`
(for the hooks), `BARWISE_EXIT_DIR` and `CLAUDE_CODE_SESSION_ID`, so the
suite run inside a session never touches that session's log. Each rule is
watched failing with it removed:

- **the recorded failures**, run for real under the recorder, each
  followed by the PostToolUse mode: `node -e 'process.exit(2)' | tail -1;
  echo $?` (the mutate shape), an `npm run` of a fixture script that
  exits 1 piped to `tail` (the test:scripts shape), and `echo | sh
  <fixture hook running npm> | tail; echo ${PIPESTATUS[0]}`
  (barwise-906), each reported with the process and its code;
- `gate > log; tail log` and `gate || true`: reported;
- **the failure mode**: `npm run lint` failing alone, and `cd x && npm
  run lint` failing, silent; two non-zero entries, reported; one entry
  whose code differs from the call's (the `git push` shape), reported;
  `npm run build 2>&1 | tail -3; test -f dist/x` with the build failing,
  reported though the codes match; a matching entry older than the
  call (a background failure), reported; an unparsable `error`,
  reported;
- a background failure read by the next call that ends, once, with its
  time;
- a node process started by a node process: not recorded; `unset
  BARWISE_EXIT_DIR`: not recorded; a hook run as its settings entry runs
  it: not recorded;
- an unparsable complete line: reported as unreadable, and the next
  entry still read; a line without its newline: left for the next read;
- no non-zero entry, and an absent log: exit 0, no output;
- three node-naming calls with an empty log, succeeded or failed: exit
  2, once per session; one such call: silent;
- the post mode with unreadable input: exit 2 with the reason;
- labels: `npm --//registry.npmjs.org/:_authToken=X whoami` records `npm`;
  `npm run --//x:_authToken=X build` records `npm run build`; `npx vitest
  run --reporter x` records `npx vitest`; `npx --registry
  https://u:T@h vitest` records `npx`;
- the recorder with an unwritable base leaves the observed process's
  output and exit code unchanged;
- the SessionStart mode writes each line once across repeated starts
  (resume, clear and compact all fire SessionStart), keeps an existing
  `NODE_OPTIONS` through the literal `${NODE_OPTIONS:+ ...}`, and writes
  nothing when the recorder cannot be read or its node is older than
  20.6;
- **end to end**: the SessionStart mode writes an env file, its text is
  inlined into a `bash -c` command line the way the harness was observed
  to (prefixed to the command, not sourced), and `node -e
  'process.exit(1)' | tail` in that command produces an entry the post
  mode reports; so the encoding, the quoting and Node's parsing of
  `NODE_OPTIONS` are tested together;
- the drift test: the recorder and `exit-log.mjs` compute the same path;
- **the wiring**: a test parses `.claude/settings.json` and asserts the
  three new entries, their matchers (`""` for SessionStart, `Bash` for the
  others) and mode arguments, and that every node hook command in the
  file, the existing `python-uv-guard.mjs` included, carries the `env -u
  BARWISE_EXIT_DIR` prefix,
  so a misspelled event cannot leave the mechanism inert behind a green
  suite;
- the PR body measures the recorder's cost per node start.

## Open decisions (for review)

None. The owner chose a mechanism on 2026-10-23.

## Risks and testing

- **`NODE_OPTIONS` reaches every node process in the session.** A tool
  that rejects `--import` in `NODE_OPTIONS` (Electron, under
  `vscode-test`) would fail to start; if the integration suite does, it
  gets a declared opt-out in the PR that finds it.
- **The premise rests on the harness**: PostToolUse on success only,
  `Exit code N` in a failure's `error`, `CLAUDE_CODE_SESSION_ID` in the
  Bash environment, the env file inlined into each command. Each failure
  of a premise is loud rather than silent by design: a duplicate report,
  a report on an unparsable `error`, or the not-armed notice.
- **Settings take effect at the next session start**, because
  `$CLAUDE_ENV_FILE` is written by SessionStart and read once.

## Non-goals

- Blocking any command. The report adds information after the fact.
- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
