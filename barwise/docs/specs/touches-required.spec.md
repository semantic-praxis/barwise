# New specs declare `Touches:`, checked by `check:plan-review`

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: none yet
Touches: barwise/scripts/check-plan-review.mjs, barwise/scripts/tests/gates.test.mjs,
.github/workflows/ci.yml, .claude/skills/spec-writer/SKILL.md,
.claude/skills/spec-writer/template.spec.md, .claude/skills/pr-creation/SKILL.md,
barwise/docs/specs/plan-scope-check.spec.md

In one sentence: `check:plan-review` fails a pull request that adds a spec
with no `Touches:` header, where "adds" means the spec is in the corpus at
HEAD and absent at the merge base -- the reading the gate already uses for
"new" -- so a new spec can no longer step outside the plan-review rule by
leaving the header out, while the 144 specs that predate the rule stay
exempt.

## Principle

A gate that cannot see its input must not print PASS (root `CLAUDE.md`).
`check:plan-review` holds a pull request to its spec's plan only through
`Touches:`, and today a spec without the header is skipped:

```
// No declaration, no plan to hold the diff against. check:spec-touches
// owns an empty one.
if (entries.length === 0) continue;
```

(`barwise/scripts/check-plan-review.mjs`, line 181). The skip is silent:
the gate prints OK and the reader cannot tell "the plan was reviewed" from
"there was no plan to look at". `plan-scope-check.spec.md` WS6 measured
the cost -- 140 of the 146 merges in its reach population named only specs
without `Touches:` -- and the owner decided on 2026-10-24 that new specs
must declare it, enforced by a check, while existing specs need not.

For a new spec the missing input is one the author can supply, so the
answer is a finding (exit 1) rather than a refusal (exit 2), and it
belongs in the gate that has the hole. Explicit over implicit argues for
the declaration; it does not argue for a second gate that re-derives what
`check:plan-review` already computes.

## Scope

In scope:

- When a pull request's three-dot diff adds a file that `inSpecCorpus`
  accepts (under `barwise/docs/specs/`, ending `.spec.md`, not under
  `archive/`) and that file has no `Touches:` field in its header block at
  HEAD, `check:plan-review` shall exit 1 and name the spec.
- When a pull request edits, archives, or deletes a spec that existed at
  the merge base, the new rule shall not apply, whatever that spec's
  header says.
- When a pull request adds a file under `barwise/docs/specs/archive/`,
  under `barwise/docs/adr/`, or anywhere else outside the spec corpus,
  the new rule shall not apply.
- When git cannot answer (shallow clone, failed command, no merge base),
  the gate shall exit 2, as it does today; the new rule adds no refusal of
  its own.
- `spec-writer` (step 8 and the design gate), the template's `Touches:`
  comment and `pr-creation`'s readiness line shall say the header is
  required on a new spec and name the gate.

Out of scope: requiring `Touches:` on the 144 existing specs (the owner's
decision); a `Touches: none` escape for a spec that plans no file change
(Open decision 3); the review rule itself, which is unchanged.

## What counts as new? (resolved: absent at the merge base, path-wise)

A spec is new when its path is in the corpus at HEAD and `git ls-tree` at
the merge base does not hold it. That is the test `check:plan-review`
already runs (`atBase === undefined`) to decide that a spec's Status need
not be read, and it equals status `A` in `git diff --name-status
--no-renames <base>...HEAD`, the diff the gate already reads. One
definition of "new" in one gate; a second, rename-aware definition beside
it would be a must-agree copy.

The cost is that a renamed spec counts as new. Measured over every
first-parent commit on main since 2026-07-01: zero renames within the
corpus and zero moves from `archive/` back into it, against 51 moves into
`archive/` (which the corpus filter excludes). Open decision 2 keeps the
alternative visible.

## Which check carries it? (resolved: `check:plan-review`, provisionally -- Open decision 1)

`check:plan-review` already has every input the rule needs and every
refusal it should give:

| Need                           | `check:plan-review` today                               | `check:spec-touches` today        |
| ------------------------------ | ------------------------------------------------------- | --------------------------------- |
| Base resolution                | `--base`, else `$BASE_SHA`, else `origin/main`          | none: reads the tree only         |
| Three-dot diff                 | `git diff --name-status -z --no-renames base...head`    | none                              |
| "New in the PR"                | `holds(mergeBase, spec)` is false                       | none                              |
| Spec text at HEAD              | `git show head:spec`                                    | working tree read                 |
| Shallow-clone refusal (exit 2) | yes                                                     | not needed today                  |
| CI wiring                      | pull requests only, `BASE_SHA` passed (`ci.yml` l. 199) | every event (`ci.yml` l. 186)     |
| Local run                      | `ci:local` at pre-push, base `merge-base origin/main`   | `ci:local`                        |
| Fixture overrides              | a sandbox repository (`gates.test.mjs`)                 | `--tracked` and `--specs`, no git |

Putting the rule in `check:spec-touches` means adding the first five rows
to a gate that has none of them, a third copy of the base resolution that
`check:tracker-closes` and `check:plan-review` each carry, and a rule that
is vacuous on the push-to-main run the step also makes. A new gate adds
all of that plus a script, a forwarder and a CI step. In
`check:plan-review` the rule is a branch of one loop it already runs.

The request named `check:spec-touches` and a new gate as candidates. This
spec recommends a third, an existing check, so the carrier is Open
decision 1 rather than settled.

## Base resolution (resolved: unchanged)

Inherited from `check:plan-review`: `--base <ref>`, else `$BASE_SHA`
(ci.yml passes `github.event.pull_request.base.sha`), else `origin/main`,
read as the three-dot `base...HEAD`. `check:tracker-closes` resolves the
same way, spelling the fallback as `git merge-base origin/main HEAD`;
`ci-local.mjs` treats the `if: github.event_name == 'pull_request'` step
as one the push will meet and runs it at pre-push.

A stale local `origin/main` widens the range to include specs merged to
main since the last fetch. Those reached main through this gate once it
lands, and every spec merged since `Touches:` entered the template (#723)
declares it (below), so the widening cannot produce a false failure
unless `origin/main` predates #723.

## Refusals (resolved: none new)

The rule reads only what the gate reads already, so it inherits the
gate's exit-2 cases and adds none:

- a shallow clone (`git rev-parse --is-shallow-repository`);
- any git command failing, including `ls-tree` at the merge base and
  `show` at HEAD;
- no merge base between base and head;
- an unknown repository root (`lib/tracked.mjs`, covered by
  `ROOT_DEPENDENT_GATES` in `gates.test.mjs`).

A new spec without `Touches:` is a finding (exit 1), never a refusal: the
author can fix it. A new spec with an empty `Touches:` is already exit 1
in `check:spec-touches`; this gate leaves it there.

## Measured: what the rule would have flagged

Over all 488 first-parent commits on `origin/main` since 2026-07-01 (417
merge commits, 70 squash merges, 1 direct commit), each read as
`merge-base(C^1, head)...head` with head the second parent of a merge and
the commit itself otherwise:

| Population                                                  | Count                    |
| ----------------------------------------------------------- | ------------------------ |
| PRs adding at least one corpus spec                         | 131 (151 specs)          |
| -- adding a spec without `Touches:` (would exit 1)          | 125 (143 specs)          |
| -- of those, also changing files outside `docs/`, `.beads/` | 94                       |
| PRs adding a spec after #723 put `Touches:` in the template | 4, all declare it: 0 hit |
| Unmerged remote branches that would fail today              | 1 of 7 (from 2026-10-13) |

Two readings follow. The rule is close to free going forward: authors
adopted the header as soon as the template carried it, so it pins a habit
rather than imposing one. And it is what gives `check:plan-review` reach:
reproducing WS6's population over the same 488 commits (a named spec, new
or claiming nothing built, and a diff outside `barwise/docs/` and
`.beads/`) gives 154 PRs; 97 named a new spec, 94 of them without
`Touches:`. Those 94 are the reach this rule recovers. The other 57 named
only existing Draft specs, 51 without `Touches:`, and stay outside the
rule by the owner's decision.

The flagged branch is `claude/dazzling-cannon-qy6uin`
(`surface-mirroring.spec.md`). A second, `claude/laughing-faraday-s0ab90`,
also shows an added spec, but its spec reached main by squash (#713), so
the branch is finished work.

ADRs and archived specs: 4 ADRs and 52 archived specs were added in the
window, none with `Touches:`; 51 of the 52 archive additions were moves.
Both stay exempt: an ADR records a rule, not a change to files, and
`template.adr.md` has no `Touches:` field; an archived spec is a frozen
record (`inSpecCorpus`'s own comment).

## Alternatives considered

The two real alternatives differ in how "new" is decided, by history or
by the tree.

- **A frozen list of the existing specs, in `check:spec-touches`.** Every
  corpus spec must declare `Touches:` unless listed in a baseline of the
  144 that predate the rule, failing on a stale row the way
  `audit-baseline.json` does. Tree-only: no base, no shallow refusal, and
  it would also catch a spec pushed straight to main. It lost on change
  amplification: every archive move of a listed spec (51 in the window)
  and every voluntary adoption of `Touches:` would have to edit the list
  in the same commit, and a new spec escapes by adding one row, a diff
  only a reviewer reads.
- **The diff rule in `check:spec-touches`.** Same behaviour as the chosen
  design, at the cost in the carrier table above. Its advantage is that
  every `Touches:` finding prints from one step. It is the runner-up in
  Open decision 1.
- **A new gate (`check:new-spec-touches`).** The cleanest separation of
  concerns, and the most surface: a script, a forwarder, a CI step and a
  third base resolver, for a rule of a few lines.
- **A cutoff on the `Created:` header.** Specs created after the landing
  date must declare `Touches:`. 147 of 152 corpus specs carry a `Created:`
  equal to the day git added them, so the header is accurate, but 2 carry
  none, and the rule would make an author-written date decide what a gate
  enforces. Set aside.

## Workstreams

One workstream: the rule and the wording that tells authors about it land
together, because a gate that fails on a rule no instruction states is the
unknown unknown this repository keeps paying for.

### 1. The rule in `check:plan-review`, and the wording

- `check-plan-review.mjs`: in the per-spec loop, before the
  `entries.length === 0` skip, when the spec is absent at the merge base
  and `touches(text)` is `undefined`, record a finding and continue. The
  finding names the spec and says why: `<id>: new in this pull request and
  declares no Touches: header; list the paths the plan changes
  (spec-writer template).` The FAIL summary counts the two classes
  separately and prints the review footer only when a review finding
  exists. The OK line states how many new specs it checked. The header
  comment gains a WHICH SPECS sentence for the rule and the measurement
  above.
- `gates.test.mjs`: the `planRepo` fixture's `spec()` gains a `touches`
  option (omit the field when `null`). Cases: a branch adding a spec
  without `Touches:` exits 1 naming it, with and without implementation
  commits; a branch editing a spec on `main` that has no `Touches:` exits
  0; a branch moving that spec to `archive/` exits 0; a branch renaming it
  within the corpus exits 1 (pins Open decision 2); a branch adding a file
  under `archive/`, an ADR, and a non-spec Markdown file under
  `docs/specs/` exits 0. Each failing case is seen red through
  `scripts/mutate.mjs` with the new branch disabled. The existing
  plan-review cases all write `Touches:` and are unaffected.
- `ci.yml`: the comment above `check:plan-review` gains one sentence for
  the rule. No step changes.
- `spec-writer` SKILL.md, step 8: after the sentence naming
  `check:plan-review`, add "It also fails a PR that adds a spec without
  `Touches:`; a spec that predates the rule is exempt." The design-gate
  bullet changes "`Touches:` for a new spec" to "`Touches:`, required on a
  new spec (`check:plan-review`)".
- `template.spec.md`: the `Touches:` comment gains "Required on a new
  spec: check:plan-review fails a pull request that adds a spec without
  it, because the plan-review rule can only hold a PR to a declared plan."
- `pr-creation` SKILL.md: the readiness line that says the gate "covers a
  spec the PR names that declares `Touches:`" adds "and fails a PR that
  adds a spec without it".
- `plan-scope-check.spec.md` WS6: the "Reach is the open question" note
  gains a pointer to this spec.

Acceptance: replaying the gate as built over the window above
(`--base C^1 --head <head>`) flags the 125 PRs in the table for the new
rule, and no others.

## Open decisions (for review)

1. **Carrier.** (a) `check:plan-review` (recommended): every input and
   refusal is already there, and the rule closes that gate's own skip.
   (b) `check:spec-touches` with a base: one step prints every `Touches:`
   finding, at the cost of a base resolver, a three-dot diff, a shallow
   refusal and a git sandbox for its tests, in a gate that has none. (c) A
   new gate: the most surface. The request named (b) and (c) as the
   candidates; (a) is recommended because it is the only one that adds no
   plumbing.
2. **A renamed spec.** (a) Counts as new (recommended): one definition of
   "new" in the gate, and adding a header to a renamed spec is cheap;
   measured zero renames in the window. (b) Rename-aware: one more
   `git diff -M --diff-filter=R` call and a second definition of "new"
   beside the one the Status skip uses. Tripwire below.
3. **A spec that plans no file change.** (a) No escape (recommended): no
   such spec is known, though the window was not searched for one; a spec
   that changes nothing has no workstream to review. (b) Accept a
   `Touches: none` token, which `check:spec-touches` would then have to
   accept too. Revisit on the first real case.

## Risks and testing

- The existing `check:plan-review` tests and `ROOT_DEPENDENT_GATES`
  refusal cases must pass unchanged; the new branch only adds findings for
  specs the gate used to skip.
- `npm run fault-matrix` measures the gate's git dependencies rather than
  reading a list, so it needs no edit; run it once to confirm the profile
  is unchanged.
- A new test in `gates.test.mjs` needs `npm run test:scripts -- --write`
  in the same commit, or the pre-push hook refuses the push.

## Evidence

Snapshot of 2026-10-24 on `7ffea343` (origin/main), from one-off scripts
that import `barwise/scripts/lib/spec-reader.mjs` (not committed).

- Added specs per PR: for each first-parent commit since 2026-07-01,
  `git diff --name-status -z --no-renames <merge-base> <head> --
  barwise/docs/` filtered to `A` and `inSpecCorpus`, with `touches()` read
  from `git show <head>:<path>`; renames from the same diff with `-M`.
- Reach: the same commits, `namedSpecs` over the diff and messages,
  `CLAIMS_NOTHING_BUILT` over the Status at the merge base, as
  `check:plan-review` reads them.
- Corpus today: 152 specs, 8 with `Touches:`, 144 without.
- Template history: `git log --first-parent -- .claude/skills/spec-writer/template.spec.md`
  puts `Touches:` in the template at #723 (2026-10-23).
- Branches: `git diff --diff-filter=A --no-renames origin/main...<ref>`
  over the 25 remote branches, 7 of them unmerged.

## Tripwires

- If a rename or an archive restore trips the rule, revisit Open
  decision 2.
- If an author writes `Touches:` listing only the spec itself to get past
  the rule, the header has become a target; revisit Open decision 3.

## Non-goals

- No requirement on existing specs, and no change to the plan-review rule,
  `check:spec-touches`, or `audit:specs`.
