# CLAUDE.md

## Project: Barwise

An ORM 2 (Object-Role Modeling) toolkit for data engineers and
architects. Includes a VS Code extension, CLI tool, and MCP server.
Named after Jon Barwise, whose work on situation semantics
provides the theoretical foundation for fact-based modeling.

## Design Principles

- **Orthogonality (primary).** Each component addresses one concern
  and avoids hidden coupling to others. The package graph is one-way
  (core has no internal deps); validation, verbalization, mapping,
  diagram, and LLM live in separate modules. A change in one should
  not force changes in unrelated ones.

- **Composability (primary).** Capabilities are built from small,
  well-defined pieces that combine cleanly. One `@barwise/core`
  powers the CLI, MCP server, and VS Code extension; formats
  register through a single `FormatDescriptor` registry; LLM
  providers slot in via a factory. Prefer narrow primitives that
  compose over wide ones that don't.

- **Determinism in the core.** Validation, verbalization, mapping,
  diff, and query are pure and deterministic -- same input, same
  output. Non-determinism (LLM calls, network I/O, clocks) lives in
  the outer packages (`llm`, `cli`, `mcp`, `vscode`). New
  capabilities go in `core` only if they can preserve this; if they
  cannot, they belong one layer out.

- **Explicit over implicit.** Cross-domain references go through
  declared context mappings; data products declare the domains they
  compose; every `.orm.yaml` carries a `schemaVersion`; import and
  export formats register through a named `FormatDescriptor` rather
  than being auto-discovered. When in doubt, require declaration
  instead of inference.

- **DRY (secondary).** Remove duplication when it does not
  compromise orthogonality or composability. A small amount of
  parallel code in two packages is preferable to an abstraction
  that couples them or forces one of them to bend its interface.
  When DRY conflicts with the primary principles, the duplication
  stays.

## Essential Context

Read `barwise/docs/ARCHITECTURE.md` before making any changes. It
contains the full system design, metamodel specification, and phasing
plan.

## Package-Specific Instructions

Each package has its own CLAUDE.md with dependency rules, layout,
commands, and testing conventions. Read the relevant file before
working in a package:

- `barwise/packages/core/CLAUDE.md` -- metamodel, validation, verbalization, serialization, mapping
- `barwise/packages/diagram/CLAUDE.md` -- diagram layout and SVG rendering
- `barwise/packages/diagram-ui/CLAUDE.md` -- React renderer (interactive canvas; headless SVG in WS3) over the diagram `PositionedGraph`
- `barwise/packages/llm/CLAUDE.md` -- LLM transcript extraction
- `barwise/packages/code-analysis/CLAUDE.md` -- code connector package; registers TypeScript/Java/Kotlin importers into the `FormatDescriptor` registry
- `barwise/packages/dbt/CLAUDE.md` -- dbt connector package; registers the dbt importer/exporter into the `FormatDescriptor` registry (owns its fs + subprocess I/O)
- `barwise/packages/formats/CLAUDE.md` -- standard interop connector package; registers the DDL/OpenAPI/Avro/NORMA/SQL descriptors into the `FormatDescriptor` registry
- `barwise/packages/promptlab/CLAUDE.md` -- deterministic prompt evaluation: eval suite, scorer, runner, score history for the LLM surfaces
- `barwise/packages/cli/CLAUDE.md` -- CLI tool (validate, verbalize, schema, export, diagram, diff, import, gym, prompt)
- `barwise/packages/mcp/CLAUDE.md` -- MCP server (tools, resources, prompts)
- `barwise/packages/vscode/CLAUDE.md` -- VS Code extension integration
- `AGENTS.md` -- General guidance on development practices.

## Dependency Graph

```
@barwise/core               (no internal deps)
  ^
  |--- @barwise/diagram         (core)
  |--- @barwise/diagram-ui      (diagram)  -- React renderer over the
  |                                           PositionedGraph; no elkjs,
  |                                           no VS Code
  |--- @barwise/llm             (core)
  |--- @barwise/code-analysis   (core)  -- connector package: registers
  |                                        code importers into the
  |                                        FormatDescriptor registry
  |--- @barwise/dbt             (core)  -- connector package: registers
  |                                        the dbt importer/exporter; owns
  |                                        its fs + subprocess I/O
  |--- @barwise/formats         (core)  -- connector package: registers
  |                                        the standard DDL/OpenAPI/Avro/
  |                                        NORMA/SQL descriptors
  |--- @barwise/learn           (core)  -- learning artifacts: the modeling
  |                                        gym (exercise format, deterministic
  |                                        evaluator, miss-card emission) and
  |                                        the tutorial renderer
  |--- @barwise/promptlab       (core, llm, learn)  -- deterministic prompt
  |                                        evaluation: eval suite, scorer,
  |                                        runner, score history (the DSPy
  |                                        optimizer lane's metric)
  |--- @barwise/cli             (core, diagram, llm, code-analysis, dbt, formats, learn, promptlab)
  |--- @barwise/mcp             (core, diagram, llm, code-analysis, dbt, formats, learn)
  |--- barwise-vscode           (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, mcp)
```

`@barwise/code-analysis` is the template for the connector convention:
a package outside `core` that keeps its own I/O (LSP sessions, repo
scanning) and registers importers into the `FormatDescriptor` registry,
rather than putting that I/O in `core`. `@barwise/dbt` follows the same
convention for the dbt importer/exporter (project-directory scanning and
the `dbt compile` subprocess), registering via `registerDbtFormats()`.
`@barwise/formats` carries the standard interop descriptors (DDL,
OpenAPI, Avro, NORMA, SQL) via `registerStandardFormats()`, so `core`
ships no interop format at all -- only the registry, the format
interfaces, and the native `.orm.yaml`.

Changes to `@barwise/core` can break all downstream packages. Run the
full monorepo build and tests after modifying core's public API.

## Current State

All development phases are complete; the full suite passes in CI
across all 10 packages. The CLI (`barwise`) and MCP server
(`barwise-mcp`) provide the same capabilities as the VS Code
extension. Core ships no interop format: the standard descriptors
live in `@barwise/formats`, dbt in `@barwise/dbt`, and code importers
in `@barwise/code-analysis`.

## Monorepo Commands

Run all monorepo commands from `barwise/` (the nested directory), not
the repo root -- the root holds no package.json. `npm run build`,
`test`, and `lint` fan out via Turborepo in dependency order;
per-package runs use `npx vitest run` / `npx tsc --noEmit` from the
package directory.

## Versioning and Releases

The project uses a single version number across all packages, tracked
by git tags on main; a release is an intentional act, not automatic.
The bump/tag/release procedure and its gotchas live in the `release`
skill (`.claude/skills/release/`).

## Conventions (Monorepo-Wide)

- ALWAYS create a spec file before beginning development. There should
  be a documented and reviewed plan to ensure the quality of work is
  high. Use the `spec-writer` skill for the house spec format, the
  design-principle framing, and the pre-flight checklist; specs live
  in `barwise/docs/specs/`.
- Doc naming and dating (stable kebab names for specs, dated filenames
  for point-in-time artifacts) follows the convention in the
  `spec-writer` skill.
- TypeScript strict mode. Base config in `barwise/tsconfig.base.json`
  uses NodeNext module resolution; the vscode package overrides to
  Bundler resolution for esbuild.
- Vitest for all test packages. Tests co-located under `tests/`
  mirroring `src/` structure.
- No emoji in output or documentation.
- No trivial dependencies: never add a package for something provided
  by JavaScript or Node core (e.g. use `node:crypto.randomUUID()` not
  `uuid`). High-quality libraries that solve real problems (yaml, ajv)
  are fine.
- ESLint config is shared at the repo root (`barwise/eslint.config.mjs`).
- Turborepo (`barwise/turbo.json`) orchestrates build/test/lint with
  correct dependency ordering.

## Beads Issue Tracker

Task tracking goes through **bd (beads)** rather than TodoWrite,
TaskCreate, or markdown TODO lists, so state survives across sessions
and machines. Run `bd prime` for the full workflow context; the core
loop is `bd ready` (find work), `bd show <id>`, `bd update <id>
--claim`, `bd close <id>`. Use `bd remember` for persistent knowledge
rather than MEMORY.md files.

## Session Completion

Work is not done until it is pushed. Sessions often run in ephemeral
containers, and anything left local is stranded when the container is
reclaimed -- so never end a session with unpushed work, and never hand
the push back to the user.

When ending a work session: file issues for any follow-up work, run
the quality gates if code changed (tests, linters, builds), update
issue status, then push and verify:

```bash
git pull --rebase
bd dolt push
git push
git status  # must show "up to date with origin"
```

If a push fails, resolve the cause and retry until it succeeds. Then
clean up (clear stashes, prune remote branches) and hand off context
for the next session.
