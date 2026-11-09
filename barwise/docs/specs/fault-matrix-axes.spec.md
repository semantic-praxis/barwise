# The fault matrix's missing axes: tool, writes, and what to do about manifests

Status: Draft -- no workstream implemented

Created: 2026-11-09
Last-updated: 2026-11-09
Tracking: barwise-ym8.rl7 (refuse-not-find: tool, manifest), barwise-ym8.j31
(three-results: tool, manifest), barwise-ym8.if3 (no-writes); WS3 of
`gate-contract-enforced.spec.md`
Touches: barwise/scripts/fault-matrix.mjs, +barwise/scripts/lib/write-recorder.mjs,
barwise/scripts/tests/gates.test.mjs, +barwise/scripts/tests/write-recorder.test.mjs,
barwise/docs/adr/gate-refusal-contract.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md

In one sentence: add two axes to the matrix, a missing tool (a PATH of
logging wrappers from which one name is deleted) and a write log (an inline
`NODE_OPTIONS` recorder that sees a write undone before the gate exits), each
shippable alone for under 10 extra seconds; and move the missing-manifest
decision to prose, because no way of choosing which file to hide is both
affordable and not a guess.

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
  signals become one verdict, `WROTE TREE`, a finding (exit 1). See open
  decision 1.

## Axis 1: a missing tool

**Design A, recommended: a PATH of logging wrappers.** The matrix builds
one directory holding a `#!/bin/sh` wrapper for every executable on the real
PATH; each appends its name to a log and `exec`s the real binary. The
unperturbed run is the record pass: the names logged, less `node`, `sh`
(the wrappers need them) and `git` (its own axes), are the tools the gate
reaches, derived rather than listed. For each such name the matrix reruns
the gate on a PATH with that wrapper deleted. `classify` is unchanged: the
axis is `instrumented`, `touched` is the record-pass count, and exit 2
conforms, exit 0 is FALSE GREEN, exit 1 is CRASHED. Cost: about 5 extra runs
(a refusal for a missing `gitleaks` took 41 ms), a farm build, and wrapped
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

Residual, named in the report rather than hidden: a tool reached by
absolute path (`dprint`) is not a PATH lookup. A gate that legitimately
continues without a tool would be a FALSE GREEN; none exists today, and one
goes on a `TOOL_EXCEPTIONS` list beside `MATRIX_EXCEPTIONS`, with its
reason.

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

The matrix runs a canary first: a child that writes under the root and must
appear in the log, or the axis refuses (exit 2). An instrument that cannot
say it is blind is the defect this spec exists to remove. Every pass runs
under the recorder, and the verdict is the union: any in-scope write
operation, or any change in `git status --porcelain`, is `WROTE TREE`. Cost:
no measurable overhead (a 1.7 s gate is within noise). Code: about 70 lines
of recorder, 40 in the matrix, and the surface test.

Residual: writes by native children (`git`'s index, `dprint`) and by a
node child launched with a scrubbed environment are not seen. The first
group is why a persisted write still needs the porcelain signal.

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
crisp, and the break class cost a killed run a stray file in `src`.

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

**Recommended: do not build it; narrow decision 2.** Four gates take a
manifest or a lockfile as their input (`check:lockfile`, `audit-gate`,
`audit-rubric`, `check:depcruise-gate`); their refusals were fixed in
`gate-contract-enforced.spec.md` WS1 and are reached by their own tests. A
declared-input table would be 37 declarations to cover those four, and it
protects a future gate only if its author declares, the "added by luck"
failure with a form to fill in. The owner decides (open decision 2). If the
owner wants it, the declared selector with the copy mechanism is the design,
about 100 extra runs and an estimated 30 s, not measured.

## Workstreams (each independently shippable)

### 1. The tool axis

`fault-matrix.mjs` builds the farm, runs the record pass, derives the
names, reruns per name, and exports the runner so fixtures can drive it. No
exit-contract change; the smallest blast radius, so first.

Plants, each red first:

- a fixture gate calling a fixture tool and exiting 0 when it is gone reads
  FALSE GREEN; one exiting 1 reads CRASHED; one exiting 2 reads REFUSED; one
  never calling the tool reads INDEPENDENT;
- a `probes.json` row mutates `check-shell.mjs`'s `process.exit(2)` after
  the missing-shellcheck test to `process.exit(1)`; `fault-matrix --only
  check-shell` must exit 1;
- a canary: a farm whose `git` wrapper logs nothing makes the axis refuse.

Exit: the matrix reports a `tool-<name>` reading per reached tool, 0
findings on main; the ADR's `Enforced-by` names the matrix for the tool
clause of `refuse-not-find` and `three-results`, with the plants above.

### 2. The write axis

The recorder, the canary, the `clean` axis kind in `classify`, and the
change from `refuse()` to a finding on a dirty tree (a persisted write ends
the run after naming the gate, since later readings read a changed tree).

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
- the surface drift test fails when a stub export is added to the list.

Exit: 0 findings on main; `Enforced-by` names the matrix for `no-writes`,
barwise-ym8.if3 closes; the ADR's Consequences stop saying the matrix
"refuses when a gate changes `git status --porcelain`".

### 3. The manifest decision

Decision 2's text names what is enforced (git, listing, shallow, tool) and
sends manifests and lockfiles to prose ("each gate names its own
preconditions"); the gap issues' remaining sentence is deleted or the issue
closes by retirement, as its acceptance line allows. No code. Waits for
open decision 2.

## Open decisions (for review)

1. **A write is a finding, exit 1; today it is a refusal, exit 2.**
   Recommended: yes. A gate that writes has answered a question and broken
   a promise; it is not a gate that could not answer. The owner decides,
   because this changes the matrix's exit contract and the ADR's sentence
   about it. The alternative keeps exit 2 for a persisted write and makes
   an undone write a finding, so one defect answers with two codes.
2. **Retire the manifest axis from the enforced list.** Recommended: yes,
   now. The owner decides, because it narrows an ADR decision the gap
   issues track. Enforcement stays available as the declared-input design
   if a manifest break recurs.
3. **Matrix runtime.** Recommended: accept. The tool axis adds under 10 s
   (farm 0.4 s, about 5 reruns, wrapper overhead on git-heavy gates); the
   write axis is within noise. The matrix is about two minutes in CI, so
   this is under 10 percent. The owner's, as it is a CI cost.
4. **Order.** Recommended: WS1, then WS2. WS1 per unit of code protects the
   most: no owner-gated change, and it covers every future gate that calls a
   tool. WS2 protects against the more severe failure, a stray file in the
   tree, for more code and a decision. WS3 first would be wasted if
   decision 2 is accepted.
5. **Native writes stay unseen.** Recommended: accept, and name them in the
   matrix's "Not run" footer. `strace` is the follow-up, not part of this
   spec.

## Risks and testing

- **The recorder breaks a gate.** A syntax error in the inline module makes
  every node process exit 1, so every baseline is non-zero and the matrix
  exits 2 with every row UNREADABLE: loud, and the canary names it.
- **The tool farm changes what runs.** Wrappers change `argv[0]` for
  multi-call binaries. The record pass and the perturbed pass use the same
  farm, so a gate wrongly failing under it fails unperturbed and reads
  UNREADABLE, not as a finding.
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
