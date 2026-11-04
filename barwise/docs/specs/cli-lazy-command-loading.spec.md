# The CLI loads only the command it runs

Status: Implemented -- WS1 shipped 2026-10-13 (see Result)
Created: 2026-10-13
Last-updated: 2026-10-13
Tracking: barwise-8nx

In one sentence: `createProgram` registers commands through a table of
dynamic imports, and the entry points pass it the command named on the
command line, so `barwise validate` loads `validate`'s module and its
dependencies instead of all eighteen.

## Principle

Orthogonality. Each command is its own module (`packages/cli/CLAUDE.md`),
but `src/cli.ts` imports all of them statically, so running one command
pays for the other seventeen: 568 modules and 3.8 MB of source for every
invocation, including `barwise --version`, which loads react-dom's
server renderer. Measured 2026-10-13 on main `fdce28fa`, in a fresh
process: importing `dist/cli.js` takes about 350 ms, importing
`dist/commands/validate.js` alone about 150 ms, and `barwise validate`
on a 531-line model 703 ms median of 15
(`docs/specs/effect-comparison.spec.md`, "How each criterion was
tested"). The modules are already separate; the loading is not.

## Should each command keep a light definition and load its body lazily? (resolved: no)

That design keeps every command's options and help at startup and moves
only the action bodies behind `import()`. It fails on one command:
`import model` builds its `--format` help from `listImporters()`, so its
_definition_ needs the format registry, which `commands/import.ts`
populates by calling `registerStandardFormats`, `registerCodeFormats`
and `registerDbtFormats` at module load. A light definition would print
an empty format list. It would also touch every action in eighteen
files. Routing by command name keeps each module exactly as it is.

## Scope

In scope:

- When the first argument names a registered command, the CLI shall
  load and register that command's module only.
- When it does not -- no arguments, `--help`, `--version`, `help
  <command>`, an unknown command, or an option before the command name
  -- the CLI shall register every command in today's order, so help
  output, suggestions and errors are unchanged. An option before the
  name is not skipped: `barwise -h validate` prints the root help, which
  must list every command.
- When a command module is added, a test shall fail until it is in the
  table, and a test shall fail if `src/cli.ts` imports a command module
  statically.

Out of scope: trimming a command's own import chain (`validate` imports
`@barwise/llm`); the JSON Schema compile on every model load
(barwise-aqa); the MCP server and the VS Code extension, which load once
per session.

## Inventory

| Module                                      | Today                                | After                                                   |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `cli/src/cli.ts`                            | static imports of 18 command modules | a table of name and `import()`; `createProgram` async   |
| `cli/src/index.ts`, `src/bundle-entry.ts`   | `createProgram(version).parse()`     | pass the routed command name; await, then `parse()`     |
| `cli/tests/workspace/run.ts`                | `createProgram(version)`             | `await createProgram(version)` -- every command, as now |
| `cli/tests/docs/gettingStartedDocs.test.ts` | `createProgram()`                    | `await createProgram()`                                 |
| `cli/src/commands/*`                        | register themselves on a program     | unchanged                                               |

The format registrations in `import.ts`, `export.ts` and `analyze.ts`
stay module side effects. They are safe to defer because the only
readers of the registry in the CLI are those three modules and their
`import/` subcommands (checked by grep for `getImporter`,
`getExporter`, `listImporters`, `listExporters` and `listFormats`), and
each reader loads its own registrations.

## Target architecture

```ts
interface CommandEntry {
  readonly name: string; // the top-level command the module registers
  readonly register: (program: Command, version: string) => Promise<void>;
}

// In today's registration order, which is the order --help lists.
const COMMANDS: readonly CommandEntry[] = [/* analyze ... llm-usage */];

/** The first argument, if it names a command in the table. */
declare function commandNameIn(args: readonly string[]): string | undefined;

/** Every command, or only `only` when it names one. */
declare function createProgram(
  version?: string,
  only?: string,
): Promise<Command>;
```

The root program keeps `--version` and the `--api-key` refusal hook,
which is installed on the root and reads the action command's options,
so it applies to a lazily registered command exactly as to an eager
one. `tests/workspace/run.ts` routes the same way the entry points do,
so every command test runs its command as production loads it.

## Alternatives considered

- **Light definitions, lazy bodies.** Rejected above: `import model`'s
  help needs the registry.
- **Commander's stand-alone executable subcommands.** One process per
  command; every command would need its own entry file and the bundle
  would ship eighteen of them.
- **Bundle the npm `bin` as well as the release asset.** The bundle
  starts faster (566 ms against 703 ms for `validate`) but still parses
  all eighteen commands; it is complementary and a larger change to how
  the package is published.

## Workstreams (each independently shippable)

### 1. Route by command name

The table, the async `createProgram`, the two entry points and the two
test callers, plus `tests/commandRouting.test.ts`: the routing cases in
Scope; that the table registers exactly the names its entries claim, in
today's order; and that `src/cli.ts` has no static import of a command
module. `test-plan/cli-checks.sh`, which runs every command through the
bundle, guards that each still works when loaded on demand.

Acceptance: `barwise validate` on the 2026-10-13 example model is at
least 150 ms faster by median of 15, measured the same way; `barwise
--help` lists the same commands in the same order.

## API and migration impact

`createProgram` becomes async and takes an optional command name. Its
callers are the two entry points and two test helpers, all in
`@barwise/cli`; no other package imports it.

## Open decisions (for review)

None. The routing fallback (load everything when unsure) keeps every
ambiguous case on today's path.

## Risks and testing

- A command module that, as a side effect, sets up something another
  command reads would break when that other command runs alone. The
  format registrations are the only module-level side effects in
  `commands/` (grep for top-level calls), and their readers load them.
- The bundle: esbuild defers a dynamically imported module's
  evaluation, but the bundle still parses all of it. `cli-checks.sh`
  and the bundle step in `ci:local` cover that it runs.

## Non-goals

- No change to any command's options, output or exit codes, with one
  exception found by comparing old and new output: `import model`'s
  `--format` help and its unknown-format error list the importers in the
  order `import.ts` registers them (ddl, openapi, sql, norma, typescript,
  java, kotlin, dbt). The old order put the code formats first only
  because `analyze.ts` happened to load before `import.ts`. Every lookup
  is by name, so the order is display only.

## Result

Measured 2026-10-13, old and new builds of `@barwise/cli` alternated, 15
runs each, `barwise validate` on `examples/models/learning-design.orm.yaml`:

| Build               | Median | Modules loaded | Source loaded |
| ------------------- | ------ | -------------- | ------------- |
| Before (`fdce28fa`) | 610 ms | 568            | 3.83 MB       |
| After               | 426 ms | 302            | 1.46 MB       |

Same output and exit code. `--help`, `--version`, `validate --help`,
`export --help`, `help validate`, `-h validate` and an unknown command
print the same bytes as before. The four guards in
`tests/commandRouting.test.ts` were each shown to fail with
`scripts/mutate.mjs`: a static import of a command, a table name that
does not match its module, a dropped entry, and routing past an option.
