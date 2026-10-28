# Ossie expressions and barwise derivation rules, 2026-10-28

A point-in-time research note for two tracker issues: barwise-pf2.xil (should
barwise adopt Ossie's `OSSIE_SQL_2026` for governed metrics?) and
barwise-pf2.m2w (how do barwise's subtype and derivation rules compare with
Ossie's `extends`, `derived_by` and `requires`?). It is not maintained.

It was written against barwise `main` at `7e84074c`, and against Apache Ossie
at two commits: `01a5488d` (2026-10-23), the commit barwise pins and vendors
under `packages/formats/tests/fixtures/ossie/`, and `89e2e17f` (2026-10-27),
upstream `main` on the day of writing. Between the two, `ontology/ontology.md`
and `examples/flights.ontology.yaml` did not change, and
`core-spec/expression_language.md` gained one sentence (see "barwise-pf2.xil: status and stability"). In
the sources list, a URL without a commit means the page as it read on
2026-10-28.

**Verified** means I read it in the source or ran it. **Inferred** marks a
conclusion I drew and did not test.

## Bottom line

**barwise-pf2.xil: wait. Track `OSSIE_SQL_2026`, but do not adopt it yet.**

- **Why it is SQL.** `OSSIE_SQL_2026` is written over tables and columns, not
  over the ORM graph. It covers Ossie's core (BI) layer, which Ossie calls
  the logical layer: a field's expression reads the columns of its dataset's
  `source` (a table or view), and a metric's expression reads fields. The
  spec says outright that it does not cover the ontology layer.
- **The owner's intuition is right about `derived_by`.** Ontology-layer
  rules are queries over the ORM graph, but they use a second language that
  Ossie has not published. So for _subsets_ (in ORM terms, subtypes with a
  defining rule), `OSSIE_SQL_2026` is the wrong tool, and the work belongs
  to barwise-pf2.2.
- **For governed metrics it is the right eventual target, but barwise has
  nowhere to put one.** There is no metric construct, barwise does not read
  Ossie's core layer (ADR decision 2), and the dbt export writes no semantic
  layer.
- **It is still moving.** Its schema changed from a closed dialect enum to a
  free-form string two days after barwise's pin, and the first grammar for
  it was opened as a pull request on the day of writing.
- **The shape I would choose when barwise adopts it:** authors write rules
  and metrics over the ORM model, barwise checks them there, and a connector
  package writes `OSSIE_SQL_2026` text at the dbt or Ossie boundary. None of
  it goes in `core`.

**barwise-pf2.m2w: the owner's prior holds for the structure around
subtypes, and does not hold for the rules themselves.**

- **barwise is ahead on structure.** It can constrain a supertype's subtypes
  as exclusive, total or a partition. It separates derived from semiderived,
  and on-request from stored. It records which supertype supplies
  identification. It validates, verbalizes and diffs all of this. Ossie has
  none of these as fields.
- **barwise is behind on the rule.** A barwise defining rule is opaque text
  that core never parses. Ossie writes `derived_by` in a syntax that names
  roles and paths, though it has not specified that syntax formally. Ossie
  also lets a value type extend another value type, which barwise flattens.
- **Role paths go part of the way.** barwise's stored role path can carry
  the path in three of the nine explicit `derived_by` items in Ossie's
  specification and flights example: both cases of `ancestor_of`, and
  `EXISTS ( Person.earns )`. The other six need comparisons, literals or
  aggregation. Recursion needs a container that holds a union of paths, not
  a different kind of path. This should reshape barwise-pf2.2 (see "What
  this means for barwise-pf2.2").

## barwise-pf2.xil: what OSSIE_SQL_2026 is

**Verified.** The definition is `core-spec/expression_language.md`:

- It is "the SQL expression language subset that Ossie-compliant
  implementations MUST support", "based on ANSI SQL:2003 Core", plus the
  optional aggregate `FILTER (WHERE ...)` (feature T612). It allows arithmetic, comparison,
  `AND`/`OR`/`NOT`, `BETWEEN`, `IN` over lists, `LIKE`, `CASE`, aggregate,
  window and scalar functions. It rules out `SELECT`, `FROM`, `JOIN`,
  `GROUP BY`, `WHERE`, subqueries and CTEs ("Not Supported in Expressions").
- It names its scope: "This proposal is only targeted at the Logical Layer.
  It would be nice if the Ontological layer could reuse the same expression
  language, but that will be treated as a separate proposal." The logical
  layer means "metrics, fields, filters, etc".
- It reads three namespaces ("Name Spaces"). In a field expression,
  identifiers name columns of the dataset's `source`. In a dataset-scoped
  metric, they name that dataset's fields. In a model-scoped metric, they
  name `dataset.field`. Nothing in it names a concept, a role or a
  relationship of the ontology. One table row ("Supported SQL Constructs",
  line 128) says column and metric references vary "based on whether in
  Ontology or Semantic models" and defers to "future Ontology
  documentation", but the scope statement on line 39 still governs.
- It declares a model and does not query one ("Model Declaration vs.
  Querying"). Querying is Layers 2 and 3 in `core-spec/spec_layers.md`.

**Verified.** The ontology's own expressions are not `OSSIE_SQL_2026`, even
though `ontology/ontology.json` gives their `Expression` type the description
"ANSI SQL expression". The examples in `ontology/ontology.md` ("Derivation
expressions", "Requires") and `examples/flights.ontology.yaml` navigate roles
with dot paths (`Person.ancestor_of.parent_of(descendant)`), use `==` for
equality, and aggregate with brackets, as in
`AVG[Flight.departure_delay WHERE Flight.route(Route) GROUP BY Route]`, which
is not SQL syntax. SQL appears in the ontology layer in one place: a mapping
document's `object_mappings[].expression`, described as a "SQL expression
that computes a value from fields". That is the bridge from logical fields up
to concepts ("Object mappings"). barwise does not read mapping documents (ADR
decision 2).

**Verified.** Upstream discussion: apache/ossie#361, "Ontology expression
language: semantics and interoperability considerations", was opened
2026-09-04 and closed 2026-09-20 as completed. No pull request is linked. In
it, a working-group member (kurtStirewalt, 2026-09-18) says the Ontology
Working Group wrote a relational formula language with a BNF in spring 2026.
He says `requires` items combine by conjunction and `derived_by` items by
disjunction, and that agreeing on the language should not block converter
work. A search of apache/ossie pull requests and issues for "ontology
expression" and "derived_by" on 2026-10-28 found no proposal for that
language. The closest open items are #146 (annotations) and #310 (an SAP
example). **Inferred:** the BNF exists outside the repository, and the
conjunction and disjunction rule is stated in a closed issue comment, not
in the specification.

## barwise-pf2.xil: status and stability

**Verified.**

- The header reads "Current Status: Proposed Final". Its Version History
  holds one row: "0.2.0.dev, 2026-07-15, Initial draft". Its working group
  includes Snowflake, Databricks and dbt Labs.
- It is still changing. Between the pin (`01a5488d`, 2026-10-23) and upstream
  `main` (`89e2e17f`, 2026-10-27), `core-spec/ossie-schema.json` changed
  `Dialect` from a closed enum of twelve names, `OSSIE_SQL_2026` among them,
  to "any non-empty string". `expression_language.md` gained the sentence
  saying so (commit `a498fce`, apache/ossie#617). The same commit added an
  optional top-level `sql` expression form, written in `OSSIE_SQL_2026` and
  authoritative over a `dialects` entry, and replaced
  `required: ["dialects"]` with `anyOf` `sql` or `dialects`. Since
  2026-09-21 `expression_language.md`
  has had ten commits. Two of them changed semantics: `NOT` now ranks below
  comparison (#614), and `FILTER (WHERE ...)` was added (#382).
- The first grammar is apache/ossie#657, "add ANTLR4 grammar for
  OSSIE_SQL_2026 expressions". It was opened 2026-10-28 and had no review
  that day. It says "The spec stays normative; where the two differ, the spec
  wins". It leaves `||` precedence, identifier rules, `LIKE ... ESCAPE` and
  comparison chaining for the spec to decide. Its only target is Python.
- A dbt converter exists in apache/ossie-converters (`dbt/`). It converts
  between dbt MetricFlow's `semantic_manifest.json` and Ossie's core layer,
  in both directions. Going from Ossie to dbt, it prefers an
  `OSSIE_SQL_2026` entry when it picks a metric's dialect. It reports
  windows, nested aggregates and subqueries as unsupported. I read its
  README and no code, and did not record a commit.

## barwise-pf2.xil: what adopting it would take

**Verified, barwise today:**

- barwise has no metric element. ARCHITECTURE.md 3.1.5 says a data product's
  metric "is captured as a derived fact type with a definition that traces
  to its source fact types", so in practice it is prose.
- barwise reads and writes only Ossie's ontology layer
  (`docs/adr/ossie-interchange.md`, decision 2). Metrics live in the core
  layer, which barwise does not touch.
- A derived fact type loses its derivation at the warehouse boundary. I
  imported `flights.ontology.yaml` with
  `barwise import model ... --format ossie`. `Airport.average_departure_delay`
  came in with `derivation: {kind: derived, expression: "Delay ==
  AVG[...]"}`. `barwise export --format ddl` then wrote it as an ordinary
  column (`delay DECIMAL` on `airport`), and `--format dbt` wrote the same
  column into `schema.yml` with no mention of the rule.
  `core/src/mapping/RelationalMapper.ts` never reads `derivation`.
- barwise's SQL parsing is statement-level pattern mining. Core's
  `parseSqlFile` (`core/src/sql/SqlCascadeParser.ts`) is a regex tier. The
  sqlglot tier (`formats/src/sql/SqlglotBridge.ts`) is a Python subprocess in
  `@barwise/formats`. Neither validates an expression against a grammar, and
  the sqlglot tier cannot run in `core` (determinism in core).

**Inferred, what adoption would need, in order:**

1. A barwise metric (or "measure") construct in the metamodel, passed
   through the four filters in `docs/adr/metamodel-evolution-policy.md`. It
   would have to say which fact types and roles a metric aggregates over.
   That is a conceptual statement, made before any column exists.
2. A way to write it out. A metric over the ORM model compiles to
   `OSSIE_SQL_2026` text only after relational mapping has named the
   columns. So that text is an export product, made in `@barwise/dbt`
   (MetricFlow YAML) or `@barwise/formats` (an Ossie core-layer document),
   which keeps core free of anything Ossie-specific (ADR decision 1).
3. Checks. These are deterministic, so they could be pure code, but they are
   SQL-specific and Ossie-specific, so they belong in the connector. They
   would check that every identifier resolves to a mapped column or field,
   that the expression uses only functions the spec marks REQUIRED (the
   "Compliance Levels"), and that a `FILTER` predicate stays within one
   dataset. barwise never evaluates an expression against data.
4. Reading `OSSIE_SQL_2026` in, from an Ossie core-layer document or a dbt
   semantic manifest. That requires reversing ADR decision 2, and it maps
   column-level text back up to fact types, which is barwise-pf2.3's
   problem.

The design choice in step 2 is between two options. The first stores
`OSSIE_SQL_2026` text on a barwise element and checks it against the mapped
schema. The second has barwise write rules over the model in its own terms
and generate `OSSIE_SQL_2026` from them. I recommend the second. The first
puts a physical-layer language into a conceptual model, and a change to the
relational mapping (a renamed column) would break a rule nobody edited.

**What would change the "wait":** Ossie publishes a release with a
`Version History` row past "Initial draft"; the grammar (#657) or a
compliance suite for expressions lands; or the owner wants barwise to write
dbt semantic-layer YAML, which would make step 2 concrete without waiting on
Ossie.

## barwise-pf2.m2w: subtyping and derivation compared

### Structure

| Aspect                                    | barwise                                                                                                                                                                                     | Ossie (`01a5488d`)                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where subtyping is stated                 | A `SubtypeFact` per subtype and supertype pair (`core/src/model/SubtypeFact.ts`; `subtype_facts` in `orm-model.schema.json`)                                                                | `extends: [ ... ]` on the concept                                                                                                                 |
| Multiple supertypes                       | Yes, one subtype fact each                                                                                                                                                                  | Yes                                                                                                                                               |
| Which supertype supplies identity         | `providesIdentification` on each subtype fact                                                                                                                                               | No field. The barwise importer gives it to the first supertype unless the concept has its own `identify_by` (`addSubtypes` in `mapOssieToOrm.ts`) |
| Value-type subtyping                      | No. The importer flattens it to one data type, with a warning                                                                                                                               | Yes. A value type extends a built-in or a declared value type                                                                                     |
| Exclusive, total and partitioned subtypes | Yes: `exclusion`, `disjunctive_mandatory`, `exclusive_or` over subtype facts (`RoleOrSubtypeOperand` in `core/src/model/Constraint.ts`), with three validation rules                        | No field. It could only be a `requires` expression, and the spec has no example of one                                                            |
| Where the defining rule sits              | `definingRule` on each subtype fact                                                                                                                                                         | `derived_by` on the concept, once                                                                                                                 |
| Rule language                             | Opaque text, "never parsed or executed by core" (`DerivationRule` in `core/src/model/FactType.ts`); `is_formal` is reserved and unused                                                      | Dot paths, role names, `AND`/`OR`/`NOT`, `EXISTS`, comparisons, bracket aggregates, recursion. Defined only by example                            |
| Derived and semiderived                   | `kind: derived` or `semiderived`                                                                                                                                                            | Derived only. The barwise exporter reports semiderived as a loss                                                                                  |
| Stored or computed on request             | `storage: derive_on_request` or `derived_and_stored`                                                                                                                                        | No such axis. Reported as a loss                                                                                                                  |
| How several rules combine                 | Not applicable (one text)                                                                                                                                                                   | Not in the spec. #361: `derived_by` items are a disjunction, `requires` items a conjunction                                                       |
| Checks on the rule                        | A blank rule is a warning, and so is a population on a derive-on-request fact type (`validation/rules/derivationRules.ts`). A changed rule is diffed as "caution" (`diff/breakingLevel.ts`) | None in the spec                                                                                                                                  |
| Verbalization                             | "X is a subtype of Y, defined as: (text)" (`Verbalizer.ts`)                                                                                                                                 | None                                                                                                                                              |

Two findings behind rows of the table:

- **Rule placement differs.** barwise attaches a defining rule to each
  subtype fact, while Halpin and Ossie attach it to the subtype. A barwise
  subtype with two supertypes can carry two different rules, and the Ossie
  exporter reports that as a loss ("its subtype facts' defining rules
  differ; only the first is written", `writeOssie.ts`). **Inferred:** one
  rule per subtype is the better model. barwise's per-fact placement
  departs from the book, which `metamodel-evolution-policy.md` decision 4
  says to design against.
- **Subtype verbalization drops the derivation kind.** For a fact type,
  `Verbalizer.ts` says "derived", "semiderived and stored" and so on
  (`derivationPhrase`). For a subtype fact it prints only
  `defined as: (text)`, so a semiderived subtype reads as fully derived.

### The derived_by examples, item by item

Of barwise's current structures, the one that comes closest to carrying a
`derived_by` item as data is `RolePath` (`core/src/model/RolePath.ts`): a root
object type and a linear list of hops, each entering and leaving one fact
type, used today only by the join constraints. The archived spec
(`docs/specs/archive/role-path-model.spec.md`) left derivation bodies,
branching paths, negation, and comparison along a path out of scope.

| Source and item                                                                                                                                  | What it needs                                                            | RolePath today                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ontology.md`, `ancestor_of`: `Person.parent_of(descendant)`                                                                                     | One hop, projecting (Person, descendant)                                 | Yes (inferred: root Person, one step through `parent_of`, projection `[0, 1]`)                                                                                                   |
| `ontology.md`, `ancestor_of`: `Person.ancestor_of.parent_of(descendant)`                                                                         | Two hops, one through the fact type being defined                        | The path, yes. A path can traverse any fact type, including the one being defined. What is missing is somewhere to hold "the union of these paths" and a stated fixpoint meaning |
| `ontology.md`, `taxed_at`: `Person.files_single AND Person.earns <= 11925 AND TaxRate == 10.0`                                                   | Conjunction, comparison with a literal, binding a value to the last role | No                                                                                                                                                                               |
| `ontology.md`, `taxed_at`: `Person.files_married_joint AND Person.earns <= 23850 AND TaxRate == 10.0` (the list then ends in `...`, not counted) | The same shape as the item above                                         | No                                                                                                                                                                               |
| `ontology.md`, `Employee`: `EXISTS ( Person.earns )`                                                                                             | Existence of a one-hop path from the supertype                           | The path, yes. Reading "exists" as the defining condition would need a new field                                                                                                 |
| `flights`, `Airport.average_departure_delay`: `Delay == AVG[Flight.departure_delay WHERE Airport == Flight.route.departure GROUP BY Airport]`    | Aggregation, a two-hop path, correlation to the root                     | No                                                                                                                                                                               |
| `flights`, `Airport.average_arrival_delay`                                                                                                       | Same, through `route.destination`                                        | No                                                                                                                                                                               |
| `flights`, `Route.average_departure_delay` and `Route.average_arrival_delay`                                                                     | Aggregation over a one-hop correlation                                   | No                                                                                                                                                                               |

**Verified:** today the importer keeps every one of these as text, in
`derivation.expression` or `definingRule.expression`, joined one per line
(`joinDerivation` in `mapOssieToOrm.ts`). On an entity with no supertype, or
on a value type, it keeps them in the element's note with a warning. Because
nothing is interpreted, nothing is mistranslated; what the exporter cannot
write back (a semiderived or stored rule, differing rules per subtype fact)
it names as a loss (`writeOssie.ts`).

### The requires examples

`requires` is constraint territory rather than derivation, but it decides how
much of an expression language barwise-pf2.2 must also read. The importer
recognizes three shapes (`formats/src/ossie/requiresShapes.ts`): an
enumeration, numeric bounds, and a bare `Entity.rel` as a mandatory role.
Running the import on the flights example (verified) reported five
relationship-level and two ontology-level items as text. barwise already has
structure for most of them. **Inferred,** none built:

| Item                                                                                             | barwise structure that states it                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COUNT[Airport] > 0`, `COUNT[Carrier] > 0`                                                       | Object-type `cardinality` with `min: 1` (`ObjectType.ts`)                                                                                                                         |
| `Item.offers_in(Store)` on `total_sales_in` (`ontology.md`)                                      | `subset` over the (Item, Store) roles                                                                                                                                             |
| `Flight.operated_by(Aircraft.carrier)` on `Flight.aircraft`                                      | `join_subset`: (Flight, Carrier) through aircraft and carrier, within (Flight, Carrier) of `operated_by`                                                                          |
| `NOT Route.departure(Airport)` on `Route.destination`, and its mirror                            | `join_exclusion` with two one-hop operands, each projecting (Route, Airport). A plain `exclusion` takes single roles, so it would say something different                         |
| `Flight.scheduled_departure < Flight.scheduled_arrival`, `Flight.departs_at < Flight.arrives_at` | None. `value_comparison` relates two roles of one fact type, and comparison across fact types is deferred to the role-path model (`ValueComparisonConstraint` in `Constraint.ts`) |

## What this means for barwise-pf2.2

**Inferred.** barwise-pf2.2 is written as "a deterministic expression layer
(parser + evaluator) in @barwise/core covering Ossie derived_by semantics". The
evidence suggests three changes:

1. **Do not target Ossie's syntax.** It is unpublished, defined only by
   example, and not even clear on how list items combine. Parsing it would
   mean guessing, and the importer's rule is that "a near miss read as a
   constraint would be a guess" (`requiresShapes.ts`).
2. **Make the rule structured data over role paths.** Start with what the
   role-path model already almost carries: a defining rule or derivation
   that is a union of projected role paths, with optional "exists". That
   covers three of the nine `derived_by` items above, recursion included,
   and it verbalizes. Comparisons with literals come next, then
   aggregation, which is where metrics start.
3. **Drop "evaluator" from core.** The determinism filter admits rules "as
   structure"; core stores them and never executes them. Checking a sample
   population against a rule is a validation question. Running a rule
   against warehouse data is the dbt boundary's job, and it is the same
   compilation step as barwise-pf2.xil's step 2.

## Open questions for the owner

1. **Subsets and metrics are two problems in Ossie.** Subsets are an
   ontology-layer rule, with no published language. Metrics are core-layer
   SQL. Do you want one barwise language that reaches both (rules over the
   model, compiled to SQL at the dbt boundary), or two?
2. **Should a derived fact type stay out of the physical schema?** Today
   `Airport.average_departure_delay` becomes a stored column in the DDL and
   dbt exports, and the rule is dropped. For a derive-on-request rule, the
   choices are a view, a dbt model, a metric, or leaving it out. This is a
   defect candidate on its own, apart from any expression language.
3. **Should the defining rule move from the subtype fact to the subtype?**
   That would match Halpin and Ossie, and it removes a loss the Ossie
   exporter reports. It changes `.orm.yaml`, so it is a schema-version
   question (`docs/adr/schema-versioning.md`).
4. **Should subtype verbalization say "semiderived" and "stored"**, as fact
   type verbalization already does?
5. **Should barwise-pf2.2 be rescoped** along the three changes above: no
   Ossie syntax, structured role-path rules, and no evaluator in core?
6. **Should the importer read more `requires` shapes** into the constraints
   barwise already has (cardinality, subset, join subset, join exclusion)?
   Each is a small, testable widening of `requiresShapes.ts`.
7. **How do you want to track Ossie's ontology-expression language?** No
   proposal was public on 2026-10-28, and #361 points to a BNF outside the
   repository. One option is to ask on `dev@ossie.apache.org` whether it can
   be published.
8. **The fixture README says the files were "copied unchanged".**
   Two of the three files differ from the pin in whitespace, probably from
   the formatter: `packages/formats/tests/fixtures/ossie/ontology.json`
   from `01a5488d:ontology/ontology.json` on three lines, and
   `fixtures/ossie/ossie-schema.json` from
   `01a5488d:core-spec/ossie-schema.json`, where the `Dialect` enum on line
   40 is reflowed onto 14 lines. Both parse to the same JSON. Should the README say so, or should the formatter
   exclude the directory?

## Sources

Upstream, at the pinned commit
(`https://github.com/apache/ossie/blob/01a5488d840deda309aac68cc0b312c195369b8d/...`):

- `core-spec/expression_language.md` (OSSIE_SQL_2026)
- `core-spec/spec_layers.md` (the four layers)
- `core-spec/ossie-schema.json` (`Dialect`, compared with `89e2e17f`)
- `ontology/ontology.md` (Extends, Derivation expressions, Requires, Object
  mappings)
- `ontology/ontology.json` (`Expression`: "ANSI SQL expression")
- `examples/flights.ontology.yaml`

Upstream, as read on 2026-10-28:

- https://github.com/apache/ossie/issues/361 (ontology expression language)
- https://github.com/apache/ossie/pull/657 (ANTLR grammar for OSSIE_SQL_2026)
- https://github.com/apache/ossie/pull/617 (dialect made free-form; commit
  `a498fce`)
- https://github.com/apache/ossie-converters/tree/main/dbt (dbt MetricFlow
  converter README)

barwise:

- `docs/adr/ossie-interchange.md`, `docs/adr/metamodel-evolution-policy.md`,
  `docs/specs/ossie-ontology-format.spec.md`,
  `docs/specs/archive/role-path-model.spec.md`, `docs/ARCHITECTURE.md` 3.1.5
- `packages/core/src/model/SubtypeFact.ts`, `FactType.ts`, `RolePath.ts`,
  `Constraint.ts`, `ObjectType.ts`
- `packages/core/src/validation/rules/derivationRules.ts`,
  `packages/core/src/verbalization/Verbalizer.ts`,
  `packages/core/src/mapping/RelationalMapper.ts`,
  `packages/core/src/sql/SqlCascadeParser.ts`
- `packages/formats/src/ossie/mapOssieToOrm.ts`, `requiresShapes.ts`,
  `writeOssie.ts`; `packages/formats/src/sql/SqlglotBridge.ts`
- `packages/core/schemas/orm-model.schema.json` (`subtype_fact`,
  `derivation_rule_def`)
