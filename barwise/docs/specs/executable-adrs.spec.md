# Executable ADRs: each ADR declares what enforces it, and CI checks the declaration

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-ym8
Touches: barwise/scripts/check-architecture.mjs,
barwise/scripts/lib/architecture-section.mjs,
barwise/scripts/lib/beads-jsonl.mjs, barwise/scripts/tests/,
barwise/docs/adr/, barwise/docs/ARCHITECTURE.md,
.claude/skills/spec-writer/template.adr.md

In one sentence: every ADR carries an `Enforced-by:` header naming the
CI steps, hooks and test files that enforce it, or `none` with an open
issue; `npm run check:architecture` fails when a named enforcer does not
exist or does not run, and when an ADR declares nothing.

## Principle

Explicit over implicit, and findings close by mechanism
(`docs/adr/findings-close-by-mechanism.md`). Almost every ADR already
names its enforcer, but only in Consequences prose, which no tool reads.
So the claim "this decision is enforced by `npm run purity`" survives
the gate being renamed, deleted, or dropped from `ci.yml`, and the ADR
goes on describing a system that no longer exists. That is the silent
decay the ADR convention was meant to end, moved one level down: the
decision text is checked (`check:architecture` validates each ADR's
shape and every reference to it), and the link from decision to enforcer
is not.

The idea comes from the Aver language, which makes decisions a parse
node its tooling can index rather than prose it cannot see
(`aver context --decisions-only`). Aver's records list the components a
decision impacts, and, as far as its published decisions document shows,
nothing checks those names against the code. This spec takes Aver's half
-- the decision is data the tooling reads -- and adds the half it lacks:
the enforcer named in that data is verified to exist and run.

## What does "executable" buy, and what does it not? (resolved: existence and wiring, not discrimination)

The check proves the named enforcer exists and runs in CI. It does not
prove the enforcer would fail on a violation of the decision. In root
`CLAUDE.md`'s terms, a gate that exists and runs is the shadow; a gate
that goes red when the decision is broken is the property. This spec
ratchets on what can be checked cheaply on every PR (the shadow's
preconditions: no named enforcer is missing or unwired), and puts the
property in workstream 4, an on-demand probe in the shape of
`npm run fault-matrix`, which is not a CI gate. Gating CI on the shadow
alone is safe here because the shadow is not used as evidence that an
ADR is respected; it only stops the ADR from claiming an enforcer that
is gone.

## Scope

In scope:

- When an ADR under `barwise/docs/adr/` has no `Enforced-by:` header
  line, `check:architecture` shall exit 1 naming the file.
- When an `Enforced-by:` entry names `npm run <script>`, the check shall
  exit 1 unless `<script>` is a key of `barwise/package.json` `scripts`
  and a `run: npm run <script>` step of `.github/workflows/ci.yml` (read
  through `ciSteps()` in `barwise/scripts/lib/ci-gates.mjs`, the parser
  `ci:local` and `fault-matrix` already share).
- When an entry names a hook (`hook <path>`), the check shall exit 1
  unless `<path>` is tracked and is referenced from
  `.claude/settings.json` or a file under `barwise/.husky/`.
- When an entry names a test file (a tracked path ending `.test.ts`,
  `.test.mjs` or `.test.tsx`), the check shall exit 1 unless the path is
  tracked.
- When an entry is `none (<issue-id>[: <which decisions>])`, the check
  shall exit 1 unless `<issue-id>` exists in `.beads/issues.jsonl` with
  a status other than `closed` (whether a `deliberate` form with no issue
  is also allowed is an Open decision). A closed issue with the ADR still saying
  `none` is one of the two out of date, and the check says which ADR and
  which issue.
- When the check cannot read `ci.yml`, `package.json` or the tracker, it
  shall exit 2, per `docs/adr/gate-refusal-contract.md`.
- When `npm run regen:architecture` renders the generated section of
  `barwise/docs/ARCHITECTURE.md`, each ADR line shall show its enforcers
  or `unenforced`, so a reader (or an agent session) sees which
  decisions are guarded without opening twenty files.

Out of scope:

- Rewriting Consequences prose. The prose keeps the reasoning and the
  gaps; the header is the list a tool reads. They overlap by design (see
  Open decisions, "Does the header duplicate Consequences?").
- Checking that a named test file's suite runs in CI. Every package's
  tests run under `test:coverage` and `barwise/scripts/tests/` under
  `test:scripts`, so a tracked test file in either place runs; a test
  file elsewhere is the gap this leaves, recorded in workstream 1's
  Consequences.
- Proving discrimination on every PR (workstream 4 is on demand).

## Inventory

Grounded 2026-10-28 by extracting the npm scripts each ADR names and
resolving them against `package.json` and `ciSteps()`.

| ADR                            | Enforcers named in prose today                                  | Declared state after WS2                               |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| `baselines-merge-on-write`     | `audit:specs`, `test:scripts`                                   | enforced; `trial:gate` writer is barwise-tko           |
| `connector-packages`           | `purity`, `depcruise`                                           | enforced                                               |
| `constraint-coverage-policy`   | none                                                            | `none`; issue or `deliberate` form, per Open decisions |
| `credential-handling`          | `check:secrets`, gitleaks pre-commit hook                       | enforced                                               |
| `determinism-in-core`          | `purity`                                                        | enforced                                               |
| `findings-close-by-mechanism`  | `audit:specs`, `audit:duplication`, `audit:corrections`, others | enforced                                               |
| `gate-refusal-contract`        | `test:scripts`; `fault-matrix` is on demand                     | enforced                                               |
| `keyless-model-access`         | `test:coverage`, `depcruise`                                    | enforced                                               |
| `merge-delegation`             | none; the ADR says so (barwise-zdd)                             | `none (barwise-zdd: decisions 1, 3, 4)`                |
| `metamodel-evolution-policy`   | none                                                            | to be determined in WS2                                |
| `must-agree-copies`            | `check:parity`, `audit:duplication`                             | enforced                                               |
| `ossie-interchange`            | `test:coverage`                                                 | enforced, by named test files                          |
| `package-graph-authority`      | `check:architecture`, `depcruise`                               | enforced                                               |
| `pinned-runtimes`              | `check:parity`; `check:pins` proposed, not built (barwise-920)  | enforced, plus `none (barwise-920)`                    |
| `plan-before-code`             | `check:plan-review`, `check:spec-touches`                       | enforced                                               |
| `production-prompt-resolution` | `test:coverage`                                                 | enforced, by named test files                          |
| `python-from-the-lockfile`     | `check:python-uv`, PreToolUse hook                              | enforced                                               |
| `review-policy`                | `check:review-tiers`                                            | enforced                                               |
| `schema-versioning`            | `test:coverage`                                                 | enforced, by named test files                          |
| `surface-capability-parity`    | `test:coverage` (the two `toEqual` tool-list tests)             | enforced, by named test files                          |

What this shows:

- 17 of 20 ADRs already name an enforcer; the header makes that list
  checkable rather than new. Every npm script they name today exists and,
  except `ci:local`, `fault-matrix`, `pr:risk`, `regen:builtins` and
  `trial:gate`, which are local tools and not enforcers, runs in
  `ci.yml`. So nothing is broken now; the check is a ratchet against
  future drift.
- Two named checks do not exist (`check:pins`, `audit:skips`), and both
  ADRs already say so honestly. Under this spec those become
  `none (<issue>)` entries, which the check ties to an open issue.
- Five ADRs cite `test:coverage`, which runs every package test and so
  cannot point at one decision. Their entries name the test
  files that pin the decision instead (for example
  `barwise/packages/mcp/tests/serverSpawn.test.ts` for
  `surface-capability-parity`), which is both sharper and checkable.

Looks affected, is not: `scripts/lib/spec-reader.mjs` `header()` already
reads a multi-line header value from an ADR (the generated index uses it
for `Scope:` and `Date:`), so parsing needs no new reader.

## Target architecture

```
barwise/docs/adr/<concern>.md
  Scope: architecture
  Date: 2026-10-24
  Tracking: ...
  Enforced-by: npm run purity, npm run depcruise

barwise/scripts/check-architecture.mjs        (existing; one new pass)
  adrs           -- already read
  enforcement    -- new: parse Enforced-by:, resolve each entry
       uses ciSteps()        from scripts/lib/ci-gates.mjs   (existing)
       uses readIssues()     from scripts/lib/beads-jsonl.mjs (new export)
       uses trackedPaths()   from scripts/lib/architecture-section.mjs
  exit 0 / 1 finding / 2 could not read

barwise/scripts/lib/architecture-section.mjs  (renderSection)
  - [Determinism in core](adr/determinism-in-core.md) -- 2026-10-24 -- purity, depcruise
  - [Merge delegation](adr/merge-delegation.md) -- 2026-10-18 -- unenforced (barwise-zdd)
```

Entry grammar, comma or newline separated, one kind per entry:

```
npm run <script>
hook <repo-rooted path>
<repo-rooted path ending .test.ts | .test.tsx | .test.mjs>
none (<issue-id>[: <free text naming which decisions>])
```

## Alternatives considered

- **Decisions as structured data (YAML or a front-matter block), as
  Aver does in its own language.** It would make every field
  machine-read, not just the enforcer. It lost because it rewrites twenty
  ADRs and the tools that read them for a gain only the enforcer field
  needs today; one header line, read by the parser that already reads
  `Scope:` and `Date:`, gets the same check.
- **Infer the enforcer from Consequences prose** (the extraction used to
  ground the Inventory above). It needs no new field, but it is the
  inference "explicit over implicit" refuses: it cannot tell a gate the
  ADR relies on from one it mentions in passing (`ci:local`, named in
  six ADRs, enforces none of them), and an ADR could stop naming its
  enforcer without the check noticing.
- **Map ADRs to gates from the gate side** (each check script declares
  the ADR it serves). It puts the link next to the code that enforces
  it, but an ADR with no enforcer has nowhere to say so, and "which
  decisions are unguarded" is the question this spec most needs to
  answer.

## Workstreams (each independently shippable)

### 1. The check, with an absent header allowed

Add `readIssues()` to `scripts/lib/beads-jsonl.mjs`, and the enforcement
pass to `check-architecture.mjs`, validating every `Enforced-by:` entry
that is present. An ADR with no header is not yet a finding, so this
lands green before any ADR changes. Tests in `barwise/scripts/tests/`
cover each entry kind's pass and fail, the closed-issue case, and the
exit-2 refusals, in `scripts/tests/gates.test.mjs` beside the existing
`check-architecture` cases. First because it touches only the checker and its
tests.

`check-tracker-closes.mjs` and `audit-spec-status.mjs` each parse the
tracker inline today; this workstream does not migrate them (that is a
separate `audit:duplication` candidate), but the new check uses the
shared reader rather than adding a third inline parser.

### 2. Backfill all twenty ADRs, then require the header

Add `Enforced-by:` to each ADR per the Inventory, open the issues the
`none` entries need (`constraint-coverage-policy`, and
`metamodel-evolution-policy` if WS2 finds no enforcer), and in the same
PR make an absent header a finding. Update `template.adr.md` so a new
ADR starts with the line. Coupled into one PR because requiring the
header without the backfill would turn CI red.

### 3. Show enforcement in the generated index

Extend `renderSection` to append each ADR's enforcers or
`unenforced (<issue>)`, and regenerate `ARCHITECTURE.md`. Separate from
WS2 because it changes generated output a reviewer reads byte for byte.

### 4. Discrimination probes (provisional: not yet grounded)

For an ADR whose decision has a concrete violation, record one probe --
a file, a planted edit and the gate expected to go red -- and run it with
`scripts/mutate.mjs`, which already plants a mutation, runs a command
and reports whether it was caught. A script runs every probe on demand,
as `fault-matrix` does for refusals. Not a CI gate: each probe is a full
gate run. Ungrounded: where probes live, and whether process ADRs
(`plan-before-code`) admit a plantable violation at all.

## API and migration impact

- No package changes; scripts, docs and one skill template only. No
  public API moves.
- `check:architecture` already runs in CI unguarded, so no `ci.yml`
  change and no new root forwarder.
- Every future ADR must carry the header, which `template.adr.md`
  states.

## Open decisions (for review)

- **Extend `check:architecture`, or a new `check:adr-enforcement`?** A
  new script keeps the package-graph check about the graph (orthogonality)
  and gives the failure its own name in CI; it costs a `ci.yml` step, a
  root forwarder and a second reader of the ADR set. Extending reuses the
  ADR reader and lives where the other ADR-shape checks already live.
  Recommend: extend, because the ADR checks are already in that script,
  and the graph check and ADR checks already report under separate
  headings.
- **Should a `none` entry require an open issue?** Requiring it makes
  "unenforced" a tracked state that cannot outlive its issue silently,
  which is the point. The cost: a decision that is unenforceable by
  nature (`constraint-coverage-policy` is a trust statement) carries an
  issue that may never close. Alternative: allow `none (deliberate:
  <reason>)` with no issue. Recommend: allow both forms, so an honest
  "never checkable" does not need a fake open issue.
- **Does the header duplicate Consequences?** Yes, partly: the
  enforcer's name appears in both. The header is checked and the prose is
  not, so the prose can still drift. Options: leave the prose as is, or
  have WS2 trim each Consequences to the reasoning and point at the
  header. Recommend: leave it; the prose explains what the gate covers
  and where it does not, which a list of names cannot.
- **Do test files earn a place in the grammar?** Without them, five ADRs
  could only cite `test:coverage`, which any PR runs and which cannot
  point at one decision. With them, a test can be renamed and the check
  catches it. Recommend: include them.

## Risks and testing

- The check must not pass vacuously. A parse that finds zero ADRs, zero
  `ci.yml` steps, or an empty tracker exits 2, not 0 (`ciSteps()` already
  throws on an empty workflow).
- WS1 tests run the check over temporary fixture trees (`--root`), as
  the existing `check-architecture` cases in `gates.test.mjs` do, and include one mutation run per failure kind through
  `scripts/mutate.mjs` to show each is caught.
- After WS2 and WS3, run `npm run check:architecture` and
  `npm run regen:architecture`, then `npm run ci:local`.

## Non-goals

- No change to what any ADR decides.
- No new gate for an unenforced decision. Where WS2 finds a decision
  with no enforcer, it records `none (<issue>)` and building the
  enforcer is that issue's work.
- No claim that a declared enforcer catches violations; that is WS4.
