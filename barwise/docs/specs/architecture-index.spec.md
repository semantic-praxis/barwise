# A current architecture index generated from the decisions specs record

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-ubc

In one sentence: specs mark the decisions that set architecture or
process with a one-line `Decision:` marker, a script renders those
decisions and the package graph into a generated section at the top of
`barwise/docs/ARCHITECTURE.md`, and CI fails when that section, the
root `CLAUDE.md` package graph, or a supersession link disagrees with
its source.

## Principle

Explicit over implicit, and a copy that must agree is derived or
checked, never guarded by a comment (root `CLAUDE.md`, Conventions).

Barwise already keeps its decisions where tools can read them: 87 of the
141 specs carry at least one heading marked `(resolved`, 141 such
headings in all, most of the form `## <question>? (resolved: <answer>)`. What it lacks is a current place that lists them.
`barwise/docs/ARCHITECTURE.md` says of itself "Historical design record
(February 2026)" (barwise-873), and the current structure is spread
across the root and per-package `CLAUDE.md` files. A reader who wants
"what has this project decided about ids, or about review" has to know
which of 141 specs to open. A reviewer who wants to say "#662 already
decided this" can only do so from memory.

The architecture facts that stay current here are the ones a check
reads: the package graph (`.dependency-cruiser.cjs`), core's purity
(`check-core-purity.mjs`), the tool lists (pinned by
`mcp/tests/serverSpawn.test.ts` and
`vscode/tests/unit/toolRegistration.test.ts`), and the paths instruction
files cite (`check-instruction-refs.mjs`). The ones that decayed are the
ones nothing reads. ARCHITECTURE.md section 8.1 cites
`docs/decisions/001-yaml-over-xml.md`, a file that has never existed in
this repository's history, and section 8.4's "read-only diagrams" was
overtaken when the canvas began saving layouts and views into the model
(`vscode/src/diagram/protocol.ts`, `saveLayout` and `saveView`). This
spec applies the pattern that works to the facts that did not.

## Anchors

Verified 2026-10-23 against `origin/main` at `1a32f9c7`.

1. **Decision headings are regular enough to parse.** All 141 resolved
   headings are on one line; 140 are `##`, one is `###`. 124 use
   `(resolved: ...)`; the other 17 are section headings of the form
   `## Decisions (resolved 2026-09-25)` that hold bullets. Separately,
   25 bulleted open decisions in 9 specs carry `(resolved: ...)`, and
   some wrap across lines. Command:
   `grep -hE "^#+ .*\(resolved" barwise/docs/specs/*.spec.md`.
2. **Most resolved headings are local, not architectural.** A sample of
   18 included "Should history read git directly or take file pairs?
   (resolved: git in the CLI, pure pairs in core)" next to "What went
   wrong (resolved: the reload rule could not tell new from old)". By my
   reading about a third of the sample is a decision a new contributor
   would need. That is judgment, not measurement, and it is why the
   design asks authors to mark decisions rather than indexing every
   heading.
3. **Supersession is recorded only as prose.** 21 specs mention
   superseded, withdrawn or replaced decisions, in forms such as
   "**WS4 WITHDRAWN** by the owner's decision of 2026-09-23" and
   "Superseded by `diagram-empty-view`". Spec `Status:` lines are free
   text too (35 read exactly "Status: Implemented", and the rest vary).
   Nothing a script can trust says a decision no longer holds.
4. **The package graph has three copies and one checked direction.** The
   root `CLAUDE.md` "Dependency Graph" block, the `INTENDED` map in
   `barwise/.dependency-cruiser.cjs`, and the twelve `package.json`
   dependency lists agree today. Only `INTENDED` against real imports is
   checked (`npm run depcruise`, guarded by `check:depcruise-gate`).
   `INTENDED`'s own comment reads "Source of truth is the root CLAUDE.md
   dependency graph", which is the reverse of what CI enforces.

Set aside: that ARCHITECTURE.md's section numbers could be renumbered
freely. They cannot. `docs/ORM_PROJECT_GUIDE.md`,
`docs/halpin-morgan-3e-reading-guide.md`,
`docs/halpin-morgan-3e-contents.md` and
`specs/prompt-optimization-harness.spec.md` cite sections such as
3.1.4, 3.4-3.5 and 7.5, and
`check-book-citations.mjs` treats "ARCHITECTURE.md" as a citation
boundary.

## Should ARCHITECTURE.md become current again? (resolved: its first section, generated)

Yes. A hand rewrite failed before, so the new section is generated. The
historical body stays where it is, because its numbered sections
(metamodel, mapping) are cited from four documents and are still the
best description of the metamodel's rationale.

The file gains one unnumbered section at the top, between generated
markers, holding the current decision index and the package graph. The
existing header already says the body is a February 2026 record; it
gains one sentence saying the first section is current and generated.
Nothing in the body moves, so no citation breaks.

Root `CLAUDE.md` keeps the current structure an agent loads every
session. It stops pointing at ARCHITECTURE.md only for "the original
system design" and points at the generated section for decisions. This
adds no second owner: the decisions are owned by the specs, the graph by
`INTENDED`, and both documents only render them.

## What is a decision, mechanically? (resolved: a resolved heading with a marker line)

A decision is a `##` or `###` heading carrying `(resolved: ...)` with,
as the first non-blank line under it:

```
Decision: architecture
```

The value is a closed set (`architecture` or `process`; Open decision
3). A decision that no longer holds gains a second line:

```
Decision: architecture
Superseded-by: <spec file>.spec.md#<heading slug>
```

The target is a spec file and the GitHub-style slug of a heading in it,
and that heading must itself be a decision. A bulleted open decision is
not indexable; to index one, promote it to a heading. Marking is
explicit because the sample in anchor 2 shows that most resolved
headings record a local choice, and an index of all 141 would bury the
ones that matter.

## Scope

In scope:

- When a spec heading carries `(resolved: ...)` and a `Decision:` line,
  the generator shall list it in ARCHITECTURE.md's generated section
  under its scope, with the spec, the heading text and a link.
- When a decision carries `Superseded-by:`, the generator shall list it
  under "Superseded" with a link to its replacement, never among the
  current decisions.
- When a `Superseded-by:` target does not exist, or names a heading that
  is not itself a decision, `npm run check:architecture` shall fail
  (exit 1) naming the spec and line.
- When a `Decision:` line sits under a heading without `(resolved`, or
  carries a value outside the closed set, the check shall fail (exit 1).
- When the generated section differs from what the generator produces,
  the check shall fail (exit 1) and name `npm run regen:architecture`.
- When the edges in the root `CLAUDE.md` "Dependency Graph" block differ
  from `INTENDED` in either direction, the check shall fail (exit 1)
  naming each edge.
- When the check cannot read the specs directory, `INTENDED`, or either
  target document, it shall exit 2 and say what it could not read
  (`docs/specs/gate-refusal-contract.spec.md`).

Out of scope: backfilling every existing decision in one change (Open
decision 4); changing how spec `Status:` lines are written (anchor 3
says they are free text, and `audit-spec-status.mjs` already owns
reading them); generating the per-package `CLAUDE.md` dependency
tables (barwise-873 named them; separate work); a decision record format
outside specs.

## Inventory

| Path                                          | Current state                                     | Change                                                      |
| --------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `barwise/docs/ARCHITECTURE.md`                | Historical record; 8.1 cites a nonexistent file   | Gains a generated first section; header sentence; 8.1 fixed |
| `CLAUDE.md` (root)                            | Holds the graph; calls ARCHITECTURE.md historical | Graph drift-checked; pointer names the generated section    |
| `barwise/.dependency-cruiser.cjs`             | `INTENDED` says CLAUDE.md is its source of truth  | Comment corrected: `INTENDED` is the authority              |
| `barwise/scripts/audit-spec-status.mjs`       | Owns reading a spec header                        | Its reader moves to a shared lib (provisional)              |
| `barwise/scripts/lib/spec-headers.mjs`        | Does not exist                                    | New: one reader for Status, headings and decision markers   |
| `barwise/scripts/regen-architecture.mjs`      | Does not exist                                    | New: renders the generated section                          |
| `barwise/scripts/check-architecture.mjs`      | Does not exist                                    | New: the drift and marker checks above                      |
| `.claude/skills/spec-writer/template.spec.md` | No decision marker                                | Documents `Decision:` and `Superseded-by:`                  |
| `.github/workflows/ci.yml`                    | No such step                                      | Runs `check:architecture`                                   |

`check-instruction-refs.mjs` is untouched: ARCHITECTURE.md is not an
instruction file, and the links the generator writes are checked by
`check:architecture` itself.

## Target architecture

```
specs/*.spec.md ──(Decision:, Superseded-by:)──┐
                                               ├─ lib/spec-headers.mjs ── regen-architecture.mjs ──> ARCHITECTURE.md
.dependency-cruiser.cjs (INTENDED) ────────────┘                              (generated first section)
        │
        └── check-architecture.mjs ── compares ──> root CLAUDE.md graph block (edges only;
                                                    the hand-written annotations stay)
```

The `CLAUDE.md` graph is checked, not generated, because its
annotations ("connector package: registers ...") are prose worth
keeping, and `CLAUDE.md` is loaded into every session, so a generator
writing into it is a larger change than a drift test.

## Alternatives considered

- **A new `barwise/docs/DECISIONS.md`, leaving ARCHITECTURE.md
  historical.** Same generator, separate file. Cheaper to explain and
  touches no cited document. It lost narrowly, because it leaves the
  document named "architecture" permanently out of date, which is the
  trap the owner named; it stays Open decision 1.
- **A classic ADR directory (`docs/decisions/NNNN-title.md`).** The
  common industry form, and what ARCHITECTURE.md planned in February.
  It lost because the specs already carry the reasoning, so each ADR
  would restate a spec section, two owners of one decision. The
  directory was planned and never created (anchor: the dead 8.1 link),
  which is the outcome a hand-kept parallel record tends to have.
- **Rewrite ARCHITECTURE.md by hand as a current document, with a
  review checklist item to keep it current.** It lost because that is
  the state barwise-873 found decayed, and because renumbering would
  break four documents' citations.

## Workstreams (each independently shippable)

### 1. Check the package graph against `INTENDED`

Smallest and independent of the rest. Add the edge comparison to a new
`check-architecture.mjs` (exit 1 on a missing or extra edge, exit 2 if
either side cannot be parsed), fix `INTENDED`'s inverted comment, wire
it into `ci.yml` (which `ci:local` reads), and add a gates test that plants an
extra edge and sees red. No spec changes and no ARCHITECTURE.md change.

### 2. Decision markers and one spec-header reader (provisional: not yet grounded)

Move `audit-spec-status.mjs`'s header reading into
`scripts/lib/spec-headers.mjs` and add the heading and marker reader.
Extend `check-architecture.mjs` with the marker rules in Scope. Document
the two lines in `template.spec.md` and the `spec-writer` skill. Mark
the first decisions: the candidates are the 124 `(resolved: ...)`
headings, listed by a `--candidates` flag; which to mark is Open
decision 4. Whether `audit-spec-status.mjs`'s reader extracts cleanly
is the ungrounded part.

### 3. The generated section in ARCHITECTURE.md (provisional: not yet grounded)

`regen-architecture.mjs` writes the decision index (by scope, then
spec) and a rendering of `INTENDED` between markers at the top of
ARCHITECTURE.md; `check-architecture.mjs` fails when they differ. Add
the header sentence and the root `CLAUDE.md` pointer, add
`regen:architecture` to the steward skill's regenerator list, and
remove 8.1's dead link. Index each of section 8's six historical
decisions that still holds, pointing at its 8.x section, with 8.4
listed as superseded by whichever spec decided saved layouts (not yet
identified).

## How this transfers to a team with ADRs in Confluence

The same three parts carry over to a data-engineering team.

- Write ADRs as markdown in the repository they affect (`docs/adr/`),
  with `Status:` and `Superseded-by:` lines, so a reviewer and an agent
  can read them from the checkout. Cross-cutting ones live in the repo
  that owns the decision, and other repos link to them.
- Make the architecture page an index the CI regenerates and checks,
  never a page someone remembers to update. A Confluence copy, if the
  team wants one, is published from the repository, not edited there.
- Check the facts a tool can read against their source: dbt model
  contracts and `dbt ls --select` against the documented layers, a
  Terraform module graph against the declared boundaries, Airflow DAG
  dependencies against the documented data flow.

## Open decisions (for review)

1. **Generated section in ARCHITECTURE.md, or a new DECISIONS.md.**
   Recommend the section: it makes the document named "architecture"
   current, and the body's citations survive. Choose DECISIONS.md if a
   half-generated, half-historical file reads as more confusing than
   two files.
2. **Mark decisions, or index every resolved heading.** Recommend
   marking (anchor 2). Indexing all 141 needs no format change and no
   backfill, at the cost of an index mostly made of local choices.
3. **The scope values.** Recommend `architecture` and `process`. This
   month's largest decisions were process ones ("The decision of
   2026-09-23" on tiered review), and leaving them out would index half
   of what a reviewer cites.
4. **Backfill.** Recommend the owner marks from the `--candidates` list
   in workstream 2's PR, rather than an agent guessing which decisions
   matter. The alternative is marking only new decisions, which leaves
   the index nearly empty for months.
5. **Which copy of the package graph is the authority.** Recommend
   `INTENDED`: it is a policy ("may import"), and the one CI enforces.
   `package.json` states what is installed, which can legitimately be
   narrower, and a check that internal `package.json` dependencies stay
   within `INTENDED` is a separate, smaller question.

## Risks and testing

- **Tripwire: the index grows past about 40 current decisions.** At
  that size it stops being a summary and becomes a second table of
  contents for the specs; tighten what `architecture` means before
  adding more.
- **Tripwire: a parse failure reads as an empty index.** The generator
  must exit 2 when it finds zero specs or zero headings, never write an
  empty section (the gate-refusal contract). Each check gets a gates
  test that sees it red on a planted defect via `mutate.mjs` before
  green.
- Workstream 3 changes a file four documents cite by section number;
  the test is that `git diff` shows no change below the generated
  markers.

## Non-goals

- No new decision content. The index renders what specs already say.
- No change to how specs are written beyond the two marker lines.
- No retirement of ARCHITECTURE.md's historical body.
