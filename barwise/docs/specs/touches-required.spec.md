# New specs declare `Touches:`, checked by `check:spec-touches`

Status: Implemented 2026-10-25 (workstream 1: the new-spec rule in
check:spec-touches against a fixed cutoff commit, the git readings shared
with check:plan-review in lib/git-run.mjs, and the wording in spec-writer,
the template, pr-creation and the session hook; see Implementation notes
for where it departs from the reviewed plan)

Created: 2026-10-24
Last-updated: 2026-10-25
Tracking: barwise-ef0
Plan-reviewed: d8e49646 (code-review, pr-review; re-pointed after the owner's decisions, which adopt the recommended options)
Touches: barwise/scripts/check-spec-touches.mjs, barwise/scripts/check-plan-review.mjs,
+barwise/scripts/lib/git-run.mjs, barwise/scripts/lib/spec-reader.mjs,
barwise/scripts/measure-touches-required.mjs,
barwise/scripts/tests/spec-reader.test.mjs, barwise/scripts/tests/gates.test.mjs,
barwise/scripts/tests/expected-counts.json, .github/workflows/ci.yml,
.claude/hooks/session-start.sh, barwise/correction-baseline.json,
.claude/skills/spec-writer/SKILL.md, .claude/skills/spec-writer/template.spec.md,
.claude/skills/pr-creation/SKILL.md, barwise/docs/specs/plan-scope-check.spec.md

In one sentence: `check:spec-touches` fails any run over a tree holding a
corpus spec whose file name was nowhere under `barwise/docs/specs/` at a
fixed cutoff commit, unless the spec's `Touches:` has an entry standing
for a tracked path outside that directory, so a new spec can no longer
step outside the plan-review rule by leaving the header out, writing a
placeholder, or naming itself.

## Principle

A gate that cannot see its input must not print PASS (root `CLAUDE.md`).
`check:plan-review` holds a pull request to its spec's plan only through
`Touches:`, and a spec without the header is skipped:

```
// No declaration, no plan to hold the diff against. check:spec-touches
// owns an empty one.
if (entries.length === 0) continue;
```

(`barwise/scripts/check-plan-review.mjs`). The gate then prints OK, and
the reader cannot tell "the plan was reviewed" from "there was no plan to
look at". `plan-scope-check.spec.md` WS6 measured the cost: 140 of the 146
merges in its reach population named only specs without `Touches:`. The
owner decided on 2026-10-24 that new specs must declare it, enforced by a
check, and existing specs need not.

For a new spec the missing input is one the author can supply, so the
answer is a finding (exit 1), not a refusal (exit 2). It belongs in the
gate that already owns what a `Touches:` header must say, so the skip in
`check:plan-review` becomes unreachable for a new spec without a second
reader of `Touches:` entries.

## Scope

In scope:

- When the tree holds a new spec (defined below) with no `Touches:` field
  in its header block, `check:spec-touches` shall exit 1 and name it.
- When the tree holds a new spec whose `Touches:` has entries but none
  that satisfies the rule (below), `check:spec-touches` shall exit 1 and
  name it.
- When the tree holds a new spec with an empty `Touches:`, the existing
  "has no entries" finding shall report it, once; the new rule adds no
  second finding.
- A spec whose file name was under `barwise/docs/specs/` at the cutoff --
  edited, deleted, archived, moved between directories or restored from
  `archive/` -- is exempt.
- Files under `barwise/docs/specs/archive/`, under `barwise/docs/adr/`,
  and non-spec documents are outside the rule.
- When the cutoff is not in the clone, or git cannot answer, the gate
  shall exit 2 (below), after printing any finding the tree rule has.
- `spec-writer`, the template's `Touches:` comment, `pr-creation` and the
  session hook's unshallow warning shall say what the rule needs.

Out of scope: specs whose file name existed at the cutoff, whether or not
they declare `Touches:`; the plan-review rule itself, unchanged.

## Who is exempt? (resolved: what existed at the cutoff, by file name)

`TOUCHES_REQUIRED_SINCE` in `barwise/scripts/lib/spec-reader.mjs` is the
cutoff: `014a4602`, the merge base of the branch that landed this rule. A
corpus spec is **existing** when a file with its name is anywhere under
`barwise/docs/specs/` (the corpus or `archive/`) in that commit's tree,
and **new** otherwise.

The cutoff stays reachable whatever happens to the branch: it is a commit
main already held before the branch was cut, so a merge commit, a squash
or a rebase of the branch leaves it in main's history, and every full
clone holds it.

Consequences, stated because the obvious summary ("the specs that predate
the rule are exempt") hides two of them:

- Every spec on main at the cutoff -- 152 on 2026-10-24, of which 8
  declared `Touches:` -- is existing, on every branch, for good.
- A spec merged to main after the cutoff but before this rule landed is
  judged by it. There was one on 2026-10-25,
  `nary-mandatory-verbalization.spec.md` (#783), and it declares a tracked
  path. The check is to merge main into the branch and run the gate before
  merging.
- A spec written on a branch not yet merged is new and must satisfy the
  rule. The 2026-10-24 snapshot found one live such branch,
  `claude/dazzling-cannon-qy6uin` (`surface-mirroring.spec.md`).
- A spec moved between `archive/` and the corpus, or between
  directories, keeps its name and stays existing. A rename to a new file
  name, and the parts of a split that take new names, read as new: a new
  name is absent at the cutoff, and a part with a new name is a new
  document with its own plan (Open decision 2).

File name, not path, because a move is exactly the case the owner's
"existing specs are exempt" covers. Measured in the window below: 51 of
the 52 additions under `archive/` were moves, there were no renames
within the corpus, and all 151 added specs were new by this definition.

A fixed commit, not each change's base, because a moving base exempts
whatever it has already absorbed. Judged against a push's before-SHA, a
spec pushed straight to main was existing for the next push, and so exempt
for good; `concurrency: cancel-in-progress` on main could cancel the one
run that would have caught it. Against a fixed commit, a spec that lands
by any route fails every later run until it declares `Touches:`.

## What satisfies the rule? (resolved: an entry standing for a real path)

`Touches: +none` passes the tree rule, because a `+` entry is a file the
plan creates and may be absent. So the rule is not "has a `Touches:`
field". A new spec satisfies it when one of its entries stands for at
least one path outside `barwise/docs/specs/` (`newSpecVerdict` and
`newSpecEntryPaths` in `lib/spec-reader.mjs`):

- an unmarked entry, expanded against the tracked tree the way the audit
  expands it -- a pattern or `x/` to what it matches, a plain path to
  itself, which the tree rule already holds to a tracked file; or
- a `-` entry naming a path, or a directory with or without its trailing
  slash, tracked at the cutoff, in the current tree, or at any commit
  between the cutoff and HEAD.

`+` entries never count. A plan that only creates files still registers
them somewhere tracked (a `package.json` script, a barrel, `ci.yml`,
`expected-counts.json`), and that file is its satisfying entry.

Paths under `barwise/docs/specs/` never count: the spec's own path, or the
directory, is tracked as soon as the spec is, so naming it would satisfy
the rule by naming the plan instead of what the plan changes.
`check:plan-review` drops a spec's own file from its implementation for
the same reason. The test is on the expanded paths, not the entry's text,
so `barwise/docs/` (where the directory holds only specs), a pattern
matching only the spec, and `-barwise/docs/specs` without its slash all
fail.

The `-` window reaches past the cutoff because the cutoff ages. Checked
against the cutoff alone, a file created after it and deleted by the plan
could never satisfy a `-` entry, and the same entry left unmarked fails
the tree rule once the deletion lands.

A deliberate lie (`Touches: README.md`) still passes; that is a review
matter, and a Tripwire.

## Which check carries it? (resolved: `check:spec-touches` -- Open decision 1)

`check:spec-touches` already runs on every event, already owns what an
entry must say (the empty-header finding, the `+`/`-` marks), and the
satisfying-entry rule is a rule about entries. With a fixed cutoff it
needs no base, so it runs as one step on pull requests and pushes alike,
with no `BASE_SHA`.

| Need                | `check:spec-touches`                             | `check:plan-review` alternative          |
| ------------------- | ------------------------------------------------ | ---------------------------------------- |
| Runs on PR and push | yes, one step, as before                         | PR step plus a new push step with a flag |
| What "new" means    | absent at the fixed cutoff                       | added since the PR's base                |
| Git readings        | `lib/git-run.mjs`, shared with check:plan-review | has them                                 |
| Entry rules         | has them                                         | would re-read entries a second way       |
| Tests               | a git sandbox for the rule; fixtures unchanged   | the `planRepo` sandbox                   |

`check:plan-review` could not carry it: on a push of a squash merge (70 of
the 488 first-parent commits in the window) the commit a `Plan-reviewed:`
line names is not an ancestor of the squash commit, so its review rule
would turn main red, and carrying the rule there would need a flag that
switches half that gate off.

The two gates share their git readings, not a base: `lib/git-run.mjs`
gives each a `run` that throws with git's first error line, an `answers`
that reads exit 0 as yes, 1 as no and anything else as a failure, and a
`commit` that reads `rev-parse --verify --quiet` exit 1 as "no such
commit" and anything else as a failure. Each gate turns a throw into its
own refusal.

## Which text is read? (resolved: the working tree)

The rule reads the specs the tree rule reads: tracked paths, from the
working tree. A committed, staged or unstaged edit is judged alike, so a
plain `ci:local` before a commit sees what CI will, and an untracked spec
is named as unchecked by both rules. Under the `--tracked` and `--specs`
fixture overrides the rule is not applied, and the OK line says so, and
that a `--cutoff` given with them was ignored.

## Refusals (resolved: exit 2, after the tree rule's findings)

The tree rule refuses as before (an unreadable or empty tracked list, an
unreadable spec). The new rule refuses when:

- the cutoff is not in the clone. The message names
  `git fetch --unshallow` when the clone is shallow, and
  `git fetch origin main` when it is not;
- `--cutoff` names no single commit (unknown, or an ambiguous
  abbreviation). The message is about the revision; no fetch mends it;
- `rev-parse --verify` fails with anything but "no such commit", or any
  other git command fails, or git lists no files at the cutoff. No fetch
  advice: fetching would not mend it.

A shallow clone that holds the cutoff answers: the rule reads one tree and
no history. A fresh shallow session clone may not hold it, so the session
hook's failed-unshallow warning names `check:spec-touches` beside
`check:secrets`.

When the tree rule has findings and the new rule refuses, the findings
print first and the exit is 1: they fail the change whatever the new rule
would have said. Without findings, the refusal exits 2.

## Measured: what the rule would have flagged

Over the 488 first-parent commits on `origin/main` from 2026-07-01 to
`7ffea343` (417 merge commits, 70 squash merges, 1 direct commit), each
read as `merge-base(C^1, head)...head` with head the second parent of a
merge and the commit itself otherwise. Every number below is printed by
`npm run measure:touches-required -- --ref 7ffea343`
(`barwise/scripts/measure-touches-required.mjs`, which calls the gate's
own `newSpecVerdict`), except the branch rows, which add `--branches` and
read live remote refs.

| Population                                                     | Count                    |
| -------------------------------------------------------------- | ------------------------ |
| PRs adding at least one corpus spec                            | 131 (151 specs, all new) |
| -- that would exit 1                                           | 125 (143 specs)          |
| -- of those, also changing files outside `docs/` and `.beads/` | 94                       |
| PRs adding a spec after `Touches:` entered the template (#723) | 4, none flagged          |
| Unmerged remote branches flagged (2026-10-24 snapshot)         | 2 (named above)          |

No flagged spec had a `Touches:` that failed only the satisfying-entry
rule: the 143 have no header at all, and the 8 with one satisfy it.

Two readings follow. Going forward the rule costs little: the 4 PRs since
the template carried the header all declared it. And it gives
`check:plan-review` reach, up to a ceiling: reproducing WS6's population
over the same commits (a named spec, new or claiming nothing built, and a
diff outside `barwise/docs/` and `.beads/`) gives 154 PRs; 97 named a new
spec, 94 of those without `Touches:`. **94 is a ceiling, not a count of
recovered PRs**: the plan-review rule applies only where the declared
paths overlap what the PR changes, which these specs, never having
declared any, cannot show. The other 57 named only existing Draft specs,
51 of them without `Touches:`, and stay outside the rule by the owner's
decision.

ADRs and archived specs: 4 ADRs and 52 archived specs were added in the
window, none with `Touches:`. Both stay exempt: an ADR records a rule,
not a change to files, and `template.adr.md` has no `Touches:` field; an
archived spec is a frozen record (`inSpecCorpus`'s own comment).

## Alternatives considered

- **A per-change base (the reviewed plan).** "New" judged against each
  pull request's merge base, or a push's before-SHA. Built first and
  replaced: the before-SHA exempts what it has absorbed (above), a stale
  local `origin/main` failed pre-push on other authors' specs, and the
  base resolution, shallow refusal and three-dot diff made a second copy
  of `check:plan-review`'s plumbing.
- **A frozen list of the existing specs.** Every corpus spec must declare
  `Touches:` unless listed in a baseline. It needs no history either, but
  every archive move of a listed spec (51 in the window) and every
  voluntary adoption of `Touches:` would edit the list in the same
  commit, and a new spec escapes by adding one row. The cutoff commit is
  that list, held by git, with nothing to edit.
- **The rule in `check:plan-review`.** It lost on the push requirement,
  as above. Runner-up in Open decision 1.
- **A new gate.** The cleanest separation, and the most surface: a
  script, a forwarder and a CI step, for the same rule.
- **A cutoff on the `Created:` header.** Of the 152 corpus specs, 147
  carry a `Created:` equal to the day git added them, 3 an earlier day and
  2 none. It would let an author-written date, which 2 specs lack, decide
  what a gate enforces.

## Workstreams

One workstream: the rule and the wording that tells authors about it land
together, since a gate that fails on a rule no instruction states is an
unknown unknown.

### 1. The rule in `check:spec-touches`, and the wording

- `lib/spec-reader.mjs`: `TOUCHES_REQUIRED_SINCE`, the exported
  `SPECS_DIR`, `newSpecEntryPaths` and `newSpecVerdict`.
- `lib/git-run.mjs` (new): `gitAt(root)` with `run`, `answers` and
  `commit`. `check-plan-review.mjs` uses it in place of its own three
  wrappers; no behaviour change.
- `check-spec-touches.mjs`: after the tree rule, when not under fixture
  overrides, resolve the cutoff (`--cutoff <rev>` stands in for it, for
  the tests and for replays; nothing in CI passes it), list its tree, keep
  the corpus specs whose file name it lacks, and judge each by
  `newSpecVerdict`, reading the commits between the cutoff and HEAD only
  when a new spec has a `-` entry. Findings: `<id>: new since the cutoff
  and declares no Touches:` (field absent), or `<id>: new since the
  cutoff, and no Touches: entry names a tracked path outside
  barwise/docs/specs/`. An empty field is left to the existing finding.
  The OK line states the cutoff and how many new specs it checked.
- `measure-touches-required.mjs`: calls `newSpecVerdict` with the merge
  base standing in for the cutoff.
- Tests, in `gates.test.mjs` (`touchesRepo`, a git sandbox whose first
  commit is the cutoff, named with `--cutoff`). Each guard is seen red
  through `scripts/mutate.mjs`:
  - exit 1: no `Touches:`; `+none`, and `+src/a.ts` beside a `-` entry; a
    `-` entry naming nothing tracked; only the spec's own path, or only
    the specs directory; `-barwise/docs/specs`, a pattern matching only
    the spec, and `barwise/docs/`; an unmarked bare `barwise/docs/specs`,
    reported by both rules; a rename to a new name; a staged spec, and an
    unstaged edit that drops `Touches:`; a spec that reached main without
    passing, still failing after a later commit;
  - exit 0: an unmarked entry, a lone `-` entry tracked at the cutoff, and
    `-src` without its slash; a `-` entry for a file created after the
    cutoff, before and after its deletion lands; an existing spec edited,
    archived, restored or moved; an added archived spec, ADR and README;
    a shallow clone that holds the cutoff;
  - an empty `Touches:`: exactly one finding;
  - exit 2: the cutoff absent (with fetch advice); a bad `--cutoff` (no
    fetch advice); `rev-parse --verify` failing with 128 (no fetch
    advice); a shallow clone short of the cutoff; `git ls-tree` failing;
    git listing nothing;
  - the tree rule's findings printed before a refusal, exit 1.

  `spec-reader.test.mjs`: the OK line under fixture overrides, and with a
  `--cutoff` they ignore. Its real-tree test runs the constant.
- `expected-counts.json`: via `npm run test:scripts -- --write`.
- `ci.yml`: the `check:spec-touches` step's comment says what the rule
  needs; no `BASE_SHA`, no new step.
- `spec-writer` SKILL.md (step 8 and the design-gate bullet),
  `template.spec.md` (the `Touches:` comment) and `pr-creation` SKILL.md
  (the readiness line, which says plan-review applies only where the
  declared paths overlap the diff) state the rule.
- `.claude/hooks/session-start.sh`: the failed-unshallow warning names
  `check:spec-touches`.
- `plan-scope-check.spec.md` WS6: the "Reach is the open question" note
  points here.

Acceptance: the gate as built, replayed in a scratch clone with each
commit's head checked out and `--cutoff C^1` -- the old base semantics --
over each commit of the window, names a new spec on exactly the 125 commits
`measure:touches-required -- --ref 7ffea343` lists under `flagged`. With
the constant, it exits 0 on today's tree and on each first-parent main
commit since `7ffea343`.

## Implementation notes (2026-10-25)

The reviewed plan judged "new" against each change's base. Two rounds of
`/code-review` on the build (`f5ebc3c2`, then `38e48bfe`) changed that and
tightened the entry rule; the body above states what ships.

- **A fixed cutoff instead of a base.** Six of the first review's nine
  findings came from the moving base: the before-SHA exemption and
  `cancel-in-progress` (Who is exempt?), a real-tree test that needed a
  fresh `origin/main`, the rule reading HEAD while the tree rule read the
  working tree, pre-push failing on another author's spec through a stale
  `origin/main`, refusals that hid the tree rule's findings, and a
  `lib/pr-base.mjs` that shared only the resolution order. The fixed
  cutoff honours Open decision 4 ("check pushes to main") more strongly
  than the before-SHA did, since every later run checks what landed. The
  `BASE_SHA` line, `lib/pr-base.mjs`, `--head` and the stale-base hint are
  gone.
- **The entry test expands entries.** The first cutoff build compared
  entry text with a prefix, which `-barwise/docs/specs`, a pattern and
  `barwise/docs/` passed. It now expands each entry and requires a path
  outside the specs directory.
- **`-` entries reach past the cutoff** (What satisfies the rule?).
- **Git readings are shared.** `lib/git-run.mjs` replaces the copies of
  the git wrapper and the `rev-parse --verify --quiet` reading in both
  gates.
- **The tests are in `gates.test.mjs`, not `spec-reader.test.mjs`**, as
  the plan said: the rule needs a git sandbox, and `touchesRepo` mirrors
  `planRepo` there.
- **Declined, with reasons:**
  - The cutoff predating this PR's merge. Specs merged to main in between
    are judged by the rule; the check is to merge main and run the gate
    before merging. There is one such spec today, and it declares a
    tracked path.
  - The cost of scanning the cutoff's tree for a `-` directory entry. It
    is negligible at this size.

Verified on 2026-10-25:

- **Mutations.** Every new or changed guard went red under
  `scripts/mutate.mjs`: 20 in the last round, all CAUGHT. Four first
  came back UNCAUGHT. Three tests were too weak: the bare specs directory
  needed a test of its own, `-src` without its slash needed a passing
  case, and `+src/a.ts` needed to sit beside a `-` entry. The fourth was a
  `-` pattern branch that the literal comparison made redundant, so it
  was removed.
- **Acceptance replay.** 488 commits, 125 flagged by the gate, 125 by the
  measure, none missed, none extra, no refusals, and no tree-rule
  findings on any historical tree. The measure's counts are unchanged by
  the expanded entry rule (131 PRs, 151 specs, 8 satisfying, 125 flagged).
- **Fixed-constant replay.** With no `--cutoff`, the gate exits 0 on each
  of the 26 first-parent commits from `7ffea343` to `a6e4929b`: the 24 up
  to the cutoff, and `082c5bd6` and `a6e4929b` after it. The last two
  report one new spec, `nary-mandatory-verbalization.spec.md`, which
  declares a tracked path. On today's tree it exits 0 with that same one
  new spec.

## Open decisions (for review)

**All four resolved 2026-10-24 by the owner, each as recommended:** (1)
`check:spec-touches` carries the rule; (2) a rename to a new file name
reads as new; (3) no escape; (4) pushes to main are checked. Decision 4
was resolved with the push's before-SHA as base; the build checks it
against the fixed cutoff instead, on every run (Implementation notes).

1. **Carrier.** (a) `check:spec-touches` (recommended): it runs on every
   event and owns the entry rules. (b) `check:plan-review`: needs a flag
   and a second CI step for push, because its review rule misfires on
   squash pushes. (c) A new gate: the most surface.
2. **A rename to a new file name.** (a) Reads as new (recommended):
   deterministic, measured zero in the window, and adding a header to a
   renamed spec is cheap. (b) Also exempt what `git diff -M` reports as a
   rename of an existing spec: covers it, at the cost of git's 50%
   similarity heuristic deciding an exemption.
3. **A spec that plans no file change.** (a) No escape (recommended): no
   such spec is known, though the window was not searched for one, and a
   spec that changes nothing has no workstream to review. (b) A declared
   escape spelled one way (`Touches: none`, unmarked), accepted by both
   rules. Revisit on the first real case.
4. **Push to main.** (a) Check it (recommended): a spec landed by direct
   push or `--no-verify` would otherwise be existing for every later
   branch and exempt forever. (b) Accept the bypass as every PR-only gate
   does: simpler, but the exemption it buys is permanent.

## Risks and testing

- The existing fixture tests, the `ROOT_DEPENDENT_GATES` refusal cases and
  `check:plan-review`'s tests pass unchanged with the shared git readings.
- The gate needs the cutoff commit; `fetch-depth: 0` in CI's checkout
  provides it, and a shallow session clone is deepened by the session hook.

## Evidence

`barwise/scripts/measure-touches-required.mjs`, run as
`npm run measure:touches-required -- --ref 7ffea343 --branches` on
2026-10-24; its header documents each definition. The corpus counts and
the `Created:` split come from the same run, read at `--ref`. The template
commit is the first first-parent commit whose `template.spec.md` carries a
`Touches:` line (`9868218e`, #723).

## Tripwires

- If a rename or a split trips the rule, revisit Open decision 2.
- If `Touches:` entries naming unrelated tracked files start appearing on
  new specs, the header has become a target; revisit Open decision 3.

## Non-goals

- No requirement on existing specs, and no change to the plan-review rule
  or to `audit:specs`.
