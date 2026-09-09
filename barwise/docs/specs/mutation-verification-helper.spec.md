# One command for the reading "this test fails on the defect it claims to catch"

Status: Workstreams 1 and 2 implemented; 3 remains open and may not be
built (see Open decisions and Implementation notes)
Created: 2026-09-09
Last-updated: 2026-09-09
Tracking: barwise-906 (verifications keep passing for reasons unrelated
to what they verify; p1, six occurrences, open since 2026-08-29). Its
acceptance criteria name this helper. Follows the same "a finding is not
closed by a document" rule as `docs/specs/duplication-drift-guards.spec.md`
and `docs/specs/deterministic-guards.spec.md`.

## Principle

**Define errors out of existence.** A green test run is evidence only
after the same run has been seen red on the defect the test claims to
catch. That reading is produced by hand today -- copy the file, edit it,
run something, copy it back -- and each hand-rolled spelling is a fresh
chance to pick a step that cannot report failure. Six times now the
chosen spelling could not have produced a red reading, and the operator
believed the green.

The skills already state the rule. `session-review` requires red before
green; `pr-review/checklist.md` repeats it under "when tests changed".
The rule was followed every time and the reading was still worthless,
because the rule governs the _thing under test_ and the failure lives in
the _scaffolding around it_. Restating the rule a seventh time is the
option this spec exists to replace.

Four spellings have failed, each at least once:

1. **The mutation never applied.** An anchor that no longer matches --
   dprint reflowed the line, or the spelling was guessed from memory --
   leaves the file untouched and the suite green. That is
   byte-identical to the reading you get when the mutation applied and
   the test was too weak to catch it. Twice on 2026-09-09: a `sed -i`
   against `spanningRoleLabel`'s multi-line return matched nothing and
   printed `4 passed`, which was nearly read as "this branch is
   covered".
2. **The mutation applied where the check does not look.** A NUL probe
   written as an _untracked_ file, against a gate that enumerates
   through `git ls-files`. The gate printed `OK` and had never seen the
   probe (barwise-905, barwise-906 first occurrence).
3. **The restore was verified by an instrument that cannot fail.**
   `git diff --stat` on an untracked file prints nothing whether the
   file is pristine or corrupt. On a tracked file carrying unrelated
   uncommitted work it prints a nonzero count in both states. Both were
   run under a `=== clean ===` banner in one session (fourth
   occurrence).
4. **The command's exit status was read through a pipe.**
   `echo | sh hook | tail` puts `echo`'s status in `PIPESTATUS[0]`; the
   hook's real status was invisible and two readings came back 0
   (second occurrence).

None of these is a mistake a more careful operator avoids reliably --
the evidence is that six sessions of an operator holding exactly this
rule did not. Each is a step where the correct instrument and a blind
one look the same at the call site. So the fix is not a better rule, it
is removing the step: one command that performs all four and refuses
rather than proceeding when any of them cannot report failure.

## Should the exit code invert? (resolved: yes)

The helper exits **0 when the mutation was caught** -- that is, when the
command under test failed. Inverting reads backwards for a second and
is right, because the helper's output is an assertion about the test
suite, not a re-run of it. `mutate ... && echo verified` should mean
"the guard works", and the composite reading a human wants ("red on the
defect, green without it") is then one command's exit status rather than
two readings to hold side by side.

The refusals are the other arm and they must be distinguishable from
both outcomes, so exit codes are three-valued: `0` caught, `1`
uncaught, `2` the helper refused (anchor missing, anchor ambiguous,
mutation is a no-op, restore did not verify). A caller that treats any
nonzero as failure still behaves correctly; a caller that wants the
distinction has it.

## Scope

In scope:

- When the anchor text does not occur in the target file exactly the
  expected number of times (default once), the system shall exit 2
  without modifying the file, naming the count it found.
- When the replacement text is identical to the anchor, the system
  shall exit 2 without running the command, because a no-op mutation
  cannot produce a meaningful reading.
- When the mutation is applied and the command under test exits
  non-zero, the system shall report the mutation as CAUGHT and exit 0.
- When the mutation is applied and the command under test exits zero,
  the system shall report the mutation as UNCAUGHT and exit 1.
- When the command under test terminates for any reason, including a
  signal or an exception in the helper itself, the system shall restore
  the file before exiting.
- When the restored file's SHA-256 does not equal the pre-mutation
  SHA-256, the system shall exit 2 and print both digests and the path
  of the retained backup, whether or not the file is tracked by git.
- When the command under test is run, the system shall read its exit
  status directly from the spawned process, never through a shell
  pipeline.
- When the target path is given, the system shall resolve it against
  the repo root rather than the process cwd, via
  `scripts/lib/tracked.mjs`'s `REPO_ROOT`.

Out of scope:

- Generating mutations. The operator names the anchor and the
  replacement; the helper does not decide what to break. Automatic
  mutant generation is the `Alternatives considered` entry on Stryker
  and stays there.
- Mutating more than one file per invocation. See Open decisions.
- Running mutations in CI. See workstream 3, which is deliberately not
  part of the first landing.

## Inventory

| Module                                   | Current state                                                   | Verdict                                           |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `scripts/mutate.mjs`                     | does not exist                                                  | new, WS1                                          |
| `scripts/lib/tracked.mjs`                | owns `REPO_ROOT`, exists because `git ls-files` follows cwd     | reused; the helper resolves its target through it |
| `scripts/tests/gates.test.mjs`           | 28 tests, each gate shown red on a planted defect then green    | gains the helper's own red-then-green tests, WS1  |
| `barwise/package.json`                   | 28 scripts                                                      | one added (`mutate`), WS1                         |
| root `package.json`                      | generated forwarder per script, checked by `check:root-scripts` | regenerated in the same commit, WS1               |
| `.claude/skills/session-review/SKILL.md` | states red-before-green as a rule, with no command              | names the command, WS2                            |
| `.claude/skills/pr-review/checklist.md`  | same rule under "when tests changed"                            | same, WS2                                         |
| `.github/workflows/ci.yml`               | 28 gates                                                        | untouched -- see below                            |

**On the `untouched` row**, which is a prediction and therefore the one
nobody re-checks: the helper cannot join the gate list, because it
deliberately breaks the working tree for the duration of a run and CI
runs its gates concurrently against one checkout. What does reach CI is
the helper's own tests, through `test:scripts`, which is already gate 13
of 28. So the helper is exercised on every push without the mutation
mechanism ever running against the repo's own source in CI.

## Target architecture

```
scripts/mutate.mjs                 # the helper; no deps beyond node core
  ├─ reads  scripts/lib/tracked.mjs  -> REPO_ROOT (cwd-independent paths)
  └─ uses   node:crypto  createHash('sha256')   -- restore verification
            node:child_process spawnSync        -- status read directly
            node:fs        copyFile/writeFile   -- backup and restore

  usage:
    node scripts/mutate.mjs \
      --file packages/core/src/validation/rules/completenessWarnings.ts \
      --old  'if (seen.has(id)) return false;' \
      --new  'if (seen.has(id)) return true;' \
      [--count 1] [--backup-dir <path>] \
      -- npx vitest run tests/validation/completenessWarnings.test.ts

  exit:  0 caught (command failed)   1 uncaught (command passed)
         2 refused (anchor, no-op, or restore did not verify)

scripts/tests/gates.test.mjs       # WS1 adds, in a throwaway repo:
  - a mutation an assertion catches      -> exit 0
  - a mutation nothing catches           -> exit 1
  - an anchor that is absent             -> exit 2, file byte-identical
  - an anchor occurring twice            -> exit 2, file byte-identical
  - a sabotaged restore on an UNTRACKED
    file                                 -> exit 2  (barwise-906's AC)
```

## Alternatives considered

- **Stryker Mutator, or another mutation-testing framework.** It
  generates mutants across the suite and reports a survival score, which
  is more than this helper does. It lost on the question being asked,
  not on cost alone: the reading needed here is "did _this_ test catch
  _this_ defect", produced once, during review, on one branch -- and
  Stryker answers "what fraction of generated mutants survive", which is
  a different number and requires N full suite runs to get. The
  coverage gate alone takes about a minute; the whole `ci:local` list
  runs in 2m40s warm. A survival score across `@barwise/core` is an
  overnight job, and nobody would run it inside a review. Worth
  revisiting as a scheduled job once the helper shows how often the
  targeted reading is wanted.

- **A declarative mutation manifest, run in CI.** Each guard names, in
  a JSON file beside `parity.manifest.json`, the mutation that must kill
  it; a gate runs them all. This is the version that turns discipline
  into a mechanism, which is what barwise-906 is actually about. It
  lost the _first_ landing on cost -- each entry is a suite run, so a
  dozen entries is a dozen runs -- and on sequencing: nothing yet says
  which mutations are worth pinning permanently, and a manifest
  populated by guesswork is the ratchet equivalent of a baseline row
  added to make a check pass. Carried as WS3, provisional, and as an
  Open decision.

- **Keep the rule in the skills and write it more precisely.** This is
  what the previous five occurrences did, and `session-review` names it
  as the forbidden third option: "Precision about a recurring failure
  reads like progress and is not."

## Workstreams (each independently shippable)

### 1. The helper, its tests, and its forwarder

`scripts/mutate.mjs`, the five `gates.test.mjs` cases sketched above,
the `mutate` script in `barwise/package.json`, and the regenerated root
`package.json`. First because everything else depends on the command
existing, and it is self-contained: no package source changes, so the
blast radius is the scripts directory and two manifests.

Closes barwise-906's stated acceptance criteria, including its explicit
requirement that the _untracked_ sabotaged-restore case be pinned --
the reading `git diff --stat` cannot produce.

The helper's own tests must themselves be seen red, which is not
circular: they are ordinary `node:test` assertions over the helper's
exit codes and the target file's bytes, planted by hand the same way
the other 28 were.

### 2. Point the skills at the command

`session-review` and `pr-review/checklist.md` each state the
red-before-green rule and neither names a way to do it. Both gain the
invocation. This is a behaviour change to instructions and gets a
code-level review under CLAUDE.md's "instructions are logic": the test
is whether the amended rule would have fired on the case that prompted
it -- specifically, whether an operator following the amended
`checklist.md` would have caught the unpinned `seen` guard of PR #487
rather than reading `30 passed` as coverage.

Separate from WS1 because the command has to exist and be trusted
before a rule points at it, and because a skill edit lands on a
different review path than a script.

The two files naming the same invocation is a copy, and the check it
gets is the one already built for exactly this: `check:book-citations`
resolves the paths a doc cites, so both amended rules cite
`scripts/mutate.mjs` by path and a rename that misses one fails that
gate. No new mechanism, and no "must match" comment.

### 3. A curated mutation manifest run in CI (provisional: not yet grounded)

A JSON file naming, per guard worth pinning, the mutation that must kill
it, and a gate that runs them. Scoped to the _gate scripts_ rather than
package source, because those are the checks whose failure is silent and
whose suites are seconds rather than minutes.

Provisional in two ways a reviewer should hold against it: nothing has
yet measured how many mutations are worth permanent pinning, and the
runtime claim ("seconds, not minutes") is an estimate from
`test:scripts` taking 14s in today's `ci:local`, not a measurement of
the manifest. Ground both before building; if the set is small enough
that WS1 run by hand covers it, this workstream should not exist.

## API and migration impact

- No package source changes and no public exports. `@barwise/core` and
  the surfaces are untouched, so the one-way dependency graph does not
  come into it.
- `barwise/package.json` gains one script, which obliges the root
  `package.json` regeneration in the same commit or
  `check:root-scripts` fails -- the gate exists precisely to catch that
  omission and will.
- No new dependency. The helper uses `node:crypto`,
  `node:child_process` and `node:fs`, per CLAUDE.md's no-trivial-
  dependencies rule.

## Open decisions (for review)

- **Does WS3 happen at all?** Options: (a) build the manifest now, so
  the finding closes on a mechanism rather than a better tool; (b) land
  WS1 and WS2, close barwise-906 against its own written acceptance
  criteria, and open a separate issue for the manifest with a
  measurement attached. **Recommend (b).** The helper is what the
  acceptance criteria ask for, and a manifest populated before anyone
  has used the helper would be guesswork about which mutations matter.
  The honest cost of (b) is that running the helper is still a decision
  someone has to make, which is the thing barwise-906 complains about --
  so (b) is only right if the follow-up issue is real.

- **One file per invocation, or several?** Some mutations are only
  meaningful as a pair (change a rule id in two places). **Recommend
  one**, with the composite case written as a script that calls the
  helper twice: two files means two backups, two restores, and a
  partial-failure state to define, which is complexity paid by every
  reader for a case that has not yet occurred.

- **Where do backups live?** Options: a temp directory (invisible, and
  lost with the container), or `.mutate-backups/` in the repo root,
  gitignored. **Recommend the repo root**, because the retained-backup
  path in a failed-restore message is only useful if the operator can
  reach it, and a failed restore is exactly when the container is about
  to be abandoned.

## Risks and testing

- **The helper corrupts a file it was meant to protect.** This is the
  risk the design is mostly about, and the mitigation is the
  hash-verified restore plus the retained backup. The gate test plants
  a sabotaged restore and asserts the refusal, on an untracked file
  specifically.
- **A run is interrupted.** The restore is in a `finally`, and the
  helper installs handlers for `SIGINT` and `SIGTERM` so a `ctrl-c`
  mid-run does not leave a mutated tree. The gate test does not cover
  the signal path; that is named under Not-covered rather than claimed.
- **The helper is used on a dirty tree.** Legitimate and common -- it
  is a review tool, and a review happens on uncommitted work. Hence
  hashes rather than `git diff`, which is the fourth-occurrence lesson
  stated as a design constraint.
- After WS1: `npm run test:scripts` and the full `npm run ci:local`.
  After WS2: no code changes, so `fmt:check` and a read of the amended
  rules against the case that prompted them.

## Implementation notes

Recorded during WS1 and WS2, so the next revision starts from what was
built rather than from the brief.

- **`restoreOrDie`'s first form could not fail.** It wrote the original
  back and then hashed the file, so the write erased the very state the
  hash was meant to judge and the comparison always passed. That is the
  same defect as barwise-906's own fourth occurrence, reproduced inside
  the script written to prevent it -- which is the strongest argument
  available for why the check has to be a mechanism rather than a rule,
  since the rule was in the author's head at the time.

  It was caught by the untracked-restore test, written before the
  implementation was finished and asserting the intended behaviour
  rather than the observed one. The shipped form checks the file
  against the MUTATED hash before writing anything, then restores and
  checks against the ORIGINAL hash, which catches two distinct
  failures: a command that wrote to its own input, and a restore write
  that did not take.

- **A tampering command is refused even when it "failed".** A command
  that both writes to the target and exits non-zero would otherwise
  read as CAUGHT. The restore check outranks the status, because a
  failure for an unknown reason is not evidence.

- **The helper was verified on itself.** Four mutations planted in
  `scripts/mutate.mjs` through `scripts/mutate.mjs`, each reddening
  exactly the test that claims it: the exit inversion (tests 8 and 9),
  the anchor count (10), the no-op guard (11), the tamper guard (12).
  The target was untracked at the time, which is the case the
  instrument this replaces could not have reported.

- **WS3 is unchanged and still ungrounded.** Nothing in WS1 measured
  how many mutations are worth pinning permanently, so the Open
  decision stands as written.

## Non-goals

- Not a coverage tool and not a replacement for one. Coverage says a
  line executed; this says a test noticed when the line was wrong. The
  `seen` guard of PR #487 was 100% covered and 0% pinned, which is the
  distinction in one example.
- No new capability on any surface. The CLI, MCP server and extension
  are untouched; this is dev tooling, like `audit:duplication`.
- Not a gate. It never runs in the CI gate list, for the reason under
  Inventory.
