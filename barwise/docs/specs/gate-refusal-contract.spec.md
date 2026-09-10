# A gate that cannot see its input must be unable to print PASS

Status: Implemented. WS2's and WS3's designs were both corrected during
grounding -- see their sections
Created: 2026-09-10
Last-updated: 2026-09-10
Tracking: barwise-987 (WS1, the instance: `audit-gate` reports PASS with zero
advisories from a package directory and advises deleting a live security
acceptance); barwise-989 (WS2 and WS3). The discipline this generalises exists in
`mutate.mjs` and `audit-spec-status.mjs`; this spec finishes applying it.

In one sentence: give every gate a third result -- pass, fail, and
**could not answer** -- because four gates already have it, the one that
did not is the one that printed PASS on a question it never asked, and
nothing distinguishes the two groups today.

## Principle

**Define errors out of existence**, applied to the gate's own reading.

CLAUDE.md's counterweight paragraph says to prefer designing away a
failure case over requiring every caller to handle it. A gate's caller
is a person or an agent reading one line of output, and today that line
carries two values where the situation has three. `PASS` means both
"the thing is fine" and "I could not see the thing" -- and the reader
cannot tell which, because the two are byte-identical.

That is the same defect the test suite has been fixing all month, one
layer out. barwise-902: a check that always passes looks exactly like a
check that is always satisfied. barwise-905: a gate enumerating through
`git ls-files` never saw an untracked probe and printed `OK`.
barwise-906, six occurrences: a verification came back green for a
reason unrelated to what it verified. Every one is a reading that could
not distinguish success from blindness.

Composability is why this is a contract rather than a fix. Each gate
keeps its own logic and its own preconditions; what they share is the
shape of the answer.

## The reading (resolved: measured, one false green in 65 runs)

Thirteen node gate scripts, four perturbations each, exit codes read
directly with no pipe:

| Behaviour                                            | Count | Gates                                                                                                                                        |
| ---------------------------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Invariant under every perturbation                   |     4 | `check-parity`, `audit-duplication`, `audit-rubric`, `check-depcruise-gate`                                                                  |
| Crashes when `git` returns nothing                   |     7 | `check-no-nul`, `regen-root-package`, `check-python-uv`, `audit-spec-status`, `check-book-citations`, `check-core-purity`, `check-file-size` |
| Refuses on its own missing tool, with the wrong code |     1 | `check-shell` -- exit 1, corrected to 2 by WS3                                                                                               |
| **False green**                                      | **1** | **`audit-gate`**                                                                                                                             |

Perturbations: `git` exits 0 printing nothing; `git` exits 127; the gate
runs from `packages/core` instead of `barwise/`; Node 20 instead of 22.

**Two rows of that table were wrong, and WS3's harness is what showed
it.** `check-shell` was recorded as refusing correctly on a missing
shellcheck; it exited 1, which is also its code for "a script has a
finding", so a container without the tool and a repository with a real
bug in its shell scripts reported the same thing. And the probe never
perturbed a shallow clone, so it missed that `audit-spec-status` -- the
gate whose own comment says "refusing" -- exited 1 there too. A hand
reading taken once is a hand reading; both are corrected in WS3.

**The negative result matters as much as the finding.** barwise-905's
shape did not reproduce: no gate reported OK over an empty enumeration.
But the reason is luck rather than design -- the seven crash on a path
derived from empty `git` output, not on a guard that noticed the input
was empty. They are accidentally loud. A different derived path that
happened to resolve would print OK over zero files.

Node 20 against 22 changed nothing here, but the known Node hazard lives
in `test:coverage`, which was not probed. That is a scope limit, not a
clean bill.

### The false green, exactly

```
$ cd barwise && node scripts/audit-gate.mjs
  5 advisory/advisories below threshold (not gated)
  ACCEPTED until 2026-11-30: high serialize-javascript GHSA-5c6j-r48x-rmvq
  audit-gate: PASS -- 1 accepted, 0 unreviewed.          exit 0

$ cd barwise/packages/core && node ../../scripts/audit-gate.mjs
  0 advisory/advisories below threshold (not gated)
  note: acceptance for GHSA-5c6j-r48x-rmvq (serialize-javascript) matches
    no current advisory -- it can be deleted from ACCEPTED.
  audit-gate: PASS -- 0 accepted, 0 unreviewed.          exit 0
```

`spawnSync("npm", ["audit", "--json"], ...)` passes no `cwd`, so it
inherits the caller's and audits a workspace package with no lockfile of
its own. The gate does not merely under-report: it recommends deleting
the acceptance record for a live high-severity RCE, because from that
directory the advisory is invisible and the acceptance therefore looks
stale.

## Should gates refuse, or is failing enough? (resolved: refuse, and four gates already do)

Refuse, with a distinct exit code, and this is not a new invention --
it is an existing discipline that four gates have and nine do not.

- `mutate.mjs` exits `2` for "refused" as a state separate from pass and
  fail, with four documented refusal paths and four tests pinning them.
  Its header states the reason: a mutation that never applied is
  "byte-identical to the reading you get when the mutation applied and
  the test was too weak to catch it."
- `audit-spec-status.mjs` exits `1` on a shallow clone rather than
  answering a smaller question, and `gates.test.mjs` pins both that
  refusal and its cwd-invariance ("green on the current tree, from every
  cwd").
- `check-shell.mjs` exits `1` naming the missing binary.
- `audit-gate.mjs` **already exits `2`** for "could not parse `npm audit`
  output" and "npm audit failed". It has the third value. It simply
  never asks whether it is looking at the right directory.

That last point is what makes this a contract rather than a feature.
The vocabulary exists, unevenly applied, and the gate that broke is one
that had the vocabulary and did not use it at the one place it mattered.

Failing is not enough, because a failure reads as a finding. A gate that
exits `1` because its tool is missing sends the reader hunting a defect
that is not there; the seven crashing gates do a cruder version of the
same thing with a stack trace.

## Should we randomise the faults? (resolved: no -- a matrix, not a monkey)

No. Chaos Monkey randomises because the failure space is combinatorially
large and production is the only place it is real. This repo's
environment axes are small, known, and each is already written down in
CLAUDE.md because it drew blood: wrong Node major (coverage not portable
across V8 versions), missing binary, shallow clone, wrong cwd, stale
lock (`uv.lock` branching on `python_full_version`), and `git` answering
emptily. That is an enumeration, not a space to sample.

Randomising would also make a deterministic check flaky, in a repository
whose whole discipline is that a reading you did not earn is worth less
than no reading. Keep the insight; drop the monkey.

## Scope

In scope, stated as requirements:

- When `audit-gate` runs, the system shall audit the npm project root
  regardless of the cwd it was invoked from. (WS1)
- When a gate cannot locate the input it audits, the system shall exit
  `2` naming what it could not find, and shall not print `PASS`. (WS1
  for `audit-gate`; WS2 for the rest.)
- When the gate suite runs, the system shall assert `audit-gate` gives
  the same reading from the repo root, from `barwise/`, and from a
  package directory. (WS1)
- When a new gate is added to ci.yml, the system shall include it in the
  fault matrix without further declaration. (WS3)
- When a gate cannot answer because a tool it needs is absent or the
  clone is shallow, the system shall exit `2` rather than the code it
  uses for a real finding. (WS3)

Out of scope:

- `test:coverage` and the other slow gates. They were not probed and are
  where the known Node hazard lives; WS3 covers them or explicitly does
  not.
- Third-party tools (`dprint`, `oxlint`, `depcruise`, `knip`, `jscpd`).
  We do not control their exit codes. The wrapper that invokes them can
  still refuse.
- Changing what any gate checks. This spec changes only what a gate says
  when it cannot check.

## Inventory

| File                            | Current state                                                   | Verdict                         |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| `scripts/audit-gate.mjs`        | no `cwd` on the `npm audit` spawn; exits 2 for two cases        | fixed by WS1                    |
| `scripts/tests/gates.test.mjs`  | covers 8 gates; `audit-gate` is not one of them                 | gains WS1's tests               |
| `scripts/mutate.mjs`            | exit 2 = refused, four refusal paths, four tests                | untouched; the model            |
| `scripts/audit-spec-status.mjs` | refuses a shallow clone; cwd-invariance pinned                  | untouched; the model            |
| `scripts/lib/tracked.mjs`       | exports `REPO_ROOT` (the **git** root)                          | gains the guard in WS2          |
| `scripts/lib/ci-gates.mjs`      | did not exist                                                   | WS3: the ci.yml parser, shared  |
| `scripts/fault-matrix.mjs`      | did not exist                                                   | WS3: the harness                |
| `scripts/ci-local.mjs`          | `ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")` | untouched; the idiom WS1 copies |

A note on which root, because there are two and they differ. `REPO_ROOT`
in `tracked.mjs` is the git root (`/…/barwise`), one level above the npm
project (`/…/barwise/barwise`), which is where `package.json` and the
lockfile live. `audit-gate` needs the npm root, so it takes
`ci-local.mjs`'s spelling rather than importing `REPO_ROOT`. Getting
this backwards would move the false green rather than remove it.

## Alternatives considered

- **Resolve from `REPO_ROOT` and stop there.** Fixes this instance and
  not the class: the gate would still print `PASS` if the lockfile were
  absent for some other reason. The refusal guard is what generalises,
  and it is one `existsSync` away once the root is pinned.

- **Make every gate take an explicit `--root` argument.** Explicit over
  implicit, taken past its usefulness: it pushes onto every caller a
  decision no caller varies, and a forgotten flag reintroduces exactly
  the defect. This is the case CLAUDE.md's "define errors out of
  existence" paragraph exists to name.

- **Have `ci-local.mjs` normalise cwd for every gate.** Would fix CI and
  leave the hazard exactly where it bites -- CI already runs from the
  right directory. The exposure is a human or an agent running `node
  scripts/…` directly, which CLAUDE.md explicitly anticipates.

- **Suppress the stale-acceptance note whenever the advisory list is
  empty.** The beads issue proposed this; it turns out to be wrong. Once
  the root is pinned and its lockfile verified, an empty result means
  nothing is vulnerable, and then an acceptance genuinely _is_ stale and
  should be reported as such. The guard belongs at the input, not at the
  output.

## Workstreams (each independently shippable)

### 1. `audit-gate` (barwise-987)

Pin the audit root to the npm project root; refuse with exit `2` when
that root has no `package.json` or no lockfile; add two tests to
`gates.test.mjs` -- the reading is identical from three cwds, and a root
without a manifest refuses rather than passing.

### 2. The contract for the remaining gates (implemented; the draft's design was wrong)

**The draft said nine small changes, not a shared helper, on the grounds
that a shared `assertPrecondition` would be a shallow module. Grounding
it showed the shared owner already exists.** All seven crashers reach
the repository root through one path, and five of them literally import
it: `lib/tracked.mjs` resolves `REPO_ROOT` from `git rev-parse
--show-toplevel`, and when git answers emptily that constant becomes
`""`. Nothing crashed on a guard; they crashed on a path derived from
an empty string, several frames later.

So the guard went where the resolution already lives. That is not a new
wrapper -- `tracked.mjs`'s own header says the listing "lives in one
place that is correct by construction", and an unguarded root was that
claim not yet finished.

Two of the seven were not importing it. `check-core-purity.mjs` and
`check-file-size.mjs` each ran their own `execFileSync("git",
["rev-parse", "--show-toplevel"])` -- a third and fourth copy of one
decision, unguarded and unregistered, which CLAUDE.md's must-agree rule
forbids. They now import `REPO_ROOT`, which removes the duplication and
gives them the guard as a consequence rather than as a second change.

Landed:

- `REPO_ROOT` refuses with exit `2` when `git` fails, and separately
  when it succeeds and prints nothing. The second is the quieter and
  worse case: `resolve("", file)` silently means cwd.
- `trackedFiles()` refuses on an empty listing. Every caller filters
  that list and reports OK on finding no offenders, so empty is exactly
  the reading that looks like success -- barwise-905, where the gate
  printed OK having scanned nothing.
- `check-core-purity` and `check-file-size` import `REPO_ROOT` instead
  of re-deriving it.
- Eleven tests in `gates.test.mjs`: five gates x two git failure modes,
  plus the empty-listing case.

Verified red, three mutations, each failing every test it should:

| Mutation                                    | Result  |
| ------------------------------------------- | ------- |
| the empty-root guard disabled               | 5 fail  |
| `process.exit(2)` becomes `process.exit(1)` | 10 fail |
| the refusal message reworded                | 10 fail |

The exit-code and message mutations failing all ten is the useful
reading: every one of the ten tests reads both, so none of them is
passing incidentally on a gate that happened to exit non-zero.

### 3. The fault matrix as a harness (implemented; the draft was under-specified)

**`scripts/fault-matrix.mjs`, run by `npm run fault-matrix`.** It takes
the fourteen node gates ci.yml runs, puts each under four environment
faults, and reports one verdict per (gate, fault) pair. On demand, not
in CI, per the open decision below.

**The draft said "assert each either answers correctly or exits 2", and
that is not decidable as written.** A gate exiting 0 under a broken
`git` is not thereby defective: `check-parity` never calls git, so it is
right to be unmoved. Telling the two apart needs to know whether the
gate reached for the thing that broke -- and the draft's phrasing quietly
assumed a reader who already knew which gates those were. Written down,
that knowledge is a hand-maintained list of gate-to-resource
dependencies: a must-agree copy, inside the harness auditing the gates
for must-agree copies.

**So it is measured instead of assumed. The `git` shim logs every call.**
`exit 0 having called git and been told nothing` is a false green by
observation; `exit 0 having never called git` is independence by
observation. Nothing has to be declared, and a gate that grows a git
dependency is reclassified the next time the harness runs.

The axes, and what each asks:

| Axis          | Fault                                                | Question              |
| ------------- | ---------------------------------------------------- | --------------------- |
| `git-empty`   | `git` exits 0 printing nothing                       | instrumented          |
| `git-absent`  | `git` exits 127                                      | instrumented          |
| `git-shallow` | real `git`, except `--is-shallow-repository` is true | instrumented          |
| `cwd`         | repo root, `barwise/`, `packages/core`               | is the reading stable |

`git-shallow` passes through to the real git rather than cloning at
`--depth 1`, because a second checkout would change the tree under test
and confound the fault with it. The `--node <path>` flag adds a fifth
axis and is refused unless the interpreter runs and reports a
**different** major -- an axis that silently ran against itself would
report conformance it never tested.

**The three questions are not one question, and collapsing them scored a
real defect as conformance.** The first draft of `classify` treated "no
resource to instrument" as "judge by invariance" but returned REFUSED
before looking. So mutating `audit-gate`'s `cwd: ROOT` pin away -- WS1's
original defect, restored -- produced exit 0, 0, 2 across three
directories, and the harness called it conforming. `npm run mutate` said
UNCAUGHT, which is the only reason it is not still doing that. The axis
kind is now an explicit argument with no guessing default:

- **instrumented** -- refusing is right, never reaching is right,
  answering anyway having reached is a FALSE GREEN.
- **invariant** (cwd) -- the reading must not move. A refusal from one
  directory and a pass from another _is_ a moved reading.
- **refusable** (Node major) -- refusing is the **desired** behaviour,
  because the pin exists so an unpinned runtime does not get to answer.
  A different answer is the finding.

**A gate whose unperturbed run already fails is reported UNREADABLE and
the harness exits 2.** Every fault reading would then be about whatever
is already wrong. Scoring those rows as conforming would be this spec's
own defect committed by its own harness, and it is not hypothetical:
`check-shell` is in exactly that state in any container without
shellcheck.

**A gate must not write to the tree it reads, and that is asserted per
gate rather than argued once.** Taking the first reading, an ad-hoc probe
ran `audit-spec-status.mjs` with package.json's default arguments instead
of ci.yml's `--check` -- and the gate regenerated
`spec-status-baseline.json`, replacing five classified rows with
"TODO: classify". The run reported cleanly. Deriving the arguments from
ci.yml closes that instance; the class is not closed by construction, so
the harness compares `git status --porcelain` before and after each gate
and refuses naming the file.

**The gate list is derived, not listed.** `scripts/lib/ci-gates.mjs`
parses the `run: npm ...` steps out of `.github/workflows/ci.yml`, and
`ci-local.mjs` now reads the same module rather than carrying its own
copy of that parser. A gate added to CI is in the matrix the same day,
which is what closes the Scope requirement "when a new gate is added,
the system shall place it under the same contract" -- and `fmt:check`,
whose npm script is `dprint check && node scripts/fmt-root.mjs --check`,
proves the compound shape resolves. An npm script chaining **two** node
gates is refused rather than guessed: one exit code cannot be attributed
to two gates, and taking the first would leave the second unaudited.

#### What it found

Two gates called a refusal by name and exited 1, which is each one's
code for a real finding:

| Gate                    | Fault           | Was    | Now    |
| ----------------------- | --------------- | ------ | ------ |
| `audit-spec-status.mjs` | shallow clone   | exit 1 | exit 2 |
| `check-shell.mjs`       | no `shellcheck` | exit 1 | exit 2 |

Neither is cosmetic. A shallow clone said _the specs are wrong_ and sent
the reader hunting a spec to fix; an absent shellcheck said _a script
has a bug_. Both now say what is true, which is that the gate could not
answer.

#### The reading, with both fixed

Fourteen gates, four axes, 56 readings, **0 findings, 0 unreadable** --
every gate either refuses or is demonstrably independent of the fault.
Nine refuse on a broken `git`; five never call it. One
(`audit-spec-status`) refuses on a shallow clone and the other thirteen
do not read history. Every gate's exit is invariant across the three
directories. About 90 seconds.

#### Verified red

Three mutations, each through `npm run mutate` so the reading is the
command's own status and not a belief about it:

| Mutation                                               | Harness said                               |
| ------------------------------------------------------ | ------------------------------------------ |
| `tracked.mjs`'s refusal exits 0 instead of 2           | **FALSE GREEN** on two axes -- CAUGHT      |
| `audit-gate.mjs`'s `cwd: ROOT` becomes `process.cwd()` | **READING MOVED** (0, 0, 2) -- CAUGHT      |
| the harness drops ci.yml's `--check` argument          | tree guard fires, names the file -- CAUGHT |

The second is WS1's original defect restored, and it is the one that was
UNCAUGHT until the axis kinds were separated. The verdict that matters
most -- FALSE GREEN -- is also asserted directly in `gates.test.mjs`
against `classify`, because no gate in this repository still returns it
and a live run therefore cannot exercise it.

#### Not run, and why

- **The stale-lock axis.** Perturbing `uv.lock` means writing to the
  tree, and this harness only reads -- the tree-invariance guard above
  would refuse its own run. It belongs with `check-python-uv`'s own
  tests, in a throwaway project.
- **The wrong-Node-major axis**, unless `--node` names an interpreter.
  This is an axis the operator did not ask for rather than one that
  could not be read, and the report says so in those words.

## Open decisions (for review)

- **Exit `2` for refusal, or a distinct higher code?** Options: (a) `2`,
  matching `mutate.mjs` and `audit-gate`'s existing parse-failure path;
  (b) something unmistakable like `77`, on the grounds that `2` is also
  what many tools return for a usage error. Recommended: (a). Two gates
  already use it, and consistency inside the repo beats distinctiveness
  against the outside world.

- **Does WS2 cover the slow gates (`test:coverage`, `build`, `lint`)?**
  Options: (a) yes, since the Node-portability hazard lives precisely
  there; (b) no, because their preconditions are npm's rather than ours
  and the failure modes are already loud. Recommended: (a) for
  `test:coverage` only, and it likely wants its own spec -- the
  refusal it needs is "the Node major is not the pinned one", which is a
  different shape from "the input is missing".

- **Should WS3 run in CI at all? (resolved: no.)** It protects against a
  class that changes on the order of months, and the honest run costs
  about 90 seconds -- 56 gate invocations, several of which shell out to
  `npm audit`, `depcruise` and `jscpd`. On demand, like `mutate.mjs`. The
  reason that was expected to settle it turned out not to apply: the
  `git` shims are written per run into a temp directory and need no
  setup at all, and the second Node is opt-in. The cost is time, not
  installation.

  What that leaves open, and it is a real gap: an on-demand harness runs
  when someone remembers. The thing standing in for CI here is that the
  three mutations above ARE asserted -- `classify`'s verdicts are pinned
  in `gates.test.mjs`, which `test:scripts` runs on every push -- so the
  harness cannot silently stop being able to find a false green. What CI
  does not check is whether the gates still conform.

## Risks and testing

- **Every refusal path must be verified red.** A guard that cannot fire
  is the defect this spec is about, reproduced inside its own fix
  (assertion-audit rule 0). Use `npm run mutate` and establish the
  failing reading first.
- **The cwd-invariance test must actually vary cwd.** `gates.test.mjs`
  already has the idiom (`audit-spec-status … from every cwd`); copy it
  rather than asserting from one directory and trusting the argument.
- **`npm audit` reaches the network.** The existing gate already
  tolerates that (`report.error` exits 2). WS1 must not make an offline
  run refuse _as though_ the root were missing -- the two readings are
  different and should stay so.
- **Behaviour that must not change:** the advisories the gate blocks on,
  the ACCEPTED list, and the threshold semantics. WS1 changes where the
  scan runs and what happens when it cannot run, nothing else.

## Implementation notes (WS1)

Landed as specified: the audit root resolved from the script's own
location, a refusal with exit `2` when that root holds no manifest or
lockfile, and two tests in `gates.test.mjs`. The gate now gives a
byte-identical reading from the repo root, from `barwise/`, and from a
package directory, and the live advisory is visible from each.

Two deviations, both found by verification rather than review:

- **The stale-acceptance suppression was dropped.** barwise-987's design
  proposed also suppressing the "this acceptance matches no advisory"
  note on an empty scan. With the root pinned and its lockfile checked,
  an empty result means nothing is vulnerable -- and then an acceptance
  genuinely is stale and should be reported. The guard belongs at the
  input, and adding a second one at the output would have suppressed a
  true finding.

- **The first version of the cwd test could not fail.** It skipped when
  `some` run exited `2`. Under `npm run mutate` restoring the defect,
  the un-pinned spawn made `npm audit` report ENOLOCK from the repo
  root, the gate refused with exit `2`, and the skip guard read that as
  "this environment cannot audit" and reported green: `mutate: UNCAUGHT`.
  A guard added for environment-robustness became the thing that hid the
  defect -- this spec's own subject, reproduced inside its own test.

  The fix is `every` rather than `some`. With the root pinned all three
  runs do identical work, so they refuse together or not at all; a
  partial refusal is not an environment fact but the defect itself.
  Re-verified CAUGHT.

  This is why the Risks section says to establish red first. Review did
  not catch it; the mutation did, and the difference between `some` and
  `every` is one word in a guard that read as obviously correct.

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No change to what any gate checks.
- No randomised fault injection, now or later.
- No shared precondition helper; each gate names its own.
