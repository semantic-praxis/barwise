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
the mechanism that makes several of these constraints machine-checkable,
not aspirational.

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

## The standard: five design constraints (the target)

Every learning artifact -- a deck subdeck, a gym exercise set, a tutorial
-- is authored and reviewed against these five constraints. Each is
stated as a requirement, then as the check an author or reviewer applies.

### C1. Target a named proficiency transition, not a topic

When a module is authored, it shall declare (a) the transition it serves
on the scale _naive, novice, initiate, apprentice, journeyman, expert_,
and (b) the observable performance that marks the far side -- a can-do
statement that includes defending the choice against a plausible
alternative.

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
emails, contradictory spreadsheets -- rated on a messiness rubric
(ambiguity, contradiction, irrelevant detail, missing information), not
from textbook-clean prose.

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
  the SRS scheduler) is not undercut by massing within a session.

## Reductive-bias case catalog

The six known reductive readings in ORM, each with the engineered trap
that exposes it and the deterministic barwise check that catches the
wrong model. This catalog seeds C2; authors extend it.

| Reductive reading                                  | The trap that exposes it                                                            | Deterministic tell (barwise check)                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "A fact type is a table, a role is a column"       | Prose whose facts are elementary but which a table-thinker lumps into one wide fact | The lumped fact type has no clean reading; `requires_verbalization` of the elementary facts fails      |
| Attribute-first thinking (from ER / dimensional)   | Prose where the "attribute" later needs its own facts or a constraint               | The attribute never becomes a fact type; `requires_element` (a fact type between the two) fails        |
| Assume binary arity; miss a genuine ternary        | Prose with an irreducible ternary (who scored what in which subject)                | The binary decomposition accepts a population the ternary forbids; `forbids_population` fails          |
| Conflate entity types with value types             | Prose where a label looks self-identifying but carries its own facts                | Wrong reference scheme; `must_validate` flags the entity with no scheme, or the verbalization is wrong |
| Treat constraints as decoration added after        | Prose whose whole point is a rule (each order has one customer)                     | The unconstrained model forbids nothing; `forbids_population` fails wholesale                          |
| Read subtypes as an ISA taxonomy, not role-derived | Prose with a subtype that plays no role its supertype cannot                        | The subtype earns nothing; `requires_element` on its distinguishing role fails                         |

## Scope

In scope: the standard (C1-C5); the reductive-bias catalog; a one-page
authoring checklist extracted from the standard; and the ordered
workstreams that retrofit the deck, gym, and tutorial to conform.

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

## Workstreams (each independently shippable)

### 1. Land the standard and the authoring checklist

This spec, plus a one-page `docs/learning-authoring.md` checklist (the
C1-C5 checks and the catalog, condensed) that every content PR references
in its description. Smallest blast radius: docs only, nothing depends on
it yet.

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

### 5. (later) Messy-case corpus from real modelers

Run cognitive task analysis on experienced modelers to extract the cases
that were genuinely hard and why, and build the C4 corpus from them. A
human-in-the-loop workstream, gated on access to those modelers.

## API and migration impact

Docs and content only; no code required for workstreams 1-4. Workstream 3
adds a deck tag (`tier-discrimination`) -- a content convention, not an
API. A discrimination "same facts?" check as a new `@barwise/learn` check
kind is possible but not required (see Open decisions); if added later it
is additive and does not change existing checks.

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

## Risks and testing

- **Risk: the standard becomes front matter nobody reads.** Mitigation:
  keep per-module conformance to the five C-checks; make the gym exercise
  its own conformance evidence -- an exercise that embodies C2 literally
  fails a barwise check on the wrong model, so conformance is executable,
  not asserted.
- **Risk: an engineered trap teaches the trap.** Mitigation: C2 requires
  the diagnosis step after the reveal; the wrong model is never the last
  artifact the learner sees.
- **Testing:** the reductive-bias exercises are self-testing -- the wrong
  model fails a barwise check and the reference passes, which the gym's
  existing reference-passes-its-own-rubric test already asserts for each
  exercise. Discrimination equivalence claims are checked against the
  verbalizer, not by hand.

## Non-goals

- **Not a replacement for Halpin's pedagogy or the CSDP.** The standard
  sits on top of the book's method; it governs how our materials teach,
  not what ORM is.
- **Not an LLM tutor.** The standard is met with deterministic materials
  first; a coaching layer, if it comes, consumes them.
