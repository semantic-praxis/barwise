# OrmProject multi-file workflow tooling

Status: Implemented -- barwise project init/split
(packages/cli/src/commands/project.ts, core scaffold/splitModel),
diagram --domain, and docs guide.
Created: 2026-05-17
Last-updated: 2026-07-25

Epic: barwise-knq. Children: barwise-e4k (guide), barwise-gfz (scaffolding
CLI), barwise-r4f (wire-up audit, partly landed in `orm-project-support.spec.md`).

## Problem

The core package can model, serialize, load, and validate a multi-domain
`.orm-project.yaml` (see `orm-project-support.spec.md`). The `barwise
validate` and `barwise diagram` commands already accept a project
manifest. What is still missing is the _path into_ a project: nothing
turns a monolithic `.orm.yaml` into a multi-file project, and there is no
user-facing guide for the workflow. A user with a single large model has
no ergonomic way to adopt bounded contexts.

This spec covers three gaps:

1. **Scaffolding** -- a `barwise project` command group: `init` creates
   an empty project; `split` cuts a monolithic model into per-domain
   files plus suggested context mappings.
2. **Single-domain diagrams** -- `barwise diagram <project> --domain
   <context>` renders one named domain (today a project always renders
   every domain).
3. **Documentation** -- a `docs/ORM_PROJECT_GUIDE.md` walkthrough.

## Design

### Core: `packages/core/src/project/`

The split is a model transformation, so the logic lives in `@barwise/core`
where it is reusable (CLI today, MCP/VS Code later) and unit-testable
without a filesystem.

#### `scaffoldProject(name): string`

Returns the YAML for a minimal valid `.orm-project.yaml` (just
`project.name`). Trivial; keeps `init` free of hand-written YAML.

#### `splitModel(modelYaml, config): SplitResult`

Operates on the serialized document, not the in-memory `OrmModel`. The
input is already-valid YAML; partitioning the parsed document is lossless
(it carries every field, including any this code does not enumerate) and
each output document is re-checked by deserializing it.

```
SplitConfig  = { projectName: string;
                 domains: Record<string, string[]> }   // context -> object type names
SplitResult  = { manifestYaml: string;
                 domains:  { context, fileName, yaml }[];
                 mappings: { fileName, yaml }[];
                 warnings: string[] }
```

Algorithm:

1. **Parse** the model document. Index object types by id and by name.
2. **Home each object type.** Start from the explicit `config.domains`
   assignments. Object types not listed anywhere are _inferred_: across
   the fact types they participate in, take the most common domain among
   already-homed co-players. Repeat for up to three passes (enough to
   carry a value type -> its entity -> the entity's domain). Anything
   still unhomed is placed in the first domain and reported as a warning.
3. **Home each fact type** to the domain owning the most of its distinct
   role players; ties break to the first role's player. Subtype facts
   are homed by their subtype; objectified fact types follow their fact
   type.
4. **Build each domain document.** It contains the object types homed
   there, plus _shadow_ copies of any foreign object type referenced by
   one of its fact types / subtype facts / objectifications. A shadow
   carries `source_context: <home context>` so the manifest reader knows
   it is owned elsewhere. The model's `domain_context` is set.
5. **Drop cross-domain constraints.** A constraint whose role list
   references a role in a fact type homed in another domain cannot be
   expressed in a single-file model; it is dropped with a warning.
6. **Suggest mappings.** For every ordered pair of domains that share an
   object type (home vs. shadow), emit a `.map.yaml` with the
   `shared_kernel` pattern and one entity mapping per shared type.
7. **Emit the manifest** listing each domain file and mapping file.

Every inferred home, every shadow, every dropped constraint, and every
suggested mapping is recorded in `warnings` so the user can review and
make the config explicit ("flag entities that need manual resolution").

### CLI: `packages/cli/src/commands/project.ts`

`barwise project init <name> [--dir <path>]`
Writes `<dir>/<name>.orm-project.yaml` and creates `domains/` and
`mappings/` directories. Refuses to overwrite an existing manifest.

`barwise project split <source.orm.yaml> --config <config.yaml> [--out <dir>]`
Loads the source model, runs `splitModel`, writes the manifest, every
domain file under `domains/`, and every mapping under `mappings/`.
Prints warnings to stderr. Exit 1 on failure.

`barwise project split <source.orm.yaml> --scaffold-config [--domains a,b,c]`
Prints a starter config to stdout: every object type in the source
listed under the named domains (all under the first, for the user to
move). Lets a user produce a config without hand-typing every name.

### CLI: `barwise diagram --domain <context>`

When the input is a project and `--domain` is given, render only that
domain. Output goes to a single file/stdout like a normal model diagram
(no `--output` directory requirement). An unknown context errors.

## Out of scope (tracked follow-ups)

Already tracked in `orm-project-support.spec.md`:

- **barwise-r4f-mcp** -- MCP tools accepting a project manifest.
- **barwise-r4f-vscode** -- project-aware VS Code commands / DiagramPanel.
- **barwise-r4f-lsp** -- LSP diagnostics for `.orm-project.yaml`.

New follow-ups from this spec:

- **barwise-gfz-interactive** -- interactive (TTY prompt) domain
  assignment for `project split`; this spec ships config-file and
  `--scaffold-config` only.
- **barwise-split-products** -- `project split` does not extract data
  products; all output domains are plain domains.

## Testing

- Core: `splitModel` on a small two-domain fixture (clean split, no
  seams), on a fixture with a cross-domain fact type (shadow + mapping
  emitted), and inference of an unhomed value type. Each output domain
  document round-trips through `OrmYamlSerializer.deserialize` and
  validates.
- Core: `splitModel` on `docs/auction.orm.yaml` with a four-domain
  config produces a project that loads and validates with no errors.
- CLI: `project init` creates the manifest; `project split` writes a
  project that `barwise validate` accepts; `diagram --domain` renders a
  single named domain and errors on an unknown context.
