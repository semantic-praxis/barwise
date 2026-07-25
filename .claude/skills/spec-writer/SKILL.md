---
name: spec-writer
description: Use when writing a design spec for a barwise change before implementing it - turning a REPO_REVIEW finding, feature, or refactor into a reviewable docs/specs/*.spec.md. The project convention is spec-before-code; this provides the house spec format, the design-principle framing, the workstream-splitting discipline, and the pre-flight checklist that keeps specs passing dprint fmt:check on the first push.
---

# Writing a Barwise Spec

Barwise requires a written, reviewed spec before development ("ALWAYS
create a spec file before beginning development"). Specs live at
`barwise/docs/specs/<kebab-name>.spec.md`. A good spec argues from the
project's design principles, splits work into independently shippable
steps, and surfaces the decisions that need a human call.

## Write for the reviewer

The Iron Imperative (from _Writing Without Bullshit_): treat the
reviewer's time as more valuable than your own. Three rules follow:

- **Lead with the answer (BLUF).** Each section's first sentence carries
  its point; the heading states the resolution
  (`## Should we X? (resolved: yes)`). A reviewer should get the
  decision from headings, first sentences, and tables alone.
- **Be decisive.** State claims directly; cut weasel words and hedging.
  Quarantine genuine uncertainty to "Open decisions" -- the one place it
  is honest.
- **Concision, not word count.** A spec needs its inventory,
  architecture, and workstreams; "brief" means no waste, not short.
  Every section earns its place by changing what the reviewer decides or
  the implementer does.

These rules are the reviewer-facing edge of the `articulation` skill,
which governs whether the spec lands: the reviewer is the audience, and
their action is to approve, object, or decide an open question. Invoke
`articulation` as the clarity discipline for the whole spec. Start with
its verbalization test -- state the spec's resolution in one plain
sentence before structuring anything; if you cannot, the design is not
yet ready to write down, and no formatting will rescue it. Let that
sentence become the BLUF.

## Workflow

The files the steps below reference -- `sensemaking.md`, `editing.md`,
`llm-tics.md`, `template.spec.md` -- ship in this skill's directory,
alongside this file.

1. **Ground it, then frame it.** Read `barwise/docs/ARCHITECTURE.md`,
   the relevant package `CLAUDE.md`, and the source the spec covers (a
   REPO_REVIEW finding, the code to change). Verify claims against the
   code; do not design from assumptions. For anything non-trivial, work
   `sensemaking.md`: anchor the design in verified facts, hold two or
   three alternatives, and test each against what the code should and
   should not show before committing.
2. **Argue from principles.** Frame the problem and the resolution in
   terms of the stated principles: determinism in core, orthogonality
   and composability (primary), explicit over implicit, DRY (secondary).
   The strongest specs this project has produced reason _from_ these
   (e.g. "no interop format is mandatory to core, so core should ship
   none").
3. **Draft from the template.** Copy `template.spec.md` and fill it
   in. Drop sections that do not apply; do not invent filler.
4. **Split into workstreams.** Decompose implementation into
   independently shippable steps, ordered smallest-blast-radius first,
   each keeping the full suite green as its own PR. Note coupling that
   forces steps together (e.g. a function only one caller uses vs. one
   five modules share). A later workstream is usually drafted before it
   is grounded; mark its conclusions provisional until then (see
   `sensemaking.md`), so an anticipated claim does not read as settled.
5. **Surface open decisions.** End with the choices that are genuinely
   the reviewer's call (package scope, where shared I/O lives,
   API shape). Recommend a default; do not silently decide. These are
   ADR-shaped -- state the options and the trade-off.
6. **Edit, then run an articulation pass.** Run the edit passes in
   `editing.md` (scanning `llm-tics.md` during the voice pass), then
   invoke the `articulation` skill in critique mode over the draft. Its
   barrier taxonomy catches the failures the voice pass misses -- the
   four most common in specs: a buried lede (a heading that does not
   state its resolution), a fuzzy abstraction (a "robust" or "scalable"
   claim with no operational meaning), a missing bridge (a design leap
   from premises the reviewer does not have), or a wall of detail (an
   inventory or architecture dump with no hierarchy). Then act on the
   review's verdict: wording and boundary problems get fixed in place
   (reword or restructure) before the pre-push gate; a
   thinking-problems verdict means a decision is missing, so return to
   grounding (step 1) or move the undecided item into Open decisions --
   do not polish through it. The review runs in-conversation; commit
   the fixes, never the review.
7. **Clear the gate, then land.** Run the pre-push gate below, land the
   spec for review, then implement in separate PRs. Before implementing
   each workstream, ground it again and verify or correct the
   conclusions drafted ahead of time; revise the spec if the scope
   differs from the brief.

## House structure

A header block -- `Status`, `Created` and `Last-updated` (ISO
`YYYY-MM-DD`), and `Tracking` -- then the sections that apply:

- **Principle / Problem** -- what is wrong and which pillar it touches.
- **Should we X?** (when the choice is non-obvious) -- reason it through
  under a heading that states the resolution.
- **Scope** -- in scope / out of scope, explicitly.
- **Inventory** -- a table classifying what changes and the verdict.
- **Target architecture** -- a fenced code block of the end state.
- **Alternatives considered** -- the rival designs the sensemaking pass
  weighed and rejected, each with the reason it lost. Keeps the
  discarded frames in the artifact, where a reviewer (or a later
  implementer who trips a tripwire) looks first.
- **Workstreams** -- the ordered, independently shippable steps.
- **API and migration impact** -- what moves, what breaks, blast radius.
- **Open decisions** -- the reviewer's calls, with a recommendation.
- **Risks and testing** / **Non-goals**.

## Requirement phrasing

State individual requirements in EARS form: "When `<trigger>`, the
system shall `<response>`." Naming one trigger and one observable
response is what makes the statement testable -- a reviewer can dispute
it, and an implementer can turn it into a test case without
interpreting. Use it for Scope bullets and workstream acceptance
criteria; the surrounding argument stays in ordinary prose.

## Naming and dating

The convention splits by document type, because specs are living and
reviews are point-in-time:

- **Specs** keep a stable, undated kebab name
  (`barwise/docs/specs/<kebab-name>.spec.md`). A creation date in the
  filename rots -- a spec edited months later still reads as "old" -- and
  renaming breaks the path references in REPO_REVIEW and CLAUDE.md.
  Instead, every spec carries `Created:` and `Last-updated:` header lines
  (ISO `YYYY-MM-DD`); git is the authoritative history, the headers are
  the at-a-glance version. Bump `Last-updated` whenever you revise.
- **Point-in-time artifacts** -- a `REPO_REVIEW`, an architecture
  snapshot -- carry a full `YYYY-MM-DD` in the filename
  (`docs/REPO_REVIEW-2026-06-16.md`), since each is a dated record that
  is never edited in place; the next review is a new file. Use the full
  date, not just the month: more than one can land in a month.

## Pre-push gate

STOP: do not push until every item below passes. Run the design gate
first -- a design change invalidates formatting work, never the
reverse.

### Design gate (content)

- **Principle check**: does the chosen design conflict with any stated
  pillar -- determinism in core, orthogonality, composability, explicit
  over implicit? A real conflict is an Open decision to surface, never
  a silent trade-off. This is the guard against principle drift under
  implementation pressure.
- **Open decisions are genuinely open** -- each states the options and
  the trade-off and recommends a default, and nothing that is the
  reviewer's call has been silently decided in the body.
- **Header block is current** -- `Status`, `Created`, `Last-updated`
  (bumped if this push revises an existing spec), `Tracking`.
- **REPO_REVIEW link**: reference the finding the spec resolves, and
  update its checkbox/status line when the spec lands.

### Formatting gate (dprint)

Run `npm run fmt` from `barwise/` and commit what it changes. dprint
runs locally in every environment: its wasm plugins are vendored as
npm devDependencies (`@dprint/*`) and referenced by `dprint.json` from
`node_modules`, so no network beyond the npm registry is needed. It
formats markdown, aligns tables, and formats fenced `ts` code blocks
inside markdown (a Target-architecture sketch is checked as real
code); `npm run fmt:check` is the CI-equivalent verification. The
pre-commit hook runs `dprint fmt` on staged files, so a clean local
commit is already gate-clean.

Two things dprint does not police:

- **No emoji** anywhere (project-wide rule).
- **Tables wider than the line width** are legal but expensive to
  read; consider restructuring before accepting one.
