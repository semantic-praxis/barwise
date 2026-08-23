# Rehearsing `prompt eval` without paying for it

Status: Implemented
Created: 2026-08-23
Last-updated: 2026-08-23
Tracking: barwise-841. Filed after barwise-840, which was the sixth
conformance/validator gap found by a paid run rather than a test.

## Principle

Determinism in the core, applied to the harness that measures the core.
The repository has a standing preference for scripting an evaluation
rather than spending a call on it, and `barwise prompt eval` is the one
command that has never been held to it: every line it prints has only
ever executed with an API key in the environment.

`runSuite` is well covered offline -- `promptlab/tests/runSuite.test.ts`
drives it with a fixture client. What that test cannot reach is
everything the CLI does around it, which is most of the code an operator
actually depends on during a sweep:

| Path                                                    | Only ever run against a paid provider |
| ------------------------------------------------------- | ------------------------------------- |
| `--artifacts <dir>` resolution + the version line       | yes                                   |
| the incomplete-run warning and `exitCode = 1`           | yes                                   |
| the truncation warning and its `--max-tokens` figure    | yes                                   |
| the cache-requested-but-never-read warning              | yes                                   |
| `--save-payloads`                                       | yes                                   |
| history append, provenance, the dirty-tree note         | yes                                   |
| `createLlmClient` from flags, and the budget it derives | yes                                   |

Each of those is a line an operator reads _while a sweep is running_, or
a file they rely on afterwards. A wrong one is discovered at the price of
the round it spoiled.

## The instrument: a loopback provider, not an injected client

The obvious move is to hand the command a mock `LlmClient`. It is the
wrong one. The CLI constructs its own client from flags -- that
construction, the flag plumbing into it, and the per-call budget are
part of what is untested, and injecting past them would test a path no
operator takes while leaving the real one uncovered. It would also mean
a new production seam existing solely for a test, which is the shallow
interface this repository's principles argue against.

The Ollama provider already gives the seam for free. It takes
`--base-url`, speaks a documented NDJSON protocol over `fetch`, and
returns the extraction payload as bare content -- exactly the shape the
recorded fixtures in `promptlab/tests/fixtures/responses/` already hold.
A `node:http` server on loopback answering `/api/chat` therefore
exercises the entire real path: `createLlmClient`, the flags, the
derived `num_ctx` and `num_predict`, the streaming reader, conformance,
the parser, scoring, aggregation, rendering, history.

Two properties make it a rehearsal rather than a simulation. The fake is
the _server_, so no barwise code is stubbed; and it is fast enough to be
an ordinary test -- the seven train cases complete in well under a
second, against roughly twenty minutes and real money for the same sweep
against Anthropic.

Verified before this spec was written: the probe ran the seven train
cases end to end and reproduced the recorded answer-key scores exactly
(0.98, 0.96, 0.96, 0.94, 0.98, 0.96, 0.94), and the appended history row
carried the right provider, model, split, commit and dirty flag.

## Two hazards found by building the probe

**Keep-alive holds the server open.** Node's `fetch` pools connections,
so `server.close()` waits on a socket that is never coming back and the
test process hangs after the assertions pass. The first probe hung for
four minutes before it was killed. Teardown must call
`closeAllConnections()`. This is recorded here because the symptom --
a green suite that never exits -- points nowhere near its cause.

**The suite's history file lives beside its manifest.**
`historyPathFor` is `dirname(manifest) + "/history.jsonl"`, so a test
that ran the packaged suite would append to the repository's own
recorded history. Every test copies `evals/` to a temp directory first.
A recorded score history that a test can write to is not a record.

## Scope

In scope, as `cli/tests/commands/promptEvalOffline.test.ts`:

- The full train split runs against the loopback provider and reports
  the recorded means, through the real client and the real flags.
- `--artifacts <dir>` resolves a variant and names its version on
  stderr; without it the default artifact is named instead.
- A run whose calls fail warns, excludes those runs from the mean rather
  than scoring them zero, and exits 1.
- A truncated answer warns and names a `--max-tokens` above the ceiling
  that cut it off.
- `--save-payloads` writes the payload of a run that could not be
  scored, and says so when there is nothing to write.
- History: appended by default with provider, model, split and build
  provenance; `--no-history` writes nothing.

Out of scope, deferred and named:

- **Anthropic and OpenAI request shapes.** This rehearses the command,
  not the providers. Their own tests cover request construction, and
  faking either SDK's wire format would be simulation rather than
  rehearsal -- the thing this design is at pains to avoid.
- **Prompt cache accounting.** The cache warning is reachable here only
  by faking fields Ollama does not report. It stays covered where it is
  real (`tests/prompt/cacheablePrefix.test.ts`).
- **Making this the eval suite's own gate.** It rehearses the harness;
  it does not measure a prompt.

## Inventory

| Area                                           | Current state                      | Verdict |
| ---------------------------------------------- | ---------------------------------- | ------- |
| `cli/tests/commands/promptEvalOffline.test.ts` | Does not exist                     | add     |
| `cli/tests/workspace/fakeOllama.ts`            | Does not exist                     | add     |
| `cli/src/commands/prompt.ts`                   | Correct; the subject               | none    |
| `llm/src/providers/ollama.ts`                  | Correct; the seam                  | none    |
| `promptlab/tests/runSuite.test.ts`             | Covers the runner, not the command | none    |

The fake server goes in `tests/workspace/` beside `run.ts`, because it
is the same kind of thing: a way to drive the real program, not a test
of anything itself.

## Risks and testing

- **A rehearsal that passes either way.** The failure mode of every
  sweep-shaped test, and the one barwise-840 was about: the constraint
  sweep asserted a check existed and never that its arithmetic was
  right. Verified by mutation -- seven deliberate breakages, each caught
  by exactly one test, recorded in the test's own header. One-for-one is
  the result worth having: a mutation tripping four tests says they
  overlap, and one tripping none says the assertion was decorative.

  The sharpest of the seven is worth naming here. Resolving the variant
  and then not passing it to `runSuite` leaves the `Using artifact
  version` line intact and sends the default prompt -- a comparative
  round that reports the variant it never ran. Only reading the system
  prompt back off the wire catches it, which is why that assertion
  exists rather than a check on stderr alone.
- **Coverage measured, not assumed.** Tests go through `runCli`
  in process. `llm-usage` shipped seven green tests covering 11% of
  their subject because they drove a subprocess, and the package
  threshold caught it in CI rather than locally.
- **Fixtures drifting from the suite.** The fake matches a request to a
  case by the first line of the case's transcript. If a transcript is
  edited, the match fails loudly (the server answers 404 and the run
  reports failures) rather than quietly serving the wrong payload.
- Full gate: `npm run build`, `test`, `lint` from `barwise/`.

## Non-goals

- No change to `prompt.ts`, to the Ollama provider, or to `runSuite`.
- No change to the suite, the fixtures, or any recorded history.
- No new production code of any kind. If this spec required one, the
  design would be wrong.
