# Ossie interchange

Scope: architecture
Date: 2026-10-27
Tracking: barwise-pf2.4, barwise-pf2, docs/specs/ossie-ontology-format.spec.md

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
alternatives; this ADR records the rules that came out of it.

## Decision

1. **Ossie is an interchange format, not a metamodel barwise adopts.**
   barwise's model stays the ORM 2 metamodel stored as `.orm.yaml`. Ossie
   documents enter and leave only through the `ossie` descriptor in
   `@barwise/formats` (`docs/adr/connector-packages.md`), and core holds
   nothing specific to Ossie. A construct Ossie has and barwise lacks is a
   candidate under `docs/adr/metamodel-evolution-policy.md` and its
   filters, not an obligation, and Ossie alone does not justify a
   metamodel or core-interface change: the spec deferred value-type
   subtyping and an `ExportResult` warnings field until a second format
   needs them (its Open decisions 1 and 5).
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
  `model/identification.ts`). IRIs and prefixes have nowhere to go until
  custom attributes exist (barwise-rqb).
- These places also state a rule here: `docs/CLI.md` (the version pin and
  its refusal, and decision 4 for both import and export),
  `cli/tests/importerIds.test.ts` (the version in its fixture), and the
  spec in Tracking, which states every rule with its reasoning.
