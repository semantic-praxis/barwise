# A failure the command's status hid is reported anyway

Status: Implemented 2026-10-23 -- workstream 1 (the recorder and the report)

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Plan-reviewed: 9b6f45d2 (code-review, pr-review)
Touches: +barwise/scripts/hooks/exit-recorder.mjs,
+barwise/scripts/hooks/masked-exit.mjs, +barwise/scripts/lib/exit-log.mjs,
+barwise/scripts/tests/masked-exit.test.mjs,
barwise/scripts/tests/expected-counts.json, barwise/test-plan/cli-checks.sh,
barwise/eval-runner.sh, barwise/optimizer/barwise_optimizer/barwise_cli.py,
+barwise/optimizer/tests/conftest.py, .claude/settings.json,
CLAUDE.md

In one sentence: each node process an agent's Bash command starts
directly records its own exit code, and after every Bash call a hook
names the ones that exited non-zero -- as a warning when the call
reported success, as a note when it did not -- so a red gate behind a
pipe or a later command no longer reads green.

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

The property is "a gate's failure reaches the reader". Eleven drafts of this
spec went through plan review (`/code-review`, 2026-10-23). The first
three checked a shadow of the property, the shape of the command line,
and each round found shapes bash allows that the rule got wrong. Drafts
4-10 recorded the exit codes but tried to stay silent when a failing
call's status "already showed" its failure; each version of that rule
was shown to swallow a masked failure (a substitution, a background exit
during the call, a coincident code). That is CLAUDE.md's "shadow and the
property" twice over: the command text and the call's status both
correlate with "the agent saw it", and both diverge exactly where the
trap lives. This design reports the property itself, every non-zero exit,
and spends a short redundant line when the status already said it.

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
  test:scripts`, `x=$(node y.mjs)`: no wrapper is node, so the first node
  process records, however the command is spelled. Nothing parses the
  command.
- `git push` runs `.husky/pre-push`, which runs `npm run ci:local`: npm
  records. `echo | sh .husky/pre-push | tail` likewise.
- `turbo run test` is reached through `npm` or `npx`, which consumed the
  switch, and turbo's strict environment mode drops unknown variables
  anyway (measured with turbo 2.11.3: it passes `NODE_OPTIONS` and drops
  `BARWISE_*`).
- A test suite that spawns gates on purpose (`gates.test.mjs` runs
  hundreds expecting exit 1 and 2) is itself a node process: its
  children see no switch.
- **Hooks never record.** Every hook command in `.claude/settings.json`,
  node or shell, existing or new, runs as `env -u BARWISE_EXIT_DIR ...`.
  Whether or not Claude Code applies the env file to hook commands, a
  hook's own exits (`session-start.sh`'s `npm install`, a guard's refusal,
  a report's exit 2) never reach the log.

**Where the log is.** `<base>/<session id>/exits.jsonl`. The base is
`os.tmpdir()/barwise-exit` as the hooks see it; the SessionStart hook
hands that absolute path to the recorder in `BARWISE_EXIT_DIR`, so a
sandbox that gives Bash commands a different `TMPDIR` cannot split the
two. The session id comes from each side's own source: the Bash
environment carries `CLAUDE_CODE_SESSION_ID`, equal to the hooks'
`session_id` (checked in this session). If the two ever diverge, the log
the hooks read stays empty and the not-armed notice below says so. The
join rule is one line in two files, because the recorder is inlined and
cannot import; a drift test asserts both compute the same path, per root
CLAUDE.md's rule for a must-agree copy. The recorder creates the
directory (0700) on its first write; an absent log is an empty log,
never an error.

**The recorder is inlined, not a file.** `NODE_OPTIONS` names it as
`--import=data:text/javascript;base64,<source>`. A `--require` of a file
is fatal when the file is missing (measured: every node command exits 1
with MODULE_NOT_FOUND), and a path with a space splits `NODE_OPTIONS`; an
inline module has neither failure. Base64's alphabet (`A-Z a-z 0-9 + / =`)
has nothing a shell treats specially, so the export line cannot be broken
by the recorder's source however the harness quotes it. The SessionStart
hook encodes `barwise/scripts/hooks/exit-recorder.mjs`, so the file in
the repository stays the one source. A prototype on 2026-10-23 confirmed
the inline form: about 1.1 KB, npm recorded with code 1, nothing for a
node process's child, directory 0700 and file 0600.

**What is recorded.** Every directly started node process, exit 0
included, so the hooks can tell "nothing failed" from "nothing recorded".
The recorder never writes to stdout or stderr and never changes an exit
code or adds a listener that could; if it cannot append, it does nothing.
Each entry is the exit code, the time, a short label, and an `epipe`
flag:

- **The label** never holds an argument that could carry a value, because
  argv is where a credential typed on a command line sits (root
  CLAUDE.md, "A key has nowhere to be written down"). It is: for `node
  <script>`, the script's basename; for `node -e`, `node -e`; for `npm`,
  `npm`, plus `run <name>` or `test` only when they are the first two
  arguments exactly (`npm run build`, `npm test`), else `npm` alone; for
  `npx`, `npx <tool>` only when the tool is the first argument, else
  `npx`. Any word taken must match `^[A-Za-z0-9][A-Za-z0-9_:.-]*$`. So
  `npm --//registry.npmjs.org/:_authToken=X whoami`, `npm run --otp 123456
  build` and `npx --registry https://u:T@h vitest` record `npm`, `npm` and
  `npx`.
- **`epipe`** is set when the process died of a write to a closed pipe:
  `process.on("uncaughtExceptionMonitor")`, which observes without
  changing behaviour, saw an error with `code === "EPIPE"` and `syscall === "write"` while no `uncaughtException` listener was registered (so
  the error was fatal), and the process then exited 1. An EPIPE a
  handler caught and survived, or an exit code other than the crash's,
  is recorded as an ordinary exit. Measured on Node 26: `process.stdout.write`
  or `fs.writeSync(1, ...)` into `| head -1` exits 1 with EPIPE, while
  `console.log` exits 0. Such an exit is the reader leaving early, not the
  gate failing, and its own result is unknown; the report says exactly
  that rather than calling it a failure.

The code recorded is the one the first `exit` listener sees. The
recorder registers first, so a later listener that changes
`process.exitCode` (measured: `process.on("exit", () => {
process.exitCode = 3 })` exits 3 while the recorder sees 0) is recorded as
before the change. npm does this only on its own crash path, where it
turns 0 into 1; that case is declared out of scope below.

## Who reports an entry, and how? (resolved: the next call to end, always)

The environment cannot carry a per-call id. Measured on 2026-10-23: the
SessionStart env file is read once, when the session starts, and its text
is inlined into every command's shell line, so a line appended later
never runs, and a dynamic line would make every Bash call depend on that
line not failing. So attribution is by order: each hook reads the log
from the read position, the end of the last complete line any hook read,
and moves it to the end of the last complete line it reads now. Every
entry is read by exactly one hook, and each read costs only what was
appended since the last.

Claude Code runs PostToolUse when a tool completes successfully and
PostToolUseFailure when a Bash command exits non-zero (hooks reference,
code.claude.com/docs/en/hooks; the non-zero case is shown by example,
carrying `Exit code 1`). For both, exit 2 with stderr is the documented
way to put text in front of the model, and neither can block, because the
tool has already run. Both modes do the same thing with what they read;
only the wording differs:

- **After a call that exited 0** (PostToolUse), each non-zero entry is a
  failure no status showed:

  ```
  These processes exited non-zero, and the command still reported 0:
    npm run test:scripts   exit 1   22:41:07
    mutate.mjs             exit 2   22:41:09
  The status was hidden (a pipe, or a later command), or you handled it.
  ```

- **After a call that exited non-zero** (PostToolUseFailure), the note
  lists the same thing without a judgement, because the agent saw a
  failure but not necessarily these: `Non-zero exits read with this
  call: npm run build exit 1, npm test exit 1.` On a plain failing `npm
  run lint` that repeats the status in one line. It is never silent,
  because every rule that tried to tell "the failure the status showed"
  from "another one" swallowed a masked failure under review: a
  substitution `cd "$(node x.mjs)" && make`, a background `npm run ci:local
  | tail &` that exits while a failing `grep` runs, a coincident code.
- **An `epipe` entry** is listed apart in both: `mutate.mjs: stopped by a
  closed pipe (| head?); its own result is unknown.`

A process that outlives its call is read by the first call that ends
after it exits, with its time on the line: the masked background case,
which matters most. When the next step is not a Bash call (the agent
reads the background output with Read and ends the turn), a **Stop**
hook does the same read before the turn ends: on an unread non-zero or
unreadable entry it exits 2, which keeps the turn open with the report
in front of the model, so a turn cannot end over an unread failure. A complete line that does not parse (an older recorder's format, a
corrupted write) is listed as "1 unreadable entry", with exit 2 like a
failure, because it may have been one, and skipped, so one bad line
cannot stop every later read; a last line without its newline (a write in progress) is left for the
next read. If the log is shorter than the read position (it was removed
and recreated), the read starts again from the beginning. Two
Bash calls running at the same time can read each other's entries; the
report names the process and its time, so a misattribution is visible,
not silent. That is the one remaining attribution gap, and it is
declared.

It never suggests `exit $s`: a non-zero result cancels the parallel tool
calls beside it, which a reader may not want.

**Not armed is said to the model, once per session.** When three calls,
succeeded or failed, have a command whose first word, or a word right
after `&&`, `||`, `;`, `|` or `(`, is `node`, `npm` or `npx`, and the log
has never received an entry, the recorder is not running (an env file
that did not take effect, a sandbox that refuses the write, a session id
that diverged, a session from before this landed). The hook that sees
the third exits 2 with "the exit recorder is not recording; non-zero
exits will not be reported". Command position, not any mention, so `grep
npm package.json` does not count; three, not one, so a first node
command still running in the background does not trip it. The test is a
diagnostic, not a gate: it decides only when to say the recorder is
silent.

**Could not answer is said to the model too.** If either report mode
cannot read its input or the log, or throws, it catches that at its top
and exits 2 saying so, because exit 1 reaches only a verbose transcript
and "could not answer" would otherwise read as "nothing failed". The
SessionStart mode exits 1 on the same condition: nothing the model does
differs, and the not-armed notice covers the consequence.

**What this costs.** A redundant line after a visibly failing node
command, and a warning after a success when a failure was handled on
purpose (`npm run lint > log; echo "exit=$?"`, `beads-crud show X ||
create ...`). Both name a real non-zero exit, so neither is false; a
script that runs expected failures as its job declares the opt-out
below.

## Scope

In scope:

- When a session starts, the SessionStart mode shall append to
  `$CLAUDE_ENV_FILE` two static lines, each replacing any earlier line of
  its kind (an earlier `BARWISE_EXIT_DIR` export, or a `NODE_OPTIONS`
  export carrying an older recorder, so a resume across a recorder change
  leaves one recorder, not two) and otherwise appended only if not
  already present,
  written literally so the shell expands them: `export
  BARWISE_EXIT_DIR="<base>"` and `export
  NODE_OPTIONS="--import=data:text/javascript;base64,<b64>${NODE_OPTIONS:+
  $NODE_OPTIONS}"`. If it cannot read the recorder, it writes neither.
- When a node process starts with `BARWISE_EXIT_DIR` and
  `CLAUDE_CODE_SESSION_ID` set, the recorder shall delete
  `BARWISE_EXIT_DIR` from its environment and append its exit code, time,
  label and `epipe` flag to the session log on exit.
- When a Bash call ends, the PostToolUse or PostToolUseFailure mode, and
  when a turn ends, the Stop mode, shall read the unread complete lines,
  and if any holds a non-zero code or does not parse, exit 2 naming each
  such process, its code and its time (or the unreadable line), in the
  wording for that event; otherwise it shall exit 0 silently.
- When three calls with node, npm or npx in command position have ended
  and the log has never received an entry, the mode that sees the third
  shall exit 2, once per session, saying the recorder is not recording.
- When a report mode cannot read its input or the log, or throws, it
  shall exit 2 saying so.
- When a script runs node processes that fail by design and checks them
  itself, it shall unset `BARWISE_EXIT_DIR` for them: a declared opt-out.
  Today that is `test-plan/cli-checks.sh` (asserts the CLI's exit codes),
  `eval-runner.sh` (probes the CLI with `if !`),
  `optimizer/barwise_optimizer/barwise_cli.py`, the one place the
  optimizer lane starts the CLI (`compile-runner.sh` reaches it only
  through there), which drops it from the environment it passes, and a
  new `optimizer/tests/conftest.py`, because the smoke tests start the CLI
  themselves and let some calls fail by design. A launcher this list misses shows up in the report by name, and
  is added here in the PR that finds it.

Out of scope, each named so the gap is visible:

- **Gates that are not node processes**: `scripts/check-beads.sh` and the
  other pure-bash scripts, `pytest` through `uv run`, `gitleaks`,
  `shellcheck`. A `BASH_ENV` recorder could cover bash scripts the same
  way; it is a follow-up, because the Bash tool's own shell is bash too
  and telling the two apart is its own design.
- **A gate killed by a signal** (no `exit` event), and **a code changed
  by a later `exit` listener** (recorded as first seen; above).
- **Two Bash calls running at the same time** (the attribution gap).
- **A command that replaces `NODE_OPTIONS` for one process**
  (`NODE_OPTIONS=--max-old-space-size=8192 npm test | tail`, `env -i
  ...`): that process loads no recorder and records nothing, and because
  other commands do record, the not-armed notice cannot catch it.
  Appending instead (`NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=..."`)
  keeps the recorder; the CLAUDE.md sentence says so.
- **A Bash `node` older than 20.6**, the first to accept `--import` in
  `NODE_OPTIONS`. Every node command would exit 9. The repo already
  requires Node 26 (`engines`, `.nvmrc`, and `session-start.sh` installs
  it in remote sessions), so such a session is already broken for this
  repository; the SessionStart mode also writes nothing when its own
  `node` is older than 20.6. It cannot see the Bash `PATH` from where it
  runs, so that check is necessary, not sufficient, and is stated as
  such.

## Inventory

| Path                                                        | Today                                  | After                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/hooks/exit-recorder.mjs`                   | Does not exist                         | The recorder's source: consume the switch, label, flag EPIPE, append on exit, never throw                                                          |
| `barwise/scripts/lib/exit-log.mjs`                          | Does not exist                         | The base and log path, the read position, reading complete lines, the not-armed count, the two wordings                                            |
| `barwise/scripts/hooks/masked-exit.mjs`                     | Does not exist                         | `session`, `post`, `failure` and `stop` modes for the four hook events                                                                             |
| `barwise/scripts/tests/masked-exit.test.mjs`                | Does not exist                         | The tests below                                                                                                                                    |
| `barwise/scripts/tests/expected-counts.json`                | The test-count manifest                | Records the new file in the same commit (`npm run test:scripts -- --write`); run-script-tests refuses without                                      |
| `barwise/test-plan/cli-checks.sh`, `barwise/eval-runner.sh` | Start the CLI expecting failures       | Also `unset BARWISE_EXIT_DIR` (the declared opt-out)                                                                                               |
| `barwise/optimizer/barwise_optimizer/barwise_cli.py`        | Starts the CLI for the optimizer lane  | Drops `BARWISE_EXIT_DIR` from the environment it passes; a new `optimizer/tests/conftest.py` removes it for the suite (the same opt-out)           |
| `.claude/settings.json`                                     | SessionStart and PreToolUse hooks      | Plus SessionStart and Stop (matcher `""`), PostToolUse and PostToolUseFailure (matcher `Bash`); every hook command under `env -u BARWISE_EXIT_DIR` |
| `CLAUDE.md`                                                 | Monorepo Commands names the pgrep trap | One sentence beside it: what the report means                                                                                                      |

One script with four modes rather than four scripts: the modes share
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

- **Refuse commands whose shape masks a status** (drafts 1-3). Each review
  round found shapes the rule got wrong; parsing bash to predict an exit
  code is the shadow, recording it the property.
- **Stay silent when a failing call's status "already showed" its
  failure** (drafts 4-10, five versions: by time window, by matching
  code, by matching code inside the call, by `&&`-only commands). Each was
  shown to swallow a masked failure. The redundant line it saved is
  cheaper than any of the swallowed failures.
- **A depth counter** for "started directly" (draft 4). Turbo strips it
  and passes `NODE_OPTIONS`; consuming one switch has no counter to strip.
- **A per-call id exported from the env file** (draft 5). The file is read
  once at session start, so the id would never change; measured.
- **A `--require` of a copied file** (draft 6). Fatal to every node
  command if the copy goes missing, and broken by a space in the path;
  both measured.
- **A URL-encoded data URL** (draft 7). `encodeURIComponent` leaves `'`,
  `(`, `)`, `!` and `*`; base64 leaves nothing a shell reads.
- **`set -o pipefail` in the env file**, which is inlined into every
  command. One line, and it fixes both barwise-40a instances at the status
  itself. It loses on what it changes and what it misses: every agent
  command's meaning shifts (`yes | head` exits 141, `grep -q` on a pipe can
  fail a command that succeeded), and `gate > log; tail log`, `gate ||
  true` and barwise-906's explicit `PIPESTATUS[0]` read green still.
- **Make every gate print its status on its last line.** Edits every gate,
  the line is cut by `tail` or `grep`, and it moves the reading back into
  text.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down; the owner chose a mechanism on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The recorder and the report

The new files, the settings entries, the opt-outs and the CLAUDE.md
sentence, in one PR. The test drives the hooks as Claude Code does (JSON
on stdin) and the recorder as the shell does (real processes under the
inlined `NODE_OPTIONS`). Every fixture sets its own `TMPDIR` (for the
hooks), `BARWISE_EXIT_DIR` and `CLAUDE_CODE_SESSION_ID`, so the suite run
inside a session never touches that session's log. Each rule is watched
failing with it removed:

- **the recorded failures**, run for real under the recorder and followed
  by the PostToolUse mode: `node -e 'process.exit(2)' | tail -1; echo $?`
  (the mutate shape), an `npm run` of a fixture script that exits 1 piped
  to `tail` (the test:scripts shape), and `echo | sh <fixture hook running
  npm> | tail; echo ${PIPESTATUS[0]}` (barwise-906), each reported with
  the process and its code;
- `gate > log; tail log`, `gate || true` and `cd "$(node -e
  'process.exit(1)')" ; true`: reported;
- **the failure mode** lists every non-zero entry it reads: one, two, one
  whose code differs from the call's, and a background entry; it is never
  silent while a non-zero entry is unread;
- a background failure read by the next call that ends, once, with its
  time;
- `node -e 'for(let i=0;i<1e5;i++)process.stdout.write("x\n")' | head
  -1` (bounded: an endless synchronous loop never yields to the EPIPE
  error and does not exit, measured): listed as stopped by a closed
  pipe; the same process with an `uncaughtException` handler that
  survives and then exits 1: listed as a failure;
- a node process started by a node process: not recorded; `unset
  BARWISE_EXIT_DIR`: not recorded; a hook command run as its settings
  entry runs it: not recorded;
- an unparsable complete line: listed as unreadable with exit 2, and the
  next entry still read; a line without its newline: left for the next
  read; a log shorter than the read position: read from the start;
- the Stop mode: an unread failure exits 2; a second Stop with nothing
  new exits 0, so the turn is held open once, not forever;
- no non-zero entry, and an absent log: exit 0, no output;
- three calls with `npm` in command position and an empty log, succeeded
  or failed: exit 2, once per session; three with `grep npm x`: silent;
- a report mode with unreadable input: exit 2 with the reason;
- labels: the three credential shapes above record `npm`, `npm`, `npx`;
  `npm run build` and `npx vitest run` record `npm run build` and `npx
  vitest`;
- the recorder with an unwritable base leaves the observed process's
  output and exit code unchanged;
- the SessionStart mode writes each line once across repeated starts
  (resume, clear and compact all fire SessionStart), replaces a
  `NODE_OPTIONS` line carrying a different recorder, keeps an existing
  `NODE_OPTIONS` through the literal `${NODE_OPTIONS:+ ...}`, and writes
  nothing when the recorder cannot be read;
- **end to end**: the SessionStart mode writes an env file, its text is
  inlined into a `bash -c` command line the way the harness was observed
  to (prefixed to the command, not sourced), and `node -e
  'process.exit(1)' | tail` in that command produces an entry the post
  mode reports; so the encoding, the quoting and Node's parsing of
  `NODE_OPTIONS` are tested together;
- the drift test: the recorder and `exit-log.mjs` compute the same path;
- **the wiring**: a test parses `.claude/settings.json` and asserts the
  four new entries, their matchers (`""` for SessionStart and Stop,
  `Bash` for the others) and mode arguments, and that every hook command in the file
  carries the `env -u BARWISE_EXIT_DIR` prefix, so a misspelled event or a
  new unprefixed hook cannot pass behind a green suite;
- the PR body measures the recorder's cost per node start.

## Open decisions (for review)

None. The owner chose a mechanism on 2026-10-23.

## Risks and testing

- **`NODE_OPTIONS` reaches every node process in the session.** A tool
  that rejects `--import` in `NODE_OPTIONS` (Electron, under
  `vscode-test`) would fail to start; if the integration suite does, it
  gets a declared opt-out in the PR that finds it.
- **The premise rests on the harness**: PostToolUse on success and
  PostToolUseFailure on a non-zero exit, `CLAUDE_CODE_SESSION_ID` in the
  Bash environment, the env file inlined into each command. Each failure
  of a premise is loud by design: both report modes say the same entries,
  so a misrouted event still reports, and a silent recorder trips the
  not-armed notice.
- **Settings take effect at the next session start**, because
  `$CLAUDE_ENV_FILE` is written by SessionStart and read once.

## Non-goals

- Blocking any command. The report adds information after the fact.
- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
