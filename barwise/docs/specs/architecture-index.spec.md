# Living ADRs, one per concern, indexed in a current section of ARCHITECTURE.md

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-ubc
Touches: barwise/docs/adr/, barwise/docs/ARCHITECTURE.md, CLAUDE.md,
barwise/.dependency-cruiser.cjs, +barwise/scripts/regen-architecture.mjs,
+barwise/scripts/check-architecture.mjs, barwise/scripts/tests/,
barwise/package.json, package.json, .github/workflows/ci.yml,
+.claude/skills/spec-writer/template.adr.md, .claude/skills/spec-writer/SKILL.md,
.claude/skills/pr-review/checklist.md, .claude/skills/steward/SKILL.md

In one sentence: each architecture or process decision lives in one ADR
named for its concern and edited in place, the PR that changes an ADR
says what changed and why, a generated first section of
`barwise/docs/ARCHITECTURE.md` lists the current ADRs and the package
graph, and CI fails when that section, an ADR's shape, or the root
`CLAUDE.md` package graph drifts from its source.

## Principle

Explicit over implicit, and a copy that must agree is derived or
checked, never guarded by a comment (root `CLAUDE.md`, Conventions).

A decision a reviewer or agent must follow needs a home that holds only
the current answer. Today barwise has three partial homes. Two ADRs live
in `barwise/docs/adr/`. About 141 "(resolved ...)" headings are spread
across 87 specs, most of them local choices. And the root `CLAUDE.md`
states 16 conventions with their reasons inline, in a file of 621 lines
that every session loads. `barwise/docs/ARCHITECTURE.md` calls itself a
"historical design record (February 2026)" (barwise-873), and its
section 8.1 cites `docs/decisions/001-yaml-over-xml.md`, a file that has
never existed in this repository's history.

The owner's decisions of 2026-10-23 set the shape: decisions get ADRs;
an ADR covers one concern, is named for it, and is edited in place when
the decision changes; and the history lives in git and in the PR that
made the change, not in the ADR.

## Anchors

Verified 2026-10-23 against `origin/main` at `1a32f9c7`.

1. **The ADR directory exists, and it already works this way.**
   `barwise/docs/adr/` holds `0001-metamodel-evolution-policy.md`
   (2026-06-17) and `0002-constraint-coverage-policy.md` (2026-08-27),
   each with `Status:`, `Date:` and `Tracking:` headers and Context,
   Decision and Consequences sections. ADR 0001 was edited in place the
   day after it was written, to settle schema versioning (`d2d677ea`),
   which is the living-ADR practice this spec writes down. ADR 0002 was
   split from its spec so that "the spec keeps the living half"
   (`7e67e04e`): the ADR holds the policy, and the spec holds the
   inventory and workstreams. That is the ADR-and-spec division this
   spec adopts.
2. **The numbers are cited widely.** 16 tracked files cite the two ADR
   paths, including two package `CLAUDE.md` files, five archived specs
   and the promptlab eval suite definition, and the text names "ADR 0001" or
   "ADR 0002" 60 times (`git grep -nE "ADR[ -]?000[12]" -- . ':!.beads'
   | wc -l`). Renaming to concern names is a mechanical rewrite of all
   of them, not an edit to two files.
3. **Supersession is prose today.** 23 specs mention a superseded,
   withdrawn or replaced decision (`git grep -liE 'supersed|withdrawn|
   replaced by' 1a32f9c7 -- 'barwise/docs/specs/*.spec.md'
   ':(exclude)barwise/docs/specs/archive/*' | wc -l`), and nothing a
   script can read says which decisions still hold. In-place ADRs make
   that question disappear: the ADR on `main` is the decision.
4. **The package graph has three copies and one checked direction.** The
   root `CLAUDE.md` "Dependency Graph" block and the `INTENDED` map in
   `barwise/.dependency-cruiser.cjs` agree edge for edge for all 12
   packages. The `package.json` lists agree in runtime `dependencies`
   but not `devDependencies`: `@barwise/llm` lists `@barwise/diagram` as
   a dev dependency for `tests/Pipeline.integration.test.ts`, while
   `INTENDED` gives `llm` only `core`. Only `INTENDED` against real
   imports is checked (`npm run depcruise`). `INTENDED`'s own comment
   reads "Source of truth is the root CLAUDE.md dependency graph", the
   reverse of what CI enforces.

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
  `barwise/docs/adr/package-graph-authority.md`, the same stable-kebab
  rule specs follow. A number suits an append-only log; a living
  document wants a stable name.
- **Edited in place.** The ADR on `main` is the current decision, so
  there is no superseded state, no `Superseded-by:` link to keep valid,
  and no dead decision for an agent to find and follow. Retiring a
  concern deletes its file; git keeps it, and
  `check:instruction-refs` already fails on any instruction file still
  linking to it.
- **History lives in git and the PR, not in the ADR.** The PR that
  changes an ADR's Decision states what changed and why. A reader who
  needs the past runs `git log -p` on the file and reads those PRs.
- **The format is the one the two existing ADRs use,** with one field
  added and one redefined:

  ```text
  # <Concern>

  Status: Accepted
  Scope: architecture
  Date: 2026-10-23
  Tracking: barwise-ubc, docs/specs/<spec>.spec.md

  ## Context
  ## Decision
  ## Consequences
  ```

  `Scope:` is `architecture` or `process`. `Date:` is the date the
  Decision section last changed. `Status:` is `Accepted` on `main`; an
  ADR proposed in an open PR may read `Proposed`, and merging it means
  setting `Accepted`. The `# ADR 0001:` title prefix goes.

## Which decisions get an ADR? (resolved: the ones others must follow)

A decision gets an ADR when it sets a rule other work must follow, or
would be expensive to reverse. The local choices in specs' resolved
headings stay in their specs; nothing indexes them. This answers the
owner's objection to both earlier designs (index every resolved heading,
or tag the important ones inside specs): decisions that matter get their
own file, and the rest stay where they were made.

**An ADR and its spec divide the work, as ADR 0002 and its spec do.**
The spec holds the reasoning, the alternatives and the workstreams. The
ADR holds the decision and its consequences, and links the spec. When a
spec settles an ADR-level question, the same PR writes or edits the ADR,
and the spec's resolved heading points to the ADR rather than restating
it. Under the owner's plan-review rule (`plan-scope-check.spec.md`), the
ADR is reviewed with the spec before any implementation.

**`CLAUDE.md` links to ADRs rather than restating them** (WS5). Its 16
conventions mostly carry their reasons inline. Each can become a one-line
rule plus a link, so the file every session loads gets shorter, and the
reason is one file away when an agent needs it.

## Scope

In scope:

- When a file under `barwise/docs/adr/` lacks `Status:`, `Scope:`,
  `Date:`, or a `## Decision` section, or carries a `Status:` or `Scope:`
  value outside its closed set, `npm run check:architecture` shall fail
  (exit 1) naming the file and the field.
- When a diff changes an ADR's `## Decision` section and leaves its
  `Date:` unchanged, the check shall fail (exit 1), so a reversal cannot
  pass as a wording fix.
- When an ADR on the base branch reads `Status: Proposed`, the check
  shall fail (exit 1): merging is acceptance.
- When the generated section of ARCHITECTURE.md differs from what
  `npm run regen:architecture` produces, the check shall fail (exit 1)
  and name the command.
- When the edges in the root `CLAUDE.md` "Dependency Graph" block differ
  from `INTENDED` in either direction, the check shall fail (exit 1)
  naming each edge.
- When the check cannot read the ADR directory, `INTENDED`, either
  target document, or the merge base (a shallow clone included), it
  shall exit 2 and say what it could not read
  (`docs/specs/gate-refusal-contract.spec.md`).
- When a PR changes an ADR's Decision, the `pr-review` checklist shall
  ask that the PR body say what changed and why.

Out of scope: ADRs for the local choices in specs; a history section
inside ADRs (the owner's decision); generating the per-package
`CLAUDE.md` dependency tables (barwise-873 names them; separate work).

## Inventory

| Path                                               | Current state                                          | Change                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `barwise/docs/adr/`                                | Two numbered ADRs                                      | Renamed by concern (WS2); new ADRs added (WS2, WS4)                                                        |
| `barwise/docs/ARCHITECTURE.md`                     | Historical record; 8.1 cites a nonexistent file        | Gains a generated first section and a header sentence; 8.1's dead link removed                             |
| `CLAUDE.md` (root)                                 | Holds the graph and 16 conventions with reasons inline | Graph drift-checked (WS1); conventions become rule plus ADR link (WS5)                                     |
| `barwise/.dependency-cruiser.cjs`                  | `INTENDED` says CLAUDE.md is its source of truth       | Comment corrected: `INTENDED` is the authority                                                             |
| `barwise/scripts/check-architecture.mjs`           | Does not exist                                         | New: graph, ADR shape, Decision-date and index checks                                                      |
| `barwise/scripts/regen-architecture.mjs`           | Does not exist                                         | New: renders the generated section                                                                         |
| `.claude/skills/spec-writer/template.adr.md`       | Does not exist                                         | New: the ADR template                                                                                      |
| `.claude/skills/spec-writer/SKILL.md`              | No ADR step                                            | When a spec settles a rule others must follow, write or edit its ADR in the same PR                        |
| `.claude/skills/pr-review/checklist.md`            | No ADR item                                            | "When an ADR's Decision changed": the PR body says what changed and why; the spec does not restate the ADR |
| `.claude/skills/steward/SKILL.md`                  | Regenerator list                                       | Gains `regen:architecture`                                                                                 |
| `ci.yml`                                           | No such step                                           | Runs `check:architecture`                                                                                  |
| `barwise/package.json` and the root `package.json` | No such scripts                                        | `check:architecture` and `regen:architecture`, with root forwarders from `regen-root-package.mjs`          |

No shared spec reader is needed: ADRs are their own files with four
header fields, so this spec does not depend on `plan-scope-check.spec.md`
WS2.

## Target architecture

```
barwise/docs/adr/<concern>.md ──┐
                                ├── regen-architecture.mjs ──> ARCHITECTURE.md
.dependency-cruiser.cjs ────────┘     (INTENDED)               (generated first section:
        │                                                       ADRs by scope, then the graph)
        └── check-architecture.mjs ── compares ──> root CLAUDE.md graph block (edges only;
                                                    the hand-written annotations stay)
```

The generated section lists each ADR under its scope with its title, its
`Date:`, the first sentence of its Decision, and a link. The `CLAUDE.md`
graph is checked rather than generated, because its annotations
("connector package: registers ...") are prose worth keeping, and a
generator writing into the file every session loads is a larger change
than a drift test.

## Which copy of the package graph is the authority? (resolved: `INTENDED`, the owner's decision of 2026-10-23)

`INTENDED` in `barwise/.dependency-cruiser.cjs` is the package graph; the
root `CLAUDE.md` block renders it and is checked against it (WS1). It
states a policy ("may import") and is the one copy CI enforces through
`npm run depcruise`. Runtime `dependencies` must stay within `INTENDED`;
`devDependencies` may reach further for tests, as `@barwise/llm`'s does
(anchor 4). A check on runtime dependencies is a separate, smaller
question this spec does not take on. WS2 records this decision as the
ADR `package-graph-authority.md`, and this heading then points to it.

## Alternatives considered

- **Numbered, immutable ADRs with supersession.** The classic form, and
  how `0001` and `0002` are named. Lost on the owner's decision: dead
  decisions accumulate beside live ones, look just as authoritative to an
  agent searching the directory, and need a supersession chain and a
  check to keep it valid. ADR 0001's own history shows the repo already
  edits in place.
- **Mark decisions inside specs with a `Decision:` line, or index every
  resolved heading.** This spec's first design. The owner rejected both:
  indexing every heading buries the few decisions that matter among 141
  local ones, and tagging leaves decisions inside long planning
  documents.
- **A history section inside each ADR.** Keeps the reason for each change
  next to the decision. Lost on the owner's decision: git and the PR
  already hold it, and a growing history section is the context
  pollution in-place editing avoids.
- **Rewrite ARCHITECTURE.md by hand.** That is the state barwise-873
  found decayed, and renumbering would break four documents' citations.

## Workstreams (each independently shippable)

### 1. Check the package graph against `INTENDED`

Smallest and independent of the rest. `check-architecture.mjs` compares
the `CLAUDE.md` graph edges with `INTENDED` (exit 1 on a missing or extra
edge, exit 2 if either side cannot be parsed), `INTENDED`'s inverted
comment is fixed, the step runs in `ci.yml`, and a gates test plants an
extra edge and sees red through `mutate.mjs`.

### 2. The ADR convention, the two renames, and the first new ADR

- `git mv` `0001-metamodel-evolution-policy.md` to
  `metamodel-evolution-policy.md` and `0002-constraint-coverage-policy.md`
  to `constraint-coverage-policy.md`. Rewrite every path citation (anchor
  2) in the same commit, and drop the `# ADR 0001:` title prefixes. Prose
  that says "ADR 0001" becomes the concern name. A grep for `adr/000`
  that finds nothing is the acceptance test; `check:instruction-refs`
  covers the two package `CLAUDE.md` files.
- Add `Scope:` to both, and the ADR shape and Decision-date checks to
  `check-architecture.mjs`, with a sandbox test for each, seen red
  first.
- Add `template.adr.md`, the `spec-writer` step and the `pr-review`
  checklist item.
- Write `package-graph-authority.md` from the resolved heading above,
  and point that heading at it.

### 3. The generated section in ARCHITECTURE.md (provisional: not yet grounded)

`regen-architecture.mjs` writes the ADR index and a rendering of
`INTENDED` between markers at the top of ARCHITECTURE.md, and
`check-architecture.mjs` fails when they differ. The header gains a
sentence saying the first section is current and generated; the root
`CLAUDE.md` "Essential Context" pointer names it; 8.1's dead link goes;
`regen:architecture` joins the steward skill's regenerator list.
`regen:architecture` writes part of a hand-written file, so
`plan-scope-check.spec.md` WS4 exempts it by name from marking
ARCHITECTURE.md generated. Not grounded: whether the six section-8
historical decisions that still hold become ADRs or are left as history.

### 4. Backfill the first batch of ADRs (provisional: the owner picks the list)

One PR per few ADRs, each reviewed under the plan-review rule, since
writing a decision down is a plan. Candidates, drawn from the root
`CLAUDE.md` and the specs it cites:

| Proposed ADR                      | Scope        | Today stated in                                           |
| --------------------------------- | ------------ | --------------------------------------------------------- |
| `determinism-in-core.md`          | architecture | CLAUDE.md design principles; `check-core-purity.mjs`      |
| `connector-packages.md`           | architecture | CLAUDE.md "Dependency Graph" prose (core ships no format) |
| `schema-versioning.md`            | architecture | ADR 0001's schema-versioning section; `migrate` row       |
| `surface-capability-parity.md`    | architecture | CLAUDE.md capability matrix ("an unmarked gap is a bug")  |
| `production-prompt-resolution.md` | architecture | CLAUDE.md `--artifacts` paragraph                         |
| `keyless-model-access.md`         | architecture | CLAUDE.md conventions; `keyless-model-access.spec.md`     |
| `python-from-the-lockfile.md`     | process      | CLAUDE.md conventions                                     |
| `gate-refusal-contract.md`        | process      | CLAUDE.md conventions; `gate-refusal-contract.spec.md`    |
| `must-agree-copies.md`            | process      | CLAUDE.md conventions; `duplication-drift-guards.spec.md` |
| `baselines-merge-on-write.md`     | process      | CLAUDE.md conventions                                     |
| `credential-handling.md`          | process      | CLAUDE.md conventions; `credential-scanning.spec.md`      |
| `pinned-runtimes.md`              | process      | CLAUDE.md "Monorepo Commands" (Node and Python pins)      |
| `plan-before-code.md`             | process      | `plan-scope-check.spec.md` (the owner's rule)             |
| `merge-delegation.md`             | process      | `steward` skill, section 4b                               |
| `review-policy.md`                | process      | `tiered-pr-review.spec.md` "The decision of 2026-09-23"   |

`schema-versioning.md` is the question this list exists to raise: today
it is a section of the metamodel ADR, and one concern per ADR says it
splits out.

### 5. Shorten the root `CLAUDE.md` (provisional: after WS4)

Each convention that has an ADR becomes its rule in a line or two plus a
link. Measure the file before and after; the session-start context is
what this buys. Keep in `CLAUDE.md` anything an agent needs before it
knows which ADR to open.

## How this transfers to a team with ADRs in Confluence

- ADRs live as markdown in the repository they govern, one per concern,
  named for it and edited in place; cross-cutting ones live in the repo
  that owns the decision, and others link to it.
- The PR that changes an ADR carries the why, and the repository's
  history is the audit trail -- which is also the answer for a team that
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
   Recommend ARCHITECTURE.md, which is the owner's corollary (keep
   ARCHITECTURE.md current with the ADRs) and leaves the body's
   citations intact. Choose the README if a half-generated,
   half-historical file reads as more confusing than two files.
2. **The backfill list.** Recommend the owner strikes or adds rows in the
   WS4 table; the default is all fifteen, in about four PRs.
3. **The scope values.** Recommend `architecture` and `process`; this
   month's largest decisions were process ones.
4. **How far `CLAUDE.md` shrinks (WS5).** Recommend rule-plus-link for
   every convention with an ADR, keeping the commands and traps an agent
   needs on its first command (the cwd and `dist` warnings) inline.

## Risks and testing

- **Tripwire: the index passes about 40 ADRs.** Past that it is a second
  table of contents; tighten what "others must follow" means.
- **Tripwire: an ADR's Decision keeps changing.** Three Decision edits in
  a quarter says the concern is not settled and belongs in a spec until
  it is.
- **A parse failure must not read as an empty index.** The generator
  exits 2 on zero ADRs or an unreadable graph, never writes an empty
  section. Each check gets a gates test seen red via `mutate.mjs`.
- WS3 changes a file four documents cite by section number; `git diff`
  must show no change below the generated markers.
- WS2's rename touches 16 files; the acceptance grep and
  `check:instruction-refs` are what make it safe.

## Non-goals

- No ADRs for the local choices recorded in specs.
- No history section inside ADRs.
- No retirement of ARCHITECTURE.md's historical body.
