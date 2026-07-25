# Learning-design constraints for barwise ORM materials

Status: Draft for review (design only -- no content changes in this PR)
Created: 2026-07-25
Last-updated: 2026-07-25
Tracking: Adopts the accelerated-proficiency framework supplied by the
project owner (Hoffman et al., _Accelerated Expertise_, 2014; AFRL
_Accelerated Proficiency and Facilitated Retention_, 2010) as a design
standard for the learning artifacts merged this cycle: the Anki deck
(PR #253), the modeling gym (`@barwise/learn`, PR #258), and the tutorial
spec (PR #257).

## Principle

Barwise now has three learning artifacts -- a deck, a gym, and a tutorial
-- authored ad hoc, each re-deciding what "good" means. Without one shared
standard they drift toward the failure the accelerated-proficiency
literature names: easy-to-author declarative recall that performs well in
practice and transfers poorly to real work. This spec makes the standard
explicit and checkable, so every future learning artifact is measured
against it rather than against the author's taste.

The standard serves the project's composability pillar: it is one thing
the deck, gym, and tutorial all consume, exactly as one `@barwise/core`
powers the CLI, MCP, and VS Code. And it rides on infrastructure already
merged -- the gym's deterministic checks (`must_validate`,
`requires_verbalization`, `forbids_population`, `requires_element`) are
the mechanism that makes several of these constraints machine-checkable.

## Problem: "good" is implicit today, and it regresses to recall

The three artifacts, measured against the far target (a modeler who turns
messy prose into a defensible model), sit here:

- **Deck** -- roughly nine of ten cards are `tier1-recall` declarative
  facts. `tier3-judgment` is a small, self-described experimental set.
  There are no perception or discrimination drills, and no card is
  engineered so a wrong mental model produces a visibly wrong answer.
- **Gym** -- the `.gym.yaml` format and the evaluator already support
  engineered-trap and generation-first exercises, but the one seed
  exercise is textbook-clean.
- **Tutorial** -- generation-before-exposition by design (the
  counterexample hook poses the problem before the concept), but it
  declares no proficiency transition and does not interleave.

None of the three states who it makes more expert, or how an observer
would know. That gap is what the standard closes.

## The proficiency scale

The six levels C1 transitions are named on, defined for barwise by what
a learner at each level can observably do with ORM. The scale measures
ORM proficiency specifically, not modeling experience in general. It is
also a different axis from the deck's tier tags (`tier1-recall`,
`tier3-judgment`, the planned discrimination tier): tiers classify the
cognitive act a single card demands, the scale classifies the learner
transition a module serves, and a module at any level can carry cards
of several tiers.

- **Naive** -- no exposure to fact-based modeling. Cannot yet tell a
  fact from an attribute. Gets the tutorial opening, the foundations
  recall cards, and textbook-clean intro exercises.
- **Novice** -- knows what ORM is for. Can read a fact type and its
  verbalization aloud and say what it asserts; cannot yet produce a
  model unaided.
- **Initiate** -- past introductory instruction. Models single
  elementary fact types from clean prose, with reference schemes and
  basic uniqueness constraints.
- **Apprentice** -- turns a page of clean prose into a small model that
  validates, with constraints defended. Messy inputs begin here: C4's
  rubric applies from this level up.
- **Journeyman** -- works unsupervised on realistic messy inputs;
  resolves ambiguity and contradiction and defends grain and constraint
  choices against plausible alternatives.
- **Expert** -- handles the models others bring to them: subtle
  subtyping, objectification, cross-context conflicts. Authors new
  traps for the bias catalog from failures they have diagnosed.

Learners who are experienced in other modeling traditions -- ER,
relational, dimensional -- should start at the early levels anyway, and
the framework says so wherever the scale is published. Prior modeling
skill does not transfer as a head start here; it transfers as the
reductive readings the catalog exists to break, and the early levels
are where those frames are intercepted before they calcify. The
naive-to-novice material costs an experienced modeler an hour and is
the cheapest bias insurance the framework offers.

## The standard: six design constraints (the target)

Every learning artifact -- a deck subdeck, a gym exercise set, a tutorial
-- is authored and reviewed against these six constraints. Each is
stated as a requirement, then as the check an author or reviewer applies.

### C1. Target a named proficiency transition, not a topic

When a module is authored, it shall declare (a) the transition it serves
on the proficiency scale above, and (b) the observable performance that
marks the far side -- a can-do statement that includes defending the
choice against a plausible alternative.

- _Check:_ the module's front matter contains a transition and an
  exit-performance sentence of the form "given X, can produce Y and
  defend Z against alternative W." "Understands uniqueness constraints"
  fails the check; "given a page of prose, produces a populated fact
  table and defends the grain against a plausible alternative" passes.

### C2. Break a specific reductive bias

When a module targets a construct with a known reductive reading (see the
catalog below), it shall include at least one case engineered so the
reductive reading produces a visibly wrong model, and shall then require
the learner to diagnose why their own reading failed -- never leaving the
wrong model as the last thing seen.

- _Check:_ the case names the bias it attacks; the wrong model it invites
  fails a deterministic barwise check (the "tell" column of the catalog);
  and a diagnosis step follows the reveal.

### C3. Build perception and discrimination, not just recall

When a module teaches a construct, it shall include short discrimination
exercises -- given several verbalizations or fragments, decide which
preserve the same facts, what the arity is, or which constraint is in
play -- and shall not rely on definitions alone to build that perception.

- _Check:_ the module contains discrimination items, not only
  produce-the-definition items. Equivalence claims ("these two preserve
  the same facts") are settled by the verbalizer, not by assertion.

### C4. Use tough, real, messy cases

When a module reaches apprentice level or beyond, its cases shall be
sourced from realistic messy inputs -- ambiguous requirements, stakeholder
emails, contradictory spreadsheets -- not from textbook-clean prose. The
messiness rubric is four dimensions -- ambiguity, contradiction,
irrelevant detail, missing information -- each marked present or absent.

- _Check:_ each apprentice-or-beyond case carries a messiness rating with
  at least one dimension present, and a note on what makes it hard.
  Textbook-clean cases are allowed only for sub-apprentice modules.

### C5. Design for desirable difficulty

When a module is sequenced, it shall prefer spacing over massing,
interleave problem types rather than block them, require the learner to
generate a model before any canonical model is shown, and test rather
than re-read. It shall warn the learner that this feels harder and is
meant to.

- _Check:_ the module never shows the canonical model before the
  learner's attempt; a set of exercises interleaves constructs rather
  than grouping all of one kind; the deck's spacing (already provided by
  the spaced-repetition scheduler) is not undercut by massing within a
  session.

### C6. Close the loop: failures become scheduled practice

When a learner's candidate fails a gym check, the toolkit shall emit a
diagnosis card in the deck's tab-separated import format -- the failed
check and its hint on the front, the authored diagnosis and a
fine-grained reading reference on the back -- and when the same failure
recurs, it shall emit the card again. Duplication is the recency
mechanism: a re-imported card re-enters the new-card queue, so the
misses subdeck tracks the learner's most recent failures by
construction. The static deck tiers remain the always-available home
for generic memorization; miss cards supplement them, per learner.

Reading references enter the loop at two grains. An optional
exercise-level reference supports a pre-session skim -- the exercise
states plainly that skimming is welcome and deep reading is not
expected before attempting. A check-level reference names the section
or subsection to study after a failure, when the learner arrives with a
specific question that section answers.

- _Check:_ emission is deterministic -- same submission, same cards, no
  timestamps or randomness in card content; the emitted file imports
  under the deck's existing convention (`#separator:tab` headers, a
  dedicated misses subdeck); every emitted card carries a check-level
  reading reference; no exercise makes its reading a prerequisite.

## Reductive-bias case catalog

The six known reductive readings in ORM, each with the engineered trap
that exposes it and the deterministic barwise check that catches the
wrong model. This catalog seeds C2; authors extend it.

| Reductive reading                                  | The trap that exposes it                                                            | Deterministic tell (barwise check)                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| "A fact type is a table, a role is a column"       | Prose whose facts are elementary but which a table-thinker lumps into one wide fact | The lumped fact type has no clean reading; `requires_verbalization` of the elementary facts fails  |
| Attribute-first thinking (from ER / dimensional)   | Prose where the "attribute" later needs its own facts or a constraint               | The attribute never becomes a fact type; `requires_element` (a fact type between the two) fails    |
| Assume binary arity; miss a genuine ternary        | Prose with an irreducible ternary (who scored what in which subject)                | The binary decomposition accepts a population the ternary forbids; `forbids_population` fails      |
| Conflate entity types with value types             | Prose where a label looks self-identifying but carries its own facts                | The label accrues its own facts; `must_validate` fails on the entity type with no reference scheme |
| Treat constraints as decoration added after        | Prose whose whole point is a rule (each order has one customer)                     | The unconstrained model forbids nothing; `forbids_population` fails wholesale                      |
| Read subtypes as an ISA taxonomy, not role-derived | Prose with a subtype that plays no role its supertype cannot                        | The subtype earns nothing; `requires_element` (a fact type only the subtype plays) fails           |

## Scope

In scope: the standard (C1-C6); the published proficiency scale with
its start-early guidance for experienced modelers; the reductive-bias
catalog; an authoring checklist extracted from the standard (where it
lives is Open decision 1); the cross-artifact loop -- `reading` and
`diagnosis` fields in the gym exercise schema and deck-format miss-card
emission from gym failures; aligning the gym's difficulty axis to the
scale; and
the ordered workstreams that retrofit the deck, gym, and tutorial to
conform.

Out of scope, deferred and named:

- Authoring the full conforming content. Each workstream below is its own
  content PR; this spec sets the bar, it does not clear it.
- Cognitive task analysis sessions with experienced modelers to mine real
  hard cases (C4's richest source). That is a human-in-the-loop effort;
  it is named as a later workstream, not done here.
- Any new `@barwise/learn` check kind (e.g. a discrimination "same facts?"
  check). Flagged in Open decisions; not committed.

## Inventory

| Artifact                   | Against the standard                                                | Verdict             |
| -------------------------- | ------------------------------------------------------------------- | ------------------- |
| Anki deck (`docs/anki`)    | Meets C5 spacing; misses C1, C2, C3; C4 partial (Tier 3 judgment)   | retrofit + new tier |
| Gym (`@barwise/learn`)     | Format and checks already support C2, C3, C5; content misses C1-C4  | author to standard  |
| Tutorial spec              | Meets C5 generation-first; misses C1 transition and C5 interleaving | amend spec          |
| `@barwise/learn` evaluator | Provides the deterministic tells C2/C3 rely on                      | unchanged           |
| Miss-card emission         | C6's mechanism; does not exist yet                                  | new, pure, in learn |

## Target architecture: the cross-artifact loop

Each artifact contributes the one thing the others lack: the tutorial
sequences first exposure, the gym grades generation, the deck schedules
retention, and the book supplies depth. The loop couples them through
file formats and shared references only -- no artifact invokes another
at runtime.

```
tutorial step (encode: generation-first exposure)
      |
      v
gym exercise (generate -> fail a check -> diagnose)
      |                              |
      | emits miss cards             | reading references
      | (deck tab-separated format,  |   before: exercise-level skim,
      |  misses subdeck; duplicates  |     optional by design
      |  intended -- recency)        |   after a failure: check-level
      v                              v     section to study
Anki deck (schedules retention)    Halpin & Morgan
  static tiers: always available
  misses subdeck: regenerated from
    the learner's own failures
```

A session interleaves across the loop rather than blocking within one
artifact: due cards from mixed subdecks, then a gym exercise on a
construct the cards did not just rehearse, then the tutorial if one is
in progress. The authoring checklist (workstream 1) carries this
session recipe; no code enforces it.

## Alternatives considered

- **Per-artifact standards.** Let the deck, gym, and tutorial each keep
  their own quality bar. This is the status quo, and it is the problem
  statement: three artifacts re-deciding "good" independently drift
  toward easy-to-author recall. Lost to the shared standard for the
  same reason one `@barwise/core` beats three engines.
- **Enforce the standard in code from day one.** Add front-matter
  schema and conformance checks to `@barwise/learn` so C1-C6 are
  machine-rejected rather than reviewed. Lost for now: the constraints
  should be proven by authoring real content before they harden into
  code, and half of them (C1's exit performance, C4's messiness) are
  judgment calls a schema cannot settle. C2's executable tells capture
  the part that genuinely is machine-checkable; Open decision 2 keeps
  the door open for more.
- **A session orchestrator.** An interactive engine that drives a
  whole sitting from one process -- serving due cards, launching the
  gym exercise, stepping the tutorial, interleaved under its control --
  and that must know about all three artifacts to do so. Lost: it
  couples three deliberately orthogonal artifacts to achieve what a
  file-format contract and a one-paragraph session recipe already
  provide. In the chosen design every session is fire-and-forget: a
  gym run grades the attempt, writes the miss cards, prints a
  suggested next step, and exits. Nothing stays running, and no
  artifact needs another installed to be useful (explicit over
  implicit).

## Workstreams (each independently shippable)

### 1. Land the standard and the authoring checklist

This spec, plus the authoring checklist (the C1-C6 checks, the
proficiency scale with its start-early guidance for experienced
modelers, the session recipe from the target architecture, and the
catalog, condensed) that every content PR references in its
description; where the checklist lives is Open decision 1 (recommended:
`docs/learning-authoring.md`). Smallest blast radius: docs only,
nothing depends on it yet.

### 2. Gym: the reductive-bias exercise set

One engineered trap exercise per catalog row, authored in `.gym.yaml`
against the shipped evaluator: prose that invites the reductive reading, a
reference model that passes, and the deterministic tell that the wrong
model trips. Each exercise declares its C1 transition and ends with a
diagnosis prompt. This is the sharpest embodiment of the standard and
uses only merged infrastructure.

### 3. Deck: a discrimination tier and bias-trap cards

Add a `tier-discrimination` tag and a set of "which preserves the same
facts / what is the arity / which constraint" cards, plus one bias-trap
card per catalog row that shows the wrong model and asks for the
diagnosis. Retrofit the existing subdecks with C1 transition statements.

### 4. Tutorial: transition and interleaving

Amend the tutorial spec and its (future) content to declare the C1
transition it serves and to interleave constructs across steps rather
than blocking them; keep the generation-first hook.

### 5. Gym: reading references and miss-card emission

Four changes to `@barwise/learn` and its planned CLI surface:

- `reading` fields in the exercise schema, at two grains:
  exercise-level (the pre-session skim) and per check (the section a
  failure sends you to). Schema-only; landing this alongside
  workstream 2 lets the bias exercises carry readings from birth.
- A per-check `diagnosis` field: the text C2's diagnosis step reveals
  and the miss card carries on its back. `hint` keeps its current job
  (guidance toward the fix, shown on the card front); `diagnosis`
  explains why the reading that produced the failure was wrong. Both
  `reading` and `diagnosis` are optional in the schema so existing
  exercises parse; the C6 check is what makes them required of
  conforming modules.
- Replace the exercise schema's `difficulty` enum (`intro`, `core`,
  `advanced`) with the C1 front matter: a `transition` declaration
  (`from`/`to` on the proficiency scale) and the exit-performance
  sentence beside it. One declaration then serves both the C1 check
  and level-based selection ("I am an apprentice; show me
  apprentice-onward exercises" means filtering on the transition's near
  side). Keeping a six-value difficulty beside a transition would say
  the same thing twice and let the two drift.
- Miss-card emission: a pure function beside the pure evaluator maps a
  `GymReport`'s failed checks to deck-format card rows; the file write
  rides the `barwise gym` CLI surface planned in the modeling-gym spec.
  The package stays a leaf with its I/O at the edge, matching the
  evaluator's own pure/loader split.

### 6. (later) Messy-case corpus from real modelers

Run cognitive task analysis on experienced modelers to extract the cases
that were genuinely hard and why, and build the C4 corpus from them. A
human-in-the-loop workstream, gated on access to those modelers.

## API and migration impact

Docs and content only for workstreams 1-4. Workstream 3 adds a deck tag
(`tier-discrimination`) -- a content convention, not an API. Workstream 5
is code: optional `reading` and `diagnosis` fields in the gym exercise
schema, a pure miss-card emission API in `@barwise/learn`, and a write
option on the planned `barwise gym` command -- all additive -- plus one
breaking schema change, `difficulty` replaced by the C1 front matter
(`transition` and the exit-performance sentence), whose blast radius is
the single seed exercise (a two-line migration). `@barwise/learn`
remains a leaf; core is untouched. A discrimination "same facts?" check
as a new `@barwise/learn` check kind is possible but not required (see
Open decisions); if added later it is additive and does not change
existing checks.

## Open decisions

1. **Where the durable standard lives.** This spec is the rationale; the
   day-to-day authoring checklist wants a shorter home. Options: keep it
   in this spec only; extract `docs/learning-authoring.md` (recommended --
   content PRs reference a one-pager, not a full spec); or fold it into
   each package's CLAUDE.md (spreads the concern). Recommendation: the
   one-pager.
2. **Discrimination as a check kind vs authored content.** A "same facts?"
   discrimination could become a `@barwise/learn` check (compare the
   verbalizations of two models for equivalence) or stay authored
   multiple-choice content. Recommendation: start as authored content;
   add the check kind only if authoring drift shows it is worth the code.
3. **How strictly to police the proficiency scale.** Require only that a
   module name its transition and exit performance (recommended), versus
   auditing every module's placement on the six-rung scale. Recommendation:
   require the naming, not the placement -- the exit-performance sentence
   is the real test.
4. **What the miss card's front carries.** The failed check and its hint
   only (compact, deterministic, authored-quality prose), or additionally
   a fragment of the learner's own submitted model (the most personal
   cue, but cards then embed arbitrary learner content). Recommendation:
   check-and-hint only for the first iteration; add the fragment later
   if miss cards prove too abstract to trigger recall of the failure.
5. **A local session history, and where learner state lives.** The gym
   CLI could append a session log -- exercise attempted, checks failed,
   cards emitted, next step suggested -- serving two purposes:
   resumability (where did I leave off?) and longitudinal gap analysis
   (the log plus the emitted cards are the record a learner, or the
   coaching layer named in Non-goals, can mine for recurring gaps).
   It stays an output artifact owned by the gym; it becomes the
   rejected orchestrator only if something starts reading it to
   control the other artifacts. Recommendation: yes, in workstream 5's
   CLI write; keep it human-readable; home it at
   `$XDG_STATE_HOME/barwise/` (fallback `~/.local/state/barwise/`),
   and copy emitted miss-card files there too, so the complete record
   lives in one place a future analysis session can read.

## Risks and testing

- **Risk: the standard becomes front matter nobody reads.** Mitigation:
  keep per-module conformance to the six C-checks; make the gym exercise
  its own conformance evidence -- an exercise that embodies C2 literally
  fails a barwise check on the wrong model, so conformance is executable,
  not asserted.
- **Risk: an engineered trap teaches the trap.** Mitigation: C2 requires
  the diagnosis step after the reveal; the wrong model is never the last
  artifact the learner sees.
- **Risk: the misses subdeck grows without bound.** It does, by design --
  duplication is the recency mechanism. Mitigation: tell the learner the
  misses subdeck is disposable (suspend or delete stale cards freely);
  the static tiers are the durable deck.
- **Testing:** the reductive-bias exercises are self-testing -- the wrong
  model fails a barwise check and the reference passes, which the gym's
  existing reference-passes-its-own-rubric test already asserts for each
  exercise. Discrimination equivalence claims are checked against the
  verbalizer, not by hand.

## Non-goals

- **Not a replacement for Halpin's pedagogy or the Conceptual Schema
  Design Procedure (CSDP).** The standard sits on top of the book's
  method; it governs how our materials teach, not what ORM is.
- **Not an LLM tutor.** The standard is met with deterministic materials
  first; a coaching layer, if it comes, consumes them.
