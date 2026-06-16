# @barwise/cli

Command-line tool for ORM 2 modeling. Wraps the platform-independent
packages (`@barwise/core`, `@barwise/diagram`, `@barwise/llm`) into a
`barwise` CLI binary.

## Dependency Rule

This package depends on `@barwise/core`, `@barwise/diagram`,
`@barwise/llm`, and `commander`. It has ZERO dependencies on VS Code.

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
    import.ts           barwise import (orchestrator over import/)
    import/             one module per import subcommand + shared helpers
  helpers/
    io.ts               File I/O helpers (loadModel, writeModel)
    format.ts           Output formatting helpers (JSON, text)
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

## Dependencies

| Direction | Package            | What is used                                                   |
| --------- | ------------------ | -------------------------------------------------------------- |
| Upstream  | `@barwise/core`    | Model, validation, verbalization, mapping, diff, serialization |
| Upstream  | `@barwise/diagram` | `generateDiagram` for SVG output                               |
| Upstream  | `@barwise/llm`     | `processTranscript`, `createLlmClient`, provider factory       |
