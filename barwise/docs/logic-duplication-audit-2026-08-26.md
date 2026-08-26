# Logic-duplication audit, 2026-08-26

Third sweep in the series, following
`unwired-capability-audit-2026-08-20.md` (a hand-maintained table
asserting parity that had not held for two years) and
`unwired-capability-audit-2026-08-25.md` (seams designed for N
consumers and connected to fewer). This one was prompted by
`docs/specs/artifact-resolution-parity.spec.md`, now implemented
(PR #347): "which prompt gets sent" was answered independently in four
places that agreed by construction of parallel code, and the
divergence went unnoticed because falling back to a default is
indistinguishable from choosing it. That instance is fixed. This sweep
looks for the rest of the class at once, because meeting it one
instance at a time has cost four sessions so far.

**Result: five detection passes over all 12 packages found eight
already-diverged copies of a single decision (two of them live bugs),
roughly a dozen must-agree pairs guarded by nothing, a vocabulary
layer with no exhaustiveness discipline, and -- the headline -- an
enforcement layer that certifies the wrong graph. The remediation
design lives in `docs/specs/duplication-drift-guards.spec.md`; the
repeatable method lives in `.claude/skills/duplication-audit/`.**

## The shape being hunted

**One decision, stated N times, where the statements agree by
construction rather than by sharing an answer or being checked, and
divergence is silent.** This is narrower than "duplication". The
monorepo's principles make DRY secondary on purpose: parallel code in
two packages is preferred over an abstraction that couples them, and
several copies below say so in their own headers
(`packages/mcp/src/workspace/projectLoader.ts:5-9`,
`packages/dbt/src/sql/SqlglotBridge.ts:12-15`). Deliberate parallelism
is not the defect. The defect is a pair (or a fan of five) whose
copies **must** agree for the system to be correct, with nothing --
no shared owner, no derivation, no drift test -- that notices when
they stop.

The verdicts used throughout:

| Verdict         | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| guarded         | A mechanical check fails when the copies disagree (verified, by test name) |
| benign parallel | Copies serve genuinely different concerns; agreement is not required       |
| drift-prone     | Copies must agree; nothing checks; divergence would be silent              |
| **diverged**    | Drift-prone, and the copies already disagree today                         |

A `diverged` verdict is the class proving itself: every one of them
was once a `drift-prone` pair someone believed would stay in sync.

## Method, and what each pass is worth

1. **Cross-surface wiring.** For each capability on two or more
   surfaces (CLI, MCP, VS Code), compare the wirings: does each
   surface obtain defaults, allowed-value lists, resolution rules, and
   output shapes from a shared module, or restate them? Found the
   registry-restated-as-prose pattern (findings B5-B7) and the copied
   policy functions (class C). Also produced the strongest negative
   result: twelve of fourteen VS Code LM tools genuinely delegate to
   the MCP executors.
2. **Duplicated literals, constants, and union restatements.**
   Extract long string literals and count cross-file duplicates; trace
   every string-literal union exported from `@barwise/core` to its
   consumers and check each for an exhaustiveness guard. Found the
   diverged prompt default (B1) and the whole of class D. Its
   systemic result: the repo has **no `assertNever` helper and zero
   uses of `satisfies`**; the only live exhaustiveness mechanisms are
   `Record<Union, T>` literals and TS2366 on value-returning
   no-default switches, and TS2366 cannot fire in a void loop body.
3. **Prose parity claims and hand-maintained tables.** Grep docs and
   CLAUDE.md files for claims of sameness ("the same way", "in sync",
   "mirrors") and tables restating code facts; spot-verify each
   against the code. Found the depcruise blindness (A1) and the doc
   rot inventory (B8). Re-verified the capability matrix: still
   accurate.
4. **Derived artifacts and drift guards.** For every generated or
   derived file: what regenerates it, and what fails when source and
   copy disagree? Found `examples/output/` (A2) and the version-sync
   table. Confirmed the guarded pattern works everywhere it was
   actually implemented.
5. **Structural clones.** jscpd over `packages/*/src` (371 files,
   59,100 lines: 40 clones, 1.95% duplicated) plus targeted shape
   hunts. The token-level detector found the byte-identical pairs;
   the shape hunts found the semantic clones jscpd cannot see
   (different literals, same decision), which were the worse ones.

Every finding below was re-verified against the merged tree at
PR #347's merge commit; agent-reported claims that #347 had already
fixed were dropped or converted to negative results.

## Class A -- the enforcement layer itself

The most important findings are not individual duplications but holes
in the machinery that is supposed to catch them.

### A1. The dependency gate is blind to every subpath import, and the graph is wrong today

`.dependency-cruiser.cjs:4-8` states "This config IS the reflexion
model: the intended one-way dependency graph from the root CLAUDE.md,
encoded as machine-checkable rules." It is the repo's one
machine-checked parity claim, and it self-certifies:
`tsconfig.depcruise.json` maps `"@barwise/*"` to
`packages/*/src/index.ts`, so for a subpath specifier the wildcard
swallows the subpath -- `@barwise/diagram-ui/server` resolves to a
nonexistent path and dependency-cruiser silently **drops the edge**
rather than reporting it. Verified directly: the depcruise JSON for
`packages/cli/src/commands/diagram.ts` lists three dependencies; the
file's imports of `@barwise/core/annotation` and
`@barwise/diagram-ui/server` are simply absent. Eighty subpath imports
across the workspace are invisible to the gate -- and
`packages/core/CLAUDE.md:34-41` _instructs_ developers to import from
subpaths, so the documented house style is precisely the style the
gate cannot see.

Consequence, live today: the root `CLAUDE.md` graph (lines 149-150)
and `.dependency-cruiser.cjs:29-30` -- a hand-copied third instance of
the graph, not a derivation -- both omit `diagram-ui` from the `cli`
and `mcp` rows, while both packages declare it in `package.json` and
import it (`packages/cli/src/commands/diagram.ts:10`,
`packages/mcp/src/tools/diagram.ts:7`). `npm run depcruise` passes
clean. Also stale: `.dependency-cruiser.cjs:2` cites
`docs/specs/architecture-analysis.spec.md`, which now lives under
`docs/specs/archive/`.

Verdict: **diverged**, highest priority -- until the gate sees subpath
edges, every "the graph is enforced" statement in the repo overclaims,
and any correction to the graph prose is unverified.

### A2. `examples/output/` is cited as the drift-test precedent in four places, and has no drift test

The one derived artifact everyone points at as the guarded example is
the one that never implemented the guard:

- Two regenerators exist and disagree. `scripts/regen-example-output.sh`
  (`npm run regen:examples`) prepends `# barwise <ver>` headers;
  `packages/llm/tests/Pipeline.integration.test.ts:174-204` under
  `UPDATE_GOLDEN=1` writes the same files with no header and a
  different diagnostics format. The committed files are the
  vitest-produced form, so the _documented_ command produces a diff on
  a clean tree by construction, and `examples/README.md:38-40` ("Each
  output file is stamped with the barwise version") is false for every
  committed file.
- No test reads these files back. `npm run validate:examples` covers
  `examples/models/` and transcripts, not the output text artifacts.
- Four sites assert the guard exists:
  `packages/llm/tests/prompt/artifacts/builtins.test.ts:7`,
  `packages/learn/tests/tutorial/drift.test.ts:4`,
  `scripts/regen-builtin-artifacts.mjs:18`, and
  `docs/specs/modeling-tutorial.spec.md:202`.

Verdict: **diverged** (the claim and the reality), and worse than an
ordinary miss: the precedent everyone copies points here.

### A3. No exhaustiveness discipline

Pass 2's systemic result, stated once so class D does not repeat it:
zero `assertNever`, zero `satisfies`, `noImplicitReturns` off. Every
switch over a core vocabulary union in a void context, and every
switch with a `default`, is unguarded -- adding a union member changes
nothing at build time. The guarded consumers that do exist
(`ConstraintVerbalizer.ts:75` and `elementDiff.ts:183`, value-returning
no-default switches; the `Record<Union, T>` tables in `learn` and
`NormaXmlWriter`) are guarded by accident of shape, not by convention.

## Class B -- copies that have already diverged

Proof of the class, ranked by blast radius.

### B1. The default extraction prompt has fallen behind the variants it is the fallback for

The ORM extraction instructions exist in four copies: the default
artifact literal (`packages/llm/src/prompt/systemPrompt.ts:10-160`),
the two YAML variants (`packages/llm/prompts/extraction.{sonnet5,haiku45}.prompt.yaml`),
and the compiled `builtins.generated.ts`. The YAML-to-generated pair
is properly drift-tested (`builtins.test.ts:22`). The default is
guarded only by a golden test that pins it against a frozen fixture --
which asserts it never _changes_, not that it _agrees_ with anything.

It no longer agrees. Verified against `extraction.sonnet5.prompt.yaml`:
the default is missing the every-role instance rule ("Every instance
MUST supply a value for EVERY role"), the enumerated-list-is-a-
value-constraint rule, and the entire frequency-siding paragraph
(`systemPrompt.ts:108` truncates at "exactly 1 entry."; the variant
continues with the Shipment/Warehouse siding rule). Since
`selectArtifact` falls back to `defaultExtractionArtifact` for any
client with no matching variant, this is the **live prompt for
OpenAI, Ollama, and any Anthropic model not matching a variant** --
those runs are instructed without rules the conformance layer
downstream enforces, and nothing reports it.

Verdict: **diverged**, a live behavioral bug. Remediation is a
decision, not just a sync: either the default is regenerated from a
YAML source like every variant (removing the fourth copy), or the
divergence is intended model-tiering and must be stated in
`packages/llm/CLAUDE.md`.

### B2. SQL type to conceptual type: three mappings, two live, already disagreeing

- `packages/formats/src/ddl/DdlImportFormat.ts:485-525` -- regex
  chain, live. Maps `TIMESTAMP` to `"datetime"` (line 511-512).
- `packages/dbt/src/dbtMapping/naming.ts:11-41` -- lookup table, live.
  Maps `timestamp` to `"timestamp"` (line 32).
- `packages/formats/src/sql/SqlImportFormat.ts:99-114` -- `_mapSqlType`,
  **dead** (zero references), sitting as a third opinion for the next
  reader to consult.

The same `TIMESTAMP` column imported through the DDL path and the dbt
path yields a different `data_type` in the `.orm.yaml`, and therefore
different re-exported DDL. Further spread: `DdlImportFormat` matches
`CHARACTER` and maps `SERIAL|AUTOINCREMENT|IDENTITY` to
`auto_counter`; the dead copy has neither; `naming.ts` alone knows
`character varying` and the `timestamp_ntz/ltz/tz` family.

Verdict: **diverged**, live bug. One mapping (per-dialect where
needed) with the connector packages consuming it, or a parity test
over the shared subset; delete `_mapSqlType` either way.

### B3. Which directories are not dbt source: three lists, one walks into `target/`

`packages/dbt/src/DbtImportFormat.ts:53-59` skips `node_modules`,
`.git`, `target`, `dbt_packages`, `logs`.
`packages/dbt/src/DbtSqlCompiler.ts:190` (`findSqlFiles`) skips only
`node_modules`, `.git`, `dbt_packages` -- so the `.sql` walk of the
same project root during the same import descends into `target/`,
where dbt writes its _compiled_ SQL, and into `logs/`. Compiled
artifacts get mined as if they were sources.
`packages/formats/src/sql/SqlImportFormat.ts:80-84` is a third list
(no `dbt_packages`), defensible for a generic SQL tree but part of the
same unshared decision.

Verdict: **diverged**, live bug in the dbt import path.

### B4. Does a constraint keyword match: two answers inside core

`packages/core/src/query/evaluate.ts:502-505` answers with an open
substring rule; `packages/core/src/describe/describers.ts:263-` with a
closed whitelist of ~9 hard-coded keywords. `query_model` and
`describe_domain` disagree for any keyword outside the whitelist --
one matches, the other silently matches nothing. Same package, same
conceptual vocabulary, no shared function, no test.

Verdict: **diverged**.

### B5. The import-format list: the registry knows eight, the CLI says three

`packages/cli/src/commands/import/model.ts:12` (help) and `:35`
(error text) advertise `ddl, openapi, norma`. The call site already
resolves through `getImporter`, whose registry holds at least eight
(`+ dbt, sql, typescript, java, kotlin`); `barwise import model
--format dbt` works today, undiscoverable, and the failure text lies.
The same list is restated five more times -- MCP `z.enum` + prose +
error (`packages/mcp/src/tools/importModel.ts:43-81`), the VS Code
manifest enum (`packages/vscode/package.json:618-628`), and a TS union
(`packages/vscode/src/mcp/ToolRegistration.ts:109`). Registering a
ninth format updates none of the seven.

Verdict: **diverged** (CLI vs registry); the other six statements are
drift-prone restatements of a fact `listImporters()` already answers.

### B6. Export: three different file extensions for the same artifact, a closed enum, and a tool that does not exist

- Extension: `packages/mcp/src/tools/exportModel.ts:83-94` maps
  ddl to `.sql`; `packages/cli/src/commands/export.ts:165` uses the
  format _name_ (`.ddl`, `.openapi`); the VS Code export commands
  hardcode `.sql` and `.avsc`. `FormatDescriptor` has no extension
  field, so there is no shared answer to consult.
- `packages/vscode/package.json:493-501` closes the export enum at
  `["ddl","openapi","dbt","avro"]`, omitting `norma`, which the
  registry serves to CLI and MCP.
- `packages/mcp/src/tools/exportModel.ts:41,107` twice directs the
  caller to `list_formats` -- **no such tool is registered**. An agent
  that follows the error message calls a tool that is not there.
- The VS Code `Export{Ddl,Avro,Dbt}Command`s bypass the registry
  entirely and call the core renderers directly, so the extension's
  DDL has no dialect routing, no strict mode, no annotations, no
  population INSERTs -- same menu label as the CLI, materially
  different SQL. Possibly a deliberate product choice; nothing records
  it.

Verdict: **diverged**, plus one dangling reference that is an
outright bug.

### B7. Smaller diverged pairs, listed once each

- **`schema --format json` means two payloads.** CLI: a hand-written
  projection (`packages/cli/src/commands/schema.ts:33-48`); MCP and VS
  Code: `JSON.stringify` of the whole `RelationalSchema`
  (`packages/mcp/src/tools/schema.ts:42-47`). Same flag name, different
  document.
- **Repo-scan skip sets, five statements in `code-analysis`.** The two
  inline `SKIP` sets in `RepoProfiler.ts` (lines 321-330 and 376-384)
  are the same shape 50 lines apart and already disagree on `.venv`;
  `ContextAssembler` and `JvmContextAssembler` disagree on `dist`;
  `LanguageDetector.SKIP_DIRS` is a fifth list. Language-specific
  extension is defensible; the common core restated five times has
  already drifted.
- **`UTILITY_TYPES` between the two code importers.**
  `TypeScriptImportFormat.ts` (17 names, 2 suffixes) vs
  `jvmModelBuilder.ts` (27 names, 9 suffixes); the shared core is one
  decision written twice.
- **Gym catalog entry shape.** MCP adds `brief` and `reading` to the
  JSON entry; the CLI does not
  (`packages/cli/src/commands/gym.ts:71-77`,
  `packages/mcp/src/tools/gym.ts:59-67`).
- **The unknown-domain guard.** Three copies of
  `project has no domain "X". Available: ...`; the copy in
  `packages/cli/src/commands/diagram.ts:75-78` lacks the `"(none)"`
  fallback the other two have -- the precedent spec's
  guard-string-duplicated-verbatim shape, drift already begun.
- **`info` diagnostics are visible only in VS Code.**
  `ValidateModelCommand.ts:97-117` surfaces `severity === "info"`;
  the CLI and MCP validate paths never do. Nothing says which is
  intended.
- **Format descriptions stated twice per format**, three pairs already
  differing (adapter `description` vs registry `FormatDescriptor`).
  Benign payload (help text); noted, not actioned.

### B8. Prose that restates code, already wrong

The full inventory is in pass 3's nature; the entries that misdirect
rather than merely lag:

- `docs/ARCHITECTURE.md` is mandated reading ("Read ... before making
  any changes", root `CLAUDE.md:96`) and describes a three-package
  repo with "no NORMA compatibility" as a non-goal -- NORMA is a
  shipped bidirectional format. Either it becomes a dated historical
  record or the pointer softens.
- The aggregator `CLAUDE.md`s (`cli`, `mcp`, `vscode`, `llm`)
  understate their dependency lists (3 stated vs 8-9 actual), list
  half their command/tool files, and `vscode/CLAUDE.md:31-36`
  documents command IDs under an `orm.` prefix the extension
  abandoned. The leaf packages' files are accurate -- the rot
  concentrates exactly where the fan-in is.
- Root `CLAUDE.md:114` carries a fifth hand-maintained copy of the CLI
  command list (9 of 19 commands), contradicting the capability matrix
  80 lines below it.
- `AGENTS.md` holds two copies of the session-completion procedure
  that disagree (`bd sync` at :38 vs `bd dolt push` at :85 and in root
  `CLAUDE.md:289`); the hand-written copy sits above a generated block
  that will be overwritten, so the divergence is structurally
  permanent until the duplicate is deleted.
- `packages/promptlab/CLAUDE.md:37` lists `history.jsonl (checked-in
  record)`; `docs/local-eval-runbook.md:17` states outright that the
  file does not exist. Two standing docs in direct contradiction.
- `README.md` describes the four-package era; `docs/MCP.md` documents
  8 of 17 tools; `docs/CLI.md` documents 12 of 19 commands.

## Class C -- identical today, must agree, nothing checks

Each of these is one drift away from being a class-B entry. Byte
identity was verified (checksum or diff) where stated.

| #   | Decision                                                                                                                                                                                              | Copies                                                                                                                                    | Today                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | sqlglot sidecar program + cascade semantics                                                                                                                                                           | `packages/{formats,dbt}/src/**/SqlglotBridge.ts`                                                                                          | identical minus docblock (~280 lines); parallelism is declared deliberate, but the embedded Python `SIDECAR_PROGRAM` and `normalizeCascadeResult` are a shared promise ("same SQL parses the same way whichever connector asks") with no parity test. `DIALECT_MAP` alone is guarded (`Record<SqlDialect, string>` in both). |
| C2  | PascalCase naming for exported schema/record names                                                                                                                                                    | `core/src/mapping/renderers/{avro,openapi}.ts` vs `formats/src/{avro,openapi}/*ExportFormat.ts` (+5 more copies)                          | identical; the two cross-package pairs each carry a `Must match the toPascalCase in ...` comment -- a comment is not a check. Misalignment breaks name agreement between core's mapper and the exporters silently.                                                                                                           |
| C3  | SQL identifier quoting                                                                                                                                                                                | `core/src/mapping/renderers/ddl.ts:92` and `core/src/export/populationRenderer.ts:186`                                                    | byte-identical, comment included; DDL `CREATE TABLE` and its own population `INSERT`s must quote identically or the INSERTs target tables the DDL never created. Same package -- no orthogonality argument.                                                                                                                  |
| C4  | UUIDv7 ambient generator (monotonic counter + random splice)                                                                                                                                          | `cli`, `mcp`, `vscode` `idGenerator.ts`                                                                                                   | byte-identical (matching checksums); ids from all three surfaces land in the same model files and must sort consistently.                                                                                                                                                                                                    |
| C5  | Non-interactive merge acceptance (`added`\|\|`modified`)                                                                                                                                              | `cli/commands/merge.ts:65`, `mcp/tools/merge.ts:73`, `cli/commands/import/transcript.ts:102`, `vscode/.../ImportTranscriptCommand.ts:331` | identical; the CLI copy's comment says "matching the MCP tool" -- agreement by construction, in prose. Core takes the acceptance set as a parameter and exports no builder. A new `ModelDelta.kind` makes four surfaces disagree about what merges.                                                                          |
| C6  | Review-result markdown rendering                                                                                                                                                                      | `mcp/tools/review.ts:85-120` vs `vscode/.../ToolRegistration.ts:241-280`                                                                  | identical line-for-line (VS Code inlined it because it needed a different LLM client); only the MCP copy is tested. The CLI's plain-text renderer is a deliberate, benign third shape.                                                                                                                                       |
| C7  | Alternative-framing diff summary                                                                                                                                                                      | `cli/commands/import/shared.ts:39` vs `mcp/tools/import.ts:134`                                                                           | `summarizeDiff` character-identical, quirks included.                                                                                                                                                                                                                                                                        |
| C8  | `analyze` extraction scope rule                                                                                                                                                                       | `cli/commands/analyze.ts:36-56` vs `mcp/tools/analyze.ts:122-141`                                                                         | identical (the one-domain-path-narrows-scope rule); divergence changes _which files the model is built from_, silently. Neither copy lives in `code-analysis`, which owns the domain.                                                                                                                                        |
| C9  | Diff delta wire projection                                                                                                                                                                            | `cli/commands/diff.ts:35-43` vs `mcp/tools/diff.ts:38-46`                                                                                 | identical five-field map incl. the `definition ? term : name` rule.                                                                                                                                                                                                                                                          |
| C10 | CLI import result reporting + exit-code policy                                                                                                                                                        | five files under `cli/commands/import/`                                                                                                   | ~22 identical lines each; `import/shared.ts` exists in the same directory and never received this.                                                                                                                                                                                                                           |
| C11 | Export strict/annotate preamble                                                                                                                                                                       | five adapters across `formats` and `dbt`                                                                                                  | identical `annotate ?? true` / `strict ?? false` / validate / same error string -- the `ExportFormatAdapter` contract restated by every implementer; a new adapter that forgets it silently exports invalid models under `--strict`.                                                                                         |
| C12 | Smaller: counterexample renderer (`cli/workspace/format.ts:66` vs `mcp/tools/verbalize.ts:158`), lineage `readManifest` + the MCP-only `process.cwd()` fallback, `deltaLabel` x3 (two in one package) | --                                                                                                                                        | identical or near; low individual stakes, same shape.                                                                                                                                                                                                                                                                        |

Deliberate-and-fine, for contrast: `projectLoader` (cli/mcp) and the
`SqlglotBridge` file pairing itself both document the parallelism
in-place with the DRY-secondary argument. The gap in both cases is
only the missing check, not the missing abstraction.

## Class D -- vocabulary unions restated without a guard

Core's string-literal unions are the shared vocabulary of the whole
system; downstream packages restate their membership as zod enums,
JSON-schema enums, `Set`s, lookup tables, and prose. A `Set<Union>` or
`readonly Union[]` annotation proves _membership_ (every listed entry
is valid), never _completeness_ (every member is listed) -- so every
one of these accepts a new union member being silently absent.

- **`RingType` (8 members).** Restated in `NormaXmlTypes.ts:429`
  (independent union), `llm/parse/helpers.ts:32` (membership set),
  `llm/prompt/responseSchema.ts:154` (bare enum), the diagram
  abbreviation table (`GraphTypes.ts:54`), and prompt prose. Worst
  copy: `NormaXmlParser.ts:1141` -- `return map[lower] ?? "irreflexive"`
  **silently rewrites an unrecognized ring type to `irreflexive`** on
  NORMA import. The validation switch (`rules/population/ring.ts:67`)
  and `CounterexampleGenerator.ts:224` are structurally unguarded (void
  loop body; explicit `default`). A ninth ring type would be: dropped
  by NORMA round-trip, rejected by the LLM parser, unvalidated, and
  undrawn -- with zero build errors.
- **Constraint kinds (16 members).** Guarded consumers exist and prove
  the pattern works (`ConstraintVerbalizer.ts:75`,
  `elementDiff.ts:183`, `learn`'s `Record<ConstraintKind, ...>`).
  Unguarded: `diagram/graph/ModelToGraph.ts:287` draws 6 of 16 --
  the five join/comparison/cardinality constraints are silently not
  drawn today, and the trailing comment accounting for the gap does
  not mention them; `lineage/generate.ts:263` widens the param to
  `{ type: string }` and five existing types already fall to its
  generic default label.
- **`InferredConstraintType` (11 members, llm).** Union, JSON-schema
  enum, and a test's `ALL` array -- and the test
  (`ConstraintCorrespondence.test.ts:401`) exists precisely to catch
  "a new constraint type with no conformance rule" but its `ALL` is
  membership-typed, so the guard is itself unguarded: a 12th member
  leaves `ALL` at 11 and the sweep passes.
- **`ConceptualDataTypeName` (14 members).** Membership set +
  bare enum + prompt prose; `RelationalMapper.ts:614`'s
  `default: return "TEXT"` silently degrades any 15th type in every
  DDL export.
- **`SqlDialect` (7 members).** Two `Record<SqlDialect, string>` maps
  are guarded (both in the SqlglotBridge pair); the MCP zod enum, two
  CLI help strings, a doc comment, and two string-keyed detection maps
  are not. `DbtDialectDetector.ts:27` still calls them "Calcite SQL
  dialects" -- a stale name from a removed design, itself evidence the
  copy drifted unnoticed.
- **Gym check kinds (4 members).** Restated in `learn` twice (one with
  no type link) and a third time across the package boundary in
  `promptlab/src/evalcase/loadSuite.ts:17` -- which imports the type
  and then does not derive the array from it. A fifth check kind makes
  promptlab silently reject every suite case using it.
- **LLM provider names (3 members).** The `ProviderName` type has no
  exported runtime array; five CLI help strings and two MCP zod enums
  restate it. Adding a provider compiles clean while both enums reject
  it at runtime and five help texts lie.

## Class E -- derived artifacts and version sync

Beyond A2 (`examples/output/`):

- **`gym-exercise.schema.json`** restates `learn`'s exercise contract
  (types + parser) by hand; its only consumer is an editor modeline.
  Nothing validates against it, nothing regenerates it.
- **`orm-model.schema.json` vs the TS document types vs
  `splitModel.ts`'s "loose mirror".** Guarded only by consequence
  (deserialization validates against the schema, so divergence
  surfaces _for constructs the examples corpus exercises_). Noted:
  `splitModel.ts:340` hardcodes `orm_version: doc.orm_version ?? "1.0"`
  while the current version is `1.1`.
- **VS Code manifest.** The `languageModelTools` schemas restate tool
  contracts with no type-check against anything (where findings B5/B6
  bite), and `contributes.commands` (11) disagrees with registered
  commands (12): `barwise.loadView` is registered but not contributed.
  Nothing records whether that is intended.
- **Version sync.** `SERVER_VERSION` is guarded narrowly (against
  mcp's own package.json, not the root); the tutorial stamp is
  guarded; monorepo-wide version equality across the 13 package.json
  files is asserted by nothing; `CURRENT_ORM_VERSION` vs the schema's
  `"const": "1.1"` is guarded by consequence only.
- **The llm prompt goldens** are the only golden family with no
  `UPDATE_GOLDEN` regeneration path (deliberate, but the deliberateness
  lives in a comment).

## Negative results

Recorded so the next sweep can skip them, and because a sweep that
only reports hits gives no sense of its coverage.

- **The parity spec's own findings are closed.** Verified post-merge:
  `TranscriptProcessor.ts:109` and `reviewModel.ts:317` both resolve
  through `selectArtifact`; the "Both LLM surfaces resolve their
  prompt the same way" sentence in `packages/llm/CLAUDE.md` is now
  true _by shared code_, which is the remediation template this audit
  points at. (Residual: "Both" is a count welded to the two-member
  `PromptSurface` union; a third surface makes the sentence silently
  false. Known shape, low frequency.)
- **The capability matrix is accurate**, third verification in a row;
  zero commits have touched the surface registrations since the
  2026-08-25 audit.
- **Twelve of fourteen VS Code LM tools call the MCP executors** --
  one implementation, genuinely shared. The two exceptions (transcript
  import, review) exist only because they need the Copilot client,
  and are findings C6/C5.
- **The guarded-regeneration pattern works everywhere it was
  implemented**: `builtins.generated.ts` (drift test verified),
  `docs/tutorial/` (byte-compare verified), promptlab train references
  -- the 2026-08-25 audit's finding 1 is **fixed**
  (`scripts/regen-references.mjs` now automates the documented
  procedure and shares its renderer with the drift test so script and
  guard cannot disagree; the model implementation of this class).
- **Single-sourced and clean**: YAML serialization
  (`OrmYamlSerializer`), diagnostic severity ordering (one
  `Record<DiagnosticSeverity, number>`), validation `ruleId` strings
  (contained in core, consumed by prefix only), the query DSL
  (`QUERY_COMMANDS` shared and derived from), MCP's `sourceInputSchema`
  (one definition of the source union for all tools -- exemplary),
  `slugifyModel`, file-extension predicates (predicates, never
  competing maps), provider default models (each stated once).
- **No same-default-different-value case** was found for
  resolve-or-default shapes -- the class barwise-850 belonged to has
  not recurred.
- **Most leaf-package CLAUDE.md files are accurate** (diagram,
  diagram-ui, code-analysis, dbt, formats, learn, core's subpath
  list); the doc rot concentrates in the aggregators.
- **Broken-path sweep across all docs and skills**: three hits total,
  all named in B8/A1.

## What this sweep cannot see

- Two implementations that agree on bytes but not on behavior for
  inputs neither test exercises -- parity of the SqlglotBridge pair or
  the id generators is asserted here on source identity, which a
  byte-level check can hold but only a behavioral test can prove.
- Semantic clones with no token overlap. The shape hunts caught
  several (B2, B4); there is no reason to think they caught all.
- Duplication against an external system's semantics (NORMA's own
  interpretation of ring types, dbt's project layout rules).
- Agreement between prompt prose and the conformance code that
  enforces it -- pass 2 verified the vocabulary lists match today, but
  the _rules_ stated in prose (frequency siding, identifier
  constraints) have no mechanical tie to `ExtractionConformance`.
- Anything whose copies live outside `src` and docs (CI workflow
  duplication was not swept).

## The invariant worth enforcing

The 2026-08-25 audit distilled "every declared capability has a
consumer, and every fallback says it fell back." This sweep adds the
sibling:

> **A decision stated twice is owned once: every must-agree pair
> carries a mechanical check -- a shared owner, a derivation from one
> authority, or a drift test. A "must match" comment is not a check.**

Both C2 comments, C5's "matching the MCP tool", and the four citations
of A2's nonexistent drift test are the same failure: the author knew
the copies had to agree, wrote the knowledge down as prose, and prose
checks nothing. The remediation hierarchy (share, derive, check, guard
the union -- in that order, with orthogonality deciding when the first
two are off the table) and the mechanism that keeps future work honest
are designed in `docs/specs/duplication-drift-guards.spec.md`. The
method for re-running this sweep is carried in
`.claude/skills/duplication-audit/`.

## Follow-up index

`bd` is unavailable in this container; these are the issue-shaped
items, for filing when it is back. Ordered by the audit's ranking, not
by effort.

1. Fix the depcruise subpath blindness; correct the two graph copies
   (A1). Everything else's verification story depends on it.
2. Reconcile the extraction default with the variants, or declare the
   divergence (B1). Live behavioral bug.
3. One SQL-type mapping; delete `_mapSqlType` (B2). Live bug.
4. Share the dbt walk skip-list; stop mining `target/` (B3). Live bug.
5. One `matchesConstraintType` (B4).
6. Derive format lists/help/enums from the registry; add `extension`
   to `FormatDescriptor`; register or un-reference `list_formats`;
   decide the VS Code export-command bypass (B5, B6).
7. Seed the parity manifest with C1-C11; add the examples/output
   drift test and collapse its regenerators (A2); guard the union
   restatements (D) behind `assertNever`/derivation.
8. Docs: dedupe `AGENTS.md`, re-date or rewrite `ARCHITECTURE.md`,
   regenerate the aggregator dependency tables, fix
   `promptlab/CLAUDE.md`'s `history.jsonl` claim, complete or trim
   `docs/MCP.md` and `docs/CLI.md` (B8).
