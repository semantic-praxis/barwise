# Connector I/O Migration: Restore Determinism in Core

Status: Draft for review (design only -- no implementation in this PR)
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
- **Some descriptors are thin wrappers over core capabilities.**
  `DdlExportFormat` wraps core's `RelationalMapper` + `renderDdl()` --
  that mapping logic _is_ core domain. Pluggability is about the
  **registration/descriptor boundary**, not relocating all logic: a
  formats package owns the descriptor and calls back into core for the
  genuine capability, exactly as `code-analysis` depends on core for
  model types.

This makes the dbt migration one instance of a general rule rather than
a one-off carve-out. The cost is honest: relocating the pure formats is
orthogonality polish, not a correctness need (they violate nothing), and
core alone can no longer import or export until a formats package is
registered -- irrelevant for this private monorepo, a minor ergonomic
for any future external consumer of `@barwise/core`.

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
| `DbtProjectImporter`                | fs over content parse                    | move to `@barwise/dbt`                 |
| `DbtSqlCompiler`                    | spawns `dbt compile`                     | move to `@barwise/dbt`                 |
| `DbtDialectDetector`                | `process.env` + `profiles.yml`           | `@barwise/dbt`; env as options         |
| `SqlImportFormat`                   | `parse()` pure; `parseAsync()` scans dir | pure parse -> formats; dir scan -> dbt |
| `lineage/manifest`                  | `readManifest`/`writeManifest`           | read/write -> tool layer; logic pure   |
| `lineage/resolveArtifact`           | `existsSync` + traversal                 | move to tool layer                     |
| `serialization/ProjectLoader`       | walks/reads project files                | fs walk -> tool layer; assembly pure   |
| `OrmProject.ExportFormat`           | hardcodes format names                   | -> registered-name `string`            |

`hashModel` (uses `node:crypto` hashing) is deterministic and pure --
hashing is not I/O and stays. The DDL/relational-mapping capability
(`RelationalMapper`, `renderDdl`) is core domain logic and stays; only
the `ddl` descriptor that wraps it relocates.

## Target architecture

```
@barwise/core           (ships NO interop format)
  - FormatDescriptor / ImportFormat / ExportFormatAdapter interfaces
  - the format registry
  - native .orm.yaml serialization + JSON Schema
  - domain capabilities the descriptors wrap (relational mapping ->
    renderDdl, etc.)
  - pure lineage logic: hashModel, updateManifest, staleness, impact
  - pure project assembly from already-read domain contents
  (no fs, no process.env, no subprocess)

@barwise/formats        (NEW: standard interop descriptors)
  - ddl (wraps core mapping), openapi, norma, avro, pure SQL parse
  - registerStandardFormats()

@barwise/dbt            (NEW: warehouse connectors, the I/O ones)
  - DbtImportFormat, DbtProjectImporter, DbtSqlCompiler,
    DbtDialectDetector, the SQL directory-scan path
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

### 1. `DbtDialectDetector`: env -> explicit options

Replace `process.env["DBT_TARGET_TYPE"]` / `DBT_ADAPTER` / `HOME` reads
with fields on an explicit options object supplied by the caller. The
tool layer reads the environment and passes it in. The smallest, most
isolated determinism fix; lands before any package move.

### 2. Lineage manifest I/O -> tool layer

Move `readManifest`/`writeManifest`/`resolveArtifact` (fs) out of
`core/lineage` into the CLI/MCP lineage commands. Core keeps `hashModel`,
`updateManifest`, `staleness`, and `impact` as pure functions over a
manifest object. The CLI `lineage` command becomes: read manifest (tool)
-> compute (core) -> write manifest (tool).

### 3. ProjectLoader fs -> tool layer

Split `loadProject(path)` into (a) a tool-layer walk that finds and reads
the `.orm-project.yaml` manifest and each domain/mapping file, and (b) a
pure core assembler that builds the `OrmProject` from the already-read
contents (reusing the existing serializers). Update the CLI `validate`
and `diagram` commands.

### 4. `@barwise/dbt` connector package

Create the package, move the dbt/sql directory importers and the SQL
directory-scan path into it, give it `registerDbtFormats()`, and register
it from cli/mcp/vscode at startup -- exactly as `registerCodeFormats()`
is wired today. `DbtSqlCompiler`'s `dbt compile` subprocess belongs here.
This removes the last I/O violators from core.

### 5. `@barwise/formats` package + retire builtins

Relocate the pure descriptors (ddl, openapi, norma, avro, pure SQL parse)
into `@barwise/formats` with `registerStandardFormats()`, and delete
`registerBuiltinFormats()` from core. The `ddl` descriptor depends on
core for `renderDdl`/`RelationalMapper`. Also de-hardcode
`OrmProject.ExportFormat` from `"dbt" | "ddl" | "avro"` to a
registered-name `string`, so the core metamodel no longer names specific
formats. This is the orthogonality step that makes every format pluggable.

## API and migration impact

- Public barrel exports move out of `@barwise/core`: `importDbtProject`,
  `detectDbtDialect`, the dbt/sql `ImportFormat` classes (to
  `@barwise/dbt`), and the standard format descriptors (to
  `@barwise/formats`). `loadProject` is reshaped. Every downstream import
  (`cli`, `mcp`, `vscode`) updates -- the one-way dependency graph makes
  the blast radius explicit and the build surfaces every site.
- Registration: `registerBuiltinFormats()` is replaced by
  `registerStandardFormats()` + `registerDbtFormats()` +
  `registerCodeFormats()`, composed by each tool. A format absent from
  the registry already yields a clear "unknown format" error, so a missed
  registration fails loudly, not silently.
- The CLAUDE.md dependency graph gains `@barwise/formats` and
  `@barwise/dbt` as connector packages alongside `@barwise/code-analysis`,
  and the connector convention becomes the single rule for all formats.

## Open decisions (for review)

- **SQL placement.** The pure SQL `parse(content)` fits `@barwise/formats`;
  its directory-scan path fits `@barwise/dbt` (warehouse-oriented). Split
  it that way, or keep all SQL in one package?
- **dbt export.** `DbtExportFormat` (model -> text) is pure; it can sit in
  `@barwise/dbt` so that package owns the whole `dbt` `FormatDescriptor`,
  rather than splitting the dbt direction across packages. Confirm.
- **ProjectLoader shape.** A pure assembler + tool-layer walk, vs moving
  the whole loader to the tool layer.

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
