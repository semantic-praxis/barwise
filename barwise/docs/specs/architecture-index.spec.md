# Living ADRs, one per concern, indexed in a current section of ARCHITECTURE.md

Status: Workstreams 1-3 implemented 2026-10-24 (one package graph; the ADR convention and its checks; the generated section of ARCHITECTURE.md); 4-5 not yet

Created: 2026-10-23
Last-updated: 2026-10-24
Plan-reviewed: 57072cf4 (code-review, pr-review)
Tracking: barwise-ubc
Touches: barwise/docs/ARCHITECTURE.md, barwise/.dependency-cruiser.cjs,
barwise/scripts/lib/intended.cjs, barwise/scripts/arch-triage.mjs,
barwise/packages/cli/CLAUDE.md, barwise/packages/core/CLAUDE.md,
barwise/packages/mcp/CLAUDE.md, barwise/docs/adr/metamodel-evolution-policy.md,
barwise/docs/adr/constraint-coverage-policy.md,
barwise/docs/adr/package-graph-authority.md, barwise/packages/llm/CLAUDE.md,
barwise/packages/promptlab/CLAUDE.md, barwise/packages/promptlab/evals/suite.yaml,
barwise/scripts/regen-architecture.mjs, barwise/scripts/lib/architecture-section.mjs,
.claude/skills/steward/SKILL.md, barwise/scripts/check-architecture.mjs,
barwise/review-tiers.json, .claude/skills/spec-writer/template.adr.md,
.claude/skills/pr-review/checklist.md, barwise/scripts/tests/,
barwise/package.json, package.json, .github/workflows/ci.yml, CLAUDE.md

In one sentence: each architecture or process decision lives in one ADR
named for its concern and edited in place; the PR that changes an ADR
says what changed and why, and is reviewed with `/code-review` and
`/pr-review` before it merges; a generated first section of
`barwise/docs/ARCHITECTURE.md` lists the ADRs and the package graph; and
CI fails when that section, an ADR's shape, or a copy of the package
graph drifts from its source.

## Principle

Explicit over implicit, and a copy that must agree is derived or
checked, never guarded by a comment (root `CLAUDE.md`, Conventions).
Where a failure can be designed away rather than checked, design it
away (CLAUDE.md, define errors out of existence).

A decision a reviewer or agent must follow needs a home that holds only
the current answer. Today barwise has three partial homes: two ADRs in
`barwise/docs/adr/`; 141 "(resolved ...)" headings across 87 specs, most
of them local choices; and 16 conventions stated with their reasons
inline in the root `CLAUDE.md`, a 621-line file every session loads.
`barwise/docs/ARCHITECTURE.md` calls itself a "historical design record
(February 2026)" (barwise-873).

The owner's decisions of 2026-10-23 set the shape: decisions get ADRs;
an ADR covers one concern, is named for it, and is edited in place when
the decision changes; the history lives in git and in the PR that made
the change, not in the ADR.

## Anchors

Verified 2026-10-23 against `origin/main` at `1a32f9c7`, except where a
line says this PR changed it.

1. **The ADR directory exists and already works this way.** It held
   `0001-metamodel-evolution-policy.md` (2026-06-17) and
   `0002-constraint-coverage-policy.md` (2026-08-27), each with
   `Status:`, `Date:` and `Tracking:` headers and Context, Decision and
   Consequences sections. ADR 0001 was edited in place the day after it
   was written (`d2d677ea`), and ADR 0002 was split from its spec so
   that "the spec keeps the living half" (`7e67e04e`): the ADR-and-spec
   division this spec adopts. At the owner's request this PR renamed both
   by concern, to `metamodel-evolution-policy.md` and
   `constraint-coverage-policy.md`.
2. **References to an ADR number spread.** At `1a32f9c7`, 16 tracked
   files cited the two ADR paths and the text named "ADR 0001" or "ADR
   0002" 60 times (`git grep -nE "ADR[ -]?000[12]" 1a32f9c7 -- .
   ':!.beads' | wc -l`). Some sit in archived specs and dated records,
   which describe the repository as of their date and are not edited.
3. **Decisions that were made did not reach their ADR.** `orm-format-3`
   planned an "ADR 0003" amending ADR 0001's "inline and local" filter,
   resolved by the owner on 2026-10-17; no such file has ever existed,
   and the metamodel ADR stated the unamended filter until it was amended
   in place on 2026-10-23 (barwise-l5z).
   One living file per concern removes the question of which file an
   amendment goes in.
4. **The package graph has four copies and one checked direction.** The
   root `CLAUDE.md` "Dependency Graph" block and `INTENDED` in
   `barwise/.dependency-cruiser.cjs` agree edge for edge for all 12
   packages. `barwise/scripts/arch-triage.mjs` keeps its own `INTENDED`,
   which has drifted: it has no `promptlab` key, its `cli` list lacks
   `diagram-ui` and `promptlab`, and its `mcp` list lacks `diagram-ui`. The `package.json` lists agree
   in runtime `dependencies` but not `devDependencies` (`@barwise/llm`
   lists `@barwise/diagram` for `tests/Pipeline.integration.test.ts`).
   Only `INTENDED` against real imports is checked (`npm run depcruise`).
   Both `INTENDED` copies say the root CLAUDE.md graph is the source of
   truth, and the `cli`, `core` and `mcp` package `CLAUDE.md` files call
   it "the authoritative list": the reverse of what CI enforces.
   `.dependency-cruiser.cjs` exports only `forbidden` and `options`, and
   dependency-cruiser's config schema rejects any other top-level key, so
   no script can import `INTENDED` from it as it stands.

Set aside: ARCHITECTURE.md's section numbers cannot change.
`docs/ORM_PROJECT_GUIDE.md`, the two Halpin-Morgan reading documents and
`specs/prompt-optimization-harness.spec.md` cite sections such as 3.1.4
and 7.5, and `check-book-citations.mjs` treats "ARCHITECTURE.md" as a
citation boundary.

## What is an ADR here? (resolved: one living file per concern)

Decided by the owner on 2026-10-23.

- **One ADR per concern, not per decision.** "Where non-deterministic
  code may live" is one ADR even if its answer changes twice.
- **Named by concern, not by number:**
  `barwise/docs/adr/package-graph-authority.md`, the stable-kebab rule
  specs follow.
- **Edited in place.** The ADR on `main` is the current decision. There
  is no superseded state and no dead decision for an agent to find and
  follow. Retiring a concern deletes its file, and every reference to it
  must go in the same PR; `check:architecture` fails on any reference
  left (WS2).
- **History lives in git and the PR.** The PR that changes an ADR states
  what changed and why; `git log -p` on the file leads to those PRs.
- **No status field.** The two existing ADRs read `Status: Accepted`. On
  `main` that is always true, and in an open PR the ADR is proposed by
  being in the PR, so the field can only ever be redundant or wrong. A
  check for a stale `Proposed` would have to read the right side of the
  right diff on the right event; removing the field removes the check.
- **The format** is the existing ADRs' sections, with `Scope:` added:

  ```text
  # <Concern>

  Scope: architecture
  Date: 2026-10-23
  Tracking: barwise-ubc, docs/specs/<spec>.spec.md

  ## Context
  ## Decision
  ## Consequences
  ```

  `Scope:` is `architecture` or `process`. `Date:` is when the decision
  last changed, kept by the author and checked in review, not by a
  script: whether an edit changes a decision is a judgment. ADR 0001's
  own in-place edit (`d2d677ea`) changed a Decision bullet and added a
  "Schema versioning" section outside `## Decision` without moving
  `Date:`. A rule keyed to the `## Decision` heading would have failed
  that edit and missed the decision in the new section, while forcing a
  date change on every reflow.

## Which decisions get an ADR? (resolved: the ones others must follow)

A decision gets an ADR when it sets a rule other work must follow, or
would be expensive to reverse. The local choices in specs' resolved
headings stay in their specs and are not indexed. That answers the
owner's objection to both earlier designs (index every resolved heading,
or tag the important ones inside specs).

**An ADR and its spec divide the work, as `constraint-coverage-policy` and
its spec do.**
The spec holds the reasoning, alternatives and workstreams; the ADR holds
the decision and its consequences and links the spec. When a spec
settles an ADR-level question, the spec's resolved heading points to the
ADR rather than restating it.

**An ADR change is reviewed in the PR that makes it.** Writing or
changing a decision is a plan, so the owner's plan-review rule applies to
the ADR itself: `/code-review` and `/pr-review` on the head being merged,
which `steward` 4b already requires before any merge. `check:plan-review`
(`plan-scope-check.spec.md`) is not what enforces it, because an ADR-only
PR implements no spec; the PR's own review is. A new `pr-review`
checklist group, "When an ADR changed", asks the review to confirm the
PR body says what changed and why, and that no spec restates the
decision.

**`CLAUDE.md` links to ADRs rather than restating them** (WS5).

## Scope

In scope:

- When a file under `barwise/docs/adr/` other than a `README.md` lacks `Scope:`, `Date:`, or a
  `## Decision` section, or carries a `Scope:` value outside
  `architecture` and `process`, `npm run check:architecture` shall fail
  (exit 1) naming the file and the field.
- When the generated section of ARCHITECTURE.md differs from what
  `npm run regen:architecture` produces, the check shall fail (exit 1)
  and name the command.
- When the edges in the root `CLAUDE.md` "Dependency Graph" block differ
  from `INTENDED` in either direction, the check shall fail (exit 1)
  naming each edge.
- `INTENDED` shall move to its own module, `scripts/lib/intended.cjs`,
  which `.dependency-cruiser.cjs`, `arch-triage.mjs` and
  `check-architecture.mjs` all require; no script keeps a copy.
- When an instruction file, an undated document under `barwise/docs/`
  (specs and ADRs included, archives excluded) or a package file names an
  ADR as ADR `<name>` or `docs/adr/<name>.md`, and no such ADR exists and
  the citing spec's `Touches:` does not plan it as a `+` or `-` entry,
  the check shall fail (exit 1) naming the file and line.
- When a package's internal runtime `dependencies` include a package
  `INTENDED` does not allow it, the check shall fail (exit 1).
- When the check cannot read the ADR directory, `INTENDED`, or either
  target document, it shall exit 2 and say what it could not read
  (`docs/specs/gate-refusal-contract.spec.md`).
- The `ci.yml` step shall carry no docs-only guard. Almost every PR it
  exists for changes only Markdown, which `changed-class.mjs` classifies
  as docs-only; `check:instruction-refs` runs unguarded for the same
  reason.
- When a PR changes a file under `barwise/docs/adr/`, `pr-risk` shall
  route it to the "When an ADR changed" checklist group through a
  `review-tiers.json` row (tier `high-risk`: a changed decision is rework
  for everything that follows it), so `check:review-tiers` accounts for the new
  heading.

Out of scope: ADRs for the local choices in specs; a history section or
status field inside ADRs; a check that a Decision edit moves `Date:`
(above); generating the per-package `CLAUDE.md` dependency tables
(barwise-873).

## Inventory

| Path                                           | Current state                                                        | Change                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `barwise/docs/adr/`                            | Two ADRs, both renamed by concern in this PR                         | `Status:` lines dropped and `Scope:` added; new ADRs (WS2, WS4)                                 |
| `barwise/docs/ARCHITECTURE.md`                 | Historical record; 8.1 and the section 6 tree cite nonexistent files | Generated first section; header sentence; the dead `decisions/` lines removed                   |
| `barwise/.dependency-cruiser.cjs`              | Holds `INTENDED`, which says CLAUDE.md is its source of truth        | Requires `lib/intended.cjs`; the comment names it the authority                                 |
| `barwise/scripts/lib/intended.cjs`             | Does not exist                                                       | New: `INTENDED`, moved out of `.dependency-cruiser.cjs`, which requires it                      |
| `barwise/scripts/arch-triage.mjs`              | Its own drifted `INTENDED` copy                                      | Requires `lib/intended.cjs`                                                                     |
| `cli`, `core`, `mcp` package `CLAUDE.md` files | Call the root CLAUDE.md graph authoritative                          | Name `INTENDED` as the authority                                                                |
| `barwise/scripts/check-architecture.mjs`       | Does not exist                                                       | New: graph edges, ADR shape, generated-section checks                                           |
| `barwise/scripts/regen-architecture.mjs`       | Does not exist                                                       | New: renders the generated section                                                              |
| `barwise/review-tiers.json`                    | No row for ADRs                                                      | A `high-risk` row for "When an ADR changed", globs `barwise/docs/adr/`                          |
| `.claude/skills/pr-review/checklist.md`        | No ADR group                                                         | "When an ADR changed": PR body says what changed and why; no spec restates the decision         |
| `.claude/skills/spec-writer/template.adr.md`   | Does not exist                                                       | New: the ADR template                                                                           |
| `CLAUDE.md` (root)                             | Holds the graph and 16 conventions inline                            | Graph drift-checked (WS1); conventions become rule plus ADR link (WS5)                          |
| `ci.yml`, both `package.json` files            | No such step or scripts                                              | `check:architecture` unguarded; both scripts with root forwarders from `regen-root-package.mjs` |

The `spec-writer` and `steward` skills each gain one line (WS2, WS3).
Whether shared files like these belong in `Touches:` is Open decision 6.
No shared spec reader is needed: ADRs are their own files with three
header fields.

## Target architecture

```
barwise/docs/adr/<concern>.md ──┐
                                ├── regen-architecture.mjs ──> ARCHITECTURE.md
scripts/lib/intended.cjs ───────┤                              (generated first section:
   (INTENDED)   │               │                               ADRs by scope, then the graph)
                │               ├── .dependency-cruiser.cjs (requires it)
                │               └── arch-triage.mjs (requires it)
                └── check-architecture.mjs ── compares ──> root CLAUDE.md graph block (edges only;
                                                    the hand-written annotations stay)
```

The generated section lists each ADR under its scope with its title, its
`Date:`, the first sentence of its Decision, and a link. The `CLAUDE.md`
graph is checked rather than generated, because its annotations are
prose worth keeping and a generator writing into the file every session
loads is a larger change than a drift test.

## Which copy of the package graph is the authority? (resolved: `INTENDED`, the owner's decision of 2026-10-23)

`INTENDED`, the map the dependency rules file enforces, is the package
graph. WS1 moves it to `scripts/lib/intended.cjs` so the rules file and
the scripts require one copy; the owner's decision names the map, and
the move only gives it a home others can import (Open decision 7,
resolved). The
root `CLAUDE.md` block renders it and is checked against it. It states a policy ("may import") and
is the one copy CI enforces through `npm run depcruise`. Runtime
`dependencies` must stay within it, and WS1 checks that they do;
`devDependencies` may reach further for tests (anchor 4). The decision is recorded in ADR
`package-graph-authority`.

## Alternatives considered

- **Numbered, immutable ADRs with supersession.** The classic form, and
  how the two existing ADRs were named. Lost on the owner's decision:
  dead decisions accumulate beside live ones and look just as
  authoritative, and anchor 3 shows a planned amending ADR that was never
  written.
- **Mark decisions inside specs, or index every resolved heading.** This
  spec's first design. The owner rejected both.
- **A history section, a status field, or a mechanical date rule.** Each
  keeps more state in the ADR. Lost: git and the PR hold the history,
  the status is implied by where the file is, and whether an edit
  changes a decision is a judgment a script cannot make (see "What is an
  ADR here?").
- **Rewrite ARCHITECTURE.md by hand.** The state barwise-873 found
  decayed; renumbering would break four documents' citations.

## Workstreams (each independently shippable)

### 1. One package graph

Move `INTENDED` to `scripts/lib/intended.cjs`; `.dependency-cruiser.cjs`
and `arch-triage.mjs` require it, which fixes arch-triage's drift, and
`npm run depcruise` must still pass with the config's exports unchanged.
`check-architecture.mjs` compares the `CLAUDE.md` graph edges with it
(exit 1 on a missing or extra edge, exit 2 if either side cannot be
parsed), and compares each package's internal runtime `dependencies` in
`package.json` with it (exit 1 on a dependency the map does not allow;
`devDependencies` are not compared). The three package `CLAUDE.md` lines
and the comments name `INTENDED` as the authority. The step runs
in `ci.yml` without a docs-only guard, and a gates test plants an extra
edge and sees red through `mutate.mjs`.

### 2. The ADR convention, the reference check, and the first new ADR

- Both renames landed in this PR, at the owner's request: live documents
  were rewritten, and archived specs and dated records (such as
  `reference-rubric-audit-2026-08-27.md`) were left as they are.
- Add the reference check to `check-architecture.mjs`. It reads a named
  set, not "everything except": instruction files, undated documents
  under `barwise/docs/` (specs and ADRs included, archives excluded), and
  every file under `barwise/packages/`. It leaves out, under both, the
  tracker, eval runs and payloads, dated records and archives, all of which
  are history.
  (Implementation note, 2026-10-24: the set first drafted here -- specs,
  ADRs and `packages/*/src/` only -- missed current documents that cite
  ADRs today, such as `promptlab/evals/suite.yaml` and the book reading
  guides, so a rename would have left them dead. A `-` entry is also
  allowed, so a spec may name the ADR its own PR retires.) It resolves the two current forms,
  ADR `<name>` and `docs/adr/<name>.md`, to an existing ADR or to a `+`
  entry in the citing spec's `Touches:` (an ADR a Draft spec plans). A
  number such as "ADR 0001" is not a form it reads, so historical
  mentions need no exemption. Sandbox tests: a dead name, a dead path,
  a planned `+` ADR that passes, and a tracker mention that is not read,
  each seen red first where red applies.
- Drop `Status:` from both ADRs and add `Scope:`; add the ADR shape
  check with a sandbox test seen red first.
- Add `template.adr.md`, the `spec-writer` step, the `pr-review`
  checklist group and its `review-tiers.json` row.
- Write `package-graph-authority.md` and point the resolved heading above
  at it.

### 3. The generated section in ARCHITECTURE.md

`regen-architecture.mjs` writes the ADR index and a rendering of
`INTENDED` between markers at the top of ARCHITECTURE.md, and the check
fails when they differ. The header gains a sentence saying the first
section is current and generated; the root `CLAUDE.md` "Essential
Context" pointer names it; `regen:architecture` joins the steward
skill's regenerator list; and the lines citing the nonexistent `docs/decisions/` directory are
removed: 8.1's pointer to `001-yaml-over-xml.md`, and the section 6
tree's `decisions/` entry with its three files (`001`, `002` and `003`,
none of which has ever existed). Below the markers, `git diff` must show
those lines and nothing else. `plan-scope-check.spec.md` WS4 exempts this partial writer
from marking ARCHITECTURE.md generated.

Grounded 2026-10-24, section 8's six historical decisions: 8.1 (YAML over
XML), 8.3 (the separate LLM package), 8.5 (multi-file models with explicit
context mapping) and 8.6 (migration on load; MCP and VS Code write 3.0 on
save) still hold. 8.2 holds, with its enforcement moved from tsconfig to
dependency-cruiser, which ADR `package-graph-authority` records. 8.4
("read-only diagrams") no longer holds: the canvas saves layouts and views.
Whether any of them gets an ADR is WS4's question, taken by the owner one
at a time; WS3 leaves section 8 as the record it is. The section renders
as lists, not tables, because dprint realigns table padding and the check
compares byte for byte; one renderer (`lib/architecture-section.mjs`)
serves the writer and the check.

### 4. Backfill ADRs one at a time (provisional: the owner takes each in turn)

One PR per ADR, each reviewed with `/code-review` and `/pr-review`
before merge (Open decision 2). Each PR adds its files to this spec's `Touches:`.
Candidates, with every place each is stated today, so WS5 can replace
all of them with a link:

| Proposed ADR                      | Scope        | Stated today in                                                                       |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `determinism-in-core.md`          | architecture | CLAUDE.md design principles; `check-core-purity.mjs`                                  |
| `connector-packages.md`           | architecture | CLAUDE.md "Dependency Graph" prose (core ships no interop format)                     |
| `schema-versioning.md`            | architecture | the metamodel ADR's "Schema versioning" section; CLAUDE.md `migrate` row              |
| `surface-capability-parity.md`    | architecture | CLAUDE.md capability matrix ("an unmarked gap is a bug")                              |
| `production-prompt-resolution.md` | architecture | CLAUDE.md `--artifacts` paragraph; `artifact-resolution-parity.spec.md`               |
| `keyless-model-access.md`         | architecture | CLAUDE.md conventions; `keyless-model-access.spec.md`                                 |
| `python-from-the-lockfile.md`     | process      | CLAUDE.md conventions                                                                 |
| `gate-refusal-contract.md`        | process      | CLAUDE.md conventions; `gate-refusal-contract.spec.md`                                |
| `must-agree-copies.md`            | process      | CLAUDE.md conventions; `duplication-drift-guards.spec.md`                             |
| `findings-close-by-mechanism.md`  | process      | CLAUDE.md conventions ("A finding is not closed by a document")                       |
| `baselines-merge-on-write.md`     | process      | CLAUDE.md conventions; `baseline-write-preserves-verdicts.spec.md`                    |
| `credential-handling.md`          | process      | CLAUDE.md conventions; `credential-scanning.spec.md`                                  |
| `pinned-runtimes.md`              | process      | CLAUDE.md "Monorepo Commands" (Node and Python pins)                                  |
| `plan-before-code.md`             | process      | CLAUDE.md conventions bullet 1 (spec first); `plan-scope-check.spec.md` (plan review) |
| `merge-delegation.md`             | process      | CLAUDE.md conventions bullet 3; `steward` skill, section 4b                           |
| `review-policy.md`                | process      | `tiered-pr-review.spec.md` "The decision of 2026-09-23"                               |

`schema-versioning.md` is the question the list raises: today it is a
section of the metamodel ADR, and one concern per ADR says it splits out.

### 5. Shorten the root `CLAUDE.md` (provisional: after WS4)

Each convention with an ADR becomes its rule in a line or two plus a
link. Keep inline what an agent needs before it knows which ADR to open
(the cwd and stale-`dist` warnings). Measure the file before and after.

## How this transfers to a team with ADRs in Confluence

- ADRs live as markdown in the repository they govern, one per concern,
  named for it and edited in place; cross-cutting ones live in the repo
  that owns the decision, and others link to it.
- The PR that changes an ADR carries the why, and the repository's
  history is the audit trail, which is also the answer for a team that
  needs one for compliance.
- The architecture page is an index CI regenerates and checks; a
  Confluence copy, if wanted, is published from the repository, never
  edited there.
- Facts a tool can read are checked against their source: dbt model
  contracts and `dbt ls --select` against the documented layers, a
  Terraform module graph against the declared boundaries, Airflow DAG
  dependencies against the documented data flow.

## Open decisions (for review)

1. **Index in ARCHITECTURE.md, or in a generated `adr/README.md`.**
   **Resolved 2026-10-23 by the owner: ARCHITECTURE.md.**
2. **The backfill list.** **Resolved 2026-10-23 by the owner: one ADR
   at a time.** The WS4 table is the candidate list, not a commitment;
   each candidate is decided, written and reviewed in its own PR.
3. **The scope values.** Recommend `architecture` and `process`.
4. **How far `CLAUDE.md` shrinks (WS5).** Recommend rule-plus-link for
   every convention with an ADR.

5. **What checks references to an ADR by name.** **Resolved 2026-10-23
   by the owner:** `check:architecture` resolves them (WS2).
6. **Shared files in `Touches:`.** **Resolved** by
   `plan-scope-check.spec.md` Open decision 5: plan review covers only
   PRs that name the spec, so listing a shared file puts no other PR
   through this spec's plan review. `audit:specs` can still ask for a
   baseline row when unrelated work edits a listed code file, as it does
   today for any Draft spec's named files.
7. **Moving `INTENDED` out of the dependency rules file.** **Resolved
   2026-10-23 by the owner:** the decision names the map, which moves to
   `scripts/lib/intended.cjs` because the rules file cannot export it
   (anchor 4).
8. **A check that runtime `dependencies` stay within `INTENDED`.**
   **Resolved 2026-10-23 by the owner: yes**, in WS1.

## Risks and testing

- **Tripwire: the index passes about 40 ADRs.** Tighten what "others
  must follow" means.
- **Tripwire: an ADR's Decision changes three times in a quarter.** The
  concern is not settled and belongs in a spec until it is.
- **A parse failure must not read as an empty index.** The generator
  exits 2 on zero ADRs or an unreadable graph. Each check gets a gates
  test seen red via `mutate.mjs`.

## Non-goals

- No ADRs for the local choices recorded in specs.
- No history section or status field inside ADRs.
- No retirement of ARCHITECTURE.md's historical body.
