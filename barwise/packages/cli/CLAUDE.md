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
    merge.ts            barwise merge <base> <incoming> (non-interactive; stdout by default)
    review.ts           barwise review <file> (LLM semantic review; always exits 0)
    gym.ts              barwise gym list|show|check (modeling gym; miss-card
                        emission + session log at $XDG_STATE_HOME/barwise/)
    import.ts           barwise import (orchestrator over import/)
    import/             one module per import subcommand + shared helpers
    prompt.ts           barwise prompt eval|score|schema|history (prompt
                        evaluation over @barwise/promptlab)
    llmUsage.ts         barwise llm-usage (report over the call log)
  workspace/
    io.ts               File I/O helpers (loadModel, writeModel)
    format.ts           Output formatting helpers (JSON, text)
    provenance.ts       Version/commit/dirty for recorded eval runs
    promptArtifacts.ts  The artifact candidate set `prompt` resolves over
    callLogSink.ts      JSONL sink for the observability records
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

- **Command tests go through `runCli`, never a subprocess.**
  `tests/workspace/run.ts` builds the program in process and captures
  stdout, stderr and the exit code. Driving the built binary through
  `execFileSync` works and is a trap: the child is not instrumented by
  the parent's coverage collector, so the tests pass while the command
  reads near-zero coverage and the package silently slides under its
  threshold. That is how `llm-usage` shipped seven green tests covering
  11% of the file. In process is also ~200x faster here, which is the
  smaller reason.
- **`prompt eval` is rehearsed offline, against a fake server rather
  than a fake client.** `tests/workspace/fakeOllama.ts` answers
  `/api/chat` on loopback with the recorded fixtures, so
  `tests/commands/promptEvalOffline.test.ts` drives the whole command --
  `createLlmClient` from the flags, the derived budget, the streaming
  reader, conformance, scoring, the warnings, the history append --
  without an API key. Seven train cases in about half a second, against
  roughly twenty minutes and real money for the same sweep against
  Anthropic.

  Handing the command a mock `LlmClient` would have been easier and
  wrong: the CLI builds its own client from its own flags, and that
  construction is part of what needed covering. **Add to the fake
  server, not to a seam in `prompt.ts`** -- production code existing
  only for a test is how this stops being a rehearsal.

  Two traps, both of which cost time to find. Node's `fetch` pools
  connections, so a plain `server.close()` hangs the test process after
  the assertions pass; teardown must call `closeAllConnections()`. And
  a suite's history file lives beside its manifest, so any test that
  runs the packaged suite in place appends to the repository's own
  recorded scores -- copy `evals/` to a temp directory first.
- **One candidate set, and `prompt eval` resolves it from the client.**
  `workspace/promptArtifacts.ts` is the only place either `prompt`
  command builds the artifacts it resolves over: every built-in, plus
  `--artifacts`, the directory winning on a version collision. It is a
  module rather than a helper because neither consumer can pin it --
  both fall back to `defaultExtractionArtifact`, so a candidate set that
  loses the built-ins still yields a plausible run and a plausible
  printout. That is exactly what happened: resolution in `eval` sat
  behind `if (opts.artifacts)`, so `haiku45-2` and `sonnet5-3` -- the
  prompts production sends -- were never once measured by the command
  built to measure them, while every run echoed the operator's provider
  and model back at them (barwise-850). `artifact` had the opposite
  bug, concatenating `packages/llm/prompts/` on top of the builtins
  generated from it and refusing the duplicate as ambiguous
  (barwise-851).

  **`eval` resolves from the CLIENT, `artifact` from the flags**, and
  the asymmetry is deliberate. `createLlmClient` auto-detects the
  provider and every provider resolves its own default model, so a
  client knows both when the flags say neither -- which is the
  documented reason `LlmClient` carries them, and why keying on flags
  let `--model` alone silently measure the default (barwise-842).
  `artifact` answers a hypothetical about a configuration, and building
  a client would demand a key for a question that needs none.
- **Observability is opt-in and writes one file.** `BARWISE_CALL_LOG`
  gates it: unset or empty is off, `1`/`true` is
  `$XDG_STATE_HOME/barwise/calls.jsonl`, anything else is that path.
  One log holds three record kinds -- call cost, what the pipeline
  changed, what validation found -- correlated by a per-operation id,
  and `barwise llm-usage` reads back the calls. **No prices ship with
  the repo**: `--rates <file>` takes a user-maintained JSON, because a
  stale rate produces a confidently wrong number.

  `barwise validate` emits a validation record; the export formats and
  the gym's check runners do not, deliberately -- they validate as an
  internal gate, and logging them would turn one `barwise export` into
  several validation events.

## Dependencies

| Direction | Package            | What is used                                                   |
| --------- | ------------------ | -------------------------------------------------------------- |
| Upstream  | `@barwise/core`    | Model, validation, verbalization, mapping, diff, serialization |
| Upstream  | `@barwise/diagram` | `generateDiagram` for SVG output                               |
| Upstream  | `@barwise/llm`     | `processTranscript`, `createLlmClient`, provider factory       |
