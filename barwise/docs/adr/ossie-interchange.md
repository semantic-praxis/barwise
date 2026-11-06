# Ossie interchange

Scope: architecture
Date: 2026-10-28
Tracking: barwise-pf2.4, barwise-pf2, barwise-wcg,
docs/specs/ossie-ontology-format.spec.md,
docs/specs/iri-identity.spec.md
Enforced-by: tests (ontology-layer-only, pinned-version, nothing-lost-silently, readable-iri),
npm run depcruise (peer-standard, own-vocabulary),
npm run check:source-sites (peer-standard, own-vocabulary),
none (barwise-ym8.zkd: nothing-lost-silently)

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
alternatives behind decisions 1 to 4. On 2026-10-28 the owner revised
decision 1 and added decisions 5 and 6, after comparing the two more
closely: barwise does not try to replace Ossie, takes ideas from it where
they serve barwise, and leans on it for what Ossie owns. Their reasoning is
recorded in barwise-wcg's spec, `docs/specs/iri-identity.spec.md`.

What crosses from Ossie into barwise follows one line of reasoning,
which was part of decision 1 until 2026-11-06 (`adr-refactor.spec.md`,
row 12). An idea from Ossie enters barwise because it serves barwise,
never only because Ossie has it, as a barwise capability in barwise's
own terms that must pass the metamodel filters
(`docs/adr/metamodel-evolution-policy.md`, Context), so core still holds
nothing specific to Ossie; identity (`ossie-interchange.md#readable-iri`)
is the first, and barwise-wcg's spec runs the filters for it. barwise
leans on Ossie, rather than building its own, for what Ossie owns: its
core layer (datasets, fields, metrics), the metric expression language
`OSSIE_SQL_2026` while it is a pending standard (barwise-pf2.xil),
`ai_context`, which is not used for anything until Ossie settles it, and
its vendor converters. The spec's deferral of value-type subtyping and
an `ExportResult` warnings field until a second format needs them stands
(its Open decisions 1 and 5). Each side keeps its own vocabulary: neither
renames its terms to match the other (row 13 moved that clause here).

## Decision

1. **barwise's model stays the ORM 2 metamodel in `.orm.yaml`, and Ossie
   documents enter and leave only through the `ossie` descriptor in
   `@barwise/formats`.**{#peer-standard} Ossie is a peer standard;
   barwise neither replaces nor absorbs it (`docs/adr/connector-packages.md`).
   The reasoning that governs what crosses, restated on 2026-11-06 from
   part of this decision (`adr-refactor.spec.md`, row 12), is in
   Context.
2. **Only the ontology layer.**{#ontology-layer-only} barwise does not read or write Ossie's core
   layer or its mapping documents. Reading a logical schema up into a
   model, which is what those mapping documents describe, is
   barwise-pf2.3's question.
3. **One pinned version, and any other is refused.**{#pinned-version} The importer reads
   exactly the version string `@barwise/formats` pins (`OSSIE_VERSION`,
   `0.2.0.dev0`) and refuses any other, naming both. The schema that
   version means is Ossie commit `01a5488d`: its schema files are vendored
   in `formats/schemas/ossie/`, which the importer reads at run time and
   the tests read too, and its example is a test fixture. Moving the pin is
   a spec change, with the diff of those files in the same PR.
4. **Nothing is lost silently.**{#nothing-lost-silently} The importer names in
   `ImportResult.warnings` every construct it cannot carry; the exporter
   names every construct it cannot write in the loss comment block at the
   top of the document, and a constraint also as a `constraintSpecs`
   entry where the shared builder can describe it. Ossie expressions are
   kept as text: only three `requires` shapes are read as constraints,
   until barwise has an expression language of its own (barwise-pf2.2).
5. **Identity is a readable IRI, after Ossie's naming.**{#readable-iri} Every barwise
   element is identified by one IRI, replacing the UUIDs barwise mints
   today, and by nothing else: a declared base that is a standard IRI and
   carries the project and any subprojects, then the domain, as the
   namespace, then a readable
   local name with no category segment, after Ossie's local names
   (`Customer`, `Customer.places`). A model names the other namespaces it
   references in declared imports with aliases, the way XML namespace
   prefixes work; Ossie's `prefixes` map is the same abbreviation, which
   Ossie uses only to write `iri` values. Ossie itself identifies an
   element by its local name and treats `iri` as an optional global
   identifier that can name an outside definition (`foaf:Agent`). How
   barwise's identity IRI relates to such an outside IRI, and which of the
   two an export writes into Ossie's single `iri` slot, is decision 1 of
   barwise-wcg's spec (`docs/specs/iri-identity.spec.md`), and the local
   name of a fact type, which in barwise belongs to no concept, is its
   decision 2.
6. **Translation between ORM 2 and Ossie happens only in the `ossie`
   descriptor.**{#own-vocabulary} That is its importer,
   `mapOssieToOrm.ts`, and its exporter, `writeOssie.ts`; the
   construct-by-construct translation is the spec's Scope. Decisions 1
   and 6 share their checks (`adr-batch9-enforcers.spec.md`, WS3): no
   module outside `formats/src/ossie/` and the package's two entry files
   (`index.ts`, `registration.ts`) imports an Ossie module, the entry
   files import only `OssieExportFormat`, `OssieImportFormat` and
   `OssieTypes` from it, and no source outside `formats/src/ossie/`
   names the vendored schema. "Core names nothing Ossie-specific" is a
   report, not a gate.

## Consequences

- Decision 3 is tested: `formats/tests/OssieImportFormat.test.ts` ("refuses
  a version other than the pinned one, naming both"), run by ci.yml's
  `npm run test:coverage` step (`if: steps.changes.outputs.docs_only !=
  'true'`). Only the string is checked at run time, and `0.2.0.dev0` is a
  development version that upstream can change without renaming, so a
  document written against a later commit that keeps the string passes.
  One such change is caught at run time: a field the later commit added
  is not in the pinned schema, so it is named in the warnings (decision 4,
  below). A changed type or enum on a field the mapper reads is refused by
  `parseOssie`'s own checks (an upstream `multiplicity` value other than
  `ManyToOne` or `OneToOne` fails the import). A changed type or enum on any
  other field, a changed meaning, or a removed field, under the same string,
  passes; for those the commit pin holds only for the tests. The pin itself
  is recorded: `formats/schemas/ossie/pin.json` names the commit and each
  vendored file's git blob id, and `formats/tests/OssiePin.test.ts`
  recomputes each id from the bytes, fails on a vendored file the record
  leaves out, and requires the schema README to name the same commit (a
  README-only change is not docs-only, `scripts/lib/changed-class.mjs`).
  The unknown-field test below is tagged too: it fails if the importer
  validates against anything but the pinned schema. That the recorded ids
  are upstream's at `01a5488d` is checked by hand in an apache/ossie
  clone, not by a test.
- Decision 4 is tested on the pinned example and on unit cases.
  `OssieExportFormat.test.ts` imports `flights.ontology.yaml`, exports it,
  and compares the result construct by construct, excluding only what the
  import warned about; it also validates two exports, the example's and a
  small built model's, against the pinned `ontology.json`. That proves
  nothing is dropped silently only for constructs the example and the
  unit cases contain. A field the pinned schema does not define is named
  in the import warnings by its path: the importer validates the document
  against the vendored schema with ajv at run time
  (`formats/src/ossie/ossieSchema.ts`, tested in
  `OssieImportFormat.test.ts`, "Ossie import: fields the pinned schema does
  not define"; `docs/specs/ossie-unknown-fields.spec.md`, barwise-pf2.6d0).
  The exporter decides what is a loss by predicting what the importer will
  read back, and three review rounds on PR #762 each found a prediction
  that was wrong; it now also reads the written document back and adds a
  loss line for any difference no prediction named (`verifyOssie.ts`,
  barwise-5bv). The read-back tests in `OssieVerify.test.ts` that expect
  a line only the read-back writes, or its refusal line, are tagged, so an
  exporter that stops reading back fails them. A property test over
  generated models, which would reach constructs the example and the unit
  cases lack, is open (barwise-ym8.zkd; `adr-batch9-enforcers.spec.md`
  WS8).
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
- Decision 2 is tested both ways. The import tests pin that an embedded
  `ontology_mappings` block is dropped with a warning, and that one holding
  a core-layer `semantic_model` (a dataset, its fields, a metric) adds no
  element named after any of them: the pinned schema closes the top level,
  so that is the one place core-layer content fits in an ontology document.
  `OssieExportFormat.test.ts` holds the example's export and a built
  model's to the top-level keys `version`, `name`, `description`,
  `requires`, `ontology` and `prefixes`, with no `ontology_mappings`,
  which the schema would accept. Mapping-document support written outside
  the descriptor without importing it, and decision 1's "core holds
  nothing specific to Ossie", are review-only (owner, 2026-11-06).
  Core's two mentions of Ossie today are comments naming it as one
  consumer of shared, format-neutral helpers
  (`annotation/constraintSpec.ts`, `isUniqueAlone` in
  `model/identification.ts`).
- Decision 1's list of what barwise leans on Ossie for is review-only:
  nothing stops barwise growing its own metric language or an
  `ai_context` field. Whether barwise adopts `OSSIE_SQL_2026` for
  governed metrics is barwise-pf2.xil's question. The research for it is in
  `docs/ossie-expressions-research-2026-10-28.md`, beside barwise-pf2.m2w's
  comparison of subtype and derivation rules with `derived_by`. Decision 2's exclusion
  of mapping documents is likewise not final: whether barwise reads them
  for barwise-pf2.3 is open.
- Decision 5 is built by `docs/specs/iri-identity.spec.md` (barwise-wcg):
  format 4.0, a major `.orm.yaml` version with a migration
  (`docs/adr/schema-versioning.md`), stores ids that are local names
  minted from names, and the Ossie reader takes the namespace from an
  Ossie `iri`. Decision 1's `equivalent_iri` is deferred (barwise-wcg.vn2).
  With identity built from names, a rename changes an element's IRI:
  diff reports a content pair whose names differ as a possible rename,
  and merge never pairs one, adding it instead (iri-identity decision 8).
  Readable ids are held by tagged tests: a model built with no ids takes
  `localName(name)` ids and draws no `structural/id-not-from-name`
  warning, and that warning names an id its name does not give (core
  `idsAndImports.test.ts`); every registered importer's ids follow the
  naming rule (`cli/tests/importerIds.test.ts`). The 4.0 decoder checks
  only an id's shape, which a UUID passes, so those tests hold "readable".
- Decisions 1 and 6 are gated twice. `npm run depcruise` carries two
  rules in `.dependency-cruiser.cjs`: `ossie-only-in-descriptor` (no
  edge into `formats/src/ossie/` except from it, `index.ts` and
  `registration.ts`) and `ossie-entry-points` (from those two files,
  edges only to `OssieExportFormat.ts`, `OssieImportFormat.ts` and
  `OssieTypes.ts`; keyed on the target file, so an aliased re-export of
  `parseOssie` or `mapOssieToOrm` still fails). Depcruise cannot see the
  vendored schema, which its `includeOnly` drops, so `npm run
  check:source-sites` (rule `ossie-schema-refs`) fails any module
  reference or string naming `schemas/ossie` in `packages/*/src`
  outside `formats/src/ossie/`. Both run in CI before the build, on the
  `docs_only` guard. Review-only, by the owner's choice (2026-11-06): an
  Ossie reader or mapping-document support written from scratch that
  imports nothing of the descriptor, a re-export routed through one of the
  three entry modules, a path to the schema built from pieces, and that
  barwise keeps its ORM 2 terms. The translation is tested construct by
  construct in `OssieImportFormat.test.ts` and `OssieExportFormat.test.ts`. It is
  written twice in code, once per direction, and the exporter's copy
  predicts the importer's (barwise-5bv, above).
- These places also state a rule here: `docs/CLI.md` (the version pin and
  its refusal, and decision 4 for both import and export),
  `cli/tests/importerIds.test.ts` (the version in its fixture), and the
  spec in Tracking, which states decisions 1 to 4 with their reasoning.
