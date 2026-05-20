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
- `barwise/packages/llm/CLAUDE.md` -- LLM transcript extraction
- `barwise/packages/cli/CLAUDE.md` -- CLI tool (validate, verbalize, schema, export, diagram, diff, import)
- `barwise/packages/mcp/CLAUDE.md` -- MCP server (tools, resources, prompts)
- `barwise/packages/vscode/CLAUDE.md` -- VS Code extension integration
- `AGENTS.md` -- General guidance on development practices.

## Dependency Graph

```
@barwise/core          (no internal deps)
  ^
  |--- @barwise/diagram  (core)
  |--- @barwise/llm      (core)
  |--- @barwise/cli      (core, diagram, llm)
  |--- @barwise/mcp      (core, diagram, llm)
  |--- barwise-vscode     (core, diagram, llm, mcp)
```

Changes to `@barwise/core` can break all downstream packages. Run the
full monorepo build and tests after modifying core's public API.

## Current State

All phases are complete. The project has 1,686 passing tests across 6
packages. The CLI tool (`barwise`) and MCP server (`barwise-mcp`) provide
the same capabilities as the VS Code extension for terminal and AI
workflows. Import and export formats (DDL, OpenAPI) are managed through
a unified format registry (`FormatDescriptor` in `core/src/format/`).
NORMA XML import is functional with data type resolution, preferred
identifier support, external uniqueness constraints, and role-level
value constraints.

## Milestones

### Phase 1 -- COMPLETE

1. Project scaffolding and metamodel types -- DONE
2. Phase 1 constraints -- DONE (integrated into metamodel)
3. JSON Schema and YAML serialization (round-trip .orm.yaml files) -- DONE
4. Validation engine with structural rules -- DONE
5. Verbalization engine (fact types and Phase 1 constraints) -- DONE

### Phase 2 -- COMPLETE

6. Phase 2 constraints (exclusion, ring, frequency, subset, equality, etc.) -- DONE
7. Subtype relationships (SubtypeFact) -- DONE
8. Multi-file models and context mapping -- DONE
9. Relational mapping (Rmap) and DDL rendering -- DONE
10. Model diffing and merging -- DONE

### Phase 3 -- COMPLETE

11. LLM transcript processing (@barwise/llm) -- DONE
12. Diagram visualization (@barwise/diagram) -- DONE
13. VS Code extension (LSP, commands, webview) -- DONE

### Phase 4 -- COMPLETE

14. LLM provider expansion (OpenAI, Ollama, factory) -- DONE
15. CLI tool (@barwise/cli) -- DONE
16. MCP server (@barwise/mcp) -- DONE

### Remaining Work

No major items remain. All phases, naming audit, and NORMA XML
enhancements are complete.

## Monorepo Commands (run from `barwise/`)

- `npm run build` -- build all packages (Turborepo, respects dependency order)
- `npm run test` -- test all packages
- `npm run lint` -- lint all packages (ESLint)
- `cd packages/core && npx vitest run` -- run core tests only
- `cd packages/core && npx vitest run --coverage` -- core tests with coverage
- `cd packages/core && npx tsc --noEmit` -- type-check core

## Versioning and Releases

The project uses a single version number across all packages, tracked
by git tags on the main branch. Versions follow semver. Changes
accumulate on main; a release is an intentional act, not automatic.

### Version lifecycle

1. **Develop** -- merge PRs to main. CI runs build + test + lint.
2. **Decide to release** -- when a meaningful set of changes has landed.
3. **Bump versions** -- update package.json files and tag.
4. **Create a GitHub release** -- triggers the VSIX build workflow.

### Bump versions and tag

All commands run from `barwise/`. The `--no-workspaces-update` flag
prevents npm from resolving workspace dependencies against the public
registry (these packages are not published).

The `barwise-vscode` extension has its own version (visible in the VS
Code marketplace) which may differ from the library packages. The
`npm version` command bumps each package relative to its current
version, so they stay in sync if they start in sync.

For a patch release (bug fixes, small improvements):

```bash
npm version patch --workspaces --include-workspace-root \
  --no-git-tag-version --no-workspaces-update
VER=$(node -p "require('./package.json').version")
git add -A && git commit -m "bump to $VER"
git tag -a "v$VER" -m "v$VER: brief description"
git push origin main --tags
```

For a minor release (new features, new format support):

```bash
npm version minor --workspaces --include-workspace-root \
  --no-git-tag-version --no-workspaces-update
VER=$(node -p "require('./package.json').version")
git add -A && git commit -m "bump to $VER"
git tag -a "v$VER" -m "v$VER: brief description"
git push origin main --tags
```

### Create a GitHub release

```bash
gh release create v1.3.0 --title "v1.3.0" --generate-notes
```

The `--generate-notes` flag auto-generates a changelog from merged PRs
since the last tag. The `release-vsix.yml` workflow then builds and
attaches the VS Code extension VSIX to the release.

### Review what changed since the last release

```bash
git log --oneline v1.2.0..HEAD
```

## Conventions (Monorepo-Wide)

- ALWAYS create a spec file before beginning development.  There should
  be a documented and reviewed plan to ensure the quality of work is high.
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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
