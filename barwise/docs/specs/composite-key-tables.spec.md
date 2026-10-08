# A table keyed on several columns imports as the fact type it states

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-2z1 (DDL); barwise-nkn, its composite-key part (dbt)

In one sentence: when a table or dbt model is keyed on more than one
column and nothing annotates it, both importers read it as one fact type
over its key columns plus, when exactly one other column remains and it
is NOT NULL and not itself unique, that column, keyed on the key; any
other shape makes the fact type over the key objectified by an entity
named after the table, which carries the remaining columns as
attributes.

## Principle

**One rule, decided once, for a question two importers answer.** The DDL
importer reads a table keyed on two or more foreign keys as an
objectified relationship over those keys and nothing else (ddl-round-
trip-fixed-point workstream 5); a table keyed on a mix of foreign keys
and values imports as an entity with an invented key (barwise-2z1). The
dbt importer finds a key only in a single column with both `unique` and
`not_null`, so a model keyed by `dbt_utils.unique_combination_of_columns`
imports as nothing at all: three trial imports skip two models each
(barwise-nkn, noted on 2026-10-08). The same schema shape should mean
the same model whichever file it arrives in.

## What a composite-key table states (resolved, pending review: the rule below)

ORM normalisation fixes most of it. A table keyed on columns K with
further columns A1..Am states, for each Ai, a fact over K and Ai unique
on K. The importer's only real choice is the grouping:

| Columns beside the key                               | Reading                                                                                       | Trial case it fits                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| none                                                 | one fact type over K (a many-to-many)                                                         | C10 `Course is prerequisite of Course`                                                                   |
| exactly one, NOT NULL and not itself unique          | one fact type over K and it, unique on K                                                      | C03 `Coverage applies to Risk under PolicyPeriod`; C08 `Meter records ReadingValue at IntervalTimestamp` |
| more than one, or the table is referenced by another | the fact type over K, objectified by an entity named after the table, the rest its attributes | C10 Enrollment, C12 Determination, C04 OrderLine                                                         |

The extra column must be NOT NULL to widen the fact type (PR #620
review): a row whose extra column is null still states the key's
combination, so a fact over the key and that column would either lose
the row or invent a value. A nullable extra column therefore forces
objectification and becomes an optional attribute of the objectifier,
exactly as a second extra column would.

A column with its own single-column `UNIQUE` beside the key is an
identifier of the objectifying entity, never a role (C04's `line_id`
beside `order_id, product_variant_id`), so it forces objectification and
is not counted as "the one other column": C04's OrderLine is then the
ternary "Order includes ProductVariant in Quantity" objectified by an
entity whose LineId is unique.

Key columns may be foreign keys or plain values, with at least one
foreign key among them; a value key column is a value role (C08's
IntervalTimestamp). A table keyed on values alone keeps today's reading,
an entity with an external uniqueness. A table that the rule reads as a
fact type with no objectifier and that another table references is
objectified after all, since only an object type can be referenced.

**Every shape the rule produces must be one the relational mapper
exports back** (PR #620 review). The mapper writes an n-ary fact type
or a many-to-many between entities as its own table, and an objectified
fact type as its entity's table keyed on its roles (#600), value roles
included. It cannot write a _binary_ with a value player and a spanning
uniqueness: it absorbs every entity-to-value binary into the entity's
table as a column (`RelationalMapper.ts`, the value-player branch). So
when the rule would read a binary over one foreign key and one value --
a table keyed on `(meter_id, interval_timestamp)` with nothing else --
that binary is objectified by an entity named after the table, which
the mapper settles as a table keyed on both columns. Each row of the
table above gets a round-trip test (import, export, re-import, no
loss), so a shape the mapper cannot write fails there.

## Open decisions

1. **The single-extra-column rule.** Recommended: as above. Alternative:
   always objectify, never widen the fact type by one column. That is
   simpler and loses C03's "For each Coverage and Risk combination, at
   most one PolicyPeriod applies", which needs the ternary.
2. **Reading text.** The importer cannot know the predicate; it names
   the fact type from the table as it does today ("Coverage, Risk and
   PolicyPeriod coverage applies to risk under policy period"). Checks
   worded around the kernel's reading stay out of reach and are
   declared `not_expressible` (as barwise-rlv did for ddl).
3. **dbt key source.** Recommended: a model-level
   `dbt_utils.unique_combination_of_columns` names the key; a model with
   a single `unique` + `not_null` column keeps today's reading.

## Scope

In scope: the rule in both `DdlImportFormat` (formats) and the dbt
mapping (dbt), a fixture per row of the table above in each package's
tests, a drift test in `@barwise/cli` (the one package that depends on
both) that imports each fixture as DDL and as the equivalent dbt project
and asserts the two models agree in object types, fact types, role
players and uniqueness -- the two packages keep their own code, and the
test is what fails when they diverge, as CLAUDE.md requires of
must-agree copies (PR #620 review) -- and the trial rows it moves (barwise-2z1's three;
barwise-nkn's C03 actuarial-analyst and the C04 ternary check; the three
REFUSED dbt imports).

Out of scope: barwise-nkn's other parts (deontic `severity: warn`, rings
as singular tests, Order-Buyer, Seller), which are separate causes; an
annotated table, whose barwise line already says what it is.

## Workstreams

1. DDL importer (formats), with tests.
2. dbt importer, with tests, and the cross-importer drift test.
3. Trial run and reclassification.

One PR each for 1 and 2; 3 rides 2.
