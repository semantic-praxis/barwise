# Batch 9: schema, Ossie, eval-coverage and package-graph decisions enforced

Status: Planned; plan reviewed 2026-11-06 (one code-review round, ten findings, all addressed in the revision); WS1 (`recompute-derived`) implemented; WS2-WS8 not started

Created: 2026-11-06
Last-updated: 2026-11-06
Plan-reviewed: f74f0125 (code-review, pr-review)
Tracking: barwise-ym8.gc9 (adr-refactor batch 9), barwise-ym8.3ai,
barwise-ym8.4i2, barwise-ym8.31z, barwise-ym8.8l3, barwise-ym8.yfi,
barwise-ym8.zec, barwise-ym8.yc6, barwise-ym8.k74, barwise-ym8.oor,
barwise-ym8.zkd, barwise-ym8.m1l, barwise-ym8.d3m, barwise-ym8.xyn,
barwise-ym8.5yl, barwise-ym8.vq8, barwise-ym8.k6g, barwise-vvg,
barwise-6om
Touches: barwise/docs/adr/metamodel-evolution-policy.md,
barwise/docs/adr/schema-versioning.md, barwise/docs/adr/ossie-interchange.md,
barwise/docs/adr/package-graph-authority.md,
barwise/docs/adr/constraint-coverage-policy.md, barwise/docs/adr/probes.json,
barwise/docs/adr/tested-in.json, barwise/docs/ARCHITECTURE.md,
+barwise/packages/core/schemas/orm-model.property-classes.json,
barwise/packages/core/tests/serialization/,
barwise/packages/core/tests/validation/idsAndImports.test.ts,
.claude/skills/pr-review/checklist.md,
barwise/packages/cli/tests/commands/merge.test.ts,
barwise/packages/cli/tests/importerIds.test.ts,
+barwise/packages/cli/tests/loadForward.test.ts,
+barwise/packages/mcp/tests/loadForward.test.ts,
+barwise/packages/formats/schemas/ossie/pin.json,
barwise/packages/formats/tests/, barwise/packages/formats/package.json,
barwise/.dependency-cruiser.cjs, barwise/scripts/check-architecture.mjs,
barwise/packages/core/CLAUDE.md, barwise/packages/learn/CLAUDE.md,
barwise/packages/promptlab/CLAUDE.md,
barwise/packages/learn/src/evaluate/checks/forbidsPopulation.ts,
barwise/packages/learn/src/index.ts,
barwise/docs/specs/constraint-extraction-coverage.spec.md,
barwise/scripts/lib/changed-class.mjs,
+barwise/scripts/check-schema-bump.mjs,
+barwise/scripts/check-source-sites.mjs,
+barwise/scripts/check-eval-coverage.mjs, barwise/scripts/tests/,
barwise/package.json, package.json, .github/workflows/ci.yml

## Principle

Batch 9 holds sixteen decisions across five ADRs, each carrying a gap
issue. Eight are already partly held by tagged tests or a gate. The
other eight have no declared enforcer: `recompute-derived`,
`shared-minor`, `peer-standard`, `own-vocabulary`, `readable-iri`
(which, as it turns out, code already holds without a tag) and all three
`constraint-coverage-policy` decisions. Every decision here is an
invariant over files the repository tracks: a schema, a migration
registry, a vendored copy, an import edge, a manifest, an eval rubric.
Each one can be checked, and this spec adds the check that fails when
the decision is broken ("explicit over implicit": a decision only review
holds reads as a rule and gets followed as advice).

The plan's enforcer suggestions were checked against the code before
being adopted. Five needed correcting, and the corrected forms are
below: row 12's depcruise rule fails on main as worded and cannot see
the vendored schema; `readable-iri`'s "to design" rule already exists;
`tiered-types` named transcripts, which no check can read; the coverage
drift check would not run on the one change it guards; and
`shared-minor`'s gate cannot fail on any real change until a release is
tagged.

Plan review added a sixth constraint on where checks live. A vitest test
is cached by turbo against its own package's inputs. A test in one
package that scans other packages' source, or files under `docs/`,
replays a cached pass when only those files change. Every scanner that
crosses package boundaries is therefore an uncached script gate under
`barwise/scripts/` (`check:source-sites`, `check:eval-coverage`,
`check:architecture`, `check:schema-bump`). Tagged vitest tests are
used only where every input is inside the host package or reaches it
through its turbo dependency graph.

## The reading this spec starts from (main at 312894fd)

- `npm run check:architecture` exits 0 (80 decisions, 26 with a gate).
- **Turbo caching.** `turbo.json` keys `test` and `test:coverage` on
  each package's `src/**`, `tests/**`, `schemas/**`, `vitest.config.ts`,
  `package.json` and four `$TURBO_ROOT$` paths, none under `docs/`
  except `docs/getting-started/**`. No package has its own
  `turbo.json`. CI restores `barwise/.turbo` across runs (`ci.yml:80`).
  So a vitest test hosted in promptlab that reads
  `docs/specs/constraint-extraction-coverage.spec.md` replays a cached
  pass when only that file changes. So does a core test scanning
  `vscode/src`, because vscode is not in core's dependency graph.
  Measured in passing: promptlab's `evals/**` is not a test input either,
  although five promptlab test files read it (`referenceDrift`,
  `loadSuite`, `collapseSplit`, `errorsByRule`, `history`).
- **Coverage.** The suite (`promptlab/evals/suite.yaml`, 2.13.0) has ten
  cases, seven in `train` and three in `dev`, and no `domain` field: a
  case is its own domain. A rubric check names `constraint: ring`, never
  a ring type. Which type it tests is the first ring constraint on the
  reference fact type (`learn/src/evaluate/checks/forbidsPopulation.ts:208`,
  `GUARDS[kind]`). Measured: two ring checks, `acyclic` in
  project-staffing (train) and `irreflexive` in incident-response (dev).
  The references carry ring types `acyclic` x2, `irreflexive` x1 and one
  `subset`, plus no rare-tier type. `ConstraintKind` has no set-comparison
  kind, so `subset` and `exclusion` cannot be rubric-tested yet.
- **Tiers.** Core's `RingType` has eight members
  (`core/src/model/Constraint.ts:200`). The ADR's decision 2 tiers seven
  of them and leaves out `asymmetric` (owner, 2026-11-06: common).
- **The inventory** (`constraint-extraction-coverage.spec.md`, lines
  38-43) is prose. It lumps six ring types into one row and gives counts
  as free text ("one (project-staffing)", "yes (2.5.0)"). Its claims
  match the suite today. A PR that changes only a `.md` file outside
  `docs/adr/` is docs-only (`scripts/lib/changed-class.mjs:25,33`), and
  CI then skips `build`, `test:coverage` and every step guarded on
  `docs_only`. That covers this file and
  `formats/schemas/ossie/README.md`.
- **Ossie boundary.** Measured with depcruise over `packages/`: the only
  edges into `formats/src/ossie/` from outside it are `formats/src/index.ts`
  (to `OssieExportFormat.ts`, `OssieImportFormat.ts`, `OssieTypes.ts`)
  and `formats/src/registration.ts` (to the first two). `OssieTypes.ts`
  imports nothing. MCP reads `OSSIE_VERSION` through `@barwise/formats`
  (`mcp/src/tools/importModel.ts:9`). Two trial rules with a scratch
  config exit 0 on main: no edge into `ossie/` except from `ossie/`,
  `index.ts` and `registration.ts`; and from those two files, edges
  only to the three entry modules. Depcruise **does not see** the
  vendored-schema imports: `ossieSchema.ts:20-21` imports
  `../../schemas/ossie/*.json`, and depcruise lists only `OssieTypes.ts`
  and `requiresShapes.ts` as that module's dependencies, because
  `includeOnly: "^packages/[^/]+/src/"` drops `formats/schemas/`.
- **Ossie pin.** The vendored files' git blob ids are `9d021c2c`
  (`ontology.json`) and `350b0910` (`ossie-schema.json`). The README
  names commit `01a5488d840d...`. Nothing ties the bytes to that commit.
- **Ossie layers.** `ontology.json` closes its top level
  (`additionalProperties: false`) over `version`, `name`, `description`,
  `ai_context`, `requires`, `ontology`, `ontology_mappings` and
  `prefixes`. So Ossie core-layer content (`datasets`, `metrics`) can sit
  in an ontology document only inside `ontology_mappings[].semantic_model`.
  The tagged import test's fixture has `ontology_mappings: []`
  (`OssieImportFormat.test.ts:906`), which carries none. The export
  tests validate against `ontology.json`, which allows
  `ontology_mappings`, so writing one would pass them.
- **Ossie read-back.** `OssieExportFormat.readBack` calls `verifyOssie`
  (`OssieExportFormat.ts:64`). `OssieVerify.test.ts:86` ("names a deontic
  mandatory that comes back alethic") calls `exporter.export` and
  expects the line `Fact type: Person.name: comes back changed:
  constraints added: mandatory; constraints removed: mandatory
  (deontic)`, a line only `verifyOssie` writes. The test is untagged.
- **Readable IRI.** This is already enforced in three places, none of
  them tagged: the 4.0 decoder checks id shape (`core/src/decode/ids.ts`,
  `LOCAL_NAME_PATTERN`); the warning rule `structural/id-not-from-name`
  (`core/src/validation/rules/structural.ts:343`) fires on any object
  type, fact type, role or population whose id is not the one its name
  gives; and `cli/tests/importerIds.test.ts` requires every registered
  importer's ids to follow the naming rule, failing on any UUID. A UUID
  passes the shape check (`[A-Za-z0-9-]` are local-name characters), so
  the rule and the importer test are what hold "readable".
- **Package graph.** No script outside `scripts/lib/intended.cjs` has a
  literal of the form `"pkg": ["pkg", ...]` (searched across tracked
  `barwise/scripts`, `.husky`, `.github`, `.claude/hooks`; the only other
  hit is a fixture string in `gates.test.mjs:7536`). Nine package
  CLAUDE.md files have a `## Dependencies` table, and in each the
  `@barwise/*` and `barwise-vscode` Upstream rows equal `INTENDED`.
  `diagram-ui`'s table also lists `react` and `react-dom` as Upstream,
  which are external. `core`, `learn` and `promptlab` have no table, and
  their dependency names exist only as prose in `## Dependency Rule`.
  Core's `src` imports exactly `effect`, `yaml` and `ajv` (measured
  across 177 files with `ts.preProcessFile`). `fast-check` is already in
  core's `devDependencies`, so planting an `import "fast-check"` in
  `core/src` needs no manifest edit.
- **Versioning.** `CURRENT_ORM_VERSION` is `"4.0"`, and the schema
  `const` is `"4.0"`. `ORM_VERSION_MIGRATIONS` has 1.0->1.1 and
  1.1->2.0. The 2.0->3.0 step goes through the model, and 3.0 is read
  by its own reader. `planMigration` takes the first registered step
  whose `from` matches (`migrations.find`), so a second step from the
  same version is ignored without a word. A document with no
  `orm_version` is refused with "orm_version is missing" (run against
  core's dist), but no test pins that.
- **`orm_version` write sites.** A full TypeScript parse of
  `packages/*/src` finds 11 sites that set `orm_version` (object key,
  assignment, or YAML text), in 9 (file, function, form) groups:
  - decoder schemas: `decode/document.ts` (module) and
    `decode/document40.ts` (module);
  - in-memory configs and documents: `decode/document40.ts`
    `document40Configs`, and `formats/src/ossie/verifyOssie.ts:169`
    `document30`, which **assigns** `doc.orm_version = "3.0"` on an
    in-memory 3.0 document built for the read-back diff and never
    written to disk;
  - migration restamps: `serialization/schemaVersion.ts` `migrate`, and
    `serialization/migrations/diagramReferencesToIds.ts` (x3);
  - the serializer: `OrmYamlSerializer.ts` `documentOf`;
  - file writers outside the serializer: `core/src/project/splitModel.ts`
    `splitModel` (copies `writeDocument40`'s 4.0) and
    `vscode/src/commands/projectScaffold.ts` (YAML text interpolating
    `CURRENT_ORM_VERSION`).

  The first draft's "two places, plus a type in `verifyOssie.ts`" was
  wrong: a key-and-template scan misses the assignment form.
  `mcp/src/workspace/resolve.ts:198` mentions `orm_version` only in a
  regex that reads.
- `merge.test.ts:44` checks that both 1.0 inputs stay unchanged, but not
  that the merge ran.
- **Releases.** `git ls-remote --tags origin` lists `v0.3.0`..`v1.7.0`
  and `edge`, with no `v2.0.0`, though the packages say 2.0.0 and
  schema-versioning's Consequences say "v2.0.0 is the first release
  since, writing 4.0". The last `v*` tag is v1.7.0, which wrote 1.1.
- **Schema shape.** `orm-model.schema.json` has 40 `properties` maps at
  any depth, holding 194 property slots under 81 distinct names. 37 maps
  are closed (`additionalProperties: false`). The other 3 are
  `object_type`'s `if`/`then`/`else`, whose slots sit under the closed
  `object_type` map. `/properties/model` is closed with 13 properties.
  `writer40.test.ts` validates the 4.0 writer's output against the
  schema, and `document40SchemaDrift.test.ts` holds the Effect decoders
  to it.

## Decision by decision

Each entry gives what holds the decision today, the proposed enforcer,
whether the decision's wording changes, the planted violation that
proves the enforcer works, and what happens to the gap issue. "Tests"
means vitest or node tests carrying `[adr:<adr>#<id>]`, held in CI by
`check:adr-tests`. Each one's plant goes in the PR body. A gate entry
gets a `probes.json` row (`spec-writer/adr-writing.md`).

### metamodel-evolution-policy

**`recompute-derived`** (row 10, owner-restated). Today: nothing holds
it. The schema is closed, so a derived property has to be added to the
schema on purpose, and nothing reviews that addition. Enforcer: a table
beside the schema, `orm-model.property-classes.json`, that classifies
every property slot as `conceptual`, `identity` (`id`, `minted_from`,
`imports`, `namespace`, `orm_version`) or `presentation` (diagram
layout; owner, 2026-11-06, as recommended). Slots are keyed by full
JSON pointer. A tagged core test walks every subschema at any depth:
root, `/properties/model`, `definitions` (whose keys are names),
`oneOf`/`anyOf`/`allOf` branches, `items` and `additionalProperties`
schemas, skipping the data keywords (`default`, `const`, `enum`,
`examples`). A slot is a name in a `properties` map whose subschema is
not `false`. `if`/`then`/`else` (and `not`) define no slots: they
restate properties the closed schema around them defines, so their five
rows are not in the table (189 rows). The test fails on any slot the
table lacks and on any table row with no slot. Keying by slot rather
than by name means that reusing a name like `expression` in a new place
still has to be classified. `identity` is allowed only for the five
names above (one way: an `id` slot may be another class), and
`presentation` only under `/properties/model/properties/diagrams` and
`/definitions/diagram_layout`.

The same test holds the schema closed, since an allowlist of slots means
nothing if an open object accepts a key no row names: every object
schema has `additionalProperties: false`, none uses `patternProperties`,
and `additionalProperties` is a schema only at the four data-keyed maps
(`imports`, `role_values`, `positions`, `orientations`), listed by
pointer with their reasons. With the schema closed, `writer40.test.ts`
validating the writer's output is what holds the serializer side.

The first revision also asserted the walk found 40 maps and 194 slots,
so a walker that stopped early could not pass. Code review dropped it
(2026-11-06): the orphaned-row check already fails such a walker,
because the rows for every slot it missed name no slot, and the counts
made every schema edit a three-place change for no added catch. The
walker's reach is pinned instead by a synthetic schema with a slot under
every keyword it must enter and one under every keyword it must not.

What the test cannot hold is a derived slot added with a `conceptual`
row. That half is review's: `pr-review/checklist.md` names the table,
and the ADR keeps `none (barwise-ym8.3ai)` beside `tests`. Every
input is under core's `schemas/` and `tests/`, both turbo inputs, so a
vitest test is enough here. Wording: unchanged. Plants: add `tables` at
`/properties/model/properties/tables` -> fails naming that pointer. Add
it under `/definitions/fact_type/properties` -> fails. Flip
`fact_type`'s `additionalProperties` to `true`, or give it
`patternProperties` -> the closedness test fails. Label a
`rendered_svg` slot `presentation` outside the layout -> fails. Gap:
3ai narrows to review of the classification and stays open.

### schema-versioning

**`version-signal`** (4i2). Today: tagged tests cover current, newer
and stamped files. Unguarded: a file with no version, and writers that
bypass the serializer. Enforcer:

1. A tagged core test that deserializing `model:\n  name: T\n` throws a
   message naming `orm_version`.
2. A rule `orm-version-writers` in a new uncached gate,
   `check:source-sites` (`scripts/check-source-sites.mjs`, which runs
   with `depcruise` and before `build`, guarded on `docs_only` like it).
   It parses every tracked `packages/*/src` file with TypeScript and
   lists each site that sets `orm_version`: a property key (identifier,
   string literal, or shorthand), an assignment to `.orm_version` or
   `["orm_version"]`, or string or template text matching
   `orm_version\s*:`. Each site's key is (file, enclosing function,
   form), with a count. The allowlist names the nine groups above,
   each with its reason and expected count. A site not on the list, or
   an extra site in a listed group, is a finding. Rows with a lower
   count than expected are findings too, so the list cannot go stale.
   The two file writers outside the serializer get tagged tests that
   their output states `CURRENT_ORM_VERSION`: `projectScaffold` in
   vscode, and `splitModel` in core. A cached core test could not hold
   this rule, because vscode's source is outside core's turbo hash.

Residue, review-only and stated in Consequences: a computed key
(`["orm_" + "version"]`), a name built by concatenation, an
`Object.assign` or `defineProperty` from a variable key, a document
copied by spread from a source other than the serializer, and YAML
assembled from string fragments that do not hold `orm_version:` whole.

Plants: make the serializer stop throwing on a missing version -> (1)
fails. Add `const doc = { orm_version: "3.0", model: {} };` to
`cli/src/commands/verbalize.ts` -> the gate exits 1 (not on the list).
Add a second `doc.orm_version = "3.0"` to `document30` -> exit 1 (count
2, expected 1). Enforced-by gains `npm run check:source-sites
(version-signal)` and keeps `tests (version-signal)`. Wording:
unchanged. Gap: 4i2 closes, with the residue moved to Consequences.

**`minor-and-major`** (31z; owner, 2026-11-06: restate). Today: a tagged
test checks that the current major's chain reaches
`CURRENT_ORM_VERSION`. Restated decision: "A minor step goes to the next
minor, a major step to the next major's first; the schema const equals
`CURRENT_ORM_VERSION`." The decision's existing sentence that the loader
reads every version "by applying those steps" stays. The
additive-versus-structural classification moves to Context. Enforcer,
tagged core tests:

- **Shape.** Every step is a minor step (same major, `to` minor =
  `from` minor + 1) or a major step (`to` = the next major's `.0`).
- **Chain.** The steps form one path. Each version is the `from` of at
  most one step. A major step leaves its major's last minor, so no step
  or `CURRENT_ORM_VERSION` names a later minor of the major it leaves.
  The shape rule alone accepts `{1.0->2.0}` beside `{1.0->1.1}`, and
  `planMigration`'s `find` would read the first and ignore the second.
- **Parity.** The schema `const` equals `CURRENT_ORM_VERSION`, checked
  directly rather than through a load.

The functions take the registry as a parameter, as `planRead` does, and
the tagged tests call them on the real `ORM_VERSION_MIGRATIONS`.
Plants, all on the real registry: change 1.0->1.1's `to` to `"1.2"` ->
shape fails. Add `{from: "1.0", to: "2.0"}` after 1.0->1.1 -> chain
fails twice (two steps from 1.0, and a major step leaving 1.0 while 1.1
exists). Set the schema const to `"4.1"` -> parity fails. Gap: 31z
closes.

**`shared-minor`** (8l3, barwise-vvg; owner, 2026-11-06: "released"
means a `v*` tag). Enforcer: a new gate, `check:schema-bump`. It finds
the latest `v*` tag reachable from HEAD, reads that tag's
`orm-model.schema.json` and `CURRENT_ORM_VERSION`, and exits 1 when the
schema differs (ignoring `description`, `title` and `$comment`) while
the version is equal. It exits 2 when no `v*` tag is reachable (a
shallow clone) or the tag's files cannot be read. It gets a `ci.yml`
step with no `if:`, a root forwarder, and node tests in a `tempRepo()`.
It does not judge additive versus structural. It cannot fail on main
today: the last tag wrote 1.1 and main writes 4.0, so it starts to bite
at the next `v*` tag. Plant (for `probes.json`, valid today): set
`CURRENT_ORM_VERSION = "1.1"` in `schemaVersion.ts` -> exit 1. After a
tag writing 4.0 exists, the row changes to planting a schema property.
Wording: decision 3 gains "a released version is one a `v*` tag names;
`edge` is not one". Consequences' "v2.0.0 is the first release since,
writing 4.0" is corrected to the tags that exist. Gap: 8l3, vvg and 6om
close.

**`load-forward`** (yfi). Today: tagged tests cover the 1.0 forward load
and `migrate`. The merge "inputs untouched" test passes even if the
merge refused. Enforcer: (1) `merge.test.ts:44` also asserts exit 0 and
`orm_version: "4.0"` on stdout, then gets tagged. (2) A CLI test and an
MCP test, each driven by its surface's own list (the commander tree;
the pinned MCP tool list). Each command or tool that takes a model path
runs on a copied 3.0 fixture and must exit 0, produce output, and leave
the file's bytes unchanged. The editing set (`migrate`, `rename`, MCP
`merge_models`, `rename_element`, `split_model`) is the declared
exception. A command with neither a fixture row nor an exemption fails,
so new commands are covered as they are declared. Each test reads only
its own package's commands, which run code from its turbo dependency
graph, so a cached pass is invalidated by any change it could see. The
success assertion matters: without it, a command that refused the file
would pass the byte check. `tested-in.json` gets a row naming both
files. Plants: make `barwise verbalize` write the model back after
reading -> the CLI test fails. Drop the success assertion -> the
self-check (a refusing stub command) fails. VS Code is provisional. Its
language-model tools reach the same core paths as MCP, but the language
server's open/save path has no headless harness here (unverified: `npx
vitest run` in `packages/vscode` shows which unit seams exist).
Wording: unchanged. Gap: yfi narrows to VS Code.

### ossie-interchange

**`peer-standard`** and **`own-vocabulary`** (rows 12 and 13,
owner-restated; zec, yc6). Today: nothing. As worded, the ADR's
decision 6 check ("only `formats/src/ossie/` imports Ossie's types")
fails on main, because `index.ts` imports `OssieTypes.ts`, and it
cannot see the vendored schema. The enforcer has two pieces:

1. Two depcruise rules. `ossie-only-in-descriptor`: from any module
   except `formats/src/ossie/`, `formats/src/index.ts` and
   `formats/src/registration.ts`, no edge into `formats/src/ossie/`.
   `ossie-entry-points`: from `index.ts` or `registration.ts`, edges
   into `ossie/` only to `OssieExportFormat.ts`, `OssieImportFormat.ts`
   and `OssieTypes.ts`. The second rule closes the barrel: a re-export
   of `parseOssie` or `mapOssieToOrm` from `index.ts` is an edge to
   another file, whatever alias it exports under. A name-based export
   pin would miss an alias. Measured: both exit 0 on main.
2. A rule `ossie-schema-refs` in `check:source-sites`: any module
   reference (`ts.preProcessFile`: imports, `export from`, `require`,
   dynamic import) or string literal containing `schemas/ossie` in
   `packages/*/src` outside `formats/src/ossie/` is a finding.
   Depcruise cannot see these under `includeOnly`, as with model SDK
   imports in `purity-and-model-boundary.spec.md`. A formats vitest
   test would be cached against formats alone, so it would miss a plant
   in another package.

Plants: `import "../ossie/mapOssieToOrm.js";` in
`formats/src/avro/AvroExportFormat.ts` (no cycle: ossie imports only
`naming.ts` outside itself) -> depcruise exits 1. `export { parseOssie
as parse } from "./ossie/parseOssie.js"` in `index.ts` -> depcruise
exits 1. A JSON import of `../../schemas/ossie/ontology.json` in
`formats/src/sql/` -> `check:source-sites` exits 1. Enforced-by gains
`npm run depcruise (peer-standard, own-vocabulary)` and `npm run
check:source-sites (peer-standard, own-vocabulary)`, each with a probe.
The rule's wording is unchanged. The sentence in decision 6 describing
the check is corrected to these rules. Residue, review-only (owner,
2026-11-06): an Ossie reader written from scratch that imports nothing
of the descriptor, mapping-document support built the same way, and a
re-export routed through one of the three entry modules. zec and yc6
close.

**`ontology-layer-only`** (k74). Enforcer: (1) a tagged import test
whose fixture has an `ontology_mappings` entry carrying a
`semantic_model` with a dataset, fields and a metric. It asserts the
drop warning and that no element named after any of them is in the
model. (2) A tagged export test over the example's export and the built
model's export: the top-level keys are a subset of `version`, `name`,
`description`, `requires`, `ontology`, `prefixes`, and there is no
`ontology_mappings`. Core-layer keys at the top level are already
refused by the closed schema. Both read only formats files. Plants: in
`mapOssieToOrm.ts`, add one entity per `semantic_model.datasets[].name`
-> (1) fails. In `writeOssie.ts`, add `ontology_mappings: []` to the
document -> (2) fails. Wording: unchanged. Gap: k74 closes, with the
residue shared with zec review-only.

**`pinned-version`** (oor). Enforcer: `schemas/ossie/pin.json` records
`{ commit, files: { name: gitBlobId } }`. A tagged formats test computes
each vendored file's git blob id (`sha1("blob <len>\0" + bytes)`),
compares it with the record, and checks that the README names the same
commit. The existing unknown-field test ("fields the pinned schema does
not define") is tagged too: it fails if `ossieSchema.ts` validates
against anything else. Every input is under `formats/schemas/**`, a
turbo input. The README is docs-only, so `changed-class.mjs` adds it to
`GATE_INPUT`, and a README-only PR runs `test:coverage`. Plants: edit
one enum in `ontology.json` -> the hash test fails. Change the README's
commit -> it fails. Point `ossieSchema.ts` at `{}` -> the tagged
unknown-field test fails. Wording: unchanged. Gap: oor closes. An
upstream change under the same version string is a limit of
measurement, stated in Consequences. Unverified: that
`9d021c2c`/`350b0910` are upstream's blob ids at `01a5488d`. A reviewer
runs `git ls-tree 01a5488d ontology/ontology.json
core-spec/ossie-schema.json` in an apache/ossie clone.

**`nothing-lost-silently`** (zkd). Today: three tagged tests cover the
example and unit cases. Enforcer, in two steps:

1. Tag the read-back tests in `OssieVerify.test.ts` and
   `OssieLossScope.test.ts`. "names a deontic mandatory that comes back
   alethic" goes through `exporter.export` and expects a line only
   `verifyOssie` writes (see the reading above). Plant: make
   `readBack` in `OssieExportFormat.ts` return `{ losses: [],
   constraintSpecs: [] }` instead of calling `verifyOssie`. The test's
   `verified(...)` then returns `[]` against an expected one-line array,
   so it fails. This needs no generated input.
2. Provisional (WS8): a property test running `OssieExportFormat.export`
   over core's model arbitrary. For every element whose serialized form
   differs between the source and the re-imported, id-aligned model, a
   loss line must name it. The oracle compares serialized YAML, not
   `diffModels`, so a blind spot in `diffModels` does not hide itself.
   The same plant fails it only if the arbitrary produces a shape that
   only the read-back names. The arbitrary has `deontic: fc.boolean()`
   on constraints and `mandatory` among `CONSTRAINT_TYPES`
   (`core/tests/arbitraries/model.ts:319,324`), so a deontic mandatory
   is the candidate. The test therefore carries a coverage self-check:
   across its runs, at least one generated model has a deontic
   mandatory on a fact type's first role, or the test fails. That keeps
   the property from passing a corpus that cannot distinguish.
   Unverified: that `RUNS = 250` at `SEED` produces one. If it does not,
   the self-check fails first and the arbitrary is widened.

Wording: unchanged. Gap: zkd narrows with (1) and closes with (2). The
missing `ExportResult.warnings` and the caller-supplied name are
decisions the ADR records, not gaps.

**`readable-iri`** (m1l). The rule the plan said was "to design" is
already built. Enforcer: tag `idsAndImports.test.ts` "reports an object
type, a fact type and a role whose ids differ" and `importerIds.test.ts`'s
per-importer tests, and add one tagged core test: a model built with no
ids gets `localName(name)` ids and no `id-not-from-name` diagnostic.
`importerIds` runs in cli, whose turbo hash covers core and every
importer package through its build dependencies. Plants: `nameIdBase`
returns `localName(name).toLowerCase()` -> the new test and
`importerIds` fail. Remove `checkIdsFromNames` from the structural rules
-> the tagged `idsAndImports` test fails. Wording: unchanged. Gap: m1l
closes. `equivalent_iri` stays deferred (barwise-wcg.vn2).

### package-graph-authority

**`intended-is-graph`** (d3m). Today: depcruise holds the import half.
Enforcer: extend `check:architecture` (uncached, no `if:`) in two ways.
(1) In tracked `barwise/scripts/**` (which it already reads for
citations), excluding `scripts/tests/` and `intended.cjs`, flag any
property whose key is a package directory name and whose value is an
array literal of package names, found by TypeScript's parser. That is
the shape of one adjacency entry. (2) Compare each package CLAUDE.md's
`## Dependencies` Upstream rows that name an internal package
(`@barwise/*` or `barwise-vscode`, resolved through the manifests as
the check already does) with `INTENDED`, both ways. External rows like
`react` are ignored. Require the table in all twelve, so `core`,
`learn` and `promptlab` gain one (core's says "none"). `## Dependency
Rule` prose stops listing internal packages (owner, 2026-11-06, as
recommended). Plants: add `const COPY = { "promptlab": ["core"] };` to
`arch-triage.mjs` -> exit 1. Add an Upstream `@barwise/llm` row to
`diagram/CLAUDE.md` -> exit 1. Both go in `probes.json`. The shadow: a
copy written another way (`"cli->core"` strings, a `Map`) passes (1).
Every copy found so far had the adjacency shape. Wording: unchanged.
Gap: d3m closes.

**`core-external-deps`** (xyn; option (a), owner, 2026-11-06, as
recommended). Enforcer: `check:architecture` reads the bare module
specifiers in `core/src` with `ts.preProcessFile`, skipping relative
paths and `node:` (purity owns those), and fails on any package
missing from core's runtime fields. Measured clean on main. Type-only
imports count, because core's `.d.ts` re-exposes them. Plant: `import
"fast-check";` at the top of `core/src/index.ts` -> exit 1, as a second
`probes.json` row. Unverified: that this plant passes knip today, as
the gap issue states (run it through `node scripts/mutate.mjs` against
`npm run knip`). Wording: unchanged. Gap: xyn closes.

### constraint-coverage-policy

All three are held by one new uncached gate, `check:eval-coverage`
(`scripts/check-eval-coverage.mjs`), not by a promptlab vitest test.
Its inputs are three: the suite under `promptlab/evals/`, this ADR, and
`docs/specs/constraint-extraction-coverage.spec.md`. None of them is in
promptlab's turbo test inputs (see the reading), so a promptlab test
would replay a cached pass on an inventory-only or evals-only PR. The
alternative was a package-level `promptlab/turbo.json` adding
`evals/**` and two `$TURBO_ROOT$/docs/...` paths. That works but keeps
correctness tied to an input list that must track the check's reads,
and the evals hole it would also close is a wider fix than this batch.
The gate always reads what it reads.

It runs in CI after `npm run build` with the `docs_only` guard, because
it imports `@barwise/core` (to read references) and `@barwise/learn`
(for `referenceConstraint`). It refuses with exit 2 when either dist is
missing, as `check:adr-model` does. `changed-class.mjs` adds the
inventory spec to `GATE_INPUT`, so an inventory-only PR is not docs-only
and both `build` and the gate run. The ADR is already a gate input. The
transcripts (`*.transcript.md`) stay docs-only, which is correct: the
gate reads `*.eval.yaml` and `*.reference.orm.yaml`, neither of them
`.md`.

It resolves each `forbids_population` ring check to its ring type
through `referenceConstraint`, a function newly exported from `learn`
that holds the selection `forbidsPopulation.ts:208` already does. It
does not copy the selection, because a copy would be a must-agree copy.
The inventory becomes one row per type: eight ring types plus `subset`,
`equality` and `exclusion`. Columns: tier, reference cases,
rubric-tested train cases, rubric-tested dev cases, covered. A
free-text "settled in a transcript" column stays prose, and the gate
ignores it. Tiers are parsed from the ADR's decision 2 backticks. A
parse that finds no tier, or a `RingType` member with no tier, is a
refusal (exit 2). WS5 adds `asymmetric` to the common tier in the
ADR's text (owner, 2026-11-06). Enforced-by: `npm run
check:eval-coverage (two-instances, tiered-types, inventory-outside)`,
with a probe per decision. The node tests under `scripts/tests/` use a
fixture suite.

**`two-instances`** (5yl; case-as-domain, owner, 2026-11-06, as
recommended). The rule checked: `covered: yes` exactly when the type has
at least one rubric-tested instance in a train case and one in a dev
case, in different cases. Phrasing stays review. Plant: mark `acyclic`
covered in the inventory -> exit 1 ("covered with 1 train, 0 dev").
Wording: unchanged. Gap: 5yl closes.

**`tiered-types`** (vq8; owner, 2026-11-06: not restated). The decision's
object, a transcript, cannot be read by a check, and a rubric names only
`ring`. The part the gate holds: no reference in the suite carries a
rare-tier constraint, so no rubric can resolve to one. Plant: change
project-staffing's reference `ring_type: acyclic` to `transitive` ->
exit 1. Enforced-by keeps `none (barwise-ym8.vq8: tiered-types)` beside
the gate entry, and vq8 narrows to transcript prose that settles a
rare-tier rule its reference leaves out.

**`inventory-outside`** (k6g). The rule checked: the inventory's derived
columns equal the suite. Plant: change project-staffing's reference
ring to `irreflexive` -> exit 1 (irreflexive becomes 1 train + 1 dev
and covered, acyclic drops to 0). A second plant edits only the
inventory's acyclic train count, which is the docs-only case that
`GATE_INPUT` now routes through CI. Wording: unchanged. Gap: k6g
closes.

## Alternatives considered

- **Row 12 as one depcruise rule, as the ADR describes it.** It fails
  on main, because the barrel imports `OssieTypes.ts`. With the barrel
  allowlisted it misses re-exports, and depcruise never sees the
  vendored schema. Two rules plus a source-site rule instead.
- **A `toEqual` pin on `/ossie/i` public exports** (first draft). An
  aliased re-export (`parseOssie as parse`) evades it. Replaced by the
  entry-point rule, which is keyed on the target file.
- **Cross-package scanners as vitest tests** (first draft: the
  `orm_version` allowlist in core, the schema-reference test in
  formats, the coverage test in promptlab). Turbo caches each against
  its own package's inputs, so a plant elsewhere replays a pass.
  `$TURBO_ROOT$/packages/*/src/**` inputs would fix it, but would make
  every source change rerun that package's whole suite. Script gates
  instead.
- **One gate per rule** (`check:orm-version-writers`,
  `check:ossie-schema-refs`). Each would parse the same files, and
  each would need a script, a step and a forwarder. One
  `check:source-sites` with named rules reads the tree once, as
  `purity` does for its rules. Each ADR names it for its own ids.
- **`check:recompute-derived` as a gate.** Every input is in core's
  turbo hash, so a tagged test reaches everything a gate would.
- **A name list of derived properties (`tables`, `ddl`, ...).** Misses a
  derived property under a new name. Row 10 chose an allowlist.
- **Moving the inventory to JSON** so it is not docs-only. The ADR names
  the spec file as the inventory's home. `GATE_INPUT` is one line.
- **knip `--production` for `core-external-deps`.** Not a declarable
  gate name without widening `GATE_EXCEPTIONS` (open decision 2, taken
  as (a)).
- **Load-forward by static scan.** Cannot tell a write of the input
  path from a write of `--output`.

## Workstreams (each independently shippable)

Each workstream ends with the ADR's `Enforced-by:` and Consequences
updated, `ARCHITECTURE.md` regenerated, a PR-body plant line per tagged
decision and a `probes.json` row per gate entry (`npm run adr-probes --
--only <adr>#<id>`). Gap issues close in a tracker-only PR after the
merge.

### 1. `recompute-derived`

The property-class table (`presentation` for diagram layout), its
tagged core test with the synthetic-walk self-cases, and the schema
closedness test. The pr-review checklist line for new `conceptual`
rows.

### 2. schema-versioning tests and the minor-and-major restatement

`version-signal`'s missing-version test, plus the `projectScaffold` and
`splitModel` output tests. `minor-and-major`'s shape, chain and parity
tests, with decision 2 restated in the ADR and the classification moved
to Context. The `merge.test.ts` success assertion. The
`orm-version-writers` rule lands in WS3 with `check:source-sites`, and
`version-signal`'s gate entry lands with it.

### 3. `check:source-sites` and ossie-interchange

The new gate with its two rules (`orm-version-writers`,
`ossie-schema-refs`), its `scripts/tests/` cases planting each rule red
in a `tempRepo()`, `ci.yml` step, forwarders and probes. The two
depcruise rules. `ontology-layer-only` fixtures. `pin.json`, the hash
test and the README `GATE_INPUT` line. `readable-iri` and
`nothing-lost-silently` tags. Decision 6's description of its check is
corrected, the residue goes to Consequences, and zec, yc6, k74, oor and
m1l close. Needs the blob ids verified upstream first.

### 4. package-graph-authority

The `check:architecture` extensions for `intended-is-graph` and
`core-external-deps` (option (a)), three new package CLAUDE.md tables,
internal-package lists removed from `## Dependency Rule` prose, and two
probes.

### 5. constraint-coverage-policy

`asymmetric` added to the common tier in the ADR's decision 2. The
`learn` export. The inventory rewritten one row per type. The
`check:eval-coverage` gate with its node tests, `ci.yml` step after
`build`, forwarders and three probes. The `GATE_INPUT` line for the
inventory. vq8 is narrowed in the tracker PR. 5yl and k6g close.

### 6. load-forward across surfaces (provisional: VS Code not grounded)

The CLI and MCP surface tests with their self-checks, and the
`tested-in.json` row. VS Code gets its own design pass once its seams
are measured.

### 7. `check:schema-bump`

The gate, its node tests, `ci.yml` step, forwarders and a probe.
Decision 3 gains the definition of "released" as a `v*` tag, and
Consequences' v2.0.0 sentence is corrected to the tags that exist on
origin. 8l3, vvg and 6om close. Until a `v*` tag writes 4.0, the probe
plants the version, not the schema.

### 8. Ossie export property test (provisional: not yet grounded)

`fast-check` becomes a formats devDependency, and the test imports
core's arbitrary by relative path (no package depends on another's
`tests/` today; this is the first, test-only). The serialized-YAML
oracle needs id alignment. `verifyOssie`'s `align` would share its
blind spots, so alignment by the writer's correspondence is to be
designed. The deontic-mandatory coverage self-check comes first.

## Open decisions (for review)

1. **Which tier is `asymmetric`?** **Resolved (owner, 2026-11-06):
   common.** WS5 adds it to decision 2's common tier.
2. **How `core-external-deps` sees devDependency imports.** **Taken as
   recommended (owner not asked; 2026-11-06): (a)** `check:architecture`
   reads `core/src` specifiers. (b) was knip `--production`.
3. **`minor-and-major`: restate or narrow.** **Resolved (owner,
   2026-11-06): restate** to "a minor step goes to the next minor, a
   major step to the next major's first; the schema const equals
   `CURRENT_ORM_VERSION`", with the classification moved to Context.
   The enforcer also checks the chain (one step out of each version; a
   major step leaves its major's last minor). That follows from the
   sentence the decision keeps, that the loader reads every version "by
   applying those steps". If the owner wants it in the restated text
   too, it is one more clause.
4. **What "released" means for `shared-minor` (barwise-6om).**
   **Resolved (owner, 2026-11-06): a `v*` tag;** the ADR's v2.0.0
   sentence is corrected (WS7).
5. **Are diagram positions "rendered output"?** **Resolved (owner,
   2026-11-06): presentation; saving is a choice.** The question was
   live: `DiagramSession.collectPositions`
   (`diagram/src/session/DiagramSession.ts`) saves every entity's
   laid-out position, ELK output included, and a fact type's only when
   it was moved. Saving is the user's choice to freeze an arrangement,
   and the layout engine is not stable enough to recompute the same
   picture, so the saved positions stay `presentation`. The ADR's
   Consequences say so.
6. **The Ossie boundary's residue.** **Resolved (owner, 2026-11-06):
   close zec, yc6 and k74,** the residue review-only in Consequences.
7. **Package CLAUDE.md dependency prose.** **Taken as recommended (owner
   not asked; 2026-11-06): (a),** the Upstream table is the checked copy.
8. **Case as domain for `two-instances`.** **Taken as recommended (owner
   not asked; 2026-11-06): (a),** with a `domain:` field later if two
   cases ever share one.
9. **Restate `tiered-types`.** **Resolved (owner, 2026-11-06): not
   restated;** barwise-ym8.vq8 stays open on transcript prose.

## Risks and testing

- **Probes that can only plant a regression.** `check:schema-bump`'s
  probe sets the version back to 1.1 until a 4.0 release exists. It
  proves the comparison, not a realistic edit. The probe row says so.
- **CI tags.** `check:schema-bump` needs `v*` tags. `ci.yml:36` checks
  out with `fetch-depth: 0`. Unverified: that this fetches tags on
  pull-request runs. A reviewer reads the checkout step's log, or the
  gate's exit 2 on its first CI run shows it.
- **New gates under fault-matrix.** `check:source-sites`,
  `check:eval-coverage` and `check:schema-bump` join the matrix's axes
  (git faults, three working directories) automatically, because it
  runs every node gate CI runs. `check:eval-coverage` reads core and
  learn dist, which exist where the matrix runs (last, after `build`).
  Each gate resolves paths from its own location. Unverified until
  `npm run fault-matrix` runs on the WS branch.
- **Self-checks.** Each scanner (writer sites, schema references, graph
  literals, the schema walk) carries positive and negative self-cases,
  as `modelSdkBoundary.test.ts` does, and the gates refuse on zero files
  read. The surface tests assert success before bytes.
- **Docs-only skips.** `GATE_INPUT` gains the inventory spec and
  `formats/schemas/ossie/README.md`. The ADRs already are inputs.
  `check:architecture` has no `if:`, so the CLAUDE.md check runs on
  every PR.
- **Pre-existing caching holes, outside this batch.** promptlab's
  `evals/**` is not a turbo test input, though five of its test files
  read it, so an evals-only change replays their cached pass.
  `llm/tests/modelSdkBoundary.test.ts` scans every package's `src`
  from llm's vitest, so a plant in cli or mcp replays llm's cached pass
  in the same way. Both want a tracker issue. They are not fixed here.
- **`check:review-tiers`** may need rows for the three new scripts.
  Unverified: run `npm run check:review-tiers` after adding them.
- Each workstream runs `npm run build` (the learn export crosses
  packages), the touched packages' `npx vitest run`, `npm run
  test:scripts`, `npm run check:architecture`, `npm run depcruise`,
  `npm run adr-probes`, and `npm run ci:local` before push.

## Non-goals

- No change to what any decision decides beyond the owner-restated rows
  10, 12 and 13 and the resolved open decisions above.
- Not authoring eval instances, a set-comparison check kind, or the
  rare-tier gym exercise (`constraint-extraction-coverage.spec.md`
  workstreams 2-4).
- Not fixing migration's comment loss (barwise-ok6) or adding steps for
  project and mapping files.
- Not a report of Ossie terms in core (row 12 made it a report, not a
  gate; it is not built here).
- Not fixing the pre-existing caching holes named under Risks.
