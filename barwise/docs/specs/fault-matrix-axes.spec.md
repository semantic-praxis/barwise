# The fault matrix's missing axes: tool, writes, and what to do about manifests

Status: Planned; plan reviewed 2026-11-09 (one round, eight findings, all
addressed; three owner decisions recorded); WS1 and WS3 implemented

Created: 2026-11-09
Last-updated: 2026-11-09
Plan-reviewed: 798109a4 (code-review, pr-review)
Tracking: barwise-ym8.rl7 (refuse-not-find: tool, manifest), barwise-ym8.j31
(three-results: tool, manifest), barwise-ym8.if3 (no-writes); WS3 of
`gate-contract-enforced.spec.md`
Touches: barwise/scripts/fault-matrix.mjs, +barwise/scripts/lib/write-recorder.mjs,
barwise/scripts/lib/ci-gates.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/tests/gates.test.mjs, +barwise/scripts/tests/write-recorder.test.mjs,
barwise/docs/adr/gate-refusal-contract.md, barwise/docs/adr/probes.json,
barwise/docs/specs/gate-contract-enforced.spec.md, barwise/docs/ARCHITECTURE.md

In one sentence: add two axes to the matrix, a missing tool (a PATH of
logging wrappers from which one name is deleted) and a write log (an inline
`NODE_OPTIONS` recorder that sees a write undone before the gate exits), each
shippable alone for under 10 extra seconds, in that order; and move the
missing-manifest decision to prose, because no way of choosing which file to
hide is both affordable and not a guess. The owner decided all three of those
on 2026-11-09 (Open decisions): a write is a finding, and writes by non-Node
programs into gitignored paths stay unseen, stated in the ADR and the report.

## Principle

The matrix measures one property: a gate answers differently when it cannot
see its input, and it can tell whether the gate reached for the thing it
broke (`classify`, `instrumented`). Three of the contract's inputs still have
no such instrument. CLAUDE.md's rule decides how to extend it: look at the
shadow, ratchet on the property. An axis whose instrument cannot log the
reach reads "exit 0" as a pass, and exit 0 is the shadow.

Explicit over implicit decides the manifest question. The matrix cannot
tell which of a gate's thousands of reads is a named input and which is a
corpus member, and a rule that guesses is a shadow. A declaration is the
principled selector, and it costs a declaration per gate that nothing
today needs.

## What was measured (2026-11-09, Node v26.7.0, main at 8a0fffd8)

- **The matrix today.** `node scripts/fault-matrix.mjs`: 38 gates, 149
  readings, 0 findings, 1 unreadable, **160 seconds**, exit 2. The
  unreadable row is `check-adr-tests`: this container has no vitest
  reports, so its unperturbed run exits 1 (CI has them).
- **Tools gates reach.** Reads logged at the call site, gate by gate:
  `uv` (`check:pins`), `gitleaks` (`check:secrets`), `shellcheck`
  (`check:shell`), `npm` (`check:lockfile`), `npx` (`check:depcruise-gate`);
  `fmt:check` reaches `dprint` by absolute path under `node_modules`, which
  no PATH axis touches. With one name deleted from PATH, all five conform
  today (exit 2), and so does `audit-gate` without `npm`. Expected findings:
  none.
- **Writes gates make.** The 38 gates unperturbed, under a prototype write
  recorder: 0 writes under the repository root. Temp-only writers:
  `check:depcruise-gate` (69 operations, two processes),
  `test:adr-model` (30), `check:lockfile` (5, through `npm`). Expected
  findings: none, and the allowlist is empty.
- **What the status quo misses.** A recursive `fs.watch` saw one event for a
  file kept and none for one created and deleted in the same tick. A gate
  that writes and removes a probe leaves `git status --porcelain` clean
  (barwise-w43's shape).
- **Reads, for the manifest axis.** Gates read from 2 to 13,028 distinct
  repository files each (outside `node_modules` and `.git`); 1,958 distinct
  data files (json, yaml, cjs, toml) make about 3,050 (gate, file) pairs.

## The six constraints, and how the recommended designs meet them

The six bullets of `gate-contract-enforced.spec.md` WS3, in order.

- **A PATH shim cannot log a lookup of a name it does not hold; an exported
  tree has no `.git`.** The tool axis holds every name: 1,492 wrappers for
  this machine's PATH, built in 423 ms. Deleting one wrapper is a real
  ENOENT. The reach is logged unperturbed, so no lookup of an absent name
  needs logging. No design here copies the tree with `git archive`; the
  manifest mechanism that copies it copies `.git` too (tracked files 0.39
  s, a 146 MB `.git` 0.91 s).
- **A recursive watcher misses create-then-delete.** The write axis logs at
  the call, not by observing the tree.
- **A `NODE_OPTIONS` preload reaches every descendant and must survive a
  space.** Measured: an unquoted spaced path fails
  `ERR_MODULE_NOT_FOUND`; a percent-encoded file URL works; an inline
  `data:` module carries no path at all (the exit recorder's precedent). A
  2.2 KB recorder is 2.9 KB of base64. A worker thread and a child
  `node --test` both logged. No gate or `lib` module sets `env:` on a child,
  so inheritance holds, and the write recorder wants it (unlike the exit
  recorder, which strips itself so only the first process records). It is
  appended to `NODE_OPTIONS`, never assigned: an agent session already
  carries the exit recorder there.
- **Refusing reads alone is an inconsistent world.** The write axis refuses
  nothing. The manifest mechanism, if built, deletes the file for real in a
  copy, so `existsSync`, `statSync`, `file:` URL loads and streams all
  agree.
- **A write log covers the whole fs write surface and the repo root, not
  the temp dir.** Scope is "the resolved path lies under the real path of
  the repository root", which holds for `ci:local --commit`'s worktree under
  the temp directory and for macOS's `/var` to `/private/var` link (resolve
  the nearest existing ancestor). A drift test classifies every export of
  `fs` and `fs/promises` on the pinned Node, so a new write function fails
  a test instead of slipping through.
- **The porcelain backstop exits 2; writes seen two ways must agree.** Both
  signals become one verdict, `WROTE TREE`, a finding (exit 1), recorded per
  gate without stopping the run (open decision 1, resolved). The backstop is
  blind to gitignored paths, which the residual in axis 2 states.

## Axis 1: a missing tool

**Design A, recommended: a PATH of logging wrappers.** The matrix builds
one directory holding a `#!/bin/sh` wrapper for every executable on the real
PATH; each appends its name to a log and `exec`s the real binary. The
unperturbed run is the record pass: the names logged, less `node`, `sh`
(the wrappers need them) and `git` (its own axes), are the tools the gate
reaches, derived rather than listed. For each such name the matrix reruns
the gate on a PATH with that wrapper deleted. `classify` is unchanged: the
axis is `instrumented`, `touched` is the record-pass count, and exit 2
conforms, exit 0 is FALSE GREEN, exit 1 is CRASHED. Cost: about 5 extra runs under
the reached rule below (a refusal for a missing `gitleaks` took 41 ms), a farm build, and wrapped
unperturbed runs: the git-heaviest gate, `audit:specs` (226 git calls), took
1.97 s against 1.71 s. Code: about 60 lines in `fault-matrix.mjs`.

**Design B: call-site patching in the recorder.** The write recorder also
logs `child_process` command names, and returns a synthetic ENOENT for the
removed one. Rejected: it must reproduce five result shapes (`spawnSync`'s
`error`, `spawn`'s event, `execFileSync`'s throw, `exec`'s shell 127, `fork`),
and a tool reached through `sh -c` is invisible. The wrapper farm is the
operating system's own answer. It reuses the recorder only if the owner
declines wrappers.

**Design C: a list of tool names.** Rejected: a must-agree copy of what
the gates call.

**What counts as reached.** A wrapper also sees transitive tools that `npm`
and `npx` call (`env`, `uname`, `dirname`); deleting one crashes npm, not the
gate, and reads as a false finding. The rule: a call counts only when its
parent is the gate's own node process or its direct npm script shell (the
wrapper logs `$PPID` and the matrix compares it with the pids it started). A
transitive tool that slips through goes on `TOOL_EXCEPTIONS` in
`scripts/lib/ci-gates.mjs`, beside `MATRIX_EXCEPTIONS` and under the same
test that fails on a stale name, with its reason. The cost follows from the
rule: one rerun per distinct counted name per gate, so the five tools named
above add five reruns on `main` and a gate that reaches no tool adds none.
The count is re-measured in the PR, not asserted here.

**The reached-name set is printed.** The report lists, per gate, the names
the record pass reached. A set that shrinks (a wrapper that stopped logging, a
gate that stopped calling a tool) shows as a diff in the report rather than as
a silent absence of a row.

**A tool genuinely absent on the runner.** The record pass never logs it, and
the unperturbed gate refuses (`check-shell.mjs` exits 2 without `shellcheck`),
so the row is UNREADABLE and the matrix exits 2. That is the right answer, and
the report states which tools CI installs so a reviewer can tell an absent
tool from a broken gate: `uv` and `gitleaks` are installed by CI steps
(`scripts/install-uv.sh`, `scripts/install-gitleaks.sh`), `npm`/`npx` come
with Node, and `shellcheck` is installed by no step: `ci.yml` only runs
`check:shell` on `ubuntu-latest`, whose image carries it. (This spec first
listed `shellcheck` among the installed tools; WS1 read `ci.yml` and the
list is written in the ADR's text as corrected.)

**INDEPENDENT is not conformance for a tool.** A wrapper logs only on `exec`.
A probe by `command -v shellcheck`, `which shellcheck`, or an absolute path
(`/usr/bin/shellcheck`, `node_modules/.bin/dprint`) logs nothing, so the gate
reads INDEPENDENT even if it would answer wrongly with the tool gone. Two
measures. A cheap source grep over the gate scripts and the `lib` modules they
import for `command -v`, `which`, and absolute tool paths lists the gates whose
tool reach the wrapper cannot see; the report prints them in its "Not run"
footer, and the grep is a listing, not a gate (the shadow, not the property).
And the footer says what remains unseen: tools reached by absolute path
(`dprint` under `fmt:check`), tools probed without an exec, and writes the
recorder cannot see (axis 2).

**The axis pins the five existing refusals, not only future gates.** Today
`check:pins`, `check:secrets`, `check:shell`, `check:lockfile` and
`check:depcruise-gate` (and `audit-gate` without `npm`) all conform with
exit 2. The axis turns each from an observation into a pinned reading: a
change that makes any of them exit 0 or 1 on a missing tool is a finding.

A gate that legitimately continues without a tool would be a FALSE GREEN; none
exists today, and one goes on `TOOL_EXCEPTIONS`, with its reason.

## Axis 2: writes

**Design A, recommended: an inline write recorder.**
`scripts/lib/write-recorder.mjs`, node builtins only, base64-encoded by the
matrix into `--import=data:...` and appended to the gate's `NODE_OPTIONS`.
It wraps the `fs` and `fs/promises` write surface (create, append, mkdir,
rm, rename, copy, cp, symlink, link, truncate, chmod, utimes, mkdtemp, a
write-flag `open`, `createWriteStream`) and calls
`syncBuiltinESMExports()` so named ESM imports see the wrappers. It appends
one JSON line per call to the file named by `BARWISE_WRITE_LOG`.

Two failures the prototype showed. Logging through `appendFileSync` recorded
its own log 15,074 times, because the public call is re-entered, so the
recorder writes through a file descriptor it opened first and holds a
re-entrancy flag. And a line is one `write`, so concurrent processes
interleave whole lines.

Four details the implementer must keep, each a failure if missed:

- The log is opened with `O_APPEND`, so the kernel keeps concurrent
  processes' lines whole.
- The re-entrancy flag is sound only because the log write is synchronous
  (`writeSync` on the held descriptor); an asynchronous write would let a
  second call slip through the flag between set and clear.
- A `TMPDIR` inside the repository root counts as in scope: scope is the
  resolved path under the root, not "not the temp directory", so a gate's
  temp write there is a write into the tree and the recorder logs it.
- `fs.promises.open` returns a `FileHandle` whose `write`, `writeFile`,
  `appendFile` and `truncate` bypass the wrapped functions. The recorder logs
  the `open` itself when its flags include a write mode, and the drift test
  maps each `FileHandle` write method to that open, so a new method fails the
  test instead of slipping through.

The matrix runs a canary first: a child that writes under the root and must
appear in the log, or the axis refuses (exit 2). An instrument that cannot
say it is blind is the defect this spec exists to remove. Every pass runs
under the recorder, and the verdict is the union: any in-scope write
operation, or any change in `git status --porcelain`, is `WROTE TREE`, a
finding recorded against the gate that made it (see The write verdict). Cost:
no measurable overhead (a 1.7 s gate is within noise). Code: about 70 lines
of recorder, 40 in the matrix, and the surface test.

**Accepted residual (owner, 2026-11-09).** Writes by native children
(`git`'s index, `dprint`) and by a node child launched with a scrubbed
environment are not seen by the recorder. `git status --porcelain` is the
second signal and covers the first group only for paths git tracks or
reports; it ignores gitignored paths (`dist`, `.turbo`, `node_modules`). A
non-Node program writing into a gitignored path is therefore seen by neither
signal. The ADR states this in its Consequences, and the matrix's report
prints it in the "Not run" footer on every run, so a green matrix is never
read as "no gate writes anywhere".

### The write verdict

Today `main` throws a `Refusal` from inside the per-gate loop
(`fault-matrix.mjs`, the `treeAfter !== treeBefore` branch, about lines
393-399), which ends the run with exit 2. Under decision 1 (resolved) that
branch becomes a recorded reading and the run continues:

- Per gate, after its readings, the matrix compares the recorder's log slice
  and `dirtySet()` before and after. Either signal makes a `clean` reading
  with verdict `WROTE TREE`, added to the findings list like FALSE GREEN. The
  gate's remaining readings still ran, and the matrix goes on through the
  remaining gates.
- A persisted write leaves the tree changed for later gates. The finding
  prints the before and after sets, as today, and a later gate is charged only
  with the change it made itself, by diffing each gate's own `treeBefore` from
  its `treeAfter`, never from the run's start.
- At the end the matrix exits 1 if any finding exists, as for every other
  finding. It exits 2 only for what it could not read (an UNREADABLE row, a
  failed canary), and when both occur 2 wins, as today.
- `ci:local` reads the matrix's exit code through its existing path: exit 1
  shows FAIL, not REFUSED; the REFUSED line stays for exit 2 only.
- The ADR sentence that changes is the Consequences line "It also refuses
  when a gate changes `git status --porcelain` and when a script chains two
  node gates." It becomes: "It reports a finding (`WROTE TREE`) when a gate
  writes into the repository tree, seen by a write recorder and by `git
  status --porcelain`, and refuses when a script chains two node gates." The
  residual above follows in the same paragraph.

**Design B: `strace -f --seccomp-bpf`.** Sees native children and
create-then-delete (a probe's `openat` and `unlink` both appeared). Cost on
`audit:specs`: 3.78 s against 1.73 s, 9.6 s without the BPF filter. Linux
only; not shown to be on the CI runner; absent on a developer's Mac where
pre-push runs the matrix. A refusal there breaks the local gate, and a skip
is the silent gap. Kept as the follow-up if native writes ever matter.

**Design C: the Node permission model** (`--permission`, write denied under
the root). Children inherit the denial (measured), but a denial throws, so a
gate that catches the error shows no difference; it prints a
`SecurityWarning` when `--allow-child-process` is given; and native children
are unconstrained. It records nothing. Rejected.

**Design D: retire the decision.** Decision 5 moves to prose; the one break
(`check-depcruise-gate`) is already fixed. Rejected: the cost above is
small, no gate writes today so the allowlist is empty and the ratchet is
crisp, and the break class cost a killed run a stray file in `src`. The
owner chose to build the axis (decision 3, resolved).

## Axis 3: a missing manifest

Every design needs a selector (which file to hide) and a mechanism (how).

Selectors: **observed, exhaustive** is about 3,050 gate runs, each at least
a node start, rejected. **Observed, sparse-directory** (data files in
directories the gate reads three or fewer of) still yields 705 files, and it
is a shadow: a corpus member and a named input look alike. **Declared** is
the only selector that is a decision rather than a guess: each gate lists
its named inputs in a table the matrix reads, a gate with no entry makes
the matrix refuse, and an entry the gate never read in the record pass is a
stale declaration and also a refusal.

Mechanisms: **real deletion in a disposable copy** (tracked files plus
`.git`, `node_modules` linked) is faithful and covers the whole read
surface including shells and native tools; the tree is the same one
`git ls-files` still lists, which is the real state of a deleted tracked
file. Setup 1.3 s measured; `node_modules` linking not measured. **A read
refuser in the recorder** needs about twenty read functions and must exempt
the gate's own code, which the ESM loader reads; it is the inconsistent
world the fourth bullet describes.

**Decided (owner, 2026-11-09): do not build it; narrow decision 2.** Four gates take a
manifest or a lockfile as their input (`check:lockfile`, `audit-gate`,
`audit-rubric`, `check:depcruise-gate`); their refusals were fixed in
`gate-contract-enforced.spec.md` WS1 and are reached by their own tests. A
declared-input table would be 37 declarations to cover those four, and it
protects a future gate only if its author declares, the "added by luck"
failure with a form to fill in. The owner retired the axis to prose (open decision 2,
resolved). If a manifest break recurs, the declared selector with the copy mechanism is the design,
about 100 extra runs and an estimated 30 s, not measured.

## Workstreams (each independently shippable)

### 1. The tool axis

`fault-matrix.mjs` builds the farm, runs the record pass, derives the
names under the parent-pid rule, prints the reached-name set, reruns per
name, and exports the runner so fixtures can drive it. `ci-gates.mjs` gains
`TOOL_EXCEPTIONS`, with a test beside the `MATRIX_EXCEPTIONS` one that fails
on a stale name. No exit-contract change; the smallest blast radius, so first.
WS1 and WS2 both edit `fault-matrix.mjs` and the ADR's `Enforced-by`, so they
ship in that order, WS2 rebased on WS1; they are not parallel PRs.

Plants, each red first:

- a fixture gate calling a fixture tool and exiting 0 when it is gone reads
  FALSE GREEN; one exiting 1 reads CRASHED; one exiting 2 reads REFUSED; one
  never calling the tool reads INDEPENDENT; one probing it only by
  `command -v` also reads INDEPENDENT and appears in the source grep's list;
- a transitive tool (a fixture npm script calling `env`) is not counted, and
  an entry in `TOOL_EXCEPTIONS` that no gate reaches fails the stale-name
  test;
- a `probes.json` row mutates `check-shell.mjs`'s `process.exit(2)` after
  the missing-shellcheck test to `process.exit(1)`; `fault-matrix --only
  check-shell` must exit 1;
- a canary: a farm whose `git` wrapper logs nothing makes the axis refuse.

Exit: the matrix reports a `tool-<name>` reading per reached tool, 0
findings on main; the ADR's `Enforced-by` names the matrix for the tool
clause of `refuse-not-find` and `three-results`, with the plants above, and
the `none (barwise-ym8.rl7 ...)` and `none (barwise-ym8.j31 ...)` entries
narrowed to what WS3 retires. `adr-enforcement.mjs` changes only if the
`Enforced-by` grammar or its gate lists need it (the implementer checks; the
spec does not assume), and `gate-contract-enforced.spec.md`'s WS3 status
line is updated to point here.

### 2. The write axis

The recorder, the canary, the `clean` axis kind in `classify`, and the write
verdict above: the `refuse()` on a dirty tree becomes a recorded finding and
the run continues to the end (owner decision 1).

Plants:

- a fixture gate that writes and removes a probe under its root: the log
  has both operations and `git status --porcelain` is clean, so only the
  recorder reads it red;
- a table test, one case per member of the write surface (including
  `fs/promises`, a stream, an `open` with `w`, `cp`, `symlink`, `truncate`),
  each writing from a child `node --test` process and a worker;
- a root path containing a space, and a root under the temp directory with a
  sibling temp write that must not count;
- a probe row mutating `check-no-nul.mjs` to write and remove a file under
  the root: exit 1; a persisted variant also exits 1, not 2;
- a `gates.test.mjs` plant for the exit path: a fixture matrix run over two
  gates, the first persisting a write, must report `WROTE TREE` for the
  first, still run and read the second, and exit 1 (not 2); a case where one
  gate is also UNREADABLE exits 2; and a `ci:local` case that maps matrix
  exit 1 to FAIL and not REFUSED;
- a node child writing into a gitignored path is seen by the recorder, and
  `sh -c 'echo > dist/x'` is not: the second is pinned as the accepted
  residual, so the day it becomes visible the test says so;
- the surface drift test fails when a stub export is added to the list.

Exit: 0 findings on main; `Enforced-by` names the matrix for `no-writes`,
barwise-ym8.if3 closes; the ADR's Consequences carry the sentence quoted
under The write verdict plus the residual; the "Not run" footer prints the
residual.

### 3. The manifest decision

Decided by the owner (open decision 2). ADR decision 2 now reads "a missing
tool, a missing manifest or lockfile, and a shallow clone when the gate reads
history. Each gate names its own preconditions." It becomes: "That covers
`git` failing or printing nothing, an empty tracked-file listing, a missing
tool and a shallow clone when the gate reads history, each pinned by the
matrix. A missing manifest or lockfile is each gate's own precondition, named
in the gate and tested by its own tests; the matrix does not perturb it." The
gap issue it closes is barwise-ym8.rl7 (refuse-not-find: tool, manifest): its
tool half closes in WS1 and its manifest half here, by retirement, as its
acceptance line allows; barwise-ym8.j31 narrows the same way. No code; WS3
can ship with WS1.

## Open decisions (all resolved 2026-11-09)

1. **A write is a finding, exit 1; it was a refusal, exit 2.** Resolved
   2026-11-09 by the owner: a write into the tree is a finding, exit 1, not a
   refusal. The run records it against the gate, continues through the
   remaining gates, then exits 1. The emission point, what `ci:local` shows
   and the ADR sentence are under The write verdict. Rejected: keeping exit 2
   for a persisted write and making an undone write a finding, which answers
   one defect with two codes.
2. **Retire the manifest axis from the enforced list.** Resolved 2026-11-09
   by the owner: retire the manifest axis to prose. The replacement ADR
   sentence and the gap issue it closes are in WS3. Enforcement stays
   available as the declared-input design if a manifest break recurs.
3. **Build both axes, tool first, then writes.** Resolved 2026-11-09 by the
   owner: build both axes, missing-tool first then no-writes, accepting that
   writes by non-Node programs into gitignored paths stay unseen, stated in
   the ADR and in the matrix report. The three decisions below resolved to
   their recommendations under this one:
   - **Matrix runtime.** Accepted. The tool axis adds under 10 s (farm
     0.4 s, a handful of reruns, wrapper overhead on git-heavy gates); the
     write axis is within noise. The matrix is about two minutes in CI, so
     this is under 10 percent; each PR re-measures it.
   - **Order.** WS1, then WS2; WS3 is prose and rides with WS1. WS1
     protects the most per unit of code and needs no owner-gated change; WS2
     protects against the more severe failure for more code.
   - **Native writes stay unseen.** Accepted, named in the "Not run" footer
     and the ADR, with the gitignored-path consequence stated in axis 2.
     `strace` is the follow-up, not part of this spec.

## Risks and testing

- **The recorder breaks a gate.** A syntax error in the inline module makes
  every node process exit 1, so every baseline is non-zero and the matrix
  exits 2 with every row UNREADABLE: loud, and the canary names it.
- **The tool farm changes what runs.** Wrappers change `argv[0]` for
  multi-call binaries. The record pass and the perturbed pass use the same
  farm, so a gate wrongly failing under it fails unperturbed and reads
  UNREADABLE, not as a finding.
- **Over- and under-collection of tools.** The parent-pid rule and
  `TOOL_EXCEPTIONS` bound the first; the printed reached-name set and the
  source grep bound the second. Neither makes INDEPENDENT mean "conforms".
- **Inheritance is wider than the gates.** `npm` and `npx` run under the
  recorder; measured on `check:lockfile` and `check:depcruise-gate`. Tools
  that reject `--import` (the exit recorder's comment names vscode-test's
  Electron) are not node gates and the matrix does not run them.
- **Timing.** Re-measure the matrix after each workstream on the same
  machine and record it in the PR; the figures above are from one machine.
- **Not grounded:** that `strace` exists on the CI runner; the declared
  manifest design's runtime and its `node_modules` linking; the farm on
  macOS (shell wrappers are the git shim's mechanism already, and nothing
  here runs Windows).

## Non-goals

- Changing what any gate checks, or its messages; the matrix reads exit
  codes only.
- A shell-script axis: the npm steps that are not node gates stay out
  (owner, 2026-11-06).
- The wrong-Node-major axis and the stale-lock axis.
- Reading native children's writes.
