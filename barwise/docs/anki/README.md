# Learning ORM 2 with spaced repetition

A deck of Anki cards for engineers learning Object-Role Modeling (ORM 2)
and fact-based conceptual modeling. The vehicle is Barwise, so the
terminology and the verbalization phrasing on these cards match what the
toolkit actually emits -- learn the card, and you are learning the tool.

## Why spaced repetition, and what it can and cannot do here

Spaced repetition rests on two robust findings from cognitive science:

- **The spacing effect.** Memory lasts longer when study is spread over
  time than when it is crammed. A scheduler shows each card at expanding
  intervals (a day, then a few days, then weeks) so you review each item
  just as you are about to forget it -- the point where the effort of
  recall does the most good.
- **The testing effect (active recall).** Retrieving an answer from
  memory strengthens it far more than re-reading. Every card asks you to
  _produce_ an answer before you flip it, not merely to recognize one.

Spaced repetition is excellent for the **atoms** of a discipline:
vocabulary, definitions, notation, the fixed phrasing of a constraint.
It is weaker, on its own, for **judgment** -- looking at a messy domain
and producing a good fact-based model. That skill is built by modeling
real domains, ideally with `barwise validate` and `barwise verbalize` in
the loop. These cards are the scaffolding underneath that practice, not
a substitute for it.

## How the deck is organized

Cards come in three tiers, from mechanical to judgment. The tier is a
tag on every card, so you can suspend a tier you are not ready for.

- **Tier 1 -- recall** (`tier1-recall`). Terminology, definitions,
  notation, and "which constraint is this". Objective grading: you knew
  it or you did not.
- **Tier 2 -- production** (`tier2-production`). Given a model fragment,
  produce the FORML verbalization. Self-graded against the exact
  phrasing on the back of the card.
- **Tier 3 -- judgment** (`tier3-judgment`). Spot the modeling error, or
  decompose a compound sentence into elementary facts. Self-graded
  against a rubric on the back.

Tier 3 is **experimental**. A binary right/wrong grade fits it poorly --
there is often more than one defensible answer. Grade yourself honestly:
"Again" if you missed the core point, "Good" if you named it, "Easy"
only if you also justified it the way the back does. If a Tier 3 card
turns out to be ambiguous or teaches a bad habit, cut it; the deck is
meant to be pruned.

Every card ends with a **"Read more"** pointer -- an italic line naming
where the concept is covered in depth, so you can go from a card you
just failed to the text that explains it. The pointers cite chapter and
section numbers in the reference edition (verified against its table of
contents); see [Further reading](#further-reading) for the full sources.

## Files

Each file imports into its own subdeck under `ORM 2::`.

- `01-foundations.txt` (`ORM 2::Foundations`) -- fact-based modeling,
  why attribute-free, elementary facts, the CSDP.
- `02-object-types.txt` (`ORM 2::Object Types`) -- entity vs value
  types, reference schemes and modes, objectification.
- `03-fact-types-and-readings.txt` (`ORM 2::Fact Types`) -- roles,
  arity, readings, reading order.
- `04-verbalization.txt` (`ORM 2::Verbalization`) -- producing FORML
  sentences (Tier 2).
- `05-constraints-phase1.txt` (`ORM 2::Constraints I`) -- uniqueness,
  mandatory, external uniqueness, value.
- `06-constraints-phase2.txt` (`ORM 2::Constraints II`) -- exclusion,
  exclusive-or, subset, equality, ring, frequency.
- `07-modeling-judgment.txt` (`ORM 2::Judgment`) -- error-spotting and
  decomposition (Tier 3).
- `08-subtypes.txt` (`ORM 2::Subtypes`) -- subtype facts, defining rules,
  exclusive/exhaustive subtypes, mapping strategies.
- `09-projects-and-mappings.txt` (`ORM 2::Projects`) -- bounded contexts,
  the manifest/domain/mapping files, context-mapping patterns, data
  products.
- `10-relational-mapping.txt` (`ORM 2::Relational Mapping`) -- Rmap,
  foreign keys vs associative tables, subtype strategies, DDL output.

## Importing into Anki

1. Anki desktop: **File -> Import**, select a `.txt` file.
2. Each file carries header lines (`#notetype`, `#deck`, `#tags`,
   `#separator:tab`, `#html:true`) so Anki configures the import for
   you. Leave "Allow HTML in fields" on -- cards use `<br>` and
   `<code>`.
3. Repeat for each file. Re-importing is safe: Anki matches on the first
   field and updates rather than duplicating.
4. Re-importing an edited file updates existing cards **without
   resetting their schedule**, so the deck can evolve as you refine it.

The default `Basic` and `Cloze` note types are used throughout, so there
is nothing to install first.

## Authoring conventions (for extending the deck)

These rules keep the deck consistent and keep it honest to the tool.

- **One idea per card.** If a card has two things to recall, split it.
  The minimum-information principle is what makes intervals stretch.
- **Ask for recall, not recognition.** Prefer "State the FORML reading
  for a single-role uniqueness constraint on a binary" over "Is this a
  uniqueness constraint? (y/n)".
- **Quote the tool verbatim.** Tier 2 answers must match the phrasing in
  `packages/core/src/verbalization/constraints/`. When a verbalizer
  changes, the affected cards change with it. The canonical templates:
  - Internal uniqueness (binary): `Each Order is placed by at most one Customer.`
  - Mandatory (binary): `Each Customer places at least one Order.`
  - Value constraint: `The possible values of Rating are: {'A', 'B', 'C', 'D', 'F'}.`
  - External uniqueness: `The combination of ... is unique across fact types.`
  - Exclusion: `No Person both authored some Book and reviewed some Book.`
  - Exclusive-or: `Each Person either ... or ... but not both.`
  - Subset: `If ... then ...`
  - Equality: `... if and only if ...`
  - Ring (irreflexive): `No Person manages that same Person.`
  - Frequency (binary): `Each Team includes exactly 11 Player.`
- **Tabs separate fields.** Front, then a literal TAB, then Back. Use
  `<br>` for line breaks inside a field, never a raw newline.
- **No emoji** (repo-wide convention).
- **Cite the source of truth.** When a card encodes a rule from
  `ARCHITECTURE.md` or a verbalizer, keep the phrasing traceable to it
  so the deck can be re-verified when the metamodel moves.
- **End each card with a "Read more" pointer.** Cite the chapter or
  section number in the canonical sources below, verified against the
  reference edition's table of contents -- not a guessed number.

## Keeping the deck true to the code

The risk with a deck like this is drift: the verbalizer changes and the
cards silently teach the old phrasing. Two mitigations:

- The FORML templates above are pulled directly from the Phase 1 and
  Phase 2 verbalizers. Treat those files as the source of truth.
- A future improvement is to _generate_ Tier 2 cards from real
  `.orm.yaml` models through the existing verbalization engine, so the
  answers cannot drift from the tool by construction. See `docs/specs/`
  if that work gets specced.

## Further reading

Each card's "Read more" pointer resolves to one of these. Book
references cite chapter and section numbers verified against the 3rd
edition's table of contents (e.g. uniqueness constraints are chapter 4,
subtyping is section 6.5, the Rmap procedure is section 11.3).

- **Halpin & Morgan, _Information Modeling and Relational Databases_,
  3rd ed. (2024).** ISBN 9780443237904. The canonical ORM reference, and
  the edition the barwise metamodel is designed against (see
  `docs/adr/0001-metamodel-evolution-policy.md`). Key chapters: 3
  (conceptual modeling and the CSDP), 4 (uniqueness), 5 (mandatory roles
  and reference schemes), 6 (value, set-comparison, and subtype
  constraints), 7 (ring, frequency, and final checks), 10.5
  (objectification), and 11 (relational mapping). The full contents,
  with per-section page numbers and the card-to-section mapping, are in
  `docs/halpin-morgan-3e-contents.md`.
- **Halpin, _ORM 2 Constraint Verbalization_ (ORM2-02).** Tech report at
  `https://www.orm.net/pdf/ORM2_TechReport2.pdf` -- the FORML target
  forms the verbalizer follows; the primary source for the Tier 2 and
  constraint cards.
- **Halpin, _ORM 2 Graphical Notation_ (ORM2-01).** Tech report at
  `https://www.orm.net/pdf/ORM2_TechReport1.pdf`.
- **Halpin, _Logical Data Modeling_ series, Business Rules Journal** at
  `https://www.brcommunity.com` -- constraint and verbalization
  deep-dives.
- **barwise `docs/ARCHITECTURE.md` and `docs/ORM_PROJECT_GUIDE.md`** for
  the toolkit's own metamodel, multi-file projects, and relational
  mapping (the sections named on the Projects and Relational Mapping
  cards).
- **Evans, _Domain-Driven Design_** for the context-mapping patterns
  (shared kernel, published language, anticorruption layer) the Projects
  cards reference.
