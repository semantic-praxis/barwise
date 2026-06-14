# Connector I/O Migration: Restore Determinism in Core

Status: Workstreams 1-4 landed; workstream 5 specified and ready
Tracking: REPO_REVIEW-2026-06.md finding #2

## Principle

"Determinism in the core" is a stated design pillar: core has no file
I/O, no `process.env`, no clocks, no subprocesses. I/O belongs one layer
out -- either in a **connector package** (the `@barwise/code-analysis`
template) that registers importers into the `FormatDescriptor` registry,
or in the **tool layer** (`cli`, `mcp`, `vscode`).

The I/O violations below are pre-connector leftovers from early work.
`@barwise/code-analysis` already proves the shape: a directory-scanning
importer that lives outside core, owns its file/LSP I/O, and registers
via `registerCodeFormats()`. The dbt/sql importers should follow it.

## Should all formats be pluggable? (resolved: yes)

Fixing the I/O violations alone would leave an asymmetry: the dbt/sql
importers move out, but the pure text formats (ddl, openapi, norma,
avro) stay baked into core as "builtins". That split is an accident of
history, not a principled line -- and orthogonality is a primary project
principle, ranked above DRY.

The resolving observation: **no interop format is mandatory to core.**
Core's job -- metamodel, validation, verbalization, relational mapping,
and the native `.orm.yaml` serialization -- needs none of them. Every
import/export format is an optional capability behind the registry. So
they can all plug in uniformly, and core should ship **no interop format
at all**: only the registry, the format interfaces, and the native
`.orm.yaml`. The two-tier "builtin vs connector" distinction disappears,
replaced by one rule: formats register from outside core.

Two refinements keep this honest:

- **The native `.orm.yaml` is not an interop format.** It is the
  canonical persistence and stays in core, along with its JSON Schema.
  "All formats pluggable" governs the interop set (ddl, openapi, norma,
  avro, dbt, sql, code), not the native serializer.
- **The export descriptors are thin wrappers over core capabilities.**
  `DdlExportFormat`, `OpenApiExportFormat`, and `AvroExportFormat` all
  wrap core's `RelationalMapper` and renderers (`renderDdl`,
  `renderOpenApi`, `renderAvro`) -- that mapping logic _is_ core domain.
  Pluggability is about the **registration/descriptor boundary**, not
  relocating logic: the formats package owns the descriptor and calls
  back into core for the capability, as `code-analysis` depends on core
  for model types. The importers (norma XML, SQL `parse`) are
  self-contained and move whole.

This makes the dbt migration one instance of a general rule rather than
a one-off carve-out. The cost is honest: relocating the standard
descriptors is orthogonality polish, not a correctness need (they
violate nothing), and core alone can no longer import or export until a
formats package is registered -- irrelevant for this private monorepo, a
minor ergonomic for any future external consumer of `@barwise/core`.
Whether that polish earns a near-empty package is the workstream-5 open
decision below.

## Inventory

The `ImportFormat` interface already encodes the I/O boundary: `"text"`
formats receive file **content** and are pure; `"directory"` formats
receive a **path** and scan the filesystem. The filesystem/subprocess
formats must relocate to stop violating determinism; the pure formats
relocate too, for uniformity.

| Module                              | I/O                                      | Verdict                                |
| ----------------------------------- | ---------------------------------------- | -------------------------------------- |
| ddl / openapi / norma / avro (pure) | none (text)                              | relocate to `@barwise/formats`         |
| `DbtImportFormat` (`directory`)     | scans a dbt project dir                  | move to `@barwise/dbt`                 |
| `DbtProjectImporter`                | pure (parses content)                    | `@barwise/dbt` for cohesion            |
| `DbtSqlCompiler`                    | spawns `dbt compile`                     | move to `@barwise/dbt`                 |
| `DbtDialectDetector`                | reads `profiles.yml` (env: PR #112)      | move to `@barwise/dbt`                 |
| `SqlImportFormat`                   | `parse()` pure; `parseAsync()` scans dir | move whole to `@barwise/formats`       |
| `lineage/manifest`                  | `readManifest`/`writeManifest`           | read/write -> tool layer; logic pure   |
| `lineage/impact`, `staleness`       | read the manifest via `readManifest`     | signature -> manifest arg; pure        |
| `lineage/resolveArtifact`           | `existsSync` + traversal                 | pure match in core; walk -> tool layer |
| `serialization/ProjectLoader`       | walks/reads project files                | fs walk -> tool layer; assembly pure   |
| `OrmProject.ExportFormat`           | hardcodes format names                   | -> registered-name `string`            |

`hashModel` (uses `node:crypto` hashing) is deterministic and pure --
hashing is not I/O and stays. The relational-mapping capability
(`RelationalMapper`, `renderDdl`/`renderOpenApi`/`renderAvro`) is core
domain logic and stays; the export descriptors that wrap it relocate as
thin shells.

## Target architecture

```
@barwise/core           (ships NO interop format)
  - FormatDescriptor / ImportFormat / ExportFormatAdapter interfaces
  - the format registry
  - native .orm.yaml serialization + JSON Schema
  - domain capabilities the descriptors wrap (RelationalMapper,
    renderDdl / renderOpenApi / renderAvro)
  - pure lineage logic: hashModel, updateManifest, staleness, impact
  - pure project assembly from already-read domain contents
  (no fs, no process.env, no subprocess)

@barwise/formats        (NEW: standard interop descriptors)
  - ddl / openapi: importer + thin export shell over core renderers
  - avro: thin export shell; norma: importer + its XML cluster
  - sql: importer (whole, fs included -- allowed outside core)
  - registerStandardFormats()

@barwise/dbt            (NEW: warehouse connectors, the I/O ones)
  - the whole dbt FormatDescriptor: DbtImportFormat + DbtExportFormat,
    plus DbtProjectImporter, DbtSqlCompiler, DbtDialectDetector, and
    the dbt schema parser / mapper / report / annotator helpers
  - depends on core for parseSqlFile and renderDbt
  - owns its fs + subprocess I/O
  - registerDbtFormats()

@barwise/code-analysis  (EXISTS: code connectors)
  - registerCodeFormats()

tool layer (cli / mcp / vscode)
  - registerStandardFormats() + registerDbtFormats() + registerCodeFormats()
  - reads/writes the lineage manifest (calls pure core lineage logic)
  - walks the filesystem for project + domain files, hands content to
    core's project assembly
  - reads env (DBT_TARGET_TYPE, etc.) and passes it as explicit options
```

`registerBuiltinFormats()` (today, in core) is retired: there are no
builtins. Each format package exposes its own `register*Formats()`, and
the tool layer composes them.

## Workstreams (each independently shippable)

Correctness-driven determinism fixes first (smallest blast radius
first), then the orthogonality relocation. Each lands as its own PR and
keeps the full suite green.

### 1. `DbtDialectDetector`: env -> explicit options (done: PR #112)

Replace `process.env["DBT_TARGET_TYPE"]` / `DBT_ADAPTER` / `HOME` reads
with fields on an explicit options object supplied by the caller. The
tool layer reads the environment and passes it in. The smallest, most
isolated determinism fix; lands before any package move.

### 2. Lineage manifest I/O -> tool layer (done)

Make core's lineage layer pure and move the filesystem to the tool
layer. This is larger than first briefed: besides `updateManifest`,
both `analyzeImpact` and `checkStaleness` take a `dir` and read the
manifest via `readManifest`. So three public signatures change from a
`dir` to a manifest object:

- `updateManifest(dir, entry, existing?)` -> `updateManifest(entry, existing?)` (pure merge).
- `analyzeImpact(dir, elementId)` -> `analyzeImpact(manifest, elementId)`.
- `checkStaleness(dir, model)` -> `checkStaleness(manifest, model)`.

Core also loses `readManifest`, `writeManifest`, `resolveArtifact`, and
`findOrmModel`. `resolveArtifact` splits: the pure path match stays in
core (e.g. `resolveArtifactInManifest(manifest, path)`); the
parent-directory walk moves to the tool layer. `hashModel` and the YAML
serialize/parse of the manifest stay (pure).

The tool layer (cli and mcp) gains thin fs wrappers -- read manifest,
write manifest, walk for the artifact -- over the pure core helpers. The
CLI `lineage` and `export` commands and the mcp `lineageStatus`,
`impactAnalysis`, and `describeDomain` tools rewire to: read (tool) ->
compute (core) -> write (tool).

This is the largest determinism workstream and does not split cleanly:
every caller depends on `readManifest`, so it leaves core in one step.

### 3. ProjectLoader fs -> tool layer (done)

`loadProject(manifestPath)` reads the `.orm-project.yaml` manifest and
then each domain and mapping file it references. Split it: a pure core
assembler builds the `OrmProject` from already-read contents (reusing
the existing serializers and collecting parse problems), and a
tool-layer walk in the CLI reads the manifest plus the domain and
mapping files. The CLI `validate` and `diagram` commands -- the only
production callers (not mcp, not vscode) -- move to the tool-layer
loader.

The whole-loader-to-cli alternative is ruled out: core's own
`splitModel.test` round-trips a split through `loadProject`, so the load
capability cannot leave core. The pure assembler serves both that test
(in-memory contents) and the CLI loader (contents read from disk).
`LoadedProject.problems` merges the tool's read errors with the
assembler's parse errors.

### 4. `@barwise/dbt` connector package (done)

Move the entire dbt connector out of core: the whole `dbt`
`FormatDescriptor` -- both `DbtImportFormat` and `DbtExportFormat` -- plus
its supporting modules (`DbtProjectImporter`, `DbtSqlCompiler`,
`DbtDialectDetector`, and the dbt schema parser, mapper, report, and YAML
annotator). The I/O violators move for determinism: `DbtImportFormat`
scans a project directory, `DbtSqlCompiler` spawns `dbt compile`, and
`DbtDialectDetector` still reads `profiles.yml` (workstream 1 removed only
its `process.env` reads). The pure helpers move with them for cohesion --
nothing in core's domain logic imports a dbt module; only `import/`,
`export/DbtExportFormat`, and the registry reference them.

The package depends on core for two capabilities it does not own:
`parseSqlFile` (the SQL cascade parser stays in core's pure `sql/`) and
`renderDbt` plus `DbtExportAnnotator` (the dbt rendering capability stays
in core's `mapping/`, like `renderDdl`). This is the descriptor boundary
again: the package owns the descriptor and calls back into core for the
capability.

Wire `registerDbtFormats()` from the tool layer exactly as
`registerCodeFormats()` is today -- at the cli `import`/`export`, mcp
`importModel`/`exportModel`, and vscode `ImportCodeCommand` startup sites.
Drop `dbtFormat` from core's `registerBuiltinFormats()` (which stays,
shrunk, until workstream 5), and move vscode `ImportDbtCommand`'s direct
`importDbtProject`/`annotateDbtYaml` imports to `@barwise/dbt` -- the only
tool-layer code that imports a dbt symbol directly rather than through the
registry.

SQL is not in this workstream. `SqlImportFormat` is generic, not
warehouse-specific, and moves whole to `@barwise/formats` in workstream 5.
This workstream removes the dbt filesystem and subprocess I/O from core;
the one I/O path left afterward is `SqlImportFormat`'s directory scan,
which leaves in workstream 5.

### 5. `@barwise/formats` package + retire builtins

Relocate the standard descriptors into a new `@barwise/formats` package
with `registerStandardFormats()`, and delete `registerBuiltinFormats()`
from core. What moves:

- Export shells: `DdlExportFormat`, `OpenApiExportFormat`,
  `AvroExportFormat` -- each wraps core's `RelationalMapper` and a
  renderer (`renderDdl` / `renderOpenApi` / `renderAvro`), the same shell
  pattern `DbtExportFormat` already follows in `@barwise/dbt`.
- Importers: `DdlImportFormat`, `OpenApiImportFormat`, `SqlImportFormat`
  (whole, fs included -- see SQL placement below), and
  `NormaImportFormat` with its self-contained XML cluster
  (`NormaXmlImporter`, `NormaXmlParser`, `NormaToOrmMapper`,
  `NormaXmlTypes`).

The rendering and parsing capabilities stay in core, and the relocated
descriptors call back into them: `RelationalMapper`, `renderDdl` /
`renderOpenApi` / `renderAvro`, `parseSqlFile`, and
`renderPopulationAsSql` (used by `DdlExportFormat` _and_ by core's own
`renderDdl`, so it stays in core and gains a public export). Only the
registry consumes these descriptors today, so the move is mechanical and
the build surfaces every site.

Also de-hardcode `OrmProject.ExportFormat` from `"dbt" | "ddl" | "avro"`
to a registered-name `string`, so the core metamodel no longer names
specific formats; `ProjectSerializer` reads and writes the name as a
plain string. This lands regardless.

This is the last workstream. With the standard set relocated, core ships
no interop format -- only the registry, the format interfaces, the native
`.orm.yaml`, and the renderers/parsers the descriptors wrap. At the tool
layer `registerBuiltinFormats()` becomes `registerStandardFormats()`,
composed with `registerDbtFormats()` and `registerCodeFormats()`.

## API and migration impact

- Public barrel exports move out of `@barwise/core`: `importDbtProject`,
  `detectDbtDialect`, and `DbtImportFormat` (to `@barwise/dbt`), and the
  standard format descriptors -- including `SqlImportFormat` (to
  `@barwise/formats`). `loadProject` is reshaped. Every downstream import
  (`cli`, `mcp`, `vscode`) updates -- the one-way dependency graph makes
  the blast radius explicit and the build surfaces every site.
- Lineage (workstream 2): three public functions change signature
  (`updateManifest`, `analyzeImpact`, `checkStaleness`, all `dir` ->
  manifest object) and four leave core (`readManifest`, `writeManifest`,
  `resolveArtifact`, `findOrmModel`). The cli `lineage`/`export` and mcp
  `lineageStatus`/`impactAnalysis`/`describeDomain` callers update.
- Registration: `registerBuiltinFormats()` is replaced by
  `registerStandardFormats()` + `registerDbtFormats()` +
  `registerCodeFormats()`, composed by each tool. A format absent from
  the registry already yields a clear "unknown format" error, so a missed
  registration fails loudly, not silently.
- The CLAUDE.md dependency graph gains `@barwise/formats` and
  `@barwise/dbt` as connector packages alongside `@barwise/code-analysis`,
  and the connector convention becomes the single rule for all formats.

## Open decisions (for review)

- **`@barwise/formats` go/no-go (workstream 5) (resolved: build it).**
  An earlier count undersold the package as "~3 thin shells plus two
  importers". The real set is ~11 source files -- 3 export shells, 4
  importers, and the 5-file Norma XML cluster -- comparable in size to
  `@barwise/dbt`. Workstream 4 proved the thin-shell move is mechanical
  and removed the determinism objection, so the only remaining argument
  for a core exception rested on that (false) near-empty premise. Keeping
  the standard descriptors in core would also re-create the two-tier
  builtin/connector split that the "all formats pluggable" section above
  resolved to remove. So the standard set relocates to `@barwise/formats`
  and core ships no interop format.
- **Lineage fs wrappers (workstream 2).** The thin read/write/walk
  wrappers are needed in both cli and mcp, which share no package.
  Duplicate them over the pure core helpers (the project tolerates small
  tool-layer duplication -- CLI `loadModel` vs MCP `resolveSource`), or
  add a shared tool-io helper (a new node in the graph)? Recommend
  duplicating: about 40 lines, no new package.
- **SQL placement (resolved: one package, `@barwise/formats`).**
  `SqlImportFormat` is one class whose pure `parse()` and fs `parseAsync()`
  share `buildModelFromPatterns`, so splitting it across packages would
  force duplicating or core-exporting that helper. fs is allowed outside
  core, so the whole class moves to `@barwise/formats` (workstream 5), the
  directory scan included. SQL is generic, not warehouse-specific, so it
  does not belong in `@barwise/dbt`.
- **dbt export (resolved: yes).** `DbtExportFormat` wraps core's
  `renderDbt`, so `@barwise/dbt` owns the whole `dbt` descriptor (import
  and export) while the renderer stays in core -- the same shell pattern
  as the ddl/openapi/avro exporters.

## Risks and testing

- Behavior must not change: the same models import/export, the same
  manifests round-trip. Existing import/lineage/project tests move with
  their code and stay green; add connector-package tests mirroring
  `@barwise/code-analysis`.
- Do the workstreams as separate PRs; each keeps the full suite green and
  runs the whole monorepo build (core API changes ripple).
- The CLI `examples/` validation step (PR #103) and the dbt import example
  guard against regressions end to end.

## Non-goals

- No new import/export capabilities; this is relocation, not features.
- The `ImportFormat` / `ExportFormatAdapter` interfaces do not change. The
  only metamodel change is `OrmProject.ExportFormat` becoming a `string`.
