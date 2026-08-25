# Test-suite assertion audit, 2026-08-25

Tracking: barwise-859. Sibling of
`unwired-capability-audit-2026-08-20.md`, which asked whether a built
capability can be reached; this one asks whether a green test is
evidence of the right thing. The motivating case is PR #338: `prompt
artifact` refused `--surface review`, wrong from the moment barwise-847
made review artifact-driven, and the gap survived a green suite because
a test asserted the refusal was correct --

```ts
it("rejects a surface it cannot print", ...)
  expect(stderr).toContain("extraction only");
```

That is worse than an untested gap. An untested gap is invisible; this
one was visible, described, and pinned as a requirement, so any
reviewer read it as intent.

Two passes, run over `main` at `24663b1`.

## Method

**Pass 1 -- refusals that are limitations, not requirements.** Grep the
expected error strings for limitation vocabulary ("yet", "only", "not
supported", "unsupported", "not implemented", "cannot"), and enumerate
every test whose name starts "rejects", "refuses", "throws", "errors",
"fails" or "does not" -- 254 across the twelve packages. For each
candidate, ask: is the refusal a requirement (the input is genuinely
invalid) or a limitation (we haven't built it)? A limitation pinned by
a test is the finding.

The discriminator that separates the two cheaply: **does `src` produce
the asserted string, or does the test supply it as fixture data?** A
test feeding its own `skipReason` and asserting it comes back out is
testing relay behaviour; a test asserting a string that only exists in
a production `throw` is pinning that refusal as forever-correct.

**Pass 2 -- assertions that pass for the wrong reason.** Grep cannot
find these. The method is mutation: pick a seam where tests feed a
hand-written value that production would compute, mutate the producer,
and run the suites. A mutation that survives green proves the tests
assert their own fixtures. Each experiment below was actually run --
edit, test, revert -- not reasoned about; the survive/caught column is
measured, and every fix added for a surviving mutation was then
re-checked to confirm it kills that same mutation.

Priority went to the packages with a capability seam: `llm` (artifacts,
surfaces, conformance), `promptlab` (the scorer), `cli` (commands and
flags), `core` (the format registry), plus the `mcp` registration
barrel.

## Findings

All four were fixed in this change; the fix for each is the test (or
command) named in its entry.

### 1. `prompt schema --surface review` refused a surface that has a schema (fixed; barwise-855)

`packages/cli/tests/commands/prompt.test.ts:114-118` pinned

```ts
expect(result.stderr).toContain("extraction only");
```

against `packages/cli/src/commands/prompt.ts`, whose `schema`
subcommand threw `has no schema export yet (extraction only)` for
anything but extraction. The "yet" was honest when written and false
since barwise-847: `reviewModel` builds a real structured-output schema
(`buildReviewResponseSchema`, `packages/llm/src/review/reviewModel.ts`)
and has since review went artifact-driven -- it was simply private to
its own call site, so the one command whose job is printing a surface's
output contract could not print it. Same shape as PR #338, one
subcommand over.

Fixed by exporting `buildReviewResponseSchema` from `@barwise/llm` and
printing it for `--surface review`; a surface that is not a surface
(`agent`) still exits 1, now with the same `Use "extraction" or
"review"` wording as `prompt artifact`. The refusal test was replaced
by one asserting the review schema prints (and is not the extraction
schema by mistake), plus a genuine-invalid-input rejection.

### 2. `--max-tokens` and `--context-window` were wired, and no test knew (fixed)

Two mutation experiments on `packages/cli/src/commands/prompt.ts`:
delete the `contextWindow` spread from the `createLlmClient` call;
separately, delete the `maxTokens` spread from the `runSuite` call.
**Both survived all 234 CLI tests.**

The tests that looked like coverage were not:
`prompt.test.ts:79-86` ("offers --context-window, and reaches the
client with it") asserts `--help` output only, and its comment defers
the wiring to "the provider tests reading num_ctx off the request" --
but the provider tests cover `OllamaClientOptions`, not the CLI handing
the flag to the factory. The value-validation guards
(`--max-tokens must be a positive integer`) kept passing throughout,
validating a value that then went nowhere. This is the
built-but-unwired class the 2026-08-20 audit chased, one level down:
the capability is wired, and the suite could not tell wired from not.

Fixed with a request-body assertion in
`tests/commands/promptEvalOffline.test.ts`: run the eval against the
fake Ollama server with both flags and assert `options.num_ctx` and
`options.num_predict` on every request the server received. Both
mutations re-run against the new test fail.

### 3. MCP tool registration was pinned for 4 tools of 17 (fixed)

Mutation: remove `registerReviewTool(server)` and
`registerMergeTool(server)` from `packages/mcp/src/tools/index.ts`,
rebuild, run the mcp suite. **All 179 tests passed** with `review_model`
and `merge_models` unregistered -- the per-tool tests import
`executeReview`/`executeMerge` directly, bypassing registration, and
`tests/serverSpawn.test.ts:34-41` sampled only four names from
`listTools()`.

This matters more than a generic coverage gap because `review` and
`merge` are exactly the rows the capability matrix in `CLAUDE.md` says
MCP has -- the rows the 2026-08-20 audit found missing from the CLI.
The matrix is hand-maintained prose; until now no test was its
executable form for the MCP column.

Fixed: `serverSpawn.test.ts` now asserts the complete sorted 17-name
list with `toEqual`, so dropping (or adding) any registration fails
one test by name. Re-running the mutation confirms the kill. The CLI
does not share this gap -- every registered command has a test file
driving it through `runCli`, which builds the program through
`createProgram`, so an unregistered command fails its own tests.

### 4. `llm-usage` and the call-log emitter agree only by convention (fixed)

`packages/cli/src/commands/llmUsage.ts` deliberately declares its own
`CallRow` row shape rather than importing `LlmCallRecord` (the log
holds three record kinds, and the reader must tolerate rows it does not
understand). Every test in `tests/commands/llmUsage.test.ts` fed
hand-written JSONL rows, and the emitter's tests
(`packages/llm/tests/observe/callLog.test.ts`) assert its fields
in-package. Nothing anywhere asserted the two shapes are the same
shape.

The realistic failure is a coordinated rename: `promptTokens` becomes
`inputTokens` in `@barwise/llm`, the llm tests are updated in the same
change, and both suites stay green while `llm-usage` silently reports
zero tokens forever after. Demonstrated by experiment: the rename
**compiles clean** -- the emitter builds the record through conditional
spreads (`...(cond ? { promptTokens } : {})`), which TypeScript does
not excess-property-check, so the type system is not a safety net here
either -- and before the fix, only hand-written fixtures ever reached
the reader.

Fixed with a round-trip test: `withCallLog` wraps a stub client, the
record the real emitter produces is written to a log, and `llm-usage`
must report its tokens. Under the simulated rename this is the one test
in the monorepo that fails. This is `ConstraintCorrespondence.test.ts`'s
lesson (two vocabularies that must not drift need a test that holds
them together) applied to the observability seam.

## Watch items (correct today, filed as follow-ups)

- **`runSuite` refuses review artifacts** --
  `packages/promptlab/src/run/runSuite.ts:337` throws `cannot drive
  transcript extraction`, pinned at
  `packages/promptlab/tests/runSuite.test.ts:226`. This is a
  requirement today: the suite's cases are transcripts scored as
  extractions, and a review prompt genuinely cannot drive that
  pipeline. But `docs/specs/review-surface-evals.spec.md` (workstreams
  2-4, open) plans review evals in "that same shape". If they route
  through `runSuite`, this test becomes the next finding 1 -- the
  refusal wording is per-surface, not per-capability, so whoever wires
  review evals must treat this test as theirs to change, not as intent
  to preserve.
- **VS Code tool registration has no unit pin.** The extension's
  `ToolRegistration` is exercised only by the integration harness;
  nothing fails fast if a registration is dropped, which is the same
  shape finding 3 had in MCP. Not mutation-tested here (the vscode
  harness is not runnable in this pass); noted for whoever next works
  that surface.
- **A stale fixture string, not a defect:**
  `packages/core/tests/annotation/OrmYamlAnnotator.test.ts:184` asserts
  `"frequency constraints not yet supported"` -- but the test itself
  supplies that string as its fixture `skipReason`, and the behaviour
  under test (relaying a skip reason into a TODO annotation) is real
  and correct. No production site emits that reason any more; frequency
  constraints have been supported since the conformance work. The
  discriminator working as intended: fixture-supplied, therefore not a
  pin. The wording could be refreshed for a reader's sake; nothing
  depends on it.

The beads tracker was not reachable from this session's container (`bd`
not installed), so these follow-ups are recorded here rather than
filed; they should be filed to bd by the next session that can.

## Negative results

What the passes covered and cleared, so a later audit does not re-walk
it.

**Pass 1** audited all 254 rejection-named tests by name and read every
limitation-vocabulary grep hit in context:

- The unknown-format rejections (`cli/tests/commands/new-export.test.ts:92`,
  `mcp/tests/tools/exportModel.test.ts:141`,
  `mcp/tests/tools/importModel.test.ts:262`) resolve through the
  `FormatDescriptor` registry and print the registry's own available
  list -- a newly registered format is accepted with no test to update,
  so no format can be pinned out by these.
- `Unknown SQL dialect` and the Snowflake `CHECK is not supported`
  comment (`formats/tests/DdlDialectExport.test.ts:69,136`) state facts
  about external systems, not repo limitations.
- `appendRunHistory` refusing incomplete runs
  (`promptlab/tests/history.test.ts:171`) is the barwise-806
  requirement, with a documented `force` escape.
- The artifact loader/resolver rejections
  (`llm/tests/prompt/artifacts/*.test.ts`,
  `TranscriptProcessor.artifact.test.ts:68`,
  `reviewModel.artifact.test.ts:147`) reject malformed artifacts,
  surface mismatches, and ambiguous ties -- all genuine invalid input,
  and the surface-mismatch guards run before the LLM call by design.
- The `core` model, serialization, query-parser, and validation throw
  tests are structural invariants of the metamodel (duplicate ids,
  dangling references, bad schema versions); none asserts a capability
  away.

**Pass 2** mutations that were caught, i.e. seams that are genuinely
pinned:

| Producer mutated                      | Caught by                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scorer: warning penalty weight zeroed | 2 failures in `promptlab` (`scoreExtraction.test.ts` hand-computes)                                                      |
| Scorer: `warningsByRule` always empty | 1 failure in `promptlab`                                                                                                 |
| `hashPrompt` as a constant            | pinned in advance: `promptHash.test.ts` asserts any-change-changes-it                                                    |
| Dispersion arithmetic                 | pinned in advance: `dispersion.test.ts` hand-computes, incl. the n-1 denominator and the recorded Haiku run              |
| `runSuite` mean/worst                 | computed expectations in `runSuite.test.ts:146-152`, plus the offline rehearsal reproducing `ANSWER_KEY_MEAN` end to end |
| CLI command registration dropped      | that command's own `runCli` tests (every registered command has a test file)                                             |
| Gym check path                        | `cli/tests/commands/gym.test.ts` runs the real catalog, evaluator, and state-directory record                            |

`enforceConformance` and the builtin-artifact drift were not
re-mutated: `ConstraintCorrespondence.test.ts` asserts the
validator/conformance correspondence across the whole constraint
vocabulary, and the generated-builtins drift test pins the compiled
artifacts, both by construction rather than by sample.

The `toHistoryEntry` mapper feeding on a hand-written `SuiteReport` is
not a finding: a mapper's contract is the mapping, its input's producer
(`runSuite`) is pinned separately (row 5), and the CLI end of the chain
is covered by the offline rehearsal's history-row test.

## A note on how this class of defect forms

Every pinned refusal here was true when written. The test author
described the present ("no schema export yet") and the assertion
framework has no tense: `toContain("extraction only")` reads identically
whether the string documents a requirement or a snapshot of what was
built so far. The fix at authoring time is to make refusal tests state
_why_ the input is invalid -- a test named "rejects a surface that is
not a surface" survives any amount of capability growth; one named
"rejects a surface it cannot print" was a limitation wearing a
requirement's name, and the suite defended it.

The pass-2 class forms differently: a consumer's tests feed literals
because the producer is elsewhere, the producer's tests assert its own
output, and the correspondence between them belongs to no package --
so no suite owns it, and a mutation at the seam survives both. The
repository already invented the countermeasure twice
(`ConstraintCorrespondence`, the builtins drift test); findings 2-4 are
three more places it applies: assert on the wire, assert the whole
registration list, round-trip the record.
