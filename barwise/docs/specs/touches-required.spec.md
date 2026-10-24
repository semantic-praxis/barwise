# New specs declare `Touches:`, checked by `check:spec-touches`

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-ef0
Plan-reviewed: 2c8cd78f (code-review, pr-review)
Touches: barwise/scripts/check-spec-touches.mjs, barwise/scripts/check-plan-review.mjs,
+barwise/scripts/lib/pr-base.mjs, barwise/scripts/tests/spec-reader.test.mjs,
barwise/scripts/tests/expected-counts.json, .github/workflows/ci.yml,
.claude/skills/spec-writer/SKILL.md, .claude/skills/spec-writer/template.spec.md,
.claude/skills/pr-creation/SKILL.md, barwise/docs/specs/plan-scope-check.spec.md

In one sentence: `check:spec-touches` fails a pull request, or a push to
main, that adds a spec whose file name did not exist under
`barwise/docs/specs/` at the merge base, unless the spec's `Touches:`
header has an entry naming something real, so a new spec can no longer
step outside the plan-review rule by leaving the header out or writing a
placeholder.

## Principle

A gate that cannot see its input must not print PASS (root `CLAUDE.md`).
`check:plan-review` holds a pull request to its spec's plan only through
`Touches:`, and a spec without the header is skipped:

```
// No declaration, no plan to hold the diff against. check:spec-touches
// owns an empty one.
if (entries.length === 0) continue;
```

(`barwise/scripts/check-plan-review.mjs`, line 181). The gate then prints
OK, and the reader cannot tell "the plan was reviewed" from "there was no
plan to look at". `plan-scope-check.spec.md` WS6 measured the cost: 140 of
the 146 merges in its reach population named only specs without
`Touches:`. The owner decided on 2026-10-24 that new specs must declare
it, enforced by a check, and existing specs need not.

For a new spec the missing input is one the author can supply, so the
answer is a finding (exit 1), not a refusal (exit 2). It belongs in the
gate that already owns what a `Touches:` header must say, so the skip in
`check:plan-review` becomes unreachable for a new spec without a second
reader of `Touches:` entries.

## Scope

In scope:

- When a change adds a new spec (defined below) with no `Touches:` field
  in its header block, `check:spec-touches` shall exit 1 and name it.
- When a change adds a new spec whose `Touches:` has entries but none
  that satisfies the rule (below), `check:spec-touches` shall exit 1 and
  name it.
- When a change adds a new spec with an empty `Touches:`, the existing
  "has no entries" finding shall report it, once; the new rule adds no
  second finding.
- When a change edits, deletes, archives, renames within the same file
  name, or restores from `archive/` a spec whose file name existed under
  `barwise/docs/specs/` at the merge base, the new rule shall not apply.
- When a change adds a file under `barwise/docs/specs/archive/`, under
  `barwise/docs/adr/`, or any non-spec document, the new rule shall not
  apply.
- When the base cannot be resolved or git cannot answer, the gate shall
  exit 2 (below).
- `spec-writer`, the template's `Touches:` comment and `pr-creation`
  shall say the header is required on a new spec and name the gate.

Out of scope: specs that existed at the merge base, whether or not they
declare `Touches:`; the plan-review rule itself, unchanged.

## Who is exempt? (resolved: what existed at the merge base, by file name)

The exemption is relative to each change's merge base, not to the day the
rule lands. A spec is **existing** when a file with its name was anywhere
under `barwise/docs/specs/` (the corpus or `archive/`) at the merge base,
and **new** otherwise. Three consequences, stated because the obvious
summary ("the specs that predate the rule are exempt") is wrong:

- On main today the corpus holds 152 specs; 8 already declare `Touches:`
  and 144 do not. Every one of them is existing for any branch cut from
  current main.
- A spec written before the rule on a branch not yet merged is new, and
  fails. The 2026-10-24 snapshot finds two such branches:
  `claude/dazzling-cannon-qy6uin` (`surface-mirroring.spec.md`, last
  commit 2026-10-13) and `claude/laughing-faraday-s0ab90`
  (`model-invariants.spec.md`, which already reached main by squash in
  #713, so that branch is finished work).
- A spec moved between `archive/` and the corpus, or between directories,
  keeps its name and stays existing. A rename to a new file name, and the
  parts of a split that take new names, read as new: a part with a new
  name is a new document with its own plan, and whether a name-changing
  rename should be exempt is Open decision 2.

File name, not path, because `git diff --no-renames` reports a move as
delete plus add, and that is exactly the case the owner's "existing specs
are exempt" covers. Measured in the window below: 51 of the 52 additions
under `archive/` were moves, there were no renames within the corpus and
no restores from `archive/`, and all 151 added specs were new by this
definition.

This is deliberately a different test from `check:plan-review`'s
`atBase === undefined`, which asks whether a Status exists at that path to
read; this one asks whether the document is new. They answer different
questions and need not agree.

## What satisfies the rule? (resolved: an entry naming something real)

`Touches: +none` passes `check:spec-touches` today, because a `+` entry
is a file the plan creates and may be absent. So the rule is not "has a
`Touches:` field". A new spec satisfies it when its `Touches:` has at
least one of:

- an unmarked entry, which the existing check already holds to a tracked
  file, directory or pattern; or
- a `-` entry naming a path tracked at the merge base.

`+` entries alone never satisfy it. A plan that only creates files still
registers them somewhere tracked (a `package.json` script, a barrel,
`ci.yml`, `expected-counts.json`), and that file is its satisfying entry.
All 8 specs that declare `Touches:` on main satisfy this. A deliberate
lie (`Touches: README.md`) still passes; that is a review matter, and a
Tripwire.

## Which check carries it? (resolved: `check:spec-touches` -- Open decision 1)

The first draft recommended `check:plan-review`. Review found that the
rule must also run on push to main (Open decision 4), and
`check:plan-review` cannot: on a push of a squash merge (70 of the 488
first-parent commits in the window) the commit a `Plan-reviewed:` line
names is on the PR branch and not an ancestor of the squash commit, so
the review rule would turn main red for every squash-merged spec that
followed it. Carrying the rule there would need a flag that switches half
the gate off and a second CI step. `check:spec-touches` already runs on
every event, already owns what an entry must say (the empty-header
finding, the `+`/`-` marks), and the satisfying-entry rule is a rule
about entries.

| Need                | `check:spec-touches` after this spec               | `check:plan-review` alternative          |
| ------------------- | -------------------------------------------------- | ---------------------------------------- |
| Runs on PR and push | yes, one step, as today                            | PR step plus a new push step with a flag |
| Base resolution     | new, shared through `lib/pr-base.mjs`              | has it                                   |
| Three-dot diff      | new: one `git diff --name-status -z --no-renames`  | has it                                   |
| Shallow refusal     | new                                                | has it                                   |
| Entry rules         | has them                                           | would re-read entries a second way       |
| Tests               | a git sandbox for the new rule; fixtures unchanged | the `planRepo` sandbox                   |

The base resolution moves out of `check-plan-review.mjs` into
`lib/pr-base.mjs` and both gates import it, so the second reader is not a
copy. `check:tracker-closes` resolves the same base in its own words and
could adopt the module later; that is outside this plan.

## Base resolution (resolved: the PR base, or the push's before-SHA)

`lib/pr-base.mjs` returns `--base <ref>`, else `$BASE_SHA`, else
`origin/main`, and the gate reads the three-dot `base...HEAD`, as
`check:plan-review` does today. `ci.yml` gives the existing
`check:spec-touches` step
`BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}`,
so a pull request is read against its base and a push to main against the
commit main pointed at before the push. Locally, `ci:local` runs the step
with no `BASE_SHA`, so the fallback applies.

Under the `--tracked` and `--specs` fixture overrides the new rule is not
applied, and the OK line says so rather than claiming it.

## Refusals (resolved: three new exit-2 cases)

The tree rule refuses as today (an unreadable or empty tracked list, an
unreadable spec). The new rule adds:

- the base does not resolve, or `$BASE_SHA` is the all-zero SHA GitHub
  sends for a newly created ref;
- a shallow clone (`git rev-parse --is-shallow-repository`), where a
  merge base cannot be trusted;
- any git command failing, including `merge-base`, `diff` and `ls-tree`
  at the merge base; a force push whose before-SHA is no longer reachable
  lands here.

So `check:spec-touches` now depends on history where it used to need only
`git ls-files`: in a fresh shallow session clone it refuses until the
session hook unshallows it. `npm run fault-matrix` measures that change
rather than reading a list.

## Stale `origin/main` at pre-push (resolved: accepted, and the finding says so)

`ci-local.mjs` never fetches (a network call can hang an offline
container), so a stale local `origin/main` widens the range to specs that
merged to main since the last fetch. Once this rule lands, every spec
reaching main has passed it on its PR or on the push, so a stale base can
surface only a spec that reached main without passing, which the push
check has already made red on main. Before landing, it can surface
another author's spec merged without `Touches:` since the fetch. The
finding names the commit that added the spec and says "if that commit is
not yours, `git fetch origin main` and rerun". CI reads the exact base
and cannot misattribute.

## Measured: what the rule would have flagged

Over the 488 first-parent commits on `origin/main` from 2026-07-01 to
`7ffea343` (417 merge commits, 70 squash merges, 1 direct commit), each
read as `merge-base(C^1, head)...head` with head the second parent of a
merge and the commit itself otherwise. Every number below is printed by
`npm run measure:touches-required -- --ref 7ffea343`
(`barwise/scripts/measure-touches-required.mjs`), except the branch rows,
which add `--branches` and read live remote refs.

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

The two real designs differ in how "new" is decided: by history, or by
the tree alone.

- **A frozen list of the existing specs.** Every corpus spec must
  declare `Touches:` unless listed in a baseline of those present when
  the rule lands, failing on a stale row as `audit-baseline.json` does.
  It needs no base and no history. It lost on change amplification:
  every archive move of a listed spec (51 in the window) and every
  voluntary adoption of `Touches:` would edit the list in the same commit,
  and a new spec escapes by adding one row.
- **The rule in `check:plan-review`.** The first draft's choice; it lost
  on the push-to-main requirement, as above. Runner-up in Open decision 1.
- **A new gate.** The cleanest separation, and the most surface: a
  script, a forwarder and a CI step, for the same rule.
- **A cutoff on the `Created:` header.** Specs created after the landing
  date must declare `Touches:`. Of the 152 corpus specs, 147 carry a
  `Created:` equal to the day git added them, 3 an earlier day (drafts
  written 1, 13 and 19 days before they landed) and 2 none. Accurate
  enough, but it would let an author-written date, which 2 specs lack,
  decide what a gate enforces.

## Workstreams

One workstream: the rule and the wording that tells authors about it land
together, since a gate that fails on a rule no instruction states is an
unknown unknown.

### 1. The rule in `check:spec-touches`, and the wording

- `lib/pr-base.mjs` (new): `resolveBase()`, the `--base` / `$BASE_SHA` /
  `origin/main` order, refusing the all-zero SHA. `check-plan-review.mjs`
  imports it in place of its inline resolution; no behaviour change.
- `check-spec-touches.mjs`: when not under fixture overrides, resolve the
  base, refuse a shallow clone, take the merge base, list status `A` in
  `git diff --name-status -z --no-renames <base>...HEAD` that
  `inSpecCorpus` accepts, drop those whose file name `git ls-tree -r` at
  the merge base shows under `barwise/docs/specs/`, and read each rest from
  HEAD. Findings: `<id>: new in this change and declares no Touches:` (field
  absent), or `<id>: new in this change, and no Touches: entry names a
  tracked path` (entries, none satisfying). Each names the adding commit
  and the stale-base hint. An empty field is left to the existing finding.
  The OK line states the base and how many new specs it checked.
  `--head <rev>` stands in for HEAD in the new rule only, as it does in
  `check:plan-review`, so the rule can be replayed over merged history;
  nothing in CI passes it.
- `spec-reader.test.mjs`: a git sandbox (the gate, `lib/`, a main with
  one spec without `Touches:` and one in `archive/`). Cases, each failing
  case seen red first through `scripts/mutate.mjs`:
  - adds a spec without `Touches:`: exit 1, named;
  - adds a spec with `Touches: +none`: exit 1;
  - adds a spec with an unmarked tracked entry, and one with only a `-`
    entry tracked at the base: exit 0;
  - adds a spec with an empty `Touches:`: exit 1 with exactly one
    finding, the existing "has no entries" one; the mutation of the
    field-absent test from `=== undefined` to `!entries?.length` must go
    red;
  - edits the existing spec, moves it to `archive/`, restores an archived
    spec into the corpus, moves a spec between directories: exit 0;
  - adds a file under `archive/`, an ADR, a non-spec Markdown file under
    `docs/specs/`: exit 0;
  - `BASE_SHA` all zeros, an unresolvable base, a shallow clone: exit 2;
  - a name-changing rename: written once Open decision 2 is settled.
- `expected-counts.json`: the new test count, via
  `npm run test:scripts -- --write` in the same commit.
- `ci.yml`: the `check:spec-touches` step gains the `BASE_SHA` line above
  and a comment sentence. No new step.
- `spec-writer` SKILL.md: step 8 gains "`npm run check:spec-touches` fails
  a change that adds a spec without a `Touches:` entry naming a tracked
  path; a spec that existed at the merge base is exempt." The design-gate
  bullet changes "`Touches:` for a new spec" to "`Touches:`, required on a
  new spec, with at least one entry naming a tracked path
  (`check:spec-touches`)".
- `template.spec.md`: the `Touches:` comment gains "Required on a new
  spec, with at least one unmarked entry or `-` entry: `+` entries alone
  do not count, so a placeholder cannot satisfy it (check:spec-touches)."
- `pr-creation` SKILL.md: the readiness line on `check:plan-review` adds
  "`check:spec-touches` fails a PR that adds a spec without a satisfying
  `Touches:`, so a new spec is always in the rule's reach".
- `plan-scope-check.spec.md` WS6: the "Reach is the open question" note
  gains a pointer to this spec.

Acceptance: the gate as built, replayed with `--base C^1 --head <head>`
over each commit of the window, flags the 125 PRs that
`measure:touches-required -- --ref 7ffea343` lists under `flagged`, and
no others.

## Open decisions (for review)

1. **Carrier.** (a) `check:spec-touches` (recommended): it runs on every
   event and owns the entry rules; it gains a base, a diff and a shallow
   refusal. (b) `check:plan-review`: has the base and diff, but needs a
   flag and a second CI step for push, because its review rule misfires
   on squash pushes. (c) A new gate: the most surface.
2. **A rename to a new file name.** (a) Reads as new (recommended):
   deterministic, measured zero in the window, and adding a header to a
   renamed spec is cheap. (b) Also exempt what `git diff -M` reports as a
   rename of a spec at the base: covers it, at the cost of git's 50%
   similarity heuristic deciding an exemption.
3. **A spec that plans no file change.** (a) No escape (recommended): no
   such spec is known, though the window was not searched for one, and a
   spec that changes nothing has no workstream to review. (b) A declared
   escape spelled one way (`Touches: none`, unmarked), accepted by both
   rules. Revisit on the first real case.
4. **Push to main.** (a) Check it, with base the before-SHA
   (recommended): the window had 1 direct commit (tracker-only), but a
   spec landed by direct push or `--no-verify` would otherwise be existing
   for every later branch and exempt forever; the push check turns main
   red at once, while the commit is still the newest. (b) Accept the
   bypass as every PR-only gate does: simpler, and one direct commit in
   488 is rare, but the exemption it buys is permanent.

## Risks and testing

- The existing fixture tests and the `ROOT_DEPENDENT_GATES` refusal cases
  must pass unchanged, as must `check:plan-review`'s tests after the base
  resolution moves.
- On push to main the step now reads history; `fetch-depth: 0` in the
  checkout already provides it.

## Evidence

`barwise/scripts/measure-touches-required.mjs`, run as
`npm run measure:touches-required -- --ref 7ffea343 --branches` on
2026-10-24; its header documents each definition. The corpus counts
(152, 8, 144) and the `Created:` split come from the same run, read at
`--ref`. The template commit is the first first-parent commit whose
`template.spec.md` carries a `Touches:` line (`9868218e`, #723).

## Tripwires

- If a rename or a split trips the rule, revisit Open decision 2.
- If `Touches:` entries naming unrelated tracked files start appearing on
  new specs, the header has become a target; revisit Open decision 3.

## Non-goals

- No requirement on existing specs, and no change to the plan-review rule
  or to `audit:specs`.
