# Enforceable ADR practice

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.gxp (barwise-ym8.krj, barwise-ym8.kva, barwise-ym8.gc9; follows docs/specs/executable-adrs.spec.md)
Touches: barwise/scripts/check-adr-tests.mjs, barwise/scripts/check-architecture.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/mutate.mjs, barwise/scripts/tests/check-adr-tests.test.mjs,
barwise/scripts/tests/gates.test.mjs, barwise/scripts/tests/expected-counts.json,
barwise/docs/adr/credential-handling.md, barwise/docs/ARCHITECTURE.md,
barwise/docs/specs/executable-adrs.spec.md, .beads/issues.jsonl,
.claude/skills/spec-writer/SKILL.md, +.claude/skills/spec-writer/adr-writing.md,
.claude/skills/spec-writer/template.adr.md, .claude/skills/pr-review/checklist.md
Plan-reviewed: 1004b993 (code-review, pr-review)

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

### 5. Discrimination probes (provisional: grounded in part)

This replaces WS5 of `executable-adrs.spec.md`, whose section becomes a pointer here after this spec's `Plan-reviewed:` line. WS3 grounded two of its open questions. Process ADRs do
admit plants: an unpinned bootstrap line made `check:python-uv` exit 1,
and a `TODO: classify` note made `audit:specs -- --check` exit 1, both
recorded in #885 and #886. And `mutate.mjs` still counts any non-zero
exit as caught, so it needs an expected-exit option before a probe can
tell a refusal from a catch. Still ungrounded: where probes live (a file
per ADR beside it, or one manifest), how a probe stays valid when the
code it edits moves (`mutate.mjs` already refuses an absent anchor, exit
2, which would flag a stale probe), and whether probes run in CI or on
demand. Ground these from the plants WS4's PR bodies record, before
writing the runner.

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
