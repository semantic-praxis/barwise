# .orm-project.yaml support: audit and wiring

Status: Implemented -- ProjectSerializer + pure projectAssembly in
core; file-resolving loaders in cli and mcp
(src/workspace/projectLoader.ts); multi-file integration tests.
Created: 2026-05-17
Last-updated: 2026-07-25

## Problem

The core package can model a multi-domain project (`OrmProject`,
`DomainModel`, `ContextMapping`, `ProductDependency`), serialize it to
and from `.orm-project.yaml` (`ProjectSerializer`), and validate it
cross-domain (`projectRules`). The metamodel, schema, and fixtures all
exist (ARCHITECTURE.md 3.1.4).

What did not exist is a user-facing path from a `.orm-project.yaml`
manifest to a working, fully-resolved project. Nothing reads a manifest
and loads the `.orm.yaml` domain files and `.map.yaml` mapping files it
references. Every consumer that wanted a project would have to
reimplement multi-file resolution -- and none did. This blocks the
multi-file workflow epic (barwise-knq) and the splitting guide
(barwise-e4k), which need to tell users how to actually use a project.

## Audit: current state per surface

### Core (`@barwise/core`)

- `OrmProject` / `DomainModel` / `ContextMapping` / `ProductDependency`
  -- present.
- `ProjectSerializer.serialize` / `deserialize` -- present, round-trips
  the manifest. `deserialize` builds an `OrmProject` with domain and
  product _references_ (path + context) but does **not** load the
  referenced model files and does **not** add `ContextMapping` objects
  to the project (mapping paths are only retrievable via the separate
  `getMappingPaths` call).
- `projectRules` -- present; checks mapping contexts, entity-mapping
  references, and product dependencies. Only meaningful once domain
  models are attached and mappings are added to the project.
- `orm-project.schema.json` -- present.
- **Gap:** no loader resolves a manifest's referenced files from disk.
  The multi-file integration test does this by hand.

### CLI (`@barwise/cli`)

- `loadModel()` handles a single `.orm.yaml` only.
- `barwise validate` / `diagram` / `verbalize` / `export` / `diff` all
  take a single model file. None accept `.orm-project.yaml`.
- **Gap:** `barwise validate` and `barwise diagram` do not work with
  project files. (Acceptance criteria for this task.)

### MCP (`@barwise/mcp`)

- `resolveSource` resolves a single `.orm.yaml` file path or inline
  YAML. No project awareness.
- `validate_model` / `generate_diagram` / `verbalize_model` only accept
  a single model.
- **Gap (tracked):** no MCP tool accepts a project manifest.

### VS Code (`barwise-vscode`)

- `activationEvents` includes `workspaceContains:**/*.orm-project.yaml`
  -- the extension activates when a project file is present.
- `ImportTranscriptCommand` reads `.orm-project.yaml` to pick up the
  `defaultLlmModel` setting -- this works.
- The `languages` contribution registers only `.orm.yaml`. Project
  manifests get no language id and no schema association.
- **Gap (tracked):** no command operates on a project; no schema-backed
  editing of the manifest.

### LSP (`barwise-vscode` language server)

- `isOrmYaml` matches `*.orm.yaml`. A `.orm-project.yaml` file does not
  end with `.orm.yaml`, so it is correctly _not_ treated as a model
  (no false positives), but it gets no diagnostics either.
- **Gap (tracked):** the LSP does not validate `.orm-project.yaml`.

## Scope of this change

Fixes the acceptance-criteria gaps and the core gap they depend on:

1. **Core** -- add `loadProject(manifestPath)`, which resolves a
   manifest and every domain and mapping file it references, attaching
   loaded `OrmModel`s to their `DomainModel`s and adding
   `ContextMapping`s to the project. Returns the project plus a list of
   files that could not be resolved (non-fatal; caller decides).
2. **CLI `barwise validate`** -- when given a `.orm-project.yaml`, load
   the project, validate every domain model, run `projectRules`, and
   report aggregated diagnostics.
3. **CLI `barwise diagram`** -- when given a `.orm-project.yaml`,
   generate one SVG per domain into an `--output` directory.

## Design

### `loadProject`

`packages/core/src/serialization/ProjectLoader.ts`:

```
loadProject(manifestPath: string): LoadedProject
  LoadedProject = { project: OrmProject; problems: string[] }
```

- Reads and deserializes the manifest. Throws `ProjectLoadError` if the
  manifest itself cannot be read or parsed.
- Resolves domain and mapping paths **relative to the manifest's
  directory**.
- Each domain `.orm.yaml` is loaded and attached via
  `DomainModel.setModel`. Each mapping `.map.yaml` is loaded and added
  via `OrmProject.addMapping`.
- A referenced file that cannot be read or parsed is not fatal: it is
  recorded in `problems` and loading continues, so a single broken file
  does not hide problems elsewhere.
- Product model files are not loaded: `ProductDependency` carries only
  a reference and `projectRules` validates products by dependency name.
  Recorded here as a known limitation.

### `barwise validate <project>`

- `isProjectFile` (suffix `.orm-project.yaml`) selects the project path.
- Each entry in `problems` becomes an `error` diagnostic
  (`project/file-unresolved`).
- Each domain model is validated; messages are prefixed `[context]`.
- `projectRules` runs; messages are prefixed `[project]`.
- Text and JSON output reuse the existing formatters. Exit code 1 if
  any error.

### `barwise diagram <project>`

- Requires `--output <dir>` (a single stdout stream cannot carry
  multiple SVGs). Without it, errors with a clear message.
- Writes `<dir>/<context>.svg` for every resolved domain.
- Unresolved files are printed as warnings; the command still succeeds
  if at least one domain diagram is produced.

## Tracked follow-ups (not in this change)

- **barwise-r4f-mcp:** MCP `validate_model` / `generate_diagram` /
  `verbalize_model` should accept a `.orm-project.yaml` file path.
- **barwise-r4f-vscode:** register `.orm-project.yaml` as a language
  with a JSON-schema association; add a "validate project" command.
- **barwise-r4f-lsp:** LSP diagnostics for `.orm-project.yaml`
  (schema validation; optionally cross-domain rules with workspace
  file resolution).
- **barwise-r4f-cli-rest:** extend `verbalize` / `export` / `diff` to
  project files if the splitting guide needs them.

## Testing

- Core: `loadProject` resolves the multi-domain fixture, attaches
  models and mappings, and reports problems for missing files.
- CLI: `barwise validate` and `barwise diagram` against a multi-domain
  fixture project; error paths for a missing manifest and a missing
  domain file.
