# Ossie interchange

Scope: architecture
Date: 2026-10-28
Tracking: barwise-pf2.4, barwise-pf2, barwise-wcg,
docs/specs/ossie-ontology-format.spec.md

## Context

Apache Ossie (https://github.com/apache/ossie, formerly Open Semantic
Interchange, OSI) is a vendor-neutral standard with two layers: a **core**
layer describing a BI semantic layer (datasets, fields, metrics) and an
**ontology** layer describing a conceptual model in ORM terms. The ontology
layer overlaps barwise's metamodel closely. Entity and value types,
relationships with roles, `verbalizes` patterns, `identify_by` identifiers,
`extends` subtyping, multiplicities and built-in data types each map to the
barwise element that already means the same thing; the spec's Scope gives
the mapping construct by construct. The two also diverge. Ossie is
concept-centric, nesting each relationship under the concept that plays its
first role, where barwise keeps fact types top-level. It writes derivations
and constraints in an expression language (`derived_by`, `requires`) that
barwise does not parse, and it carries IRIs, namespace prefixes and value
types that extend value types, which barwise has no field for. barwise, for
its part, has constraints Ossie cannot express -- ring, frequency,
exclusion, exclusive-or, subset, equality, value comparison, cardinality,
disjunctive mandatory, the join kinds, a mandatory role other than a first
role, and any uniqueness other than what a multiplicity or an identifier
states (the spec's Scope) -- and multi-domain projects with context
mappings. Both Ossie specifications are at `0.2.0.dev0`, unreleased, and say
their schema will change. The spec in Tracking holds the reasoning and the
alternatives; this ADR records the rules that came out of it. Decisions 1,
5 and 6 were revised on 2026-10-28 by the owner, after comparing the two
more closely: barwise does not try to replace Ossie, takes ideas from it
where they serve barwise, and leans on it for what Ossie owns.

## Decision

1. **Ossie is a peer standard; barwise neither replaces nor absorbs it.**
   barwise's model stays the ORM 2 metamodel stored as `.orm.yaml`, and
   Ossie documents enter and leave only through the `ossie` descriptor in
   `@barwise/formats` (`docs/adr/connector-packages.md`). barwise takes
   an idea from Ossie when it serves barwise, as a barwise capability in
   barwise's own terms that passes `docs/adr/metamodel-evolution-policy.md`
   and its filters, so core still holds nothing specific to Ossie: identity
   (decision 5) is the first. barwise leans on Ossie, rather than building
   its own, for what Ossie owns: its core layer (datasets, fields, metrics),
   the metric expression language `OSSIE_SQL_2026` while it is a pending
   standard (barwise-pf2.xil), `ai_context`, which is not used for
   anything until Ossie settles it, and its vendor converters. The spec's
   deferral of value-type subtyping and an `ExportResult` warnings field
   until a second format needs them stands (its Open decisions 1 and 5).
2. **Only the ontology layer.** barwise does not read or write Ossie's core
   layer or its mapping documents. Reading a logical schema up into a
   model, which is what those mapping documents describe, is
   barwise-pf2.3's question.
3. **One pinned version, and any other is refused.** The importer reads
   exactly the version string `@barwise/formats` pins (`OSSIE_VERSION`,
   `0.2.0.dev0`) and refuses any other, naming both. The schema that
   version means is Ossie commit `01a5488d`, whose files are vendored as
   the test fixtures. Moving the pin is a spec change, with the fixture
   diff in the same PR.
4. **Nothing is lost silently.** The importer names in
   `ImportResult.warnings` every construct it cannot carry; the exporter
   names every construct it cannot write in the loss comment block at the
   top of the document, and a constraint also as a `constraintSpecs`
   entry where the shared builder can describe it. Ossie expressions are
   kept as text: only three `requires` shapes are read as constraints,
   until barwise has an expression language of its own (barwise-pf2.2).
5. **Identity follows Ossie's naming.** Every barwise element is
   identified by one readable IRI, replacing the UUIDs barwise mints today:
   a declared base that is a standard IRI, then project, any subprojects and
   domain as the namespace, then a dotted local name after Ossie's
   `Concept.relationship` (`Customer`, `Customer.places`), with
   cross-namespace references through declared imports and aliases, as
   Ossie's `prefixes` map does. Ossie's `iri` is a link to an outside
   vocabulary (`foaf:Agent`), which barwise keeps as a separate
   cross-reference, never as a second identifier. The design is
   barwise-wcg's spec.
6. **Each side keeps its own vocabulary, and the `ossie` format
   translates.** barwise speaks ORM 2 and Ossie speaks Ossie; neither
   renames its terms to match the other, and the translation lives once,
   in the descriptor. This table is that translation:

   | barwise (ORM 2)                                              | Ossie                                                           |
   | ------------------------------------------------------------ | --------------------------------------------------------------- |
   | model                                                        | ontology document                                               |
   | object type: entity type, value type                         | concept: `EntityType`, `ValueType`                              |
   | fact type                                                    | relationship, declared under the concept playing its first role |
   | role                                                         | role                                                            |
   | reading                                                      | `verbalizes` pattern                                            |
   | preferred identifier                                         | `identify_by`                                                   |
   | subtype fact                                                 | `extends`                                                       |
   | internal uniqueness, in the shapes a multiplicity states     | `multiplicity`                                                  |
   | value constraint (enumeration, bounds); mandatory first role | the three recognized `requires` shapes                          |
   | derivation rule, kind derived                                | `derived_by`                                                    |
   | definition (element); note (model)                           | `description`                                                   |
   | aliases                                                      | none per element; `synonyms` exists only inside `ai_context`    |
   | (none yet; barwise-wcg)                                      | `iri`, `prefixes`                                               |

## Consequences

- Decision 3 is tested: `formats/tests/OssieImportFormat.test.ts` ("refuses
  a version other than the pinned one, naming both"), run by ci.yml's
  `npm run test:coverage` step (`if: steps.changes.outputs.docs_only !=
  'true'`). Only the string is checked at run time, and `0.2.0.dev0` is a
  development version that upstream can change without renaming, so a
  document written against a later commit that keeps the string passes.
  The commit pin holds only for the fixtures.
- Decision 4 is tested on the pinned example and on unit cases.
  `OssieExportFormat.test.ts` imports `flights.ontology.yaml`, exports it,
  and compares the result construct by construct, excluding only what the
  import warned about; it also validates two exports, the example's and a
  small built model's, against the pinned `ontology.json`. That proves
  nothing is dropped silently only for constructs the example and the
  unit cases contain. Two gaps are known. The importer does not validate
  against the pinned schema at run time (`@barwise/formats` carries no
  JSON-schema validator), so a field the schema does not define is
  ignored without a warning (barwise-pf2.6d0). And the exporter decides
  what is a loss by predicting what the importer will read back; three
  review rounds on PR #762 each found a prediction that was wrong, and
  re-importing to verify the loss report is barwise-5bv.
- The model's name is the one exception decision 4 does not report: a
  caller-supplied name replaces the document's `name` without a warning,
  and the CLI always supplies one (`--name`, defaulting to the file name),
  as for every format. The spec's Scope decided this.
- Constraint losses reach the surfaces: the CLI prints `constraintSpecs`
  (`cli/src/workspace/constraintReport.ts`), and MCP `export_model`
  returns the written document, loss block included, and a constraint
  report (barwise-wc0). A loss that is not a constraint -- a semiderived
  rule, a dropped note, an unmapped data type -- appears only in the
  block, because `ExportResult` has no warnings field (decision 1).
- Decision 2 is partly tested: the same import test pins that an embedded
  `ontology_mappings` block is dropped with a warning. Nothing stops a
  change from adding mapping-document support elsewhere; that, and
  decision 1's "core holds nothing specific to Ossie", are review-only.
  Core's two mentions of Ossie today are comments naming it as one
  consumer of shared, format-neutral helpers
  (`annotation/constraintSpec.ts`, `isUniqueAlone` in
  `model/identification.ts`).
- Decision 1's list of what barwise leans on Ossie for is review-only:
  nothing stops barwise growing its own metric language or an
  `ai_context` field. Whether barwise adopts `OSSIE_SQL_2026` for
  governed metrics is barwise-pf2.xil's question, and whether it reads
  Ossie's mapping documents for barwise-pf2.3 is still open.
- Decision 5 is not built. barwise mints UUIDs (`generateId()` in
  `core/src/model/id.ts`) until barwise-wcg ships, so today an Ossie
  `iri` or `prefixes` map is named in the import warnings and dropped.
  The change is a major `.orm.yaml` version with a migration
  (`docs/adr/schema-versioning.md`).
- Decision 6's table is the decision, and the code follows it: the
  construct-by-construct tests in `OssieImportFormat.test.ts` and
  `OssieExportFormat.test.ts` exercise each pairing. No check ties a row
  of the table to those tests; one would only test how the terms are
  spelled, which the tests already fix. Renaming a barwise term to an
  Ossie one is what the decision rules out, and review is what holds it.
- These places also state a rule here: `docs/CLI.md` (the version pin and
  its refusal, and decision 4 for both import and export),
  `cli/tests/importerIds.test.ts` (the version in its fixture), and the
  spec in Tracking, which states every rule with its reasoning.
