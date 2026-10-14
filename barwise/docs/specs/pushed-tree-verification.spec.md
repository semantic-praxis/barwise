# The pre-push run checks the commit being pushed, not the working tree

Status: Draft -- no workstream implemented
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

- When the pre-push hook runs, the system shall run the `ci.yml` gate
  list against a fresh `git worktree` of each pushed commit, with a
  fresh `npm ci` and no shared build cache, and remove the worktree
  afterwards whatever the outcome.
- When the working tree holds files that differ from the pushed commit
  (untracked and not ignored, or modified), the system shall list them
  before the gates run, without failing the push.
- When the worktree cannot be created or `npm ci` fails, the system
  shall exit 2 and name the step, rather than report the gates as
  passed or failed.
- When a script outside `scripts/lib/` lists untracked files itself
  (spells `ls-files --others`), `npm run check:git-listing` shall fail
  and name the shared helper to use instead.
- When `audit:corrections --check` or `audit:specs --check` runs while
  an untracked `.spec.md` exists under `docs/specs`, the system shall
  print each such file as unchecked beside the verdict (barwise-qch).

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

| Module                                                           | Current state                                            | Verdict                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `barwise/.husky/pre-push`                                        | runs `npm run ci:local` in `barwise/`                    | passes each pushed SHA: `ci:local --commit <sha>`                                                |
| `barwise/scripts/ci-local.mjs`                                   | runs the gates in the current tree                       | gains `--commit <sha>`: worktree, `npm ci`, re-run itself there, remove; lists files left behind |
| `barwise/scripts/lib/changed-class.mjs`                          | `uncommittedPaths(cwd)`, `committedPaths(base, cwd)`     | unchanged; supplies the left-behind list and `trial`'s listing                                   |
| `barwise/scripts/measure-comparison.mjs` (`trial`)               | spells `diff --name-only` and `ls-files --others` itself | uses `committedPaths` + `uncommittedPaths`                                                       |
| `barwise/scripts/check-git-listing.mjs`                          | does not exist                                           | new gate; `check:git-listing` script, root forwarder, `ci.yml` step                              |
| `barwise/scripts/lib/tracked.mjs`                                | `refuseUntrackedInput` lists and refuses in one function | split: `untrackedInputs()` lists; `refuseUntrackedInput` and the two notices call it             |
| `barwise/scripts/audit-corrections.mjs`, `audit-spec-status.mjs` | `--check` silent about untracked specs                   | print the unchecked files                                                                        |
| `CLAUDE.md` "The hooks split by cost"                            | quotes about 30 s and 2 min 40 s                         | updated with the measured cost                                                                   |

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

ci-local.mjs --commit <sha>
  1. left behind = uncommittedPaths(ROOT)            print, do not fail
  2. git worktree add --detach <tmp> <sha>           fail -> exit 2
  3. npm ci in <tmp>/barwise                         fail -> exit 2
  4. node <tmp>/barwise/scripts/ci-local.mjs         same gate list, same
       (cwd <tmp>/barwise, no --commit)              if: conditions, its
                                                     exit code is ours
  5. finally: git worktree remove --force <tmp>      always, on SIGINT too

check-git-listing.mjs
  tracked scripts/*.mjs outside scripts/lib/
  fail on "ls-files" ... "--others" in one call; exit 2 on an empty listing

tracked.mjs
  untrackedInputs({ pathspec, suffix }) -> string[]
  refuseUntrackedInput(...)    = untrackedInputs + exit 2   (write paths)
  noteUntrackedInput(...)      = untrackedInputs + print    (check paths)
```

Step 4 re-runs the existing script rather than adding a second runner:
the gate list, conditions, lock and per-run coverage directory from
`local-ci-isolation.spec.md` all apply unchanged, and the lock lands in
the worktree's own `node_modules`.

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
  not change the exit code.

The cost is measured with a source change and with a docs-only change,
and the CLAUDE.md paragraph is updated with the readings. This goes last
because it changes every contributor's push. Workstreams 1 and 2 do not
depend on it.

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

- **Turbo cache in the worktree: cold (recommended) or shared.** Cold
  matches CI and avoids the stale-output failure barwise-r7j recorded,
  at 22 s per source push. Shared is near-free and inherits whatever the
  local cache holds. Recommend cold. The cost is a known number; the
  cache's failure mode is the very thing this spec exists to stop.
- **Several refs in one push: one run per distinct SHA (recommended) or
  only the current branch.** One run per SHA is correct and normally
  means one run. Pushing two branches at different commits then costs
  two runs. Recommend one per distinct SHA.
- **Where the untracked-file notice goes: `--check` output
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
