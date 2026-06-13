# Connector I/O Migration: Restore Determinism in Core

Status: Draft for review (design only -- no implementation in this PR)
Tracking: REPO_REVIEW-2026-06.md finding #2

## Principle

"Determinism in the core" is a stated design pillar: core has no file
I/O, no `process.env`, no clocks, no subprocesses. I/O belongs one layer
out -- either in a **connector package** (the `@barwise/code-analysis`
template) that registers importers into the `FormatDescriptor` registry,
or in the **tool layer** (`cli`, `mcp`, `vscode`).

The violations below are pre-connector leftovers from early work, not a
question of whether the principle is right. `@barwise/code-analysis`
already proves the shape: it is a directory-scanning importer that lives
outside core, does its own file/LSP I/O, and registers via
`registerCodeFormats()`. The dbt/sql importers should follow it.

## Inventory

The `ImportFormat` interface already encodes the boundary: `"text"`
formats receive file **content** and are pure; `"directory"` formats
receive a **path** and scan the filesystem. The pure ones are fine where
they are; the filesystem ones are misplaced.

| Module                                          | I/O                                      | Verdict                                    |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `DdlImportFormat`, `NormaImportFormat`, OpenAPI | none (text)                              | pure -- stays in core                      |
| `DbtImportFormat` (`directory`)                 | scans a dbt project dir                  | move to connector                          |
| `DbtProjectImporter`                            | fs over content parse                    | move to connector                          |
| `DbtSqlCompiler`                                | spawns `dbt compile`                     | move to connector                          |
| `DbtDialectDetector`                            | `process.env` + `profiles.yml`           | connector; env as options                  |
| `SqlImportFormat`                               | `parse()` pure; `parseAsync()` scans dir | keep pure parse, move dir scan             |
| `lineage/manifest`                              | `readManifest`/`writeManifest`           | read/write -> tool layer; logic stays pure |
| `lineage/resolveArtifact`                       | `existsSync` + traversal                 | move to tool layer                         |
| `serialization/ProjectLoader`                   | walks/reads project files                | fs walk -> tool layer; assembly stays pure |

`hashModel` (uses `node:crypto` hashing) is deterministic and pure --
hashing is not I/O and stays.

## Target architecture

```
@barwise/core
  - ImportFormat / FormatDescriptor interfaces (unchanged)
  - pure text formats: ddl, openapi, norma
  - pure SQL parse(content) (no directory scan)
  - pure lineage logic: hashModel, updateManifest, staleness, impact
  - pure project assembly from already-read domain contents
  (no fs, no process.env, no subprocess)

@barwise/dbt  (NEW connector package, modeled on @barwise/code-analysis)
  - DbtImportFormat, DbtProjectImporter, DbtSqlCompiler,
    DbtDialectDetector, the directory path of SQL import
  - owns its fs + subprocess I/O
  - registerDbtFormats() registers into the core registry at tool startup

tool layer (cli / mcp / vscode)
  - reads/writes the lineage manifest (calls pure core lineage logic)
  - walks the filesystem for project + domain files, hands content to
    core's project assembly
  - reads env (DBT_TARGET_TYPE, etc.) and passes it as explicit options
  - calls registerBuiltinFormats() + registerCodeFormats() +
    registerDbtFormats() at startup
```

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first so value lands incrementally and no
single PR is a big-bang.

### 1. `DbtDialectDetector`: env -> explicit options

Replace `process.env["DBT_TARGET_TYPE"]` / `DBT_ADAPTER` / `HOME` reads
with fields on an explicit options object supplied by the caller. The
tool layer reads the environment and passes it in. This is the smallest,
most isolated determinism fix and can land before the package move.

### 2. Lineage manifest I/O -> tool layer

Move `readManifest`/`writeManifest`/`resolveArtifact` (fs) out of
`core/lineage` into the CLI/MCP lineage commands. Core keeps `hashModel`,
`updateManifest`, `staleness`, and `impact` as pure functions that take a
manifest object. The CLI `lineage` command becomes: read manifest (tool)
-> compute (core) -> write manifest (tool).

### 3. ProjectLoader fs -> tool layer

Split `loadProject(path)` into (a) a tool-layer walk that finds and reads
the `.orm-project.yaml` manifest and each domain/mapping file, and (b) a
pure core assembler that builds the `OrmProject` from the already-read
contents (reusing the existing serializers). Update the CLI `validate`
and `diagram` commands.

### 4. `@barwise/dbt` connector package (the bulk)

Create the package, move the dbt/sql directory importers and the SQL
directory-scan path into it, give it `registerDbtFormats()`, and register
it from cli/mcp/vscode at startup -- exactly as `registerCodeFormats()`
is wired today. Core retains the pure SQL `parse(content)` and the
generic interface. `DbtSqlCompiler`'s `dbt compile` subprocess naturally
belongs here.

## API and migration impact

- Public barrel exports move: `importDbtProject`, `detectDbtDialect`, and
  the dbt/sql `ImportFormat` classes leave `@barwise/core` for
  `@barwise/dbt`; `loadProject` is reshaped. Every downstream import
  (`cli`, `mcp`, `vscode`) updates -- the one-way dependency graph makes
  the blast radius explicit and the build will surface every site.
- Format registration: tools must call `registerDbtFormats()` at startup.
  A format absent from the registry currently yields a clear "unknown
  format" error, so a missed registration fails loudly, not silently.
- The dependency graph in CLAUDE.md gains `@barwise/dbt` as a second
  connector package alongside `@barwise/code-analysis`.

## Open decisions (for review)

- **Package name/scope.** `@barwise/dbt` vs a broader `@barwise/connectors`
  that could also house future warehouse/SQL connectors. Does SQL import
  live with dbt or in its own connector?
- **dbt export.** `DbtExportFormat` (model -> text) is pure and could stay
  in core, but cohesion argues for the connector owning the whole `dbt`
  `FormatDescriptor`. Pick one.
- **ProjectLoader shape.** A pure assembler + tool-layer walk, vs moving
  the whole loader to the tool layer.

## Risks and testing

- Behavior must not change: the same models import, the same manifests
  round-trip. Existing import/lineage/project tests move with their code
  and must stay green; add connector-package tests mirroring
  `@barwise/code-analysis`.
- Do the workstreams as separate PRs; each keeps the full suite green.
  Run the whole monorepo build after each (core API changes ripple).
- The CLI `examples/` validation step (added in PR #103) and the dbt
  import example guard against regressions end to end.

## Non-goals

- No new import capabilities; this is a relocation, not a feature.
- The `ImportFormat` interface itself does not change.
