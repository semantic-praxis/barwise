# `ci:local` should run the gates CI runs, not every gate CI has

Status: Draft -- no workstream implemented
Created: 2026-09-07
Last-updated: 2026-09-07
Tracking: barwise-954 (this spec); barwise-950 (no git hooks in a remote
container, so the local tier is chosen by hand rather than by the
pre-commit/pre-push split)

In one sentence: `ci-local.mjs` parses CI's gate list out of `ci.yml` so
the two cannot drift, then ignores the `if:` conditions on those steps,
so a change CI classifies as docs-only runs all 28 gates locally instead
of the 11 CI would run.

## Principle

This is DRY where DRY is not secondary, because the copy is already
half-eliminated. `ci-local.mjs` exists because a hand-written gate list
went stale twice in one session; its answer was to derive the list from
`ci.yml` rather than restate it, and the module comment says so at
length. The derivation stops at membership. Which gates run, for a given
change, is equally a fact `ci.yml` owns, and it is currently restated
locally as "all of them" -- a copy that happens to be safe rather than a
copy that is checked.

The second principle at stake is **explicit over implicit**, pointed at
the thing this design must not get wrong. A local runner that skips a
gate CI will run converts a fast local pass into a red push, which is
the exact failure `ci-local.mjs` was written to prevent. So every
mechanism below is arranged so that the unknown case runs the gate: an
`if:` expression the classifier does not recognise is not a licence to
skip.

## Should the predicates be re-implemented in JavaScript? (resolved: no -- they move)

The `docs_only` and `optimizer` predicates are four lines of shell
inside `ci.yml`'s detect step. Copying them into `ci-local.mjs` would
create precisely the must-agree pair `duplication-drift-guards.spec.md`
governs: two implementations of "what kind of change is this", drifting
the first time someone adds an extension to the docs-only set.

So they move instead. One script owns the classification, `ci.yml`'s
detect step calls it, and `ci-local.mjs` imports it. That is a shared
owner rather than a checked copy, which is the strongest of the four
remedies the convention allows, and it removes the need for a
`parity.manifest.json` row.

The constraint that shapes it: `ci.yml` runs the detect step **before**
`setup-node` and before `npm ci`, so the script executes on whatever
Node the runner ships with and can import nothing. It must be
stdlib-only. That is not a hardship -- the classification is two regular
expressions over a list of paths -- but it rules out putting the logic
in a package.

## Scope

In scope:

- When a change touches only files matching `\.md$` or `^\.beads/`, the
  system shall skip the same gates CI skips for a docs-only pull
  request, and report each skipped gate with the condition that skipped
  it.
- When a change touches no file under `barwise/optimizer/` or
  `barwise/packages/cli/`, the system shall skip `test:optimizer`.
- When `ci.yml` carries an `if:` expression the classifier does not
  recognise, the system shall run that gate and print that it did not
  understand the condition.
- When `--all` is passed, the system shall run every gate regardless of
  what changed.
- When `--list` is passed, the system shall print each gate with the
  verdict (run or skip) that the current working tree produces.
- The `docs_only` and `optimizer` predicates shall have exactly one
  implementation, called by both `ci.yml` and `ci-local.mjs`.

Out of scope:

- Changing which gates CI itself skips. The classification is copied
  faithfully, including the deliberate exceptions (`check:beads`,
  `check:book-citations`, `check:parity`, `fmt:check` and four others run
  on docs-only changes on purpose, each with a comment saying why).
- Installing git hooks in remote containers. That is barwise-950 and it
  is a separate decision about shared environment setup.
- Any new gate, or any change to what a gate checks.

## Inventory

| File                            | Current state                                                                                       | Verdict                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | A `Detect docs-only pull request` step computes `docs_only` and `optimizer` from a shell `git diff` | Step calls the new script; the two predicates leave the YAML                            |
| `scripts/ci-local.mjs`          | Parses `run: npm ...` lines; ignores `if:`; runs all 28 gates                                       | Parses the whole step block; applies conditions; gains `--all`                          |
| `scripts/lib/changed-class.mjs` | Does not exist                                                                                      | New: the one owner of both predicates                                                   |
| `scripts/tests/gates.test.mjs`  | Tests eight gate scripts, each shown red on a planted defect in a throwaway repo                    | Gains the cases for the classifier and the condition parser                             |
| `scripts/lib/tracked.mjs`       | The single tracked-file listing, anchored at the repo root                                          | Untouched -- a different concern, and the classifier reads a diff rather than a listing |

The thing that looks affected and is not: **the gate scripts
themselves**. None of them learns about change classes; the decision of
whether to run one lives entirely in the runner, exactly as it does in
CI.

## Target architecture

```
scripts/lib/changed-class.mjs        stdlib-only, no imports
  classify(changedPaths) -> { docsOnly: boolean, optimizer: boolean }
  changedPaths(baseRef)  -> string[]   repo-root-relative
  main()                 -> prints "docs_only=true\noptimizer=false"
                           for ci.yml to append to $GITHUB_OUTPUT

.github/workflows/ci.yml
  - name: Detect docs-only pull request
    run: node scripts/lib/changed-class.mjs "$base" >> "$GITHUB_OUTPUT"
    # runs before setup-node, so: no npm, no imports, runner Node

scripts/ci-local.mjs
  import { classify, changedPaths } from "./lib/changed-class.mjs"

  gates()          now returns { args, condition } per step, scanning the
                   whole step block -- an `if:` may precede its `run:`,
                   which is how `test:optimizer` is written
  shouldRun(cond)  "" -> true
                   "steps.changes.outputs.docs_only != 'true'" -> !docsOnly
                   "steps.changes.outputs.optimizer == 'true'" -> optimizer
                   anything else -> true, with a printed warning
```

The local base ref is `git merge-base origin/main HEAD`, which is the
analogue of CI's `pull_request.base.sha`. The changed set is the union
of that diff with the **uncommitted** working-tree changes, because
`ci:local` is run before a commit as often as before a push, and a
source edit that is not yet committed must not be classified as
docs-only.

## Alternatives considered

- **Re-implement the predicates in `ci-local.mjs`, register the pair in
  `parity.manifest.json`.** Cheaper by one file and it satisfies the
  letter of the duplication convention. It loses because
  `parity.manifest.json` compares text, and the two forms are shell and
  JavaScript -- there is no byte-identical pair to register. It would
  need a bespoke drift test instead, which is more machinery than the
  shared owner it is trying to avoid.
- **Parse the shell out of `ci.yml`'s detect step.** Maximal derivation:
  read the `grep -qvE` pattern from the YAML and apply it. Rejected as
  the kind of cleverness that fails silently -- the day someone rewrites
  the step with a different shell idiom, the parser matches nothing and
  the classifier quietly says "not docs-only", which is safe, or worse,
  matches partially.
- **Give `ci:local` a `--fast` flag that skips a hard-coded heavy set.**
  What I would have reached for before reading `ci.yml`. It is a third
  hand-written list, in the third place, with nothing keeping it honest
  -- the exact shape `ci-local.mjs`'s own module comment was written
  against.
- **Do nothing; tell people to run the right gates by hand.** The
  status quo. It costs about three minutes per tracker commit and
  relies on judgement that this session demonstrably got wrong four
  times in a row. Discipline is not a mechanism.

## Workstreams (each independently shippable)

### 1. One owner for the change classification

Extract `docs_only` and `optimizer` into `scripts/lib/changed-class.mjs`
and have `ci.yml`'s detect step call it. No local behaviour changes;
`ci-local.mjs` is untouched. This ships first because it is the only
workstream that edits CI's own control flow, and it is verifiable on its
own: the step must classify this repository's recent pull requests
exactly as the shell did.

Acceptance: when the detect step runs on a pull request touching only
`.beads/issues.jsonl`, it shall write `docs_only=true`; when it runs on
one touching a `.ts` file, `docs_only=false`; and `gates.test.mjs` shall
show each verdict from a planted file list, including the boundary case
of an empty diff (which the shell treats as **not** docs-only, via its
`[ -n "$changed" ]` guard).

### 2. `ci:local` reads the conditions (provisional: not yet grounded)

Teach `gates()` to return each step's condition by scanning the step
block rather than the single `run:` line, add `shouldRun`, add `--all`,
and make `--list` show the verdicts. Report skipped gates in the summary
so a reader can see what was not run, which is the half that keeps this
from becoming a silent hole.

Acceptance: when the working tree contains only a `.beads/` edit,
`ci:local` shall run 11 gates and print the 17 it skipped; when it
contains a `.ts` edit, it shall run 27 (all but `test:optimizer`); when
it contains a `packages/cli/` edit, it shall run all 28; and when a step
carries an unrecognised `if:`, it shall run that gate and say so.

Provisional until grounded: the counts above are computed from today's
`ci.yml` and are the numbers to re-derive at implementation time, not to
trust from this draft.

## API and migration impact

- No package API changes; nothing here is imported by any workspace
  package. `scripts/lib/changed-class.mjs` is a repo-level script, like
  `scripts/lib/tracked.mjs` beside it.
- `npm run check:root-scripts` is unaffected: no npm script is added or
  removed. `ci:local` keeps its name and its meaning.
- The one behavioural change a contributor sees is that `ci:local` gets
  faster on documentation and tracker changes, and prints a skip list it
  did not print before.

## Open decisions (for review)

- **Whether `--all` or condition-awareness is the default.** Option A
  (recommended): conditions apply by default, `--all` forces everything.
  This makes the local run match CI, which is the whole point, and the
  escape hatch exists for the case where someone distrusts the
  classifier. Option B: the full run stays the default and `--changed`
  opts in, which is safer against a classifier bug but leaves the
  three-minute tracker run in place for everyone who does not know the
  flag exists -- and a fast path nobody takes is not a fast path.
  Recommend A, on the grounds that the classifier is shared with CI, so
  a bug in it is a CI bug and will be found by CI.

- **What the local base ref is when `origin/main` is stale or absent.**
  Option A (recommended): fall back to running every gate, printing why.
  A missing base is exactly the unknown case, and the whole design says
  unknown means run. Option B: `git fetch origin main` first, which is
  network I/O inside a gate runner and can fail in an offline container.
  Recommend A; B turns a fast local check into something that can hang.

- **Whether the skip list belongs in the summary or behind a flag.**
  The summary is eight to seventeen extra lines on a docs change.
  Recommend printing it: a runner that silently does less than it used
  to is how a fast path becomes a hole, and the lines are the evidence
  that it did the right less.

## Risks and testing

- **The risk that matters is skipping a gate CI will run**, which
  converts a green local pass into a red push. Three things guard it:
  the shared classifier (a divergence is impossible rather than
  unlikely), the fail-open rule for unrecognised conditions, and
  `gates.test.mjs` cases that assert the verdict for each condition form
  present in `ci.yml`.
- **The condition parser is the fragile part**, and it has a known trap
  already: `test:optimizer` writes its `if:` _before_ its `run:`, so a
  forward-only scan misses it and the gate would run unconditionally.
  That direction is safe, which is why it must be tested rather than
  reasoned about -- a test that only ever sees the safe direction proves
  nothing. The test plants both orderings.
- **The counts are the tell**, as they were for `check-no-nul`
  (barwise-905). `--list` printing "11 run, 17 skipped" is what makes a
  classifier that silently matches nothing visible; a runner that says
  only "ok" cannot show it has lost half its coverage.
- Per WS1's acceptance, the classifier is checked against real recent
  pull requests before `ci.yml` depends on it, not only against
  synthetic path lists.

## Non-goals

- No change to which gates exist, what they check, or CI's own
  classification.
- No caching, no parallelism, no incremental test selection inside a
  gate. This spec decides _whether_ a gate runs, never how fast it is
  once it does.
- No git-hook installation. barwise-950 owns that, and it is a decision
  about shared environment setup rather than a script change.
