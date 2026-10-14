# The pre-push run checks the commit being pushed, not the working tree

Status: Workstreams 1, 2 and 3 implemented 2026-10-14. Workstream 3 shares
Turbo's cache, not the cold build decision (A) chose; (A) is reopened (see
Implementation notes)
Created: 2026-10-14
Last-updated: 2026-10-14
Tracking: barwise-vzf (this spec); barwise-qch (workstream 2)

In one sentence: `ci:local` at pre-push runs CI's gate list against a
clean checkout of the commit being pushed, so a green hook describes the
tree CI will build, and the hook names any working-tree file the push
leaves behind.

## Principle

**A gate that cannot see its input must not print PASS**
(`gate-refusal-contract.spec.md`). The pre-push hook's question is "will
CI pass this commit", and it answers by checking a different tree: the
working directory. That tree holds two kinds of thing the commit does
not.

- **Build outputs.** `packages/*/dist` is present locally from earlier
  builds and absent on CI's fresh checkout. On PR #641, commit 7dd1081d
  added a script test that loads `@barwise/core` from `dist`. `ci.yml`
  runs `test:scripts` before `build`, and so does `ci:local`, since it
  parses its step order from `ci.yml`. Locally `dist` already existed and
  the test passed; in CI it did not exist and the test failed. Reproduced
  2026-10-14 in a clean worktree of 7dd1081d: `test:scripts` exits 1, "1
  failing of 282", the CI reading exactly.
- **Files outside the commit.** An untracked or uncommitted file is
  tested locally and never pushed. barwise-qch, barwise-1018 and
  barwise-906 item (1) are this shape at the level of a single gate.

barwise-954 was the first of these: locally the build always ran, and in
CI it was skipped. `ci-local-condition-parity.spec.md` fixed it by
applying `ci.yml`'s `if:` conditions locally. That fixed which steps run.
Neither it nor `local-ci-isolation.spec.md` addressed which tree they run
on.

**Define errors out of existence** settles the shape. One could list
everything a working tree holds that a checkout does not (`dist`,
`.turbo`, `coverage/`, untracked files, uncommitted edits) and hide each
in turn. That list is a must-agree copy of "what a fresh clone lacks",
with nothing to keep it current. A fresh worktree of the pushed SHA is
that state by construction.

## Should the hook refuse a push that leaves files behind? (resolved: no, it names them)

When this was first discussed, refusing a push while the working tree
held untracked or uncommitted files was the proposal. With the gates
running on a clean checkout, that refusal no longer protects the gate
result: the checkout contains exactly what is pushed, so a file left
behind cannot make the hook pass something CI fails. What remains is an
authoring slip, a file the author meant to include. Naming it costs
nothing. Refusing would block every push made while unrelated scratch
work sits in the tree, and a hook that blocks correct work gets bypassed
with `--no-verify`. The hook names the files and lets the push proceed.

## Scope

In scope:

Three requirements follow the recommended default of an open decision,
marked (A), (B) or (C); choosing the alternative in review changes the
lines that carry the mark.

- When the pre-push hook runs, the system shall run the `ci.yml` gate
  list against a fresh `git worktree` of each distinct pushed commit (B),
  with a fresh `npm ci` and a cold build (A), and remove the worktree
  afterwards whatever the outcome.
- While a `--commit` run is in progress, the system shall hold the
  initiating checkout's lock (`node_modules/.ci-local.lock`) from before
  the worktree is created until after it is removed, so a second
  `ci:local` from that checkout stops, as `local-ci-isolation.spec.md`
  requires. Each worktree's own lock does not see the others.
- When the working tree holds files that differ from a pushed commit --
  compared with that commit, not with the current `HEAD` -- the system
  shall list them before the gates run, without failing the push.
- When the worktree cannot be created or `npm ci` fails, `ci:local`
  shall exit 2 and name the step, rather than report the gates as
  passed or failed.
- When `ci:local --commit` exits 2, the hook shall say the commit could
  not be checked, not that CI would fail, and block the push. Exit 1 keeps
  today's message. Today the hook maps every nonzero status to one
  message, so a refusal reads as a failure.
- When a tracked `.mjs` file under `barwise/scripts/` outside
  `scripts/lib/` lists untracked files itself (spells
  `ls-files --others`), `npm run check:git-listing` shall fail and name
  the shared helper to use instead. Shell scripts and hooks are out of
  the rule: they cannot import the helper, and none of the eleven tracked
  today lists untracked files.
- When `audit:corrections --check` or `audit:specs --check` runs while
  an untracked `.spec.md` exists under `docs/specs`, the system shall
  print each such file as unchecked beside the verdict (barwise-qch), and
  keep its exit code (C).

Out of scope:

- **barwise-1049** (refusal paths tested only by hand-chosen
  mutations). It shares this spec's motive, a green reading that could
  not have been red, and nothing else: its instrument is a mutation sweep
  with a ratchet baseline, already designed in the issue, and it gets
  its own spec.
- **barwise-1045** (`ci:local` does not check the Node version).
  Another way a green pre-push can mean nothing, on another axis. A
  worktree inherits whatever Node runs the hook.
- **barwise-975** (shallow clones). A worktree shares the repository's
  object store, so a shallow clone stays shallow. Unchanged.
- A plain `npm run ci:local` keeps checking the working tree. That is the
  right question before a commit, and it stays fast.

## Inventory

| Module                                                           | Current state                                            | Verdict                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `barwise/.husky/pre-push`                                        | runs `npm run ci:local`; any nonzero exit is one message | one `ci:local --commit <sha>` per distinct SHA; separate messages for exit 1 and exit 2 |
| `barwise/scripts/ci-local.mjs`                                   | runs the gates in the current tree, under a lock         | gains `--commit <sha>`: lock, worktree, `npm ci`, re-run itself there, remove, unlock   |
| `barwise/scripts/lib/changed-class.mjs`                          | `uncommittedPaths(cwd)` compares with `HEAD` only        | gains `pathsDifferingFrom(sha, cwd)`; existing helpers supply `trial`'s listing         |
| `barwise/scripts/measure-comparison.mjs` (`trial`)               | spells `diff --name-only` and `ls-files --others` itself | uses `committedPaths` + `uncommittedPaths`                                              |
| `barwise/scripts/check-git-listing.mjs`                          | does not exist                                           | new gate; `check:git-listing` script, root forwarder, `ci.yml` step                     |
| `barwise/scripts/lib/tracked.mjs`                                | `refuseUntrackedInput` lists and refuses in one function | split: `untrackedInputs()` lists; `refuseUntrackedInput` and the two notices call it    |
| `barwise/scripts/audit-corrections.mjs`, `audit-spec-status.mjs` | `--check` silent about untracked specs                   | print the unchecked files                                                               |
| `CLAUDE.md` "The hooks split by cost"                            | quotes about 30 s and 2 min 40 s                         | updated with the measured cost                                                          |

Raw git file listing outside `scripts/lib/` today, checked against the
proposed rule:

- **`measure-comparison.mjs:344-345`**: the only hand-rolled untracked
  listing. Copilot found its first version missing untracked files on
  PR #641. It moves to the shared helpers in workstream 1.
- **`audit-spec-status.mjs:140, 160`**: `ls-files --error-unmatch`
  probes one path, and `ls-tree` lists a commit. Neither lists the
  working tree. Allowed.
- **`fault-matrix.mjs:213`** and **`measure-comparison.mjs:111`**:
  `status --porcelain` as a dirty flag. Allowed.
- **`pr-risk.mjs:185`**: `diff --name-status` needs per-file status,
  which the helper does not carry. Allowed.

The rule names `ls-files --others` alone because that is the spelling
that enumerates untracked files, and the one that has gone wrong.

## Target architecture

```
.husky/pre-push
  for each pushed (local ref, sha), sha not all zeros:
    npm run ci:local -- --commit <sha>

.husky/pre-push (status handling)
  exit 1 -> "CI would fail on this push"
  exit 2 -> "this push could not be checked: <step>"   both block the push

ci-local.mjs --commit <sha>
  0. take this checkout's lock; held through step 5
  1. left behind = pathsDifferingFrom(sha, ROOT)     print, do not fail
       = git diff --name-only <sha> (working tree vs sha)
         + untracked, not ignored
  2. git worktree add --detach <tmp> <sha>           fail -> exit 2
  3. npm ci in <tmp>/barwise                         fail -> exit 2
  4. node <tmp>/barwise/scripts/ci-local.mjs         same gate list, same
       (cwd <tmp>/barwise, no --commit)              if: conditions, its
                                                     exit code is ours
  5. finally: git worktree remove --force <tmp>      always, on SIGINT too

check-git-listing.mjs
  tracked barwise/scripts/**/*.mjs outside scripts/lib/
  fail on "ls-files" ... "--others" in one call; exit 2 on an empty listing

tracked.mjs
  untrackedInputs({ pathspec, suffix }) -> string[]
  refuseUntrackedInput(...)    = untrackedInputs + exit 2   (write paths)
  noteUntrackedInput(...)      = untrackedInputs + print    (check paths)
```

Step 4 re-runs the existing script rather than adding a second runner:
the gate list, conditions and per-run coverage directory from
`local-ci-isolation.spec.md` all apply unchanged. The child takes a lock
in the worktree's own `node_modules`, which no other run can see, so the
lock that keeps two runs from one checkout apart is the one step 0 takes
in the initiating checkout. `uncommittedPaths` is not reused for step 1
because it compares with `HEAD`, and a pushed ref need not be the
current one.

## Alternatives considered

- **Hide build outputs before the steps that precede `build`.** Delete
  or move `dist` before `test:scripts`. It fixes the one failure seen and
  none of its relatives. It is the must-agree list the Principle rejects,
  and it destroys the developer's build.
- **A reused worktree, cleaned with `git clean -fdx` between runs.**
  Saves `npm ci` time when the lockfile has not changed. But a clean that
  spares `node_modules` is again a list of what to keep, and a
  `node_modules` reused across lockfile changes is the stale-state bug in
  one more place. The fresh install costs 19 s, measured.
- **Share the Turbo cache with the worktree.** That build took 1 s
  instead of 23 s, measured. But Turbo's cache has already served a stale
  vscode bundle once (barwise-r7j), and CI builds cold. It is offered as
  an open decision, defaulting to cold.
- **Refuse the push when files are left behind.** See the resolved
  question above.
- **Push-time checks only, in the PR skill.** A skill step runs when
  someone remembers. barwise-906 records seven occurrences of this class,
  one of them inside the tool built to close it.

## Workstreams (each independently shippable)

### 1. One untracked listing: `trial` on the shared helpers, and a check that keeps it so

`trial` replaces its two `git` calls with
`[...committedPaths(base, path), ...uncommittedPaths(path)]`, which is
the formula `ci-local.mjs:165` already uses. Its scratch-repository test
is unchanged and must stay green, which is the evidence the swap kept
behavior. `check-git-listing.mjs` enumerates through `trackedFiles()`,
follows the gate-refusal contract, and is registered as an npm script, a
root forwarder and a `ci.yml` step. Its test plants a script that spells
`ls-files --others` and expects exit 1, and is seen red when the check is
neutralized. This goes first because it is the smallest: two files, no
behavior change.

### 2. `--check` names the specs it could not see (barwise-qch)

`tracked.mjs` gains `untrackedInputs()`, and `refuseUntrackedInput`
becomes a caller of it, with no behavior change on the write paths. A
new `noteUntrackedInput()` prints
`unchecked (untracked): docs/specs/x.spec.md` lines after the verdict.
Exit codes do not change: the tracked corpus is still the input by
definition. A test plants an untracked spec in a scratch repository and
asserts the line appears, for both audits. Independent of 1 and 3.

### 3. Pre-push checks the pushed commit

`ci-local.mjs --commit <sha>` as sketched, plus the hook change. Tests:

- A scratch repository whose committed script test passes only when an
  untracked `dist/` file exists: plain `ci:local` reports pass, and
  `--commit HEAD` reports fail. That pair is the defect and its fix in
  one test.
- An unresolvable SHA, and a failing `npm ci` (a lockfile edited to
  disagree), each give exit 2 with the step named.
- The worktree is gone after a pass, a fail, and a refusal.
- The left-behind list names an untracked and a modified file and does
  not change the exit code, including when the pushed SHA is not the
  current `HEAD`.
- A second `ci:local` started while a `--commit` run holds the lock
  stops with the lock message.
- The hook itself, run with ref lines on stdin and a stub `npm` on
  `PATH`: two refs at distinct SHAs give two runs, the same SHA twice
  gives one, a deletion gives none, and a child exit of 1 and of 2 each
  block the push with their own message.

The cost is measured with a source change and with a docs-only change,
and the CLAUDE.md paragraph is updated with the readings. This goes last
because it changes every contributor's push. Workstreams 1 and 2 do not
depend on it.

### How the numbers were taken

On commit 16820341, 2026-10-14, in this session's container (Node
v26.7.0, Intel Xeon 2.80 GHz x4). Times are wall-clock seconds from one
run each:

```
git worktree add --detach <tmp> HEAD                      under 1 s
(cd <tmp>/barwise && npm ci --no-audit --no-fund)         19 s
npx turbo run build --cache-dir=<repo>/barwise/.turbo/cache   1 s (warm shared cache)
npx turbo run build --cache-dir=<new empty directory>         23 s (cold)
du -sh <tmp>                                              543 MB
```

The reproduction of the CI failure was `git worktree add --detach <tmp>
7dd1081d`, then `npm ci` and `npm run test:scripts` in `<tmp>/barwise`,
with no build: exit 1, "1 failing of 282". One run each is enough to
size the cost; workstream 3 measures the hook end to end.

## API and migration impact

- No package API changes. Everything here is in `barwise/scripts/` and
  the hook.
- New npm script `check:git-listing`, with its root forwarder
  (`npm run check:root-scripts` enforces the pair) and a `ci.yml` step.
  `ci:local` picks the step up from `ci.yml` with no edit.
- `expected-counts.json` gains rows for the new tests.
- Push time rises. Measured components: `npm ci` 19 s, a cold build
  23 s. A docs-only push skips the build, as CI does, and pays about
  20 s. A source push pays about 45 s on top of today's 2 min 40 s.
  Workstream 3 replaces these estimates with end-to-end readings.
- `git push --no-verify` remains the escape hatch.

## Open decisions (for review)

The Scope, architecture and workstreams are written against the
recommended default of each. A requirement that depends on one carries
its letter.

- **(A) Turbo cache in the worktree: cold (recommended) or shared.** Cold
  matches CI and avoids the stale-output failure barwise-r7j recorded,
  at 22 s per source push. Shared is near-free and inherits whatever the
  local cache holds. Recommend cold. The cost is a known number; the
  cache's failure mode is the very thing this spec exists to stop.
- **(B) Several refs in one push: one run per distinct SHA (recommended)
  or only the current branch.** One run per SHA is correct and normally
  means one run. Pushing two branches at different commits then costs
  two runs. Recommend one per distinct SHA.
- **(C) Where the untracked-file notice goes: `--check` output
  (recommended), or a refusal.** barwise-qch allows either. A refusal
  would block the authoring-time run, which is the one run that sees an
  untracked spec at all, since the pre-push run no longer can.
  Recommend the notice.

## Risks and testing

- **Disk.** A worktree with `node_modules` measured 543 MB. It is
  removed in a `finally` and on SIGINT, and the test checks removal after
  each outcome. A full disk makes `worktree add` or `npm ci` fail, which
  is exit 2, not a pass.
- **Network.** `npm ci` needs the registry. Offline, the hook refuses
  (exit 2) and `--no-verify` remains. Today an offline push runs the
  gates without needing the network, so this is a real loss, named
  rather than hidden.
- **A gate that reads outside its tree.** Any gate that resolves paths
  from the main checkout rather than its own root would read the wrong
  tree in a worktree. `tracked.mjs` resolves `REPO_ROOT` through
  `git rev-parse --show-toplevel`, which answers the worktree.
  `ci-local.mjs` resolves `ROOT` from its own file location
  (`ci-local.mjs:56`), which is correct only because step 4 runs the
  worktree's copy of the script, not the main checkout's. The first
  end-to-end run in
  workstream 3 is the check. A gate found reading the main checkout is
  fixed in that workstream.
- Every behavior change is proven by a test seen red, through
  `scripts/mutate.mjs`, before it lands.

## Non-goals

- Does not change what CI runs or the order it runs in.
- Does not make plain `npm run ci:local` slower.
- Does not address flaky tests, the Node version, or shallow clones.

## Implementation notes

**Workstream 1, 2026-10-14.**

- **The gate also skips `scripts/tests/`.** The Scope said "outside
  `scripts/lib/`". Tests build scratch repositories and inspect them
  with raw `git` on purpose, to check what the helpers report, so a test
  that spells the command is not a second owner of the listing. Caught
  while writing the gate's own test, which plants exactly that case.
- **`trial`'s new union is a superset of the old listing.** The old
  code diffed the working tree against the base; the new one unions
  `committedPaths(base, path)` (base to `HEAD`) with
  `uncommittedPaths(path)`. A file changed in a commit and reverted in
  the working tree now counts as touched where it did not before. For a
  check that protects an oracle, over-reporting is the safe direction.
  A new case covers work committed on top of the base, which no test
  reached before; removing either half of the union turns a test red.
- **First reading of the gate, before the fix:** exit 1 naming
  `measure-comparison.mjs:345` and nothing else. After: exit 0 over 33
  scripts.
- **The gate passed by hand and failed at pre-push, on itself.** Its
  header comment quoted the command it looks for. Run by hand, the gate
  was still untracked, so `trackedFiles()` could not see it, and it read
  OK over 33 scripts. Once committed, the pre-push run counted 34 and
  failed on line 6. This is workstream 3's defect in miniature: a check
  run before the commit saw a different tree from the one pushed.
  The comment no longer spells the command.

**Workstream 2, 2026-10-14.** Two deviations. The notice prints before
the verdict, not after it as Scope says: on a failing run the verdict is
a long list, and a notice after it is the line a reader scrolls past, while
before it the notice is visible on a passing run, the case that matters.
And the listing applies each audit's own corpus rule, so an untracked spec
under `archive/`, which neither audit reads even once tracked, is neither
named nor a reason to refuse a write (Copilot, PR #646). One test change is
worth naming: the existing `audit-corrections` test asserted that `--check`
did NOT mention an untracked draft. That pinned the blind spot this
workstream removes, so the assertion now requires the
`unchecked (untracked)` line instead. Exit codes are unchanged.

**Workstream 3, 2026-10-14.** Built as sketched, with one simplification:
cleanup deletes the worktree directory and runs `git worktree prune`
instead of also calling `git worktree remove`. Mutation showed the remove
call to be redundant: with it deleted, the tests still passed, and they fail
when either of the remaining two steps is deleted.

**The build is not cold, and the first cost reading was confounded.**
Turbo shares its local cache across worktrees: a fresh worktree with no
`.turbo/cache` of its own reported `LOCAL` cache hits (`turbo run build
--dry=json`) for entries another worktree had written. So the worktree
reuses whatever this checkout's cache holds, and decision (A)'s default,
a cold build, is not what was built: as built it is the shared cache.

The readings, on one machine with nothing else running:

```
ci-local --commit HEAD, first run of new code     392 s  (test:coverage 142 s,
                                                          computed for the first time)
ci-local, in the working tree, same commit        178 s  (test:coverage reused
                                                          the entry the run above wrote)
pre-push hook, --commit, later push               208 s  (npm ci 14 s; build and
                                                          test:coverage from cache)
```

The first pair looked like a 3.5-minute penalty for the worktree, but only
the first run had to compute coverage at all; the second reused its
result. The steady-state cost is the third reading: about 30 s over an
in-tree run, mostly `npm ci`. A truly cold build, which (A) recommended,
would cost the 392 s on every source push. Decision (A) is reopened on
these numbers, with the build as it stands (shared) until it is decided.

The first timing run also caught a real defect: `fmt:check` failed in the
worktree because these files had been committed without formatting. The
in-tree hook could not have seen it, because the working copy was what the
formatter had last touched.
