# Format registration held at what each surface boots

Status: Planned; plan reviewed 2026-11-08 (one round, eight findings, all addressed; three owner decisions recorded). No workstream implemented. Grounds workstream 2 of `purity-and-model-boundary.spec.md` and replaces its provisional sketch.
Created: 2026-11-08
Last-updated: 2026-11-09
Tracking: barwise-ym8.2n3 (gap: `connector-packages#explicit-registration` has no enforcer)
Touches: +barwise/packages/cli/tests/bootRegistration.test.ts,
+barwise/packages/mcp/tests/bootRegistration.test.ts, barwise/docs/adr/connector-packages.md,
barwise/docs/adr/tested-in.json, barwise/docs/architecture-scenarios.md,
barwise/docs/ARCHITECTURE.md, barwise/docs/specs/purity-and-model-boundary.spec.md

## Principle

Explicit over implicit: decision 4 of `connector-packages` says each surface calls the `register*Formats()` functions it needs, and a format no one registered fails as unknown. Nothing checks that a surface does. The one tagged test, `vscode/tests/unit/formatEnums.test.ts`, calls the three register functions itself, so it passes whatever the extension does. A surface that drops a connector fails only when a user asks for that format.

The thing to hold is the registry a surface has after it starts, not the calls that put it there. Determinism stays in core: the checks are tests in the outer packages, which already depend on every connector.

## What the code does (verified 2026-11-08, main at c1c02d1e)

No surface registers at boot. Every register call is a top-level statement in a module a command or tool needs, so a format is registered as a side effect of loading the module that reads it.

| Surface | Entry                                             | Chain to the register calls                                                                                                                                                         | When                                                 | Registry after boot                                                                                                                                                                               |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI     | `cli/src/index.ts:10` (bundle: `bundle-entry.ts`) | `createProgram(version, name)` imports only the named command (`cli.ts`, lazy table)                                                                                                | per command, at module load                          | `validate`, `review`: none. `import`: all 10 (`import.ts:25-29`). `export`: standard and dbt, 7 (`export.ts:34-36`). `schema`: standard, 6 (`schema.ts:16`). `analyze`: code, 3 (`analyze.ts:28`) |
| MCP     | `mcp/src/index.ts:10`                             | `createServer()` (`server.ts:22`) then `registerTools` (`tools/index.ts:25`); `importModel.ts:17-21`, `exportModel.ts:20-22`, `analyze.ts:25` run on import of `tools/index.ts`     | once, at import                                      | all 10                                                                                                                                                                                            |
| VS Code | `vscode/src/client/extension.ts:27` `activate()`  | static imports at `extension.ts:13-14` load `ImportCodeCommand.ts:19-21` and `export/registeredExport.ts:14-15`; `@barwise/mcp` (`ToolRegistration.ts`) loads the MCP modules above | once, at bundle load; `activate()` registers nothing | all 10                                                                                                                                                                                            |

I measured the registry per surface with the built `dist` in a child process: `createProgram` for each of `validate`, `import`, `export`, `schema`, `analyze`, `review`, and with no name; `createServer()` for MCP; and for VS Code, `src/client/extension.ts` under vitest with `vscode`, `vscode-languageclient/node` and `@vscode/chat-extension-utils` stubbed (`inertModule`), before and after `activate()`. The registry was empty before the extension loaded, full after, and `activate()` ran clean and changed nothing. The VS Code probe is a source-level run, not the esbuild bundle (which holds its own copy of core and cannot be queried from outside).

Findings:

1. **No surface misses a connector for anything it can be asked.** The only registry readers in `cli/src` are `import/*.ts` and `export.ts`, `schema.ts`, `analyze.ts` (grep for `getImporter|getExporter|listImporters|listExporters|getFormat`); each is under a command that registers what it reads. MCP and VS Code hold all 10.
2. **The CLI is lazy by design** (`cli-lazy-command-loading.spec.md`), so "the CLI registers all formats" is false and should not be asserted. The requirement is per command.
3. **MCP and VS Code register redundantly.** Three MCP modules and two VS Code modules each register what they need, and VS Code inherits the MCP set through `@barwise/mcp`. Removing one call changes nothing observable; the set only shrinks when every module on the path loses the connector. A test of the calls cannot be written; a test of the outcome can, and for VS Code that outcome is the MCP set, so it gets no test of its own (Open decisions).
4. **Registration runs once per process.** Modules are cached, so a test that clears the registry and boots again in the same process sees nothing registered, and a test that does not clear sees what an earlier test loaded. Boot checks must run each surface in a fresh process.
5. **Existing coverage never boots a surface.** `formats/`, `dbt/`, `code-analysis/` registration tests and `core/tests/format/registry.test.ts` call `register*` directly. `cli/tests/importerIds.test.ts` and `formatEnums.test.ts` register by hand. `mcp/tests/serverSpawn.test.ts` spawns `dist/index.js` over stdio but asserts the tool list only, though `import_model`'s input enum and `export_model`'s description are built from the registry at `importModel.ts:47` and `exportModel.ts:49`. `cli/tests/commands/analyze.test.ts` and `importCode.test.ts` use real registration but not as the thing under test. The CLI bin is never spawned.

## Scope

1. When a CLI command is booted the way a user starts it, in a fresh process, the registry shall hold every format that command can be asked for, and a missing one shall fail the test naming the command and format.
2. The requirement is derived from each command itself, never listed in the test (Resolved 2026-11-08 by the owner: the CLI's requirement is derived from each command itself, not a hand-written table). The reference set is a snapshot of the registry after the test's own process calls `registerStandardFormats()`, `registerDbtFormats()` and `registerCodeFormats()`; "Deriving each command's need" says how a command's need is read from it.
3. When a file in `cli/src` reads the registry and is not under a command in the lazy table, or a registry read cannot be resolved by the rules below, the test shall fail naming the file and line, so a new reader must become derivable.
4. The MCP server, booted over stdio, shall expose the full reference set in the `import_model` format enum and the `export_model` description.
5. Tests carry `[adr:connector-packages#explicit-registration]`; `tested-in.json` names the CLI and MCP files.

## Deriving each command's need (resolved: not from declared choices)

I read every command that takes a format. None declares its registry formats as a machine-readable choice. `export --format <name>` is a `requiredOption` whose help is "Export format (ddl, openapi, etc.)" (`export.ts:54`), prose that lists no complete set. `import model --format <format>` builds its help from `listImporters()` (`import/model.ts:17`), so reading it back would read the registry under test. `schema --format` and `analyze --format` are output formats ("ddl or json", "text or json"), not registry formats. `import norma|dbt|sql|typescript|java|kotlin` have no `--format`. So the need is read from three things each command does declare:

1. **Subcommand names.** The test walks `program.commands` recursively (commander introspection, in the child process). A leaf command whose name equals a name in the reference importer set requires that importer: `import norma`, `dbt`, `sql`, `typescript`, `java`, `kotlin`. `import/code.ts` calls `getImporter(lang)` with the loop variable that also names the subcommand, so the two cannot diverge.
2. **An open `--format` option.** A command with a `--format` option that is `mandatory` with no `argChoices` (commander `Option` fields), and whose owner files call a registry getter, takes any name of that getter's kind and requires every reference-set format of that kind. Today that is `export` (exporters, 7) and `import model` (importers, 10).
3. **Literal arguments.** A registry getter called with a string literal in the command's owner files requires that name: `schema.ts:60`, `getExporter("ddl")`. This is a static scan of source.
4. **A connector-typed argument.** A getter call that rules 1-3 leave unresolved, in a file that imports non-`register*` symbols from a connector package, requires the formats that connector's `register*` adds, measured as the registry diff around that call in the reference process. Today this resolves `analyze.ts:47`, `getImporter(profile.importFormat)`, whose value comes from the profiler in `@barwise/code-analysis` (`LANGUAGE_TO_FORMAT` is unexported). `analyze.ts` imports the profiler, so it requires the three code formats; deleting its `registerCodeFormats()` leaves that import, so the requirement survives the plant.

A read none of the four resolves is Scope 3's failure.

**Reader detection** is built from core, not listed. The test reads `core/src/format/registry.ts`, takes every exported function or const name, and removes the two writers, `registerFormat` and `clearFormats`. Today that yields `formatRegistry`, `getFormat`, `getImporter`, `getExporter`, `listFormats`, `listImporters`, `listExporters`, `surrogateKeyFormats` and `surrogateKeysRefusal`. A name core adds later is a reader until someone says otherwise, so the failure is on the safe side. A word-boundary pattern over those names finds reader files in `cli/src`. Each maps to its owning command by path: `commands/<x>.ts` and `commands/<x>/*.ts` belong to `<x>`, so `import/code.ts`, `norma.ts`, `dbt.ts`, `model.ts` and `sql.ts` belong to `import`. Today's readers are those five plus `export.ts` (which also reads through `listExporters` and `surrogateKeysRefusal`), `schema.ts` and `analyze.ts`. Commands with no reader (`validate`, `review` and the rest) require nothing, and the test asserts that for `validate` as the zero case.

## Alternatives considered

- **A static check per reader file:** each file that reads the registry contains a register call, counted by grep. It is cheap and needs no build. Rejected as the main check: five of the eight reader files (`import/code.ts`, `norma.ts`, `dbt.ts`, `model.ts`, `sql.ts`) hold no register call, because `import.ts` registers for all of them, so the rule fails on correct code. Widened to the owning command it passes a call in dead code, or a call for the wrong connector. It sees calls, and finding 3 shows calls are the wrong thing to hold. Its useful half, which files read the registry, is kept as Scope 3.
- **One `registerAllFormats()` at each surface's start.** Rejected by the owner (Open decisions). It would load every connector for `validate`, undoing `cli-lazy-command-loading.spec.md`, and the helper would be a shallow module in a package that depends on all connectors.
- **A hand-written table of what each command requires.** Rejected by the owner (Open decisions): it is a must-agree copy of what the commands already say.
- **Asserting on the registered calls with spies.** Rejected for finding 3.
- **In-process boot with `vi.resetModules()`.** Whether vitest resets the workspace packages' `dist` files, which it may externalize, is not established. A child process over built `dist` needs no such assumption and tests what ships.

## Open decisions (all resolved by the owner)

- **Resolved 2026-11-08 by the owner: keep per-module registration, no `registerAll`.** Each module stays self-sufficient and the CLI stays lazy.
- **Resolved 2026-11-08 by the owner: no VS Code boot test; the ADR states that VS Code inherits the MCP set through `@barwise/mcp`.** A test over the extension would stub `vscode`, `vscode-languageclient/node` and `@vscode/chat-extension-utils`, a list that grows with the extension's imports, and could not go red for the thing it exists to catch: deleting VS Code's own register calls (`ImportCodeCommand.ts:19-21`, `registeredExport.ts:14-15`) never goes red, because `@barwise/mcp` registers the same set when the extension loads it. The ADR records the inheritance so the next reader does not take the missing test for a gap. If the extension stops depending on `@barwise/mcp`, the ADR line is the cue to add one.
- **Resolved 2026-11-08 by the owner: the CLI's requirement is derived from each command itself** ("Deriving each command's need"), not from a hand-written table.

## Workstreams (each independently shippable)

### 1. CLI per command, plus the ADR edit (first slice)

This slice is enough for barwise-ym8.2n3's acceptance.

`cli/tests/bootRegistration.test.ts`. A probe script runs under plain `node` over the built `dist/cli.js`, which exports `createProgram(version, only)` (`cli.ts:133`, the function both bins call). There is no TypeScript loader, since the probe imports compiled JavaScript. For each command in the lazy table, one fresh child process boots `createProgram` for that command name, prints the registry, then calls the three `register*` functions in the same process and prints the reference set. The parent applies the derivation above and asserts the booted registry holds each required name. One further spawn of the real bin (`export --format nonesuch`) asserts the "Available formats" line lists the full exporter set, so the bin entry is booted once (`bundle-entry.ts` shares `createProgram` and is not separately tested). The reader scan runs in the parent over `cli/src`.

Plant (a `tests` enforcer, run with `scripts/mutate.mjs` and recorded in the PR body per `adr-writing.md`): delete one command's register call and that command's test goes red naming the command and format. Concretely, delete `registerDbtFormats()` from `export.ts` and the `export` case goes red naming `dbt` while `import` stays green; delete `registerStandardFormats()` from `schema.ts` and `schema` goes red naming `ddl`; delete `registerCodeFormats()` from `analyze.ts` and `analyze` goes red. Add a `getExporter` read to a new command file outside the lazy table and Scope 3 goes red.

ADR and index. `connector-packages.md`: `Enforced-by` moves `explicit-registration` from `none (barwise-ym8.2n3)` to `tests`. The Consequences paragraph that calls registration review-only is restated: the CLI per command and MCP are held by boot tests, and VS Code inherits the MCP set through `@barwise/mcp` and has no boot test of its own, with the reason above. `architecture-scenarios.md` S-EXPL-5 loses "review" as its guard. Regenerate `ARCHITECTURE.md` (`npm run regen:architecture`). `purity-and-model-boundary.spec.md` WS2 points here. Closes barwise-ym8.2n3.

### 2. MCP: the tool enums (second slice)

`mcp/tests/bootRegistration.test.ts` spawns the built `dist/index.js` over stdio, as `serverSpawn.test.ts` does, and asserts that `import_model`'s `format` enum and `export_model`'s description equal the reference importers and exporters (built at `importModel.ts:47` and `exportModel.ts:49`). The reference set comes from a second short child process that calls the three `register*` functions and prints the registry.

This is a weak but real check, and the spec says so. The only red plant is deleting `registerDbtFormats()` from both `mcp/src/tools/importModel.ts` and `exportModel.ts`, a two-site edit, because either module alone leaves `dbt` registered. Deleting it from one module alone must stay green; the PR states that as the expected result so a green single deletion is not mistaken for a blind test. It holds the set the server offers, which VS Code inherits, and nothing finer.

## API and migration impact

No source or public API change in either workstream; all additions are tests, the ADR and the index. The tests read `dist`. `turbo.json` has `test` depending on `build` and `build` depending on `^build`, and `cli` and `mcp` depend on `@barwise/formats`, `@barwise/dbt` and `@barwise/code-analysis`, so a connector change rebuilds those packages and reruns these tests. That is not the cross-package trap of `barwise-wrr` and `uncached-boundary-and-crypto-purity.spec.md`, where a scan read a package its package did not depend on. No turbo probe is needed.

## Risks and testing

- A test holding the outcome is green when a call is redundantly removed; that is intended (finding 3) and stated in each plant.
- Rule 4 (the `analyze` derivation) is the least grounded step: I read that `analyze.ts` imports the profiler and calls `getImporter` on its output, but did not run the registry diff around a `register*` call. If the diff proves unusable, the fallback is for `@barwise/code-analysis` to export its language-to-format map, a source change that would be added to this spec first.
- WS1 confirms `dist/cli.js` exports `createProgram` under plain `node` before writing the test.
- Run each workstream's package tests and, after the ADR edit, `npm run check:architecture`.

## Non-goals

- No change to how any surface registers, to the registry, or to a connector.
- No VS Code boot test (Open decisions).
- No claim that the CLI registers every format at start.
- No check that a format's code sits in its own connector (barwise-ym8.x9w).
- Out of scope, each listed in the ADR as open: `barwise-i22` (VS Code pickers offer a subset), `barwise-0wa.ymj` (`generate_diagram` points at an unregistered `svg`), `barwise-5zi` (VS Code's direct `importDbtProject` call), `barwise-4hh`.
