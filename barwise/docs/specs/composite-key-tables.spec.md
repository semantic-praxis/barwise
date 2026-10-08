# A table keyed on several columns imports as the fact type it states

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-2z1 (DDL); barwise-nkn, its composite-key part (dbt)

In one sentence: when a table or dbt model is keyed on more than one
column, the key is eligible under requirement 1 (at least one foreign
key wholly inside it, none partly inside it, none sharing a column) and
nothing annotates it, both importers read it as one fact type
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

## What a composite-key table states (recommended; the open decisions below)

ORM normalisation fixes most of it. A table keyed on columns K with
further columns A1..Am states, for each Ai, a fact over K and Ai unique
on K. The importer's only real choice is the grouping:

| Shape (key K has at least one foreign key and at least two roles) | Reading                                                                                       | Example                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| nothing beside K                                                  | one fact type over K (a many-to-many)                                                         | C10 `Course is prerequisite of Course`                                                                   |
| exactly one column beside K, NOT NULL, not unique by itself       | one fact type over K and it, unique on K                                                      | C03 `Coverage applies to Risk under PolicyPeriod`; C08 `Meter records ReadingValue at IntervalTimestamp` |
| exactly one column beside K, nullable                             | the fact type over K, objectified, the column an optional attribute                           | `coverage_applies` with a nullable `policy_period_id`                                                    |
| more than one column beside K, or another table references it     | the fact type over K, objectified by an entity named after the table, the rest its attributes | C10 Enrollment, C12 Determination                                                                        |
| a column unique by itself beside K                                | objectified; that column an alternate identifier, never a role                                | C04 OrderLine and its `line_id`                                                                          |
| K is one foreign key and one value, nothing beside it             | the binary over them, objectified                                                             | `meter_reading_time (meter_id, read_at)`                                                                 |
| K is one composite foreign key                                    | not this rule: one role is the key-is-reference shape                                         | `order_note (tenant_id, order_id)`                                                                       |
| K has no foreign key                                              | not this rule: today's entity with an external uniqueness                                     | `exchange_rate (currency, rate_date)`                                                                    |

The extra column must be NOT NULL to widen the fact type (PR #620
review): a row whose extra column is null still states the key's
combination, so a fact over the key and that column would either lose
the row or invent a value. A nullable extra column forces
objectification and becomes an optional attribute.

A table another table references never takes the extra role (PR #620
review: requirements 2 and 3 both matched it). It must be objectified,
and a fact type unique over only some of its roles is not one to
objectify: its objectifier would be identified by the key while the
extra role hung off the fact. So the fact type stays over the key, and
the column is the objectifier's attribute or relationship.

**Every shape the rule produces must be one the relational mapper
exports back** (PR #620 review). The mapper writes an n-ary fact type
or a many-to-many between entities as its own table, and an objectified
fact type as its entity's table keyed on its roles (#600), value roles
included. It cannot write a _binary_ with a value player and a spanning
uniqueness: it absorbs every entity-to-value binary into the entity's
table as a column (`RelationalMapper.ts`, the value-player branch). So a
binary over one foreign key and one value is objectified. A table the
rule reads as a fact type with no objectifier, and that another table
references, is objectified too, since only an object type can be
referenced.

## Requirements

1. When an unannotated table's primary key has two or more roles, at
   least one foreign key wholly inside it, and the foreign keys wholly
   inside it share no column, the DDL importer shall import one fact
   type whose roles are each such foreign key and each other key column,
   unique over the key's roles.
2. When exactly one column remains beside the key, NOT NULL and not
   unique by itself, and no other table references the table, the
   importer shall add it as a further role, the
   uniqueness still over the key's roles only.
3. When any other column remains beside the key, when another table
   references the table, or when the fact type would be a binary over
   one foreign key and one value, the importer shall objectify the fact
   type by an entity named after the table and import each remaining
   column as that entity's: a plain column as an attribute, a column of
   a remaining foreign key as a relationship the entity plays with the
   referenced entity, as the importer reads any entity's foreign key
   today (PR #620 review: `supplier_id` beside an order line's key is a
   relationship, not a value). A remaining plain column unique by
   itself shall be an attribute whose value role is unique -- an
   alternate identifier; the objectified fact type's key, which is the
   table's primary key, remains the entity's preferred identification.
   A remaining foreign-key column that is also unique by itself is read
   as any entity's foreign key is read today, a many-to-one: the DDL
   importer drops a single-column UNIQUE on a foreign-key column on
   every table, not only here, so the one-to-one it states is its own
   change with its own round-trip question (barwise-u0e; PR #620
   review).
4. When the key is one composite foreign key, contains no foreign key,
   has a foreign key lying partly inside it, or has two foreign keys
   inside it that share a column (PR #620 review: `FOREIGN KEY
   (tenant_id)` beside `FOREIGN KEY (tenant_id, order_id)`), the
   importer shall read the table as it did before this spec. This
   requirement takes precedence over requirements 1-3.
5. When a dbt model has no column with both `unique` and `not_null` and
   a model-level `dbt_utils.unique_combination_of_columns` names two or
   more columns, each `not_null`, at least one a `relationships` column,
   the dbt importer shall read it by requirements 1-3, each
   `relationships` column a foreign-key role. When two or more such
   tests qualify, the model has two candidate keys and nothing says
   which is preferred, so the importer shall read none of them as the
   key, keep today's reading, and report the model naming each
   combination (PR #620 review). A DDL table has one PRIMARY KEY, so the
   case is dbt's alone.
6. For each shape in the table above, a DDL import exported and imported
   again, with and without the export's annotations, shall give the same
   object types, fact types, role players, uniquenesses and
   objectifications.
7. For each shape both formats can state, the cli drift test shall
   import it as DDL and as the equivalent dbt project and shall fail when
   the two disagree on role players, internal and external uniquenesses
   or mandatory constraints of the fact types the rule builds and of
   every fact type the objectifier plays a role in -- its attributes,
   its alternate identifier and its remaining foreign keys' relationships
   (PR #620 review: a `supplier_id` one side dropped would otherwise
   pass) -- or on what is objectified. Fact type names and readings are
   not compared, since the two importers word them differently.

## Open decisions

1. **The single-extra-column rule.** Recommended: as above.
   Alternative: always objectify, never widen the fact type by one
   column. That keeps the functional dependency -- uniqueness over the
   objectified Coverage-Risk pair plus a mandatory functional
   PolicyPeriod attribute still allows at most one PolicyPeriod per pair
   (PR #620 review) -- but loses the ternary's shape, and C03's check is
   a verbalization of that shape: "For each Coverage and Risk
   combination, at most one PolicyPeriod applies."
2. **Reading text.** The importer cannot know the predicate; it names
   the fact type from the table as it does today ("Coverage, Risk and
   PolicyPeriod coverage applies to risk under policy period"). Checks
   worded around the kernel's reading stay out of reach and are
   declared `not_expressible` (as barwise-rlv did for ddl).
3. **dbt key source.** Recommended: a model-level
   `dbt_utils.unique_combination_of_columns` over `not_null` columns names
   the key; the test alone proves uniqueness and not presence, so a key
   with a nullable column is no key (PR #620 review). A model with a
   single `unique` + `not_null` column keeps today's reading: that column
   is a dbt model's key by convention, so where DDL can say a single
   `UNIQUE` sits beside a composite primary key, dbt cannot.
4. **A column unique by itself beside the key.** Recommended: an
   alternate identifier of the objectifying entity (a unique attribute),
   never a role; the primary key stays the preferred identification, as
   the DDL says. The trade-off (PR
   #620 review): the DDL importer reads a single-column UNIQUE elsewhere
   as a role with a uniqueness (`DdlImportFormat.ts`, header), and a
   unique column could be the extra role of a fact type that happens to
   be one-to-one with it. Reading it as an identifier matches the trial
   case (C04's LineId) and keeps the extra-role rule to non-identifying
   columns; the other reading would widen the fact type with a column
   that identifies the rows on its own.

## Scope

In scope: requirements 1-7, in `DdlImportFormat` (formats) and the dbt
mapping (dbt); a test per row of the table above in the DDL importer, and in the dbt
importer per row dbt can state (not the composite-foreign-key row:
dbt's `relationships` test is per column, so it cannot say several
columns form one reference -- barwise-tjg); a dbt test that a
model with two qualifying combination tests keeps today's reading and
is reported; the
drift test in `@barwise/cli`, the one package that depends on both --
the two packages keep their own code, and the drift test is what fails
when they diverge, as CLAUDE.md requires of must-agree copies (PR #620
review); and the trial rows the change moves (barwise-2z1's three;
barwise-nkn's C03 actuarial-analyst and C04 ternary check; the three
REFUSED dbt imports).

Out of scope: barwise-nkn's other parts (deontic `severity: warn`, rings
as singular tests, Order-Buyer, Seller), which are separate causes; an
annotated table, whose barwise line already says what it is; a
composite foreign key outside the key, which imports as one reference
per column (barwise-f2n); a single-column UNIQUE on a foreign-key
column, which no table imports today (barwise-u0e).

## Workstreams

1. Both importers, their tests and the drift test, in one PR: the drift
   test needs both sides, and either side alone would land a rule the
   other contradicts.
2. Trial run and reclassification, riding the same PR.
