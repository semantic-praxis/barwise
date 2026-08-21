# @barwise/cli

Command-line tool for ORM 2 modeling. Wraps the platform-independent
packages (`@barwise/core`, `@barwise/diagram`, `@barwise/llm`) into a
`barwise` CLI binary.

## Dependency Rule

This package depends on `@barwise/core`, `@barwise/diagram`,
`@barwise/llm`, `@barwise/promptlab`, and `commander`. It has ZERO
dependencies on VS Code.

## Package Layout

```
src/
  index.ts              Main entry point (bin shebang)
  cli.ts                Commander program definition
  commands/
    validate.ts         barwise validate <file>
    verbalize.ts        barwise verbalize <file>
    schema.ts           barwise schema <file>
    export.ts           barwise export <file> --format <name>
    diagram.ts          barwise diagram <file>
    diff.ts             barwise diff <file1> <file2>
    gym.ts              barwise gym list|show|check (modeling gym; miss-card
                        emission + session log at $XDG_STATE_HOME/barwise/)
    import.ts           barwise import (orchestrator over import/)
    import/             one module per import subcommand + shared helpers
    prompt.ts           barwise prompt eval|score|schema|history (prompt
                        evaluation over @barwise/promptlab)
  workspace/
    io.ts               File I/O helpers (loadModel, writeModel)
    format.ts           Output formatting helpers (JSON, text)
    provenance.ts       Version/commit/dirty for recorded eval runs
tests/
  cli.test.ts           Scaffolding tests
  commands/             Command-specific tests
  fixtures/             .orm.yaml test files
```

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check only
```

## Key Conventions

- Each command is a separate module that registers itself on a
  Commander program.
- Commands read `.orm.yaml` files via the shared `loadModel()` helper.
- Output goes to stdout by default. `--output` writes to a file.
- `--format json` is available on most commands for machine-readable
  output.
- Exit code 1 for validation errors or failures; 0 for success.
- **Never reach for `import.meta` in shared command code.** The CLI
  ships two ways: a tsc build whose bin entry reads its own
  package.json, and an esbuild CJS bundle where `import.meta` is empty
  and the version arrives as an injected
  `process.env.BARWISE_CLI_VERSION`. Anything a command needs from the
  package root is threaded in from `createProgram(version)` instead --
  code that reads package.json directly works in development and
  silently reports `0.0.0-dev` in every release.
- **Provenance names barwise's repository, not the current directory.**
  `resolveProvenance` starts from `process.argv[1]` and verifies the git
  root carries barwise's own `barwise/package.json` marker before
  recording its commit. Asking about the working directory would record
  whatever repo the operator was standing in, and a global install can
  sit in another project's `node_modules`. It never throws: an eval run
  costs money, and a missing `git` must not be what loses it.

## Dependencies

| Direction | Package            | What is used                                                   |
| --------- | ------------------ | -------------------------------------------------------------- |
| Upstream  | `@barwise/core`    | Model, validation, verbalization, mapping, diff, serialization |
| Upstream  | `@barwise/diagram` | `generateDiagram` for SVG output                               |
| Upstream  | `@barwise/llm`     | `processTranscript`, `createLlmClient`, provider factory       |
