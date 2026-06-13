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

## Workflow

1. **Ground it.** Read `barwise/docs/ARCHITECTURE.md`, the relevant
   package `CLAUDE.md`, and the source the spec covers (a REPO_REVIEW
   finding, the code to change). Verify claims against the code -- do
   not design from assumptions. (E.g. "are these formats actually
   pure?" / "does this function also read disk?" -- check first.)
2. **Argue from principles.** Frame the problem and the resolution in
   terms of the stated principles: determinism in core, orthogonality
   and composability (primary), explicit over implicit, DRY (secondary).
   The strongest specs this project has produced reason _from_ these
   (e.g. "no interop format is mandatory to core, so core should ship
   none").
3. **Draft from the template.** Copy `template.spec.md` (in this skill
   dir) and fill it in. Drop sections that do not apply; do not invent
   filler.
4. **Split into workstreams.** Decompose implementation into
   independently shippable steps, ordered smallest-blast-radius first,
   each keeping the full suite green as its own PR. Note coupling that
   forces steps together (e.g. a function only one caller uses vs. one
   five modules share).
5. **Surface open decisions.** End with the choices that are genuinely
   the reviewer's call (package scope, where shared I/O lives,
   API shape). Recommend a default; do not silently decide. These are
   ADR-shaped -- state the options and the trade-off.
6. **Edit.** The first draft gets the thinking down; the edit makes it
   worth reading. Run the passes in `editing.md` -- BLUF, brevity,
   redundancy, voice (scanning `llm-tics.md`) -- then re-verify the
   survivors against the code. No first draft is good enough to share.
7. **Spec before code.** Land the spec for review first; implement in
   separate PRs. Update the spec (and the REPO_REVIEW status line) when
   scope is discovered to differ from the brief.

## House structure

Status/Tracking header, then the sections that apply:

- **Principle / Problem** -- what is wrong and which pillar it touches.
- **Scope** -- in scope / out of scope, explicitly.
- **Inventory** -- a table classifying what changes and the verdict.
- **Target architecture** -- a fenced code block of the end state.
- **Workstreams** -- the ordered, independently shippable steps.
- **API and migration impact** -- what moves, what breaks, blast radius.
- **Open decisions** -- the reviewer's calls, with a recommendation.
- **Risks and testing** / **Non-goals**.

For requirement statements, EARS phrasing keeps them testable:
"When `<trigger>`, the system shall `<response>`."

## Pre-flight checklist (before pushing)

`dprint fmt:check` runs in CI but cannot be run locally here (the wasm
plugin download is network-blocked). These markdown rules trip it every
time, so check them by eye:

- **Emphasis uses underscores**, not asterisks: `_word_`, not `*word*`.
  (`**bold**` is fine.)
- **Tables are column-aligned** -- every cell in a column padded to the
  widest cell, separator dashes spanning the full width. Generate the
  table with a script rather than by hand.
- **Task-list continuation lines indent 6 spaces** (aligned under the
  text after `- [ ] `), not 2. Regular `- ` bullet continuations indent
  2 spaces.
- **Imports/exports sort** by module specifier (external/bare before
  relative), case-insensitively; named members sort within `{ }`.
- **No emoji** anywhere (project-wide rule).
- Lines over 100 chars that dprint cannot break (long template literals)
  are fine; everything else stays under the width.

Also: reference the REPO_REVIEW finding the spec resolves, and update
its checkbox/status line when the spec lands.
