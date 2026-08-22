# Stop scoring truncated responses as though the prompt failed

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-818. Found while running the dev split for the first
time (2026-08-22).

## Principle

Explicit over implicit. The harness already draws a careful line
between a call the provider never answered (excluded from the mean, per
barwise-806) and an answer that could not be scored (a real zero). A
third case has been silently landing in the second bucket: an answer
the provider cut off because it ran out of output tokens.

That is not a measurement of prompt quality. It measures the budget the
caller set. Scoring it zero is the same category error barwise-806
fixed for failed calls, and it is worse for being invisible -- a failed
call at least reports an error, while a truncated one comes back as
well-formed JSON containing almost nothing.

## How this surfaced (measured, not hypothesised)

The first run against the dev split produced three consecutive
near-zero scores on `vendor-onboarding` with the default artifact:
`0.000`, `0.000`, `0.133` -- the last being one rubric check of six.
The payload parsed, so nothing marked it unscorable; it simply
contained too little to satisfy anything.

The cause is a size gap nobody accounted for when the dev transcripts
were written. Calibrating from the seven recorded seed payloads:

| Transcripts      | Size         | Payload/transcript ratio |
| ---------------- | ------------ | ------------------------ |
| Seven seed cases | 1.0-1.6 KB   | 4.0 to 9.7, mean 5.95    |
| Three dev cases  | 13.1-17.2 KB | not yet observed         |

At the mean ratio the dev cases need roughly 19,500 to 25,500 output
tokens. At the densest observed ratio, `vendor-onboarding` needs closer
to 41,000. The provider default is **8,192**, so every dev case is two
to five times over budget, and the extraction is cut off mid-structure
every time.

Both provider SDKs report this and the code throws it away.
`stop_reason: "max_tokens"` on Anthropic and
`finish_reason: "length"` on OpenAI never reach `CompletionResponse`.

## Should a truncated run be excluded or scored? (resolved: excluded)

Excluded, with the same machinery as a failed call.

The case for scoring it is that a more concise prompt would have fit,
so the overflow is partly the prompt's doing. That argument fails on
the numbers: a faithful extraction of a 17 KB transcript legitimately
needs more than 8,192 tokens, and no prompt wording changes that. What
the score would be measuring is the caller's budget.

Excluding it also reuses what already exists. `runSuite` counts
exclusions as failures, `SuiteReport.complete` goes false, and
`appendRunHistory` then refuses to record the run without `--force`.
A truncated sweep therefore cannot quietly become a row in the
longitudinal record, which is precisely what nearly happened today.

## Where does the budget come from? (resolved: the call, with a derived default)

The provider holds one `maxTokens` for its lifetime, fixed at
construction. That is the wrong grain: one client runs cases of wildly
different sizes, and the budget a 1 KB transcript needs is not the
budget a 17 KB one needs.

So `CompletionRequest` gains an optional `maxTokens` that overrides the
client's default for that call, and the eval runner derives one per
case from the transcript length. The derivation is a heuristic and is
therefore stated where a reader can see and change it, not buried:

    tokens ~= transcript_chars * RATIO / CHARS_PER_TOKEN, floored at the
    client default and capped

`RATIO` comes from the recorded payloads rather than from intuition,
and uses the **densest** observed case rather than the mean -- under-
budgeting silently corrupts a measurement while over-budgeting only
permits one, so the two errors are not symmetric.

## Scope

In scope:

- When a completion request carries `maxTokens`, the provider shall use
  it in place of its own default for that call.
- When a provider reports that a response was cut off at the output
  limit, the response shall say so.
- When a scored run's response was truncated, the runner shall exclude
  it from the mean and count it as a failure rather than scoring it.
- When a run is excluded for truncation, the report shall name
  truncation as the reason, distinctly from a provider failure.
- When the eval runner processes a case, it shall derive an output
  budget from that case's transcript length, never below the client's
  own default.
- When the operator passes an explicit budget, it shall override the
  derived one for every case in the run.

Out of scope, deferred and named:

- **Retrying a truncated call with a larger budget.** Attractive and
  wrong for an eval: silently re-running with different settings makes
  two samples incomparable. The operator raises the budget and re-runs.
- **Splitting a long transcript across calls.** A real feature for
  production extraction and a different spec.
- **Per-model output ceilings.** Models differ, the SDKs do not expose
  the limit, and a hardcoded table would go stale. The cap here is a
  conservative constant the operator can exceed explicitly.
- **`processTranscript` deriving its own budget.** Production extraction
  has the same problem and should get the same treatment, but it has no
  measured calibration data behind it yet. See Open decisions.

## Inventory

| Area                                  | Current state                                                  | Verdict   |
| ------------------------------------- | -------------------------------------------------------------- | --------- |
| `llm/src/LlmClient.ts`                | `CompletionRequest` has no budget; response has no stop reason | modify    |
| `llm/src/providers/anthropic.ts`      | `max_tokens: this.maxTokens`; discards `stop_reason`           | modify    |
| `llm/src/providers/openai.ts`         | Same shape; discards `finish_reason`                           | modify    |
| `llm/src/providers/ollama.ts`         | Same shape                                                     | modify    |
| `llm/src/budget.ts`                   | Does not exist; the calibrated derivation                      | new       |
| `promptlab/src/run/runSuite.ts`       | Scores every parseable payload, truncated or not               | modify    |
| `cli/src/commands/prompt.ts`          | No budget flag                                                 | modify    |
| `promptlab/tests/fixtures/responses/` | The calibration data                                           | untouched |

## Workstreams

### 1. Report and honour the budget

`CompletionRequest.maxTokens`, `CompletionResponse.truncated`, all
three providers. Acceptance: when a request carries `maxTokens`, the
provider shall send that limit; and when the provider reports the
output limit as the stop reason, the response shall be marked
truncated.

### 2. Exclude truncated samples

Acceptance: when a case's response is truncated, the run shall be
counted as a failure and excluded from the mean, and the report shall
distinguish it from a call the provider never answered.

### 3. Derive and override the budget

`suggestMaxTokens`, wired into `runSuite`, with `--max-tokens` on
`barwise prompt eval`. Acceptance: when a 17 KB transcript runs, the
derived budget shall exceed the 8,192 default; and when `--max-tokens`
is given, every call shall use it.

## Decisions taken

- **Production extraction derives a budget too.** `processTranscript`
  had the same exposure -- a user importing a long transcript got a
  silently truncated model with no warning -- and the split treatment
  was not defensible: the eval lane would have been protected against a
  failure the product still shipped. It derives the same way and
  surfaces `truncated` as the _first_ warning on `DraftModelResult`,
  ahead of the conformance warnings, because it is the one that changes
  what the whole result means. It still returns the partial model
  rather than throwing: the call has been paid for, and half a model
  with a warning beats nothing.
- **The cap is 64,000, not the 32,000 first proposed.** Measuring the
  actual transcripts contradicted the draft. At the densest ratio,
  `vendor-onboarding` (17,171 bytes) derives about 41,600 tokens and
  `subscription-billing` about 35,300 -- so a 32,000 cap would have
  left two of the three cases that motivated this spec silently
  truncated, while looking like prudence. A cap that re-creates the bug
  is not a safe default, it is a quiet one.

  The cost is stated rather than hidden: a model with a lower ceiling
  of its own (gpt-4o allows 16,384) now rejects the request outright.
  That is a 400 carrying a status, an error type, and a request id --
  all three recorded by the runner as of this change -- and the remedy
  is one `--max-tokens` away. Being told a budget is impossible beats
  being handed a fragment that scores like a bad prompt.
- **The ratio is the densest observed, 9.69.** As argued above: the two
  errors are not symmetric. An under-budget run produces a plausible
  wrong number; an over-budget one costs nothing at all, because
  providers bill generated tokens rather than permitted ones.

## Added during implementation: the rest of what the providers said

The spec as drafted recovered one discarded field. Reviewing the call
path showed the same thing was true of several others, all of them
wanted for the same reason -- diagnosing a sweep that has already
finished:

- `CompletionResponse.stopReason` carries the provider's own word
  unmapped, alongside the derived `truncated`. A normalized enum would
  have to invent names for reasons this code has never seen, and the
  raw string is what provider documentation is written against.
- `CaseRun` keeps `promptTokens`, `outputTokens` and the `maxTokens`
  the call was given. The pair is the whole story: equal values are a
  truncation, and a near-equal pair on a _healthy_ run is the warning
  that the next slightly longer transcript will not fit. So it is
  recorded when nothing is wrong, and rendered on every verbose line.
- `describeProviderError` pulls `status`, `errorType` and `requestId`
  off a failed call. The message alone is a poor bug report: it is the
  field the SDKs reword between releases, and it never carries the
  request id, which is the only handle anyone has on a call that has
  already happened.

## Risks and testing

- **The truncation flag must not fire on a normal stop.** A response
  that ended because the model finished is not truncated, and marking
  it so would exclude every healthy sample. Its own test per provider.
- **Excluding truncated runs makes a sweep incomplete**, which means
  `appendRunHistory` refuses it. That is the intent, and it is what
  keeps a truncated run out of the record -- but it will surprise an
  operator, so the message must name truncation.
- **The derived budget must never go below the client default**, so
  existing small cases behave exactly as before.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to the scorer, the rubrics, or the suite.
- No retry-on-truncation.
- No per-model token tables.
