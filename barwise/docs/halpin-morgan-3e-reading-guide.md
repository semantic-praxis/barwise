# Reading guide: Halpin & Morgan, 3rd ed.

A reading path through Terry Halpin and Tony Morgan, _Information Modeling and
Relational Databases_, 3rd ed. (Morgan Kaufmann / Elsevier, 2024; ISBN
9780443237904), for a data engineer who knows tables and is picking up
Object-Role Modeling to use barwise well.

The short version: read chapters 3 to 7 in order with the tool open, then 10.5
and chapter 11. That is about 320 of the book's 1,000 pages, and it is the part
barwise's metamodel is designed against. Everything else is by need, and the
last section says which need.

Every chapter and section number here is checked against the transcribed table
of contents in `docs/halpin-morgan-3e-contents.md` by
`npm run check:book-citations`; the transcript is the authority when the two
disagree, and the book is the authority over the transcript.

## Why this book, and why this order

Barwise's metamodel is designed against this edition rather than against NORMA's
tooling (`docs/adr/0001-metamodel-evolution-policy.md`, filter 4), and
`docs/book-verification-checklist.md` verifies barwise's constructs against it.
So the book is not background reading for the tool. It is the specification the
tool's validation rules and verbalization forms are trying to be faithful to,
and when the two disagree the checklist treats the book as right until proven
otherwise.

The order is the book's own. Chapters 3 to 7 walk the Conceptual Schema Design
Procedure (CSDP), seven steps in which each step is provoked by a defect the
previous step leaves in the model. That is the same sequence the
order-fulfillment tutorial (`docs/tutorial/order-fulfillment.md`) follows on one
worked model, so the two can be read side by side.

## What the tool assumes you know

Barwise verbalizes, validates and maps; it does not teach. Three things it
assumes you bring from the book:

- **Facts, not attributes.** Everything is an object playing a role in a
  fact type. A reader who still thinks in tables and columns writes
  models that validate and mean the wrong thing (section 3.3 is where
  this is taught).
- **Constraints are the model.** A fact type with no uniqueness
  constraint asserts almost nothing. The book checks every constraint
  against a sample population, and so does `barwise validate`.
- **The relational schema is derived.** Tables, keys and foreign keys
  fall out of the conceptual model by the Rmap procedure (section 11.3).
  Barwise recomputes them and never stores them
  (`docs/adr/0001-metamodel-evolution-policy.md`, decision 5).

Three things the book covers that barwise deliberately does not model, so you do
not look for them: dynamic rules and process models (chapter 15), conceptual
queries (section 18.3), and NORMA's own file format (barwise imports and exports
it, and `docs/NORMA_VS_ORM_YAML.md` records what survives the round trip).

## Pass 1: enough to read a model

Two evenings. The goal is to read a `.orm.yaml` file and its verbalization
without guessing, before modeling anything yourself.

| Read                                         | Why                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1.2 (Information Modeling Approaches)        | Where ORM sits next to ER, UML and the relational model you already know.                     |
| 2.1-2.2 (four information levels)            | Conceptual versus logical versus physical. Barwise lives at the first and derives the second. |
| 3.3-3.4 (elementary facts and fact types)    | The unit of meaning. Every line of a barwise model is one of these.                           |
| 4.2 (uniqueness on unaries and binaries)     | The constraint you will read most often, and the one that decides one-to-many.                |
| 5.2-5.3 (mandatory roles, reference schemes) | Why every entity type has a reference mode, and what an optional role is.                     |

Then: run the tutorial's first three steps, and start the deck's
`ORM 2::Foundations` and `ORM 2::Fact Types` subdecks (`docs/anki/README.md`).

## Pass 2: the CSDP, end to end

The spine. Each stop names what to read, what it unlocks, the habit from
table-thinking it corrects, and where to practice with the tool. Page spans are
the chapter's, from the contents transcript.

### Stop 1: chapter 3, Conceptual Modeling: First Steps (pp. 59-110)

Read all of it: 3.1 (language criteria), 3.2 (the CSDP), 3.3 (from examples to
elementary facts), 3.4 (draw fact types and populate), 3.5 (trim the schema,
note derivations).

CSDP steps 1 to 3. The method starts from concrete examples rather than from a
list of entities, and the discipline of splitting a sentence into elementary
facts is the whole difference between ORM and the modeling you already do. Read
3.3 slowly.

Corrects: "a fact type is a table, a role is a column", and attribute-first
thinking. Both come from starting with the shape of the answer instead of the
facts.

In barwise: object types, fact types, readings and sample populations
(`packages/core/CLAUDE.md`, from `barwise/`). Tutorial steps 1 and 2. Gym
exercise `customer-order` (`barwise gym show customer-order`). Deck:
`ORM 2::Foundations`, `ORM 2::Fact Types`, `ORM 2::Object Types`.

### Stop 2: chapter 4, Uniqueness Constraints (pp. 111-158)

Read 4.2-4.3 (uniqueness on binaries, then longer fact types), 4.4 (external
uniqueness), 4.5 (arity checks). Skim 4.6 (projections and joins) on a first
pass and return to it before chapter 10.

CSDP step 4. Uniqueness is what decides whether a fact type maps to a column, a
foreign key or its own table, and the arity check in 4.5 is the procedure for
telling a genuine ternary from two binaries in disguise.

Corrects: assuming binary arity and missing a genuine ternary; treating
constraints as decoration added afterward.

In barwise: `internal_uniqueness` and `external_uniqueness`; the counterexample
generator that shows the population a constraint forbids; `barwise validate`
against a sample population. Tutorial steps 3 and 4. Deck:
`ORM 2::Constraints I`.

### Stop 3: chapter 5, Mandatory Roles (pp. 159-210)

Read 5.2 (mandatory and optional roles), 5.3 (reference schemes), 5.5 (the
logical derivation check). The case study in 5.4 is worth the time if you have
it.

CSDP step 5. Reference schemes are where a table-thinker's "primary key" becomes
a modeling decision rather than a default, and the derivation check is the first
place the book asks whether a fact type should exist at all.

Corrects: conflating entity types with value types. A value denotes itself; an
entity needs a reference scheme, and a label that starts collecting its own
facts has stopped being a value.

In barwise: `mandatory`, `disjunctive_mandatory`, reference modes and preferred
identifiers. Tutorial step 5. Deck: `ORM 2::Constraints I`,
`ORM 2::Object Types`.

### Stop 4: chapter 6, Value, Set-Comparison, and Subtype Constraints (pp. 211-272)

Read 6.3 (value constraints and independent types), 6.4 (subset, equality,
exclusion), 6.5 (subtyping), 6.6 (generalization). 6.2 is set theory you can
skip if the words subset and disjoint are already yours.

CSDP step 6. Subtyping is the chapter's centre of gravity for this audience: an
ORM subtype earns its place by playing a role its supertype cannot, or by
carrying a defining rule. A taxonomy alone is no reason to subtype.

Corrects: reading subtypes as an ISA taxonomy rather than as role-derived.

In barwise: `value`, `subset`, `equality`, `exclusion`, exclusive-or, subtype
facts with defining rules, independent object types. Tutorial steps 6 and 7.
Deck: `ORM 2::Constraints II`, `ORM 2::Subtypes`.

### Stop 5: chapter 7, Other Constraints and Final Checks (pp. 273-308)

Read 7.2 (frequency), 7.3 (ring), 7.5 (final checks). 7.4 (other constraints and
rules) is a catch-all; chapter 10 is where the advanced constructs get sections
of their own.

CSDP step 7, and the end of the procedure. The final checks in 7.5 are what a
model review is: redundancy, completeness, and whether the population still
fits.

In barwise: `frequency`, `ring` (all seven kinds), `cardinality`;
`barwise review`, which is the tool's version of 7.5. Tutorial step 8. Deck:
`ORM 2::Constraints II`, `ORM 2::Judgment`.

## Pass 3: objectification and the mapping

Two chapters that turn a finished conceptual model into something a data
engineer can ship.

### Stop 6: 10.5, Nominalization and Objectification, and 10.1, Join Constraints

Read 10.5 (objectification) first; it is the construct people reach for most and
misuse most. Then 10.1 (join constraints), which is where the set-comparison
constraints of 6.4 stop being about single fact types. 10.8 (further constraints
involving subtyping) closes the subtyping thread from chapter 6. Skim 10.6 (open
and closed world) once so the term is familiar.

Corrects: inventing an "EnrollmentRecord" entity with duplicated identifying
facts where an objectified fact type was the answer.

In barwise: objectified fact types; `join_subset`, `join_equality`,
`join_exclusion` (`docs/specs/archive/role-path-model.spec.md` records the
design). Deck: `ORM 2::Object Types`, `ORM 2::Subtypes`.

### Stop 7: chapter 11, Relational Mapping (pp. 481-538)

Read 11.2 (relational schemas, as a refresher of vocabulary), 11.3 (the
relational mapping procedure, Rmap), 11.4 (advanced mapping, for subtypes and
objectification).

This is the payoff. Rmap is the algorithm that turns uniqueness and mandatory
patterns into tables, columns, keys and foreign keys, and once you have followed
it by hand you can read a barwise DDL export and say why each table is shaped as
it is.

Corrects: flattening a one-to-many into a column because the source system did,
and choosing a subtype table strategy before the model has said what the
subtypes are for.

In barwise: the relational mapper and the DDL, dbt and Avro exports
(`docs/ARCHITECTURE.md` sections 3.4-3.5; `docs/IMPORT_EXPORT.md`). Deck:
`ORM 2::Relational Mapping`.

## Reading with the tool open

The book teaches by worked example, and barwise makes each example executable. A
routine that works:

1. At the end of each chapter, write its worked model as `.orm.yaml`,
   including the sample population the book gives.
2. Run `barwise validate`. A constraint the book says the population
   violates should fail here too; one that passes when the book says it
   should not is either your model or a barwise gap. The
   `docs/book-verification-checklist.md` is where the latter gets
   recorded.
3. Run `barwise verbalize` and compare the sentences with the book's
   own. The forms follow Halpin's _ORM 2 Constraint Verbalization_ (tech
   report ORM2-02); differences in wording are worth a note, differences
   in meaning are a bug.
4. Fail a gym check on purpose, read its `reading` pointer, and import
   the miss card it emits (`barwise gym check --emit-misses`). That is
   the loop the learning design describes
   (`docs/specs/learning-design.spec.md`).

## For a reader coming from tables

Each habit on the left is right in a warehouse and wrong in a conceptual model.
The section teaches the ORM side.

| Habit from tables                  | ORM counterpart                                        | Read                                        |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| A table with columns               | Several elementary fact types over one object type     | 3.3 (elementary facts)                      |
| A column                           | A role in a fact type                                  | 3.4 (fact types)                            |
| A primary key                      | A preferred reference scheme                           | 5.3 (reference schemes)                     |
| A nullable column                  | An optional role                                       | 5.2 (mandatory and optional roles)          |
| A foreign key                      | A uniqueness pattern that Rmap turns into a key        | 4.2 (uniqueness), 11.3 (relational mapping) |
| A junction table                   | A many-to-many fact type with a spanning uniqueness    | 4.2-4.3 (uniqueness)                        |
| A check constraint or enum         | A value constraint                                     | 6.3 (value constraints)                     |
| A type column with per-type tables | Subtyping, and a mapping choice made later             | 6.5 (subtyping), 11.4 (advanced mapping)    |
| A surrogate key                    | A reference scheme decision, not a default             | 5.3 (reference schemes)                     |
| A fact table with a grain          | Often an objectified fact type                         | 10.5 (objectification)                      |
| Normalization                      | A consequence of elementary facts, not a separate step | 14.6 (normalization)                        |

## By need: the rest of the book

| Chapters                          | Verdict for this reader                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (Introduction), 2 (Levels)      | Skim 1.2 and 2.1-2.2 in pass 1; the rest is history and framing.                                                                                                                 |
| 8 (ER), 9 (UML)                   | Read 8.5 (mapping from ORM to ER) and 9.8 (mapping from ORM to UML) when you have to explain a model to someone who draws the other notation. Skip the rest.                     |
| 10 (Advanced), remaining sections | 10.2 (deontic rules) when you meet a constraint with deontic modality; 10.3 (temporality) before modeling history; 10.4 (collection types) and 10.7 (higher-order types) rarely. |
| 12 (SQL), 13 (Other features)     | Skip: you write SQL. 12.1 (relational algebra) if you never studied it; 13.2 (defining tables) to compare with a barwise DDL export.                                             |
| 14 (Schema Transformations)       | 14.3 (nesting, coreferencing, flattening) with stop 6; 14.6 (normalization) to see it fall out of elementary facts; 14.8 (reengineering) before importing a legacy schema.       |
| 15 (Process and State)            | Skip. Barwise does not model dynamic rules, by decision (`docs/adr/0001-metamodel-evolution-policy.md`, tier 4).                                                                 |
| 16 (Data File Formats)            | 16.5 (XML, JSON, and ORM) only; it is the section closest to what a `.orm.yaml` file is doing (`docs/book-verification-cc5-serialization.md`).                                   |
| 17 (NoSQL)                        | 17.4 (document databases) and 17.5 (graph databases) if you target either; the mapping ideas transfer.                                                                           |
| 18 (Other aspects)                | 18.2 (data warehousing and OLAP) is written for this reader. 18.7 (metamodeling) if you want to know how barwise's metamodel could be an ORM model itself.                       |

## Related material in this repository

- `docs/halpin-morgan-3e-contents.md`: the table of contents with page
  numbers, and the map from each deck subdeck to its chapters.
- `docs/anki/README.md`: the deck, tiered from recall to judgment, with a
  book pointer on every card.
- `docs/tutorial/order-fulfillment.md`: the CSDP on one model, eight steps,
  each drilled by a subdeck.
- `docs/book-verification-checklist.md`: the claims barwise makes that still
  need checking against the text, kept as a reading log.
- `docs/specs/learning-design.spec.md`: the reductive readings this guide's
  "corrects" lines come from, and how the tutorial, gym and deck fit
  together.
