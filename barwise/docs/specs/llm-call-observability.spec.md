# Keep the call records the providers already hand us

Status: Accepted (workstreams 1 and 2 implemented; see Implementation notes)
Created: 2026-08-21
Last-updated: 2026-08-21
Tracking: barwise-815. Related: task #2 (model-tier economics), which
cannot be answered without the numbers this keeps.

## Principle

Explicit over implicit, and composability. Every provider already
reports what a call cost -- `CompletionResponse` carries `modelUsed`,
`usage.promptTokens`, `usage.completionTokens`, and `latencyMs`, and
all three providers populate them. `processTranscript` threads them
into `DraftModelResult`. Then every surface drops them on the floor.

So the system measures what it spends and refuses to remember. There is
no answer to "what did that extraction cost", "how much slower is Opus
on a 16KB transcript", or "how often did we retry last week" without
instrumenting a run by hand, and the model-tier economics question has
been open since it was filed for exactly this reason.

Determinism in the core says where the pieces go. The measurement is
already outside `core` -- it comes back from a network call. What is
missing is a place to put it, and the recording of it is I/O, so it
follows the seam this project has now drawn twice: the value is
computed where it is known and the persistence is supplied by the
caller, exactly as the run date and the build provenance are.

## One record or three? (resolved: one, aggregated differently)

barwise-815 asks whether eval runs, production extractions, and the
optimizer lane want one envelope or three. One, because they differ in
how they are grouped, not in what they measure. A single completion is
the primitive: model, tokens in, tokens out, latency, attempts,
outcome. An eval run is thirty-five of those; an extraction is one; the
optimizer lane is a few thousand. Three record types would triplicate
the same fields and guarantee they drift.

The grouping that distinguishes them is one field, an optional
correlation id, which an eval run sets to its run identity and a
one-off extraction leaves empty.

## Where does the record get made? (resolved: at the client, not the caller)

The obvious place is each call site -- `processTranscript`,
`reviewModel`, `runSuite`. That is three places today and four
tomorrow, each needing the same code, and it is how the divergence this
project keeps finding gets started.

The seam that already exists is `LlmClient`. A recording decorator
wraps any client, forwards `complete`, and emits a record:

```ts
withCallLog(client, sink, { correlationId?: string }) : LlmClient
```

Every surface that builds a client gets recording by wrapping it once,
and nothing that consumes a client changes at all. `processTranscript`,
`reviewModel`, and `runSuite` are untouched -- which is the test of
whether the seam is right.

## What must never be recorded (resolved: the content)

The record carries sizes and identities, never prompt or response text.
Transcripts are client material: this repository's own eval fixtures
were written under a standing constraint that no client-derived content
enter them, and a telemetry log that quietly accumulated the transcripts
users feed it would be a worse version of the same mistake, written to
disk and forgotten.

Token counts, latency, model name, and the prompt hash are enough to
answer every question this spec exists for. If a future need genuinely
requires content, it is a separate decision with a separate consent
story, not a field someone adds because the plumbing is already there.

## Scope

In scope:

- When a wrapped client completes a call, the system shall record the
  model used, prompt and completion token counts where the provider
  reports them, the latency, and whether the call succeeded.
- When a wrapped client's call fails, the system shall record the
  failure and its classification rather than omitting the row.
- When a record is written, the system shall not include prompt or
  response text.
- When no sink is configured, the system shall make no record and add
  no measurable cost to a call.
- When the CLI runs an LLM command with recording enabled, the system
  shall append records to a file under the user's state directory,
  outside the repository.
- When a caller supplies a correlation id, the system shall record it
  on every call made through that client.
- When a usage report runs, the system shall summarise calls by model
  with token totals, call counts, and latency percentiles.
- When a usage report is asked for cost, the system shall require a
  caller-supplied rate table and shall not carry prices of its own.

Out of scope, deferred and named:

- **Recording from MCP and VS Code.** The CLI is where the cost
  question is asked today. Both other surfaces build clients the same
  way and can wrap them later; the decorator is what makes that a
  one-line change rather than a project.
- **A pricing table in the repository.** Prices change without notice
  and a stale one is worse than none, because it produces a confident
  wrong number. See Open decisions.
- **Sampling, batching, or a remote sink.** A local JSONL file is
  sufficient at this volume and has no operational story to maintain.
- **Recording prompt or response content.** Not deferred -- excluded,
  for the reason above.
- **The score history.** `promptlab`'s `history.jsonl` is a committed
  longitudinal record of scores and stays exactly as it is. This is
  operational data with a different lifetime and does not belong in the
  same file.

## Inventory

| Area                                      | Current state                                                       | Verdict     |
| ----------------------------------------- | ------------------------------------------------------------------- | ----------- |
| `llm/src/LlmClient.ts`                    | `provider`, `model`, `complete`; the seam to decorate               | untouched   |
| `llm/src/observe/callLog.ts`              | Does not exist; the record type and `withCallLog`                   | new (W1)    |
| `llm/src/providers/*`                     | All three already report usage and latency                          | untouched   |
| `llm/src/TranscriptProcessor.ts`          | Threads usage into `DraftModelResult`; no persistence               | untouched   |
| `llm/src/review/reviewModel.ts`           | Takes a client; unaware of recording                                | untouched   |
| `promptlab/src/run/runSuite.ts`           | Records `attempts` and `failureKind` per run, in memory only        | untouched   |
| `cli/src/workspace/callLogSink.ts`        | Does not exist; the JSONL sink and its path                         | new (W2)    |
| `cli/src/commands/{import,review,prompt}` | Build clients via `createLlmClient`                                 | modify (W2) |
| `cli/src/commands/llm-usage.ts`           | Does not exist; the report                                          | new (W3)    |
| `learn` gym session log                   | Already writes under `$XDG_STATE_HOME/barwise/`; the path precedent | untouched   |

The three consumers of `LlmClient` are all listed untouched, and that
is the load-bearing claim of this design rather than an incidental one.
If wiring observability required editing `processTranscript`,
`reviewModel`, and `runSuite`, the decorator would not be earning its
place and the call sites would be the right home after all.

## Target architecture

```ts
// llm/src/observe/callLog.ts
export interface LlmCallRecord {
  readonly startedAt: string; // caller-supplied clock, as everywhere
  readonly provider: string;
  readonly model: string | undefined; // what the client meant to use
  readonly modelUsed?: string; // what answered, when reported
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly latencyMs?: number;
  readonly ok: boolean;
  readonly errorKind?: string; // classification, never the message
  readonly correlationId?: string;
  // A promptHash would tie a call to the prompt that made it. Deferred;
  // see the workstream 1 implementation note.
}

export interface CallLogSink {
  record(entry: LlmCallRecord): void;
}

export function withCallLog(
  client: LlmClient,
  sink: CallLogSink,
  options?: { correlationId?: string; now?: () => string; },
): LlmClient;
```

`now` is injected rather than read, so the decorator stays testable and
the package keeps its no-clocks rule intact; the CLI passes
`() => new Date().toISOString()`.

`errorKind` is a classification, not a message. Provider error strings
can carry request context, and a log that quietly accumulated them
would drift back toward recording content.

## Workstreams (each independently shippable)

### 1. The record and the decorator

Add `LlmCallRecord`, `CallLogSink`, and `withCallLog` to `@barwise/llm`.
Nothing wraps anything yet, so behaviour is unchanged. Acceptance: when
a client wrapped with a recording sink completes a call, the system
shall emit one record carrying the model, token counts, and latency;
and when the same client is wrapped with no sink, the system shall emit
nothing and return the provider's response unchanged.

### 2. The CLI sink

A JSONL sink under `$XDG_STATE_HOME/barwise/`, matching where the gym
already writes, wired into the commands that build clients. Acceptance:
when `barwise import transcript` runs with recording enabled, the
system shall append one record per call to the state-directory log; and
when recording is disabled, the system shall create no file.

### 3. The report

`barwise llm-usage` over the log. Acceptance: when the report runs over
a log containing calls from two models, the system shall present per
model the call count, token totals, and median and 95th-percentile
latency; and when `--rates <file>` is supplied, the system shall also
present cost derived from those rates.

That third workstream is what closes task #2, which has been unanswerable
since it was filed.

## API and migration impact

- `@barwise/llm` gains three exports. No existing export changes.
- No package gains a dependency.
- No existing command changes behaviour when recording is off, which
  is the default.

## Open decisions (for review)

- **Opt-in or opt-out?** Recording costs nothing and answers questions
  nobody can currently answer, which argues for on-by-default.
  Writing to a user's disk without being asked argues the other way.
  Recommend opt-in via a `BARWISE_CALL_LOG` environment variable for
  one release, then revisit with evidence about whether anyone turned
  it on -- an opt-in nobody enables is a feature that does not exist.
- **Where do rates come from?** Cost needs prices, prices go stale, and
  a stale price produces a confidently wrong number. Recommend the repo
  ship no prices and `--rates <file>` take a small user-maintained
  JSON. The alternative -- a checked-in table with a "last verified"
  date -- is friendlier for one release and misleading for every
  release after.
- **Should the eval harness set a correlation id automatically?**
  `runSuite` knows its suite version and artifact; it could correlate
  every call in a sweep. Recommend yes, using the same prompt hash the
  history row already carries, so a spend figure can be attributed to a
  specific eval run. It is the one place the id is free.
- **Retention.** The log grows without bound. Recommend nothing in the
  first cut -- a JSONL file the user can delete is a smaller problem
  than a rotation policy nobody asked for -- but say so in the docs
  rather than leaving it as an accident.

## Risks and testing

- **The decorator must not change what callers see.** Its test asserts
  the wrapped client returns the provider's response unchanged,
  including on failure, and that a throwing sink cannot break a call --
  observability that can fail the operation it observes is worse than
  none.
- **Content must not leak into a record.** A test asserts that a record
  built from a request with a distinctive prompt and response contains
  neither.
- **No clocks in the package.** The `now` injection is the guard; a
  test passes a fixed clock and asserts the recorded timestamp.
- Full gate after each workstream: `npm run build`, `test`, `lint` from
  `barwise/`.

## Implementation notes

### Workstream 1 (2026-08-21)

Shipped as specified, inert: `withCallLog` exists and nothing wraps
anything yet, so no behaviour changed. The design's load-bearing claim
held -- `processTranscript`, `reviewModel`, and `runSuite` are all
untouched, which is what says the decorator is at the right seam rather
than the call sites.

- **Deferred: `promptHash` on the record.** The sketch above carried
  one. `hashPrompt` lives in `@barwise/promptlab`, which depends on
  `@barwise/llm` and not the other way round, so the decorator cannot
  reach it. The honest options are to move the hasher into `llm` --
  arguably where it belongs, since `llm` is what builds the prompt --
  or to duplicate it. Neither is worth doing for a field nothing reads
  yet, so it waits for workstream 2, where a sink will actually consume
  it. Recorded rather than silently dropped because a reader comparing
  the sketch to the code would otherwise wonder which is wrong.
- **A throwing sink is swallowed silently, not reported.** The
  alternative -- warning on stderr -- would print noise into the middle
  of a command's real output, on every call, for a failure the operator
  cannot act on mid-run. Its test asserts the call still returns.
- **`errorKind` classification is duplicated, deliberately.** The
  classifier mirrors `promptlab`'s retry classifier without importing
  it, for the same graph-direction reason as the hash. This is the DRY
  exception the design principles describe: a few lines of parallel
  code beat inverting a package dependency.
- **A call with no usage still produces a record.** Copilot reports no
  token counts; a row saying a call happened at all is still worth
  more than a gap.

## Non-goals

- No change to any provider, to `processTranscript`, to `reviewModel`,
  or to `runSuite`.
- No dashboards, no remote collection, no background process.
- No prompt or response text, ever, under any flag.
- No change to `promptlab`'s score history, which measures something
  else on a different clock.

### Workstream 2 (2026-08-22)

Shipped, fourteen months of inertness later measured in days: the
decorator had zero call sites from the moment it landed until now.

`cli/src/workspace/callLogSink.ts` supplies the JSONL sink under the
state directory the gym already uses, gated on `BARWISE_CALL_LOG`. Both
`barwise import transcript` and `barwise import batch` wrap their client
and pass the same sink as `ProcessorOptions.observer`, so what a call
cost and what the pipeline did with its answer land in one file,
correlated by a per-import id.

- **The deferred `promptHash` is still deferred.** Workstream 1 left it
  for "when a sink will actually consume it". The sink exists now and
  still does not consume it: `hashPrompt` lives in `promptlab`, which
  depends on `llm` and not the reverse, and the honest fix is moving the
  hasher into `llm` rather than duplicating it. Not worth doing inside
  a workstream about persistence.
- **Workstream 3 remains unbuilt.** The log accumulates and nothing
  reads it. Task #2 is unblocked, not answered.
