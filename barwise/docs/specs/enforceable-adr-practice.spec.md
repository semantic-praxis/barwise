# Enforceable ADR practice

Status: WS1 implemented 2026-11-04 (check:adr-tests refuses a decision whose tagged tests all skipped; credential-handling#gitleaks-detects declared through its probe tests); WS3 implemented 2026-11-05 (the 87 gap issues labelled adr-gap; check:architecture requires the label, the title prefix, one decision per none entry, and one entry per gap issue). WS4 implemented 2026-11-05 (spec-writer/adr-writing.md, the SKILL.md and template pointers, the pr-review checklist item). WS5 implemented 2026-11-05 at the owner's direction (npm run adr-probes over barwise/docs/adr/probes.json; 13 of the 14 gated decisions probed and CAUGHT, check:plan-review's one unprobed because it reads committed state; no proxy found). WS2 implemented 2026-11-05 (#920: the held-by breakdown on check:architecture's OK line; the real tree reads 89 decisions, 14 with a gate, 31 tests and no gate, 44 none only, 87 carrying a gap issue).

Created: 2026-11-04
Last-updated: 2026-11-05
Tracking: barwise-ym8.gxp (barwise-ym8.krj, barwise-ym8.kva, barwise-ym8.gc9; follows docs/specs/executable-adrs.spec.md)
Touches: barwise/scripts/check-adr-tests.mjs, barwise/scripts/check-architecture.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/lib/adr-judge.mjs,
barwise/scripts/mutate.mjs, barwise/scripts/tests/check-adr-tests.test.mjs,
barwise/scripts/tests/, barwise/scripts/tests/expected-counts.json,
barwise/docs/adr/credential-handling.md, barwise/docs/ARCHITECTURE.md,
barwise/docs/specs/executable-adrs.spec.md, .beads/issues.jsonl,
+barwise/scripts/adr-probes.mjs, +barwise/scripts/tests/adr-probes.test.mjs,
+barwise/docs/adr/probes.json, barwise/package.json, package.json,
.claude/skills/spec-writer/SKILL.md, +.claude/skills/spec-writer/adr-writing.md,
.claude/skills/spec-writer/template.adr.md, .claude/skills/pr-review/checklist.md
Plan-reviewed: f83ebbfb (code-review, pr-review)

## Principle

An ADR's `Enforced-by:` header is a claim that a named check fails when
the decision is broken, and today nothing makes that claim earn its keep
before it is written down. WS3 of `executable-adrs.spec.md` declared 89
decisions across 20 ADRs, and in four of its five batches the author
declared a gate or test that held a precondition of the decision rather
than the decision: `check:architecture` for a graph rule it does not
read, `check:review-tiers` for a routing rule, `depcruise` for a client
it happens to exclude, a classifier tested on a synthetic build. Each was
caught by one question in a review pass -- "if I break this decision on
purpose, does the declared check go red?" -- asked after the declaration,
never before. This spec makes that question the first step of writing an
ADR, closes three places where the existing checks report the wrong
thing, and stages the mechanical version of the question (probes) on the
evidence WS3 produced.

The principles at stake are **explicit over implicit** (an author states
a concrete violation rather than implying the decision is checkable) and
**define errors out of existence** (a declaration that cannot discriminate
is stopped at authoring time, not rediscovered in review).

## Scope

In scope:

- When every test tagged for a tested decision is skipped, so none
  passed and none failed, `check:adr-tests` shall report that decision
  as a refusal (exit 2, unless a finding elsewhere makes it 1) naming the
  skipped tests, not as a finding. A decision with a failed tagged test stays a finding whatever else was skipped. A decision whose tags are skips and todos only follows the Open decision on that case: a refusal under the recommended answer.
- When a `none` entry names an issue, `check:architecture` shall exit 1
  unless that issue carries the gap label (`adr-gap`, the recommended
  name; Open decisions), its title begins
  `Gap: <adr> decision <id> ` for this ADR and the entry's one decision
  id, and no other `none` entry names it. A `none` entry listing more
  than one id is a finding.
- When `check:architecture` passes, its summary shall state how the
  decisions are held -- how many have a gate, how many are held by tests
  and no gate, how many by `none` alone, and how many carry a gap issue
  -- instead of a count of ADRs that declare the header.
- When an author writes or changes an ADR, the `spec-writer` skill shall
  direct them to state a concrete violation for each decision, plant it,
  and declare only an enforcer that went red, recording each plant in the
  PR body; the `pr-review` checklist shall ask for that record.
- Provisional, for WS5 to confirm or revise when it is grounded: when a
  probe names an ADR decision, a planted edit and the enforcer expected
  to go red, running it shall fail unless that enforcer exits 1 with the
  edit applied. This spec is not Implemented until WS5 either delivers
  that or records why not.

Out of scope:

- Refactoring the ADRs themselves (sorting the 87 gap issues into
  buildable, restate, and retire-to-prose, and doing that work). Filed as
  its own tracker item (barwise-ym8.gc9), after barwise-wcg.vlv:
  `ossie-interchange` names that issue as the one bringing it and
  `determinism-in-core` up to date after iri-identity WS6.
- Making the held-by breakdown a ratchet. It is a reading; nothing fails
  on it (Open decisions).
- barwise-4vj (`ci:local` and `continue-on-error`), unchanged.

## Inventory

| Area                                            | Current state (verified 2026-11-04)                                                                      | Verdict                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `check-adr-tests.mjs`                           | counts only `status === "passed"`; a decision with no passed tag is a finding when every report was read | WS1: a skip-only decision is a refusal                                            |
| `credential-handling.md`                        | `gitleaks-detects` is `none` only, because its probe tests skip without gitleaks (barwise-ym8.7zs)       | WS1: `tests` added, tags restored; the `none` stays                               |
| `check-architecture.mjs` OK line                | "... 20 declare Enforced-by:", always equal to the ADR count since the header became required            | WS2: the held-by breakdown                                                        |
| `check-architecture.mjs` `none` entries         | checks only that the issue exists and is open                                                            | WS3: label, title and one-to-one rule                                             |
| `.beads/issues.jsonl` gap issues                | 87 under barwise-ym8, every title `Gap: <adr> decision <id> ...`, none labelled                          | WS3: `adr-gap` added to each                                                      |
| `architectureRepo()` in `gates.test.mjs`        | rewrites each fixture ADR to `none (barwise-fx1: <all ids>)`                                             | WS3: defaults to `tests (<ids>)`, which needs no tracker                          |
| `spec-writer` skill                             | `template.adr.md` names the entry forms and the owner's gate rule; no authoring step                     | WS4: `adr-writing.md` and pointers                                                |
| `pr-review/checklist.md`, "When an ADR changed" | three items; nothing on enforcement                                                                      | WS4: one item                                                                     |
| `mutate.mjs`                                    | exit 0 when the command fails with the mutation applied, so a refusal (2) counts as caught               | WS5: an expected-exit option                                                      |
| `executable-adrs.spec.md` WS5                   | provisional, ungrounded                                                                                  | replaced by a pointer here, in the commit after this spec's `Plan-reviewed:` line |

The tracker's `labels` field is already supported: `beads-crud.mjs`
takes `--labels` on `create` and `update`, and more than 400 issues carry
labels.

## Should a skipped tag be a refusal? (resolved: yes)

The owner chose this on 2026-11-03 over two alternatives: leaving a
skip-only decision a finding, and refusing only when the skip reason
names a missing tool. A skipped test is, by the gate-refusal contract's
own words, a test that could not answer. The cost is that an `it.skip`
left in by mistake reads as "could not check" rather than "not proven".
CI still goes red on it, because exit 2 fails the step, and the refusal
names the skipped test. Reading skip reasons would need a phrasing
convention nothing enforces, and vitest's JSON report carries no reason.

A `todo` test is not read as a skip. Under vitest an `it.todo` has no
body; under node:test a `{ todo }` test runs its body, but its result is
not counted as a pass or a failure, and the reporter records it as
`todo`. Either way the author has marked it as not yet a real check, which
is a statement about the test, not about a missing tool, so a decision
whose only tag is on a `todo` stays a finding (Open decisions).

## Should a gap issue be identified by label and title? (resolved: yes)

The owner chose this on 2026-11-03 over leaving it to review and over
requiring a parent (barwise-ym8), which would tie every future ADR to one
epic. The title prefix is what WS3 already wrote on all 87 issues, so the
rule is checkable today without renaming any of them; the label marks the
issue as a gap issue so an umbrella issue with a lucky title still fails.
The one-to-one rule is the owner's "one dedicated gap issue per decision"
written as a check.

## Target architecture

```
ADR author ── spec-writer/adr-writing.md:
               1. state a concrete violation per decision
               2. find the enforcer whose failure IS that violation
               3. plant it; the enforcer must go red (record the plant)
               4. declare only what went red; the rest is none on a
                  dedicated gap issue
            └─ (WS5) the plant becomes a probe a script replays

check:architecture ── header required (WS3 of executable-adrs)
                   ├─ none entry: issue exists, open, adr-gap label,
                   │  title "Gap: <adr> decision <id> ", one id, one entry
                   └─ OK line: "<d> decisions: <g> with a gate, <t> tests
                      and no gate, <n> none only; <k> carry a gap issue"

check:adr-tests ── per tested decision:
                   passed tag  -> proven
                   only skipped tags -> refusal (2), names them
                   neither     -> finding (1)
```

## Alternatives considered

- **Only a skill (no checks).** Rejected: the dedicated-gap rule and the
  skip reading are mechanical, and a rule only review enforces is the
  kind the next author does not know exists.
- **Only probes (WS5), no skill.** Rejected for now: probes need a home,
  a format and a runner, and their worth is the open question WS5 has to
  answer. The skill's step 3 is the manual probe; the plants authors
  record become WS5's grounding data.
- **A separate `adr-writer` skill.** Rejected: `spec-writer` already
  owns `template.adr.md` and the ADR conventions, and two skills for one
  document set would drift.

## Workstreams (each independently shippable)

Ordered smallest blast radius first. WS1, WS2 and WS4 are independent;
WS3 changes the fixture WS2's tests read, so it lands after WS2.

### 1. A skip-only decision is a refusal

`check-adr-tests.mjs` collects, beside `passed`, the decisions with a
tagged test whose status is a skip (`skipped`, or vitest's `pending` and
`disabled` if it emits them; to be confirmed against a real report when
the workstream is grounded). A tested decision whose tagged tests are all
skips -- none passed, none failed -- goes to `refusals` with the skipped titles, before the existing finding branch; a failed tagged test keeps it
a finding. A `todo` beside a skip does not change that reading: a
decision whose tags are skips and todos only is a refusal (recommended;
Open decisions). The refusal header line, which today counts only unread
reports, says how many decisions were left unproven by skips. The existing case that expects exit 1 for a lone `skipped` test (it loops over skipped, todo and failed) drops `skipped`, and the script's header comment, which says a skipped test settles itself as not passed, names the new refusal. New cases in `check-adr-tests.test.mjs`: skip-only is exit 2 and names the test; skip
plus pass is 0; skip plus fail is 1; skip plus todo is 2 under the recommended answer to the Open decision, 1 if the reviewer picks the other; a `todo` alone is 1. Then
`credential-handling` adds `tests (gitleaks-detects)` beside its existing
`none (barwise-ym8.7zs: gitleaks-detects)`, which stays: the probe tests
catch a dropped default set or Anthropic rule, not a second local rule.
The staged-probe tests in `gates.test.mjs` get their tag back by title,
`regen:architecture` rewrites the header's line in `ARCHITECTURE.md`,
and barwise-ym8.7zs replaces its "not declared" paragraph with the
tagged tests' reach. `expected-counts.json`
is rewritten with `--write`. Closes barwise-ym8.krj.

### 2. The held-by breakdown

`check-architecture.mjs` counts, over every decision of every ADR: with
an `npm` entry; with a `tests` entry and no `npm` entry; with only `none`;
and, separately, with any `none` entry. The OK line prints them in place
of "N declare Enforced-by:". The `gates.test.mjs` cases that match the old
clause match the new one. The real-tree reading on main today is 89, 14,
30, 45 and 87; after WS1 moves `gitleaks-detects` to tested, it is 89, 14,
31, 44 and 87. Closes barwise-ym8.kva.

### 3. Dedicated gap issues

First the backfill: `adr-gap` added to the 87 gap issues with
`beads-crud.mjs update --labels`. That flag replaces the list, so the
backfill passes each issue's existing labels with the new one (none has a
label today). Then the check, in the `none` branch of
`check-architecture.mjs`: label present; title begins with the exact
prefix; the entry lists one id; and a map across all ADRs flags an issue
named by two entries. `architectureRepo()` defaults to `tests (<ids>)`,
which needs no tracker, and `ADR_OK`, which about seven shape and
staleness cases stage, becomes `tests (the-rule)` with it. The cases
that need a `none` entry (`ENFORCED_ADR` and the tracker cases) stage a
fixture issue carrying the label and a title of the required form.
The `ADR_OK.replace("none (barwise-fx1: the-rule)", ...)` call in the
no-tracker case (the one WS3 of `executable-adrs` added) then matches
nothing and is removed. `template.adr.md`'s comment, which writes
`none (<issue>: <ids>)` (its example header already has one id), the check's own messages, and the parser's (`adr-enforcement.mjs`, its entry-form message and doc comment) change to the one-id form. The `none` branch checks in order: the issue exists, it is open, then label, title and one id, so a closed issue reports only that it is closed and the existing `barwise-shut` case keeps its one finding. New cases: an unlabelled issue, a wrong title, two ids in
one entry, and one issue named twice, each exit 1 naming the entry; they
join an existing case where they can, and `expected-counts.json` is
rewritten with `--write` for whatever count changes.

WS3 implementation note (2026-11-05). The `none` branch this section
places in `check-architecture.mjs` has lived in `scripts/lib/adr-judge.mjs`
since the reader/judge split (#910, `docs/specs/adr-gate-reader-split.spec.md`),
so the checks went there, and the label is `GAP_LABEL` in
`adr-enforcement.mjs`. The issue-named-twice check needs no tracker, so it
runs before the tracker is read and is judged even when the tracker is
not. With two ids the title is not checked, since there is no one
decision for it to name; the one-id finding covers that entry. Each new
case was seen red: the test fails with each check disabled in turn, and
`check:architecture` exits 1 on the real tree with one real issue's label
removed.

### 4. The authoring step

`.claude/skills/spec-writer/adr-writing.md` holds the method: the four
steps in Target architecture, what counts as a plant (a minimal edit to
real code or config that violates the decision, applied and reverted),
the form a plant takes in the PR body (decision id, the edit, the
enforcer, its exit code), and what to do when no plant is possible
(the decision is judgment: `none` on its gap issue, and the gap issue
says it is a retire-to-prose candidate). `SKILL.md` step 6 and the
`template.adr.md` comment point to it. The `pr-review` checklist's "When
an ADR changed" section gains one item: each `npm` or `tests` entry the
PR adds or changes has a recorded plant that turned its enforcer red.
Entries the PR leaves alone need none; the existing declarations have no
plant record, and backfilling one is the refactor session's work
(barwise-ym8.gc9).
`check:review-tiers` keys on headings, and none is added.

### 5. Discrimination probes (design 2026-11-05)

This replaces WS5 of `executable-adrs.spec.md`, whose section becomes a
pointer here after this spec's `Plan-reviewed:` line.

**What it adds.** A declared gate is held today to existing and running
in CI (`check:architecture`, `check:adr-model`), not to failing when its
decision is broken; a WS3 batch found a proxy declaration that way
only by review (#886's `check:review-tiers`). A probe states one
violation of one decision and the declared gate that must go red on it,
and `npm run adr-probes` replays every probe through `mutate.mjs
--expect-exit 1`. That delivers the provisional requirement under Scope.

**The grounding, and how thin it is.** The owner chose on 2026-11-05 to
design WS5 now rather than wait for ADR-writing PRs to record plants
(WS4's skill step); no PR has recorded one since. Seven plants exist:

| Plant                            | Where it edits             | Enforcer                 | Kind                            |
| -------------------------------- | -------------------------- | ------------------------ | ------------------------------- |
| unpinned uv bootstrap (#885)     | `.github/workflows/ci.yml` | `check:python-uv`        | a declared gate on its decision |
| `TODO: classify` note (#886)     | a spec                     | `audit:specs -- --check` | a declared gate on its decision |
| five header plants (#926 review) | the ADR's own file         | `check:adr-model`        | a test of a gate's own rules    |

Only the first two are probes in this section's sense; the five test
`check:adr-model` itself and already live in `adr-model.test.mjs`. So
the design rests on two probe-shaped plants and the 14 decisions that
declare a gate today, across 10 `npm` entries. The three questions WS3
left open are answered from that, and each answer says what would move
it.

1. **Where probes live: one manifest, `barwise/docs/adr/probes.json`.**
   Both real probes edit a file other than their ADR (`ci.yml`, a
   spec), and their `old` and `new` strings are literal code and YAML
   that would sit badly in an ADR's prose. One file is also one input
   for the runner to read and check. Neither reason is strong; a file
   per ADR would work as well, and the manifest is the cheaper start.
   Each row is `{ decision: "<adr>#<id>", file, old, new }`, or
   `{ decision, unprobed: "<why>" }` for a gate a probe cannot reach (below), `file`
   from the repository root. A row names no command: the runner takes
   the script and its `-- <args>` from the decision's `npm` entry, so a
   probe runs exactly what the header declares and CI runs.
2. **A probe whose code moved: refused, never passed.** `mutate.mjs`
   already refuses (exit 2) an absent or ambiguous anchor, a no-op edit,
   a command that fails unmutated, and a restore that does not verify.
   The runner reports each such probe as stale or unreadable and exits
   2, so a moved anchor is never read as a gate that still catches. The
   cost is maintenance: a refactor of a probed file may need its probe
   updated. Two probes cannot show how often that happens; the first
   probes that go stale will.
3. **On demand, not in CI.** `executable-adrs.spec.md` already put
   discrimination on demand, in the shape of `npm run fault-matrix`, and
   ruled out proving it on every PR. Running it costs a full gate run
   per probe, unmutated and mutated, in sequence (each edits the working
   tree). A CI step is an
   open decision below, not part of this workstream.

**The runner, `barwise/scripts/adr-probes.mjs`.** It reads the
manifest and the ADRs' `Enforced-by:` headers, and for each probe:

- a manifest it cannot read (absent, not JSON, not an array, a row
  missing a field) is a refusal (exit 2), before anything runs;
- a row naming a decision no ADR has, or a decision no `npm` entry of
  its ADR lists, is a finding (exit 1), before anything runs: there is
  no declared gate to probe. A decision listed by two `npm` entries is
  probed once per entry;
- a probe whose `file` has uncommitted changes is refused (exit 2):
  `mutate.mjs` restores the bytes it found but does not check that they
  are committed, so a dirty file would be judged as a tree nobody
  committed;
- otherwise it spawns `mutate.mjs --file <file> --old <old> --new <new>
  --expect-exit 1 -- npm run <script> [-- <args>]` in `barwise/`,
  with no shell, and reads mutate's own status: 0 CAUGHT, 1
  MISSED (the gate passed, or failed some other way, on the violation:
  a proxy declaration, the finding this workstream exists for), 2
  REFUSED (stale anchor, gate red unmutated, gate refused).

It prints one line per probe and then the declared pairs (`npm` entry,
decision id) with no probe, as information. Exit 1 if any row finding
or MISSED, printing any refusals beside them; else 2 if the manifest
could not be read, any probe was REFUSED, or the manifest has no probe;
else 0. It adds no lock, because it runs one probe at a time.

**Gates a working-tree edit cannot reach.** `mutate.mjs` edits the
working tree. A gate that reads committed state does not see that edit:
`check:plan-review` reads only commits on the branch, so a probe of
`plan-before-code#plan-reviewed` would read MISSED for a gate that does
catch. Such a gate is not probed in WS5. Seeding names each one, with the
line of the gate that shows it reads committed state, in the runner's
unprobed list with that reason, and files no gap issue for it; a
committed-state probe (a temporary commit in a scratch worktree) is a
later step if the owner wants one.

**Seeding.** The same PR writes a probe for each of the 14 decisions that
declare a gate, planted by hand first. A gate that reads the working tree
and will not go red on any honest violation of its decision is a proxy
declaration: it gets a gap issue (the header change is the ADR
refactor's, barwise-ym8.gc9), and no probe, so the runner's unprobed
list names it. A MISSED reading counts as a proxy only after the gate's
input is confirmed to be the working tree, per the paragraph above.

**What the first seeding found (2026-11-05).** All 13 probes CAUGHT,
so none of the 14 gated decisions is a proxy. Three first plants read
MISSED, and each was the plant's fault, which is the reason a MISSED
reading is confirmed before it is filed:

- `check:python-uv` passed a bare `python3` and a `--with` planted in
  a `package.json` script. Its header says it does not read
  `package.json`, and barwise-ym8.fq7 names that boundary; the probes
  plant in `ci.yml`, which it reads.
- `depcruise` exited 13 on a core-to-diagram import: the import closes
  a cycle, and dependency-cruiser's exit code is its violation count,
  which the refusal contract misreads (barwise-vt2). The probe plants a
  diagram-to-llm import, one violation, so it exits 1; until vt2 is
  fixed, a depcruise probe must stay a one-violation edit.

**The skill.** `spec-writer/adr-writing.md` step 4 changes from
recording each plant in the PR body to adding it to `probes.json`, and
the `pr-review` checklist item asks for the row instead of the record.

**Tests**, in `scripts/tests/adr-probes.test.mjs` on a git fixture with a
one-gate repository: a caught probe exits 0; a gate that ignores the
edit exits 1, MISSED; a moved anchor exits 2; a probe naming an
unknown decision, or one no `npm` entry lists, exits 1 before any
run; the entry's `-- <args>` reach the gate; a dirty probed file, an
unreadable manifest and an empty one each exit 2. Each is watched red by removing the branch it
pins.

**What it still cannot see.** A probe proves the gate catches one
violation, not every violation of its decision: the decision's gap
issue says what else is unguarded. And a tagged test (`tests` entries)
is not probed here; `check:adr-tests` holds it to passing, and a probe
of a test is the same `mutate.mjs` run with a test command, left for
when an author records one.

The spec lands in a commit of its own, with nothing it lists in
`Touches:`; the tracker issues it files and the pointer in
`executable-adrs.spec.md` follow its `Plan-reviewed:` line, because
`check:plan-review` needs the reviewed commit to precede every change to
a `Touches:` path.

## API and migration impact

- No package API changes; everything is in `barwise/scripts/`, the
  tracker, and two skills.
- WS3 makes `check:architecture` stricter. On main every `none` entry
  already names a one-decision issue with the right title prefix, so the
  only migration is the label backfill in the same PR. An open branch
  that adds an ADR with an umbrella `none` issue fails after it lands.
- WS1 can turn a finding into a refusal in `ci:local`; CI fails on both.

## Open decisions (for review)

- **The label name.** `adr-gap` (recommended: short, says what it marks),
  or `gap`, which collides in meaning with the many non-ADR gap issues in
  the tracker. The spec is written with `adr-gap`; another pick is a
  rename in WS3 and in barwise-ym8.gxp, nothing more.
- **Does `todo` count as a skip?** Recommended no, as argued above: a
  `todo` is the author marking a test unfinished, not a tool going
  missing. The alternative reads every test that did not count as a
  refusal, and would let a `todo` tag stand in for a test that does not
  exist yet.
- **Skips mixed with todos.** A decision whose tags are only skips and
  todos, with none passed or failed: a refusal (recommended, because the
  skipped test is the one that would have answered with the tool present)
  or a finding (the todo's "not yet a real check" wins).
- **Should the breakdown ratchet?** Recommended no for now: a ratchet on
  "none only" would pressure authors toward declaring weak enforcers,
  which is the proxy problem this spec exists to stop. Revisit once WS5
  can tell a real enforcer from a proxy.
- **WS5: should `adr-probes` run in CI?** Recommended not yet: on
  demand, as `executable-adrs.spec.md` decided and `fault-matrix` does.
  A CI step would catch a gate that stops discriminating on the PR that
  breaks it, at the price of a gate run per probe on every
  non-docs PR and a red CI whenever a refactor moves a probe's anchor.
  Revisit once the seeded probes show how often anchors move.
- **WS5: should a declared gate with no probe be a finding?**
  Recommended no in WS5: the runner lists them. Once the 14 are seeded,
  a later step can require a probe for every new `npm` entry, which
  pushes toward proof rather than toward weaker declarations, unlike a
  ratchet on the breakdown.
