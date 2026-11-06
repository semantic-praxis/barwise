# Batch 9: schema, Ossie, eval-coverage and package-graph decisions enforced

Status: Draft -- no workstream implemented

Created: 2026-11-06
Last-updated: 2026-11-06
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
+barwise/packages/promptlab/tests/coverageInventory.test.ts,
barwise/docs/specs/constraint-extraction-coverage.spec.md,
barwise/scripts/lib/changed-class.mjs,
+barwise/scripts/check-schema-bump.mjs, barwise/scripts/tests/,
barwise/package.json, package.json, .github/workflows/ci.yml

## Principle

Batch 9 holds sixteen decisions across five ADRs, each carrying a gap
issue. Eight are already partly held by tagged tests or a gate. The
other eight have no declared enforcer: `recompute-derived`,
`shared-minor`, `peer-standard`, `own-vocabulary`, `readable-iri`
(which, as it turns out, code already holds without a tag) and all three
`constraint-coverage-policy` decisions. Every decision here is
an invariant over files the repository tracks: a schema, a migration
registry, a vendored copy, an import edge, a manifest, an eval rubric.
Each one can be checked, and this spec adds the check that fails when
the decision is broken ("explicit over implicit": a decision only review
holds reads as a rule and gets followed as advice).

The plan's enforcer suggestions were checked against the code before
being adopted. Five needed correcting, and the corrected forms are
below: row 12's depcruise rule fails on main as
worded and cannot see the vendored schema; `readable-iri`'s "to design"
rule already exists; `tiered-types` named transcripts, which no check can
read; the coverage drift test would not run on the one change it guards;
and `shared-minor`'s gate cannot fail on any real change until a release
is tagged.

## The reading this spec starts from (main at 312894fd)

- `npm run check:architecture` exits 0 (80 decisions, 26 with a gate).
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
  of them and leaves out **`asymmetric`**, which is in neither tier.
- **The inventory** (`constraint-extraction-coverage.spec.md`, lines
  38-43) is prose. It lumps six ring types into one row and gives counts
  as free text ("one (project-staffing)", "yes (2.5.0)"). Its claims
  match the suite today. A PR that changes only this `.md` file is
  docs-only (`scripts/lib/changed-class.mjs:25`), so CI skips
  `test:coverage` for it.
- **Ossie boundary.** Measured with depcruise over `packages/`: the only
  edges into `formats/src/ossie/` from outside it are `formats/src/index.ts`
  (OssieExportFormat, OssieImportFormat, OssieTypes) and
  `formats/src/registration.ts`. MCP reads `OSSIE_VERSION` through
  `@barwise/formats` (`mcp/src/tools/importModel.ts:9`). A trial rule
  that forbids those edges from anywhere except `ossie/`, `index.ts` and
  `registration.ts` exits 0 on main. Depcruise **does not see** the
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
  hit is a fixture string in `gates.test.mjs:7536`). In the package
  CLAUDE.md files, nine `## Dependencies` tables list Upstream rows that
  equal `INTENDED`. `core`, `learn` and `promptlab` have no table, and
  their dependency names exist only as prose in `## Dependency Rule`.
  Core's `src` imports exactly `effect`, `yaml` and `ajv` (measured
  across 177 files with `ts.preProcessFile`). `fast-check` is already in
  core's `devDependencies`, so planting an `import "fast-check"` in
  `core/src` needs no manifest edit.
- **Versioning.** `CURRENT_ORM_VERSION` is `"4.0"`, and the schema
  `const` is `"4.0"`. `ORM_VERSION_MIGRATIONS` has 1.0->1.1 and
  1.1->2.0. The 2.0->3.0 step goes through the model, and 3.0 is read
  by its own reader. A document with no `orm_version` is refused with
  "orm_version is missing" (run against core's dist), but no test pins
  that. Outside `core/src/serialization` and `core/src/decode`, two
  places write `orm_version`: `vscode/src/commands/projectScaffold.ts`
  (a template using `CURRENT_ORM_VERSION`) and
  `core/src/project/splitModel.ts:488` (copies `writeDocument40`'s
  version). `merge.test.ts:44` checks that both 1.0 inputs stay
  unchanged, but not that the merge ran.
- **Releases.** `git ls-remote --tags origin` lists `v0.3.0`..`v1.7.0`
  and `edge`, with **no `v2.0.0`**, though the packages say 2.0.0 and
  schema-versioning's Consequences say "v2.0.0 is the first release
  since, writing 4.0". The last `v*` tag is v1.7.0, which wrote 1.1.
- **Schema shape.** `orm-model.schema.json` has 194 property slots under
  81 distinct names. Every object that declares `properties` is closed
  (37 of 37; the 38th is an `if` clause). `writer40.test.ts` validates
  the 4.0 writer's output against the schema, and
  `document40SchemaDrift.test.ts` holds the Effect decoders to it.

## Decision by decision

Each entry gives what holds the decision today, the proposed enforcer,
whether the decision's wording changes, the planted violation that
proves the enforcer works, and what happens to the gap issue. "Tests"
means vitest or node tests carrying `[adr:<adr>#<id>]`, held in CI by
`check:adr-tests`. Each one's plant goes in the PR body
(`spec-writer/adr-writing.md`).

### metamodel-evolution-policy

**`recompute-derived`** (row 10, owner-restated). Today: nothing holds
it. The schema is closed, so a derived property has to be added to the
schema on purpose, and nothing reviews that addition. Enforcer: a table
beside the schema, `orm-model.property-classes.json`, that classifies
every property slot by JSON pointer
(`/definitions/<def>/properties/<name>`) as `conceptual`, `identity`
(`id`, `minted_from`, `imports`, `namespace`, `orm_version`) or
`presentation` (diagram layout). It is keyed by slot, not by name, so
reusing an existing name like `expression` in a new place still has to
be classified. A tagged core test walks the schema and fails on any slot
the table lacks and on any table row with no slot. The writer side is
already covered: the schema is closed and `writer40.test.ts` validates
the writer's output, so the serializer cannot write a property the
schema lacks. Wording: unchanged. Plant: add a `tables` property to
`definitions/fact_type` -> the test fails naming the slot. Gap: 3ai
closes. The classification of diagram positions goes to the owner (Open
decision 5).

### schema-versioning

**`version-signal`** (4i2). Today: tagged tests cover current, newer
and stamped files. Unguarded: a file with no version, and writers that
bypass the serializer. Enforcer: (1) a tagged test that deserializing
`model:\n  name: T\n` throws a message naming `orm_version`. (2) A
tagged test that uses TypeScript's scanner to find every `orm_version`
property key (identifier or string literal) and every template text
containing `orm_version:` in `packages/*/src`. It fails on any file
outside an allowlist (`core/src/serialization/`, `core/src/decode/`,
`core/src/project/splitModel.ts`,
`vscode/src/commands/projectScaffold.ts`, and
`formats/src/ossie/verifyOssie.ts`, which only has a type). Each
allowlisted writer outside `serialization/` has a tagged test that its
output states `CURRENT_ORM_VERSION`. Plants: make the serializer stop
throwing on a missing version -> (1) fails; add `orm_version: "3.0"` to
a new object literal in `cli/src` -> (2) fails. Wording: unchanged. Gap:
4i2 closes. A schema failure on a same-version file using an unknown
construct stays outside the decision, as the ADR says.

**`minor-and-major`** (31z). Today: a tagged test checks that the
current major's chain reaches `CURRENT_ORM_VERSION`. Enforcer: a tagged
test that every registered step is either a minor step (same major, `to`
minor = `from` minor + 1) or a major step (`to` = next major's `.0`).
That catches 3.0->3.2, which the reach test passes. A second tagged
assertion: the schema `const` equals `CURRENT_ORM_VERSION` directly,
rather than indirectly through a load. Plants: register `{from:"1.0",
to:"2.0"}` in a test-local copy of the real registry passed to the shape
function, and replace the real 1.0->1.1 step's `to` with `"1.2"` -> the
shape test fails. Set the schema const to `"4.1"` -> the parity test
fails. Wording: the decision also says "a change an older reader would
misread rather than ignore is structural", which is a judgment no check
can make. Owner choice (Open decision 3): restate to the checkable rule
and move the classification to Context, or keep the wording and leave
31z open, narrowed to that judgment.

**`shared-minor`** (8l3, barwise-vvg). Today: nothing. Enforcer: a new
gate, `check:schema-bump`. It finds the latest `v*` tag reachable from
HEAD, reads that tag's `orm-model.schema.json` and `CURRENT_ORM_VERSION`,
and exits 1 when the schema differs (ignoring `description`, `title`
and `$comment`) while the version is equal. It exits 2 when no `v*` tag
is reachable (a shallow clone) or the tag's files cannot be read. It
needs a `ci.yml` step with no `if:`, a root forwarder, and a node test
in a `tempRepo()`. It does not judge additive versus structural. It
**cannot fail on main today**: the last tag wrote 1.1 and main writes
4.0, so every schema change since then is covered by a bump that
already happened. It starts to bite at the next `v*` tag. Plant (for
`probes.json`, valid today): set `CURRENT_ORM_VERSION = "1.1"` in
`schemaVersion.ts` -> exit 1. After v2.0.0 is tagged, the row changes
to planting a schema property. Wording: decision 3 says "released"
without defining it. The gate reads a `v*` tag as a release, which is
barwise-6om's open question (Open decision 4). Gap: 8l3 and vvg close
once 6om is decided.

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
so new commands are covered as they are declared (`importerIds.test.ts`
works the same way). Without the success assertion, a command that
refuses the file would pass the byte check, which is the
cannot-fail-test trap. `tested-in.json` gets a row naming both files.
Plants: make `barwise verbalize` write the model back after reading ->
the CLI test fails. Drop the success assertion -> the self-check test
(a refusing stub command) fails. VS Code is provisional: its
language-model tools reach the same core paths as MCP, but the language
server's open/save path has no headless harness here (unverified: `npx
vitest run` in `packages/vscode` shows which unit seams exist). Wording:
unchanged. Gap: yfi narrows to VS Code. Comment loss (barwise-ok6) and
project/mapping files (no steps yet) stay where the ADR puts them.

### ossie-interchange

**`peer-standard`** and **`own-vocabulary`** (rows 12 and 13,
owner-restated; zec, yc6). Today: nothing. The enforcer the ADR's
decision 6 describes would fail on main: as worded ("only
`formats/src/ossie/` imports Ossie's types"), `formats/src/index.ts`
imports `OssieTypes.ts`. It also cannot see the vendored schema. So the
enforcer is three pieces:

1. A depcruise rule `ossie-only-in-descriptor`: from any module except
   `formats/src/ossie/`, `formats/src/index.ts` and
   `formats/src/registration.ts`, no edge into `formats/src/ossie/`.
   Measured: exits 0 on main.
2. A tagged formats test that pins, with `toEqual`, the public exports
   whose names match `/ossie/i`: `OSSIE_VERSION`, `OssieExportFormat`,
   `OssieImportError`, `OssieImportFormat`, `ossieFormat`. The barrel is
   allowlisted in (1), so a re-export of `parseOssie` or
   `mapOssieToOrm` through it would pass (1). This test closes that.
3. A tagged test that uses `ts.preProcessFile` over `packages/*/src` and
   fails on any module reference containing `schemas/ossie` outside
   `formats/src/ossie/`. Depcruise cannot do this under `includeOnly`,
   for the same reason it could not see model SDK imports in
   `purity-and-model-boundary.spec.md`.

Plants: `import "../ossie/mapOssieToOrm.js";` in
`formats/src/avro/AvroExportFormat.ts` (no cycle: ossie imports only
`naming.ts` outside itself) -> depcruise exits 1. `export { parseOssie }
from "./ossie/parseOssie.js"` in `index.ts` -> (2) fails. A JSON import
of `../../schemas/ossie/ontology.json` in `formats/src/sql/` -> (3)
fails. Enforced-by gains `npm run depcruise (peer-standard,
own-vocabulary)` with a `probes.json` row, and `tests (peer-standard,
own-vocabulary)`. Wording: the rule stays as the owner restated it. The
sentence in decision 6 describing the check is corrected to the three
pieces. Residue: an Ossie reader written from scratch outside the
descriptor that imports nothing from it passes all three, and so does
mapping-document support built the same way. The gaps narrow to that
residue, and closing them is the owner's call (Open decision 6).

**`ontology-layer-only`** (k74). Enforcer: (1) a tagged import test
whose fixture has an `ontology_mappings` entry carrying a
`semantic_model` with a dataset, fields and a metric. It asserts the
drop warning and that no element named after any of them is in the
model. (2) A tagged export test over the example's export and the built
model's export: the top-level keys are a subset of `version`, `name`,
`description`, `requires`, `ontology`, `prefixes`, and there is no
`ontology_mappings`. Core-layer keys at the top level are already
refused by the closed schema. Plants: in `mapOssieToOrm.ts`, add one
entity per `semantic_model.datasets[].name` -> (1) fails. In
`writeOssie.ts`, add `ontology_mappings: []` to the document -> (2)
fails. Wording: unchanged. Gap: k74 narrows to the residue shared with
zec.

**`pinned-version`** (oor). Enforcer: `schemas/ossie/pin.json` records
`{ commit, files: { name: gitBlobId } }`. A tagged test computes each
vendored file's git blob id (`sha1("blob <len>\0" + bytes)`), compares
it with the record, and checks that the README names the same commit.
The existing unknown-field test ("fields the pinned schema does not
define") is tagged too: it fails if `ossieSchema.ts` validates against
anything else. Plants: edit one enum in `ontology.json` -> the hash test
fails. Point `ossieSchema.ts` at `{}` -> the tagged unknown-field test
fails. Wording: unchanged. Gap: oor closes. An upstream change to a
document under the same version string is not a barwise violation; it
is a limit of what can be measured, stated in Consequences. **Unverified:**
that `9d021c2c`/`350b0910` are upstream's blob ids at `01a5488d`. A
reviewer runs `git ls-tree 01a5488d ontology/ontology.json
core-spec/ossie-schema.json` in an apache/ossie clone (this session has
no GitHub access to that repository).

**`nothing-lost-silently`** (zkd). Today: three tagged tests cover the
example and unit cases. The exporter reads its output back
(`verifyOssie.ts`). Enforcer, in two steps. (1) Tag the untagged
read-back tests in `OssieVerify.test.ts` and `OssieLossScope.test.ts`.
(2) Provisional: a property test that runs `OssieExportFormat.export`
over core's model arbitrary (`core/tests/arbitraries/model.ts`). For
every element whose serialized form differs between the source and the
re-imported, id-aligned model, a loss line must name it. The oracle
compares serialized YAML, not `diffModels`, because a blind spot in
`diffModels` is also a blind spot in `verifyOssie`, and a property using
the same oracle would share it. Plants: make `OssieExportFormat` skip
`verifyOssie` -> (2) fails (and (1) only if a tagged case depends on the
read-back). Wording: unchanged. Gap: zkd closes with (2). The missing
`ExportResult.warnings` and the caller-supplied name are decisions the
ADR records, not gaps.

**`readable-iri`** (m1l). The rule the plan said was "to design" is
already built (see the reading above). Enforcer: tag
`idsAndImports.test.ts` "reports an object type, a fact type and a role
whose ids differ" and `importerIds.test.ts`'s per-importer tests, and
add one tagged core test: a model built with no ids gets
`localName(name)` ids and no `id-not-from-name` diagnostic. Plants:
`nameIdBase` returns `localName(name).toLowerCase()` -> the new test and
`importerIds` fail. Remove `checkIdsFromNames` from the structural rules
-> the tagged `idsAndImports` test fails. Wording: unchanged. Gap: m1l
closes. `equivalent_iri` stays deferred (barwise-wcg.vn2).

### package-graph-authority

**`intended-is-graph`** (d3m). Today: depcruise holds the import half.
Enforcer: extend `check:architecture` in two ways. (1) In tracked
`barwise/scripts/**` (it already reads these for citations), excluding
`scripts/tests/` and `intended.cjs`, flag any property whose key is a
package directory name and whose value is an array literal of package
names: the shape of one adjacency entry, found by TypeScript's parser.
(2) Compare each package CLAUDE.md's `## Dependencies` Upstream rows
with `INTENDED`, both ways, and require the table in all twelve.
`core`, `learn` and `promptlab` gain one (core's says "none"). Plants:
add `const COPY = { "promptlab": ["core"] };` to `arch-triage.mjs` ->
exit 1. Add an Upstream `@barwise/llm` row to `diagram/CLAUDE.md` ->
exit 1. Both go in `probes.json`. The shadow: a copy written another
way (a list of `"cli->core"` strings, a `Map`) passes (1). Every copy
found so far had the adjacency shape. Wording: unchanged. Gap: d3m
closes. Prose in `## Dependency Rule` that names packages stays
unchecked (Open decision 7).

**`core-external-deps`** (xyn). Today: `check:architecture` compares
manifest fields, and knip runs in default mode, so an import of a
devDependency from `core/src` passes both. Enforcer (recommended):
`check:architecture` reads `core/src`'s bare module specifiers with
`ts.preProcessFile` (skipping relative paths and `node:`, which purity
owns) and fails on any package missing from core's runtime fields.
Measured clean on main. Type-only imports count, because core's `.d.ts`
re-exposes them. Plant: `import "fast-check";` at the top of
`core/src/index.ts` -> exit 1, as a second `probes.json` row for the
decision. **Unverified:** that this plant passes knip today, as the gap
issue states. A reviewer runs it with `node scripts/mutate.mjs` (see
`adr-writing.md`) against `npm run knip`. Wording: unchanged. Gap: xyn
closes. Choosing between this and knip `--production` changes a CI gate,
which the issue reserves for the owner (Open decision 2).

### constraint-coverage-policy

All three are held by one drift test, `coverageInventory.test.ts` in
promptlab. It loads the suite and each reference and resolves every
`forbids_population` ring check to its ring type through a function
exported from `learn` (`referenceConstraint`, the selection
`forbidsPopulation.ts:208` already does). The test does not copy that
selection, because a second copy is a must-agree copy. The inventory
becomes one row per type: eight ring types plus `subset`, `equality`
and `exclusion`. Columns: tier, reference cases, rubric-tested train
cases, rubric-tested dev cases, covered. A free-text "settled in a
transcript" column stays prose, and the test ignores it. Tiers are
parsed from the ADR's decision 2 backticks, not copied. The ADR stays
the authority, and a parse that finds no tier refuses (fails with "could
not read the tiers").

**`two-instances`** (5yl). The rule checked: `covered: yes` exactly when
the type has at least one rubric-tested instance in a train case and one
in a dev case, in different cases. The rest of the test also fails a
type the suite covers but the inventory does not mark. Plant: mark
`acyclic` covered in the inventory -> fails ("covered with 1 train, 0
dev"). Wording: "different domains with different surface phrasing".
The test reads a case as a domain, and phrasing stays review (Open
decision 8). Gap: 5yl closes if the owner accepts the case-as-domain
reading.

**`tiered-types`** (vq8). The plan's enforcer ("a rubric that tests a
rare-tier type") cannot see the decision's object, a transcript, and a
rubric names only `ring`. The check that can be built: no reference in
the suite carries a rare-tier constraint, so no rubric can resolve to
one. References are authored to carry what each transcript settles
(barwise-878), which is why this proxy tracks the decision, and it
diverges exactly when a transcript settles a rare rule the reference
leaves out. Every type must also have a tier: `asymmetric` has none
today, so the test cannot pass until the owner places it (Open decision
1). Plant: change project-staffing's reference `ring_type: acyclic` to
`transitive` -> fails. Wording: Open decision 9 offers a restatement
("never enters an eval case: no reference or rubric in the suite holds a
rare-tier constraint"). Without it, vq8 narrows to transcript prose.

**`inventory-outside`** (k6g). The rule checked: the inventory's derived
columns equal the suite. Plant: change project-staffing's reference ring
to `irreflexive` -> fails (irreflexive becomes 1 train + 1 dev and
covered, acyclic drops to 0). The same commit that edits the suite must
edit the inventory, which is the decision. For the test to run on an
inventory-only PR, `changed-class.mjs` adds
`constraint-extraction-coverage.spec.md` to `GATE_INPUT` (not
docs-only), as it does for ADRs. Without that, a PR that falsifies only
the table skips `test:coverage` and goes green. Wording: unchanged. Gap:
k6g closes.

## Alternatives considered

- **Row 12 as one depcruise rule, as the ADR describes it.** Fails on
  main (the barrel imports `OssieTypes.ts`). Fixed with an allowlist, it
  cannot see re-exports or the vendored schema. Kept as one of three
  pieces, not the whole.
- **One source test for the Ossie boundary, no depcruise rule** (the
  `modelSdkBoundary` precedent). It would see everything the rule sees.
  The owner chose a depcruise rule with a probe for row 12, and the rule
  is exact for edges inside `src`. Both kept.
- **`check:recompute-derived` as a gate.** A gate adds a script, a CI
  step and a forwarder, and reaches nothing a core test does not (the
  `credential-handling-held.spec.md` reasoning). A tagged test.
- **A name list of derived properties (`tables`, `ddl`, ...).** Misses a
  derived property under a new name. Row 10 chose an allowlist.
- **Coverage counts by name match** (`factType` text to reference ring
  type) **in the test.** A second copy of `forbidsPopulation`'s
  selection. Exported from `learn` instead.
- **Moving the inventory to JSON** so it is not docs-only. The ADR names
  the spec file as the inventory's home. `GATE_INPUT` is one line.
- **knip `--production` for `core-external-deps`.** Also catches the
  plant, but knip is not a declarable gate name (`GATE_EXCEPTIONS`).
  Declaring it means widening that list, and it changes how knip reads
  the other packages unless scoped. Offered in Open decision 2.
- **Load-forward by static scan** (writes only from editing commands).
  It cannot tell a write of the input path from a write of `--output`.
  The behavioural test over each surface's own command list can.

## Workstreams (each independently shippable)

Each workstream ends with the ADR's `Enforced-by:` and Consequences
updated, `ARCHITECTURE.md` regenerated, a PR-body plant line per tagged
decision and a `probes.json` row per gate entry (`npm run adr-probes --
--only <adr>#<id>`). Gap issues close in a tracker-only PR after the
merge.

### 1. `recompute-derived`

The property-class table and its test. One core test file, one JSON
file, one ADR. Needs Open decision 5 only for one row's category.

### 2. schema-versioning tests

`version-signal` (missing-version and writer-allowlist tests),
`minor-and-major` (step shape and const parity), and the `merge.test.ts`
success assertion for `load-forward`. Core and CLI tests only. 31z's
outcome follows Open decision 3.

### 3. ossie-interchange

The depcruise rule, export pin and schema-reference test (rows 12 and
13); `ontology-layer-only` fixtures; `pin.json` and the hash test;
`readable-iri` and `nothing-lost-silently` tags. Decision 6's sentence
on its check is corrected. Needs the blob ids verified upstream first.

### 4. package-graph-authority

The `check:architecture` extensions for `intended-is-graph` and
`core-external-deps`, three package CLAUDE.md tables, and two probes.
Waits on Open decisions 2 and 7.

### 5. constraint-coverage-policy

The `learn` export, the inventory rewrite, `coverageInventory.test.ts`,
and the `GATE_INPUT` line. Waits on Open decisions 1, 8 and 9: the test
cannot pass while `asymmetric` has no tier.

### 6. load-forward across surfaces (provisional: VS Code not grounded)

The CLI and MCP surface tests with their self-checks, and the
`tested-in.json` row. VS Code gets its own design pass once its seams
are measured.

### 7. `check:schema-bump` (blocked on Open decision 4)

The gate, its node tests, `ci.yml` step, forwarders, and a probe. It
lands either way once 6om is decided. Until a `v*` tag writes 4.0, the
probe plants the version, not the schema.

### 8. Ossie export property test (provisional: not yet grounded)

`fast-check` becomes a formats devDependency, and the test imports
core's arbitrary by relative path (no package depends on another's
`tests/` today; this is the first, test-only). The serialized-YAML
oracle needs id alignment, which `verifyOssie`'s `align` does; reusing
it would share its blind spots, so alignment by the writer's
correspondence is to be designed.

## Open decisions (for review)

1. **Which tier is `asymmetric`?** **Resolved (owner, 2026-11-06): common.** It is a core ring type and in neither
   tier of `tiered-types`. Adding it changes the decision's text.
   Recommended: common, because "no one approves their own request in
   both directions" is the shape of rules real sessions state; the owner
   may judge it rare.
2. **How `core-external-deps` sees devDependency imports.** **Taken as recommended (owner not asked; 2026-11-06).** (a)
   `check:architecture` reads `core/src` specifiers, which is
   declarable, probed and core-only. (b) knip `--production` for core,
   which needs `GATE_EXCEPTIONS` widened. Recommended: (a).
3. **`minor-and-major`: restate or narrow.** **Resolved (owner, 2026-11-06): restate.** (a) Restate to "a minor
   step goes to the next minor, a major step to the next major's first;
   the schema const equals `CURRENT_ORM_VERSION`" and move the
   additive/structural classification to Context, closing 31z. (b)
   Keep the text and leave 31z open on the judgment. Recommended: (a).
   Plan open decision 4 listed this as the owner's to reopen.
4. **What "released" means for `shared-minor` (barwise-6om).** **Resolved (owner, 2026-11-06): a `v*` tag; the ADR's v2.0.0 sentence is corrected.**
   Recommended: a `v*` tag, not `edge`. If `edge` counted, every PR
   that changes the schema would need a bump, which contradicts the
   decision. The ADR's "v2.0.0 is the first release since" names a tag
   that does not exist on origin. Either the tag is cut or the sentence
   is corrected in the same decision.
5. **Are diagram positions "rendered output"?** **Taken as recommended (owner not asked; 2026-11-06).** `diagrams[].positions`
   persist pixel coordinates. Recommended: `presentation`, authored and
   not recomputed (users place elements). If the owner reads them as
   rendered layout, `recompute-derived` is violated today.
6. **The Ossie boundary's residue.** **Resolved (owner, 2026-11-06): close, the residue review-only.** A reader written from scratch that
   imports nothing Ossie (or a mapping-document reader built the same
   way) passes every check. (a) Close zec, yc6 and k74 with the residue
   moved to Consequences as review-only. (b) Keep them open, narrowed.
   Recommended: (a). No source scan tells a new YAML reader apart from
   the others.
7. **Package CLAUDE.md dependency prose.** **Taken as recommended (owner not asked; 2026-11-06).** (a) The Upstream table is
   the checked copy, and `## Dependency Rule` prose stops listing
   internal packages. (b) Keep the prose lists unchecked. Recommended:
   (a), applied to the three files that lack a table and any prose list
   that disagrees.
8. **Case as domain for `two-instances`.** **Taken as recommended (owner not asked; 2026-11-06).** (a) Accept that two cases
   are two domains (employee-hierarchy and project-staffing are both HR
   settings). (b) Add a `domain:` field to eval cases and count
   distinct values. Recommended: (a) now, with (b) when a case set
   shares a domain in practice.
9. **Restate `tiered-types`** **Resolved (owner, 2026-11-06): not restated; barwise-ym8.vq8 stays open on transcript prose.** to "never enters an eval case: no
   reference or rubric in the suite holds a rare-tier constraint", or
   keep "transcript" with vq8 open on prose. Recommended: restate. The
   reference is where the suite records what a transcript settles.

## Risks and testing

- **Probes that can only plant a regression.** `check:schema-bump`'s
  probe sets the version back to 1.1 until a 4.0 release exists. It
  proves the comparison, not a realistic edit. WS7 says so in the row.
- **CI tags.** `check:schema-bump` needs `v*` tags. `ci.yml:36` checks
  out with `fetch-depth: 0`. **Unverified:** that this fetches tags on
  pull-request runs. A reviewer reads the checkout step's log for
  `git tag` output, or the gate's own exit 2 on the first CI run shows
  it.
- **Self-checks.** Each scanner test (writer allowlist, schema
  reference, graph literal) carries positive and negative self-cases,
  as `modelSdkBoundary.test.ts` does, so an empty reading cannot pass.
  The surface tests assert success before bytes.
- **Docs-only skips.** Only the inventory needs `GATE_INPUT`. The ADRs
  already are inputs. `check:architecture` runs on every PR, so the
  CLAUDE.md check needs nothing. The Ossie README is docs-only, but the
  hash test compares it with `pin.json`, which is not.
- **`check:review-tiers`** may need a row for
  `scripts/check-schema-bump.mjs`. **Unverified:** run `npm run
  check:review-tiers` after adding the file.
- Each workstream runs `npm run build` (core and learn exports cross
  packages), the touched packages' `npx vitest run`, `npm run
  check:architecture`, `npm run depcruise`, `npm run adr-probes`, and
  `npm run ci:local` before push.

## Non-goals

- No change to what any decision decides beyond the owner-restated rows
  10, 12 and 13 and the open decisions above.
- Not authoring eval instances, a set-comparison check kind, or the
  rare-tier gym exercise (`constraint-extraction-coverage.spec.md`
  workstreams 2-4).
- Not fixing migration's comment loss (barwise-ok6) or adding steps for
  project and mapping files.
- Not a report of Ossie terms in core (row 12 made it a report, not a
  gate; it is not built here).
