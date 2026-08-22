# Report cache hits, so caching is confirmed rather than assumed

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-823. Follows barwise-822, which turned caching on
without any way to see whether it works.

## Principle

Define errors out of existence -- or, failing that, make them visible.
Prompt caching fails silently by construction. Below a model's minimum
cacheable length, or after any byte change in the prefix, nothing
errors: `cache_creation_input_tokens` is simply 0, the request
succeeds, and the only symptom is a bill nobody reads.

That is the same shape as every defect this line of work has turned up
(barwise-818, 826, 827): a plausible wrong number and no error. The
difference is that here the failure mode was known in advance, so
shipping the feature without the instrument was the mistake.

## What is at stake

The prefix is ~5,780 tokens and Haiku 4.5 requires 4,096 to cache at
all -- a margin of 1,684 tokens, and Haiku has the highest minimum of
any current model. `cacheablePrefix.test.ts` guards the size, but it
cannot guard the thing that actually matters: whether the provider
returned a cache read. Only the provider can say that.

A `--repeat 5` sweep is 50 calls sending that prefix. Working, it costs
one write and 49 reads. Broken, it costs 50 writes at 1.25x -- **more
than not caching at all** -- and looks identical from the outside.

## The trap this creates, named now

Once caching is on, `input_tokens` is the **uncached remainder**, not
the prompt size. The total is
`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
Any cost reporting that reads the first field alone will under-report
by the cached portion, which after this change is most of it. The field
docs must say so, because the natural reading is wrong.

## Scope

In scope:

- A completion response shall report tokens written to and read from
  the cache, where the provider reports them.
- A scored run shall keep both, alongside the tokens it already keeps.
- When a run asked for caching and no call read anything back, the
  report shall say so. Silence is what this spec exists to remove.
- The verbose line shall show cache reads as they happen, so a sweep
  that is not caching can be stopped in the first minute rather than
  the fiftieth call.

Out of scope, deferred and named:

- **Cost estimation in currency.** Needs a price table per model, which
  goes stale and is a different concern from whether the mechanism
  works.
- **Ollama and the cache fields.** It has no prompt cache; the fields
  stay absent rather than being reported as zero, which would claim a
  measurement that was never made.
- **Acting on a cache miss automatically.** Retrying or re-ordering the
  prompt in response would hide the very signal being added.

## What belongs in the longitudinal record

A history row should carry what a _future_ reader can act on, and that
is the line drawn here.

**In:** the four token totals -- prompt, completion, cache read, cache
write. They do not bear on comparability (caching is score-neutral; the
model sees identical tokens either way), which is what every other
field in a row is for. They earn their place on a different ground: cost
is a longitudinal question, and these four numbers let a later reader
reconstruct it against whatever price table exists then, without this
package committing to one now. That is precisely what the open
model-tier economics question needs and cannot currently answer.

**Out:** stop reasons, request ids, HTTP statuses. Those diagnose a run
that is happening; a request id in a row from three weeks ago is a
string nobody can use. They stay on `CaseRun`, which is the report, not
the record.

## Inventory

| Area                             | Current state                      | Verdict   |
| -------------------------------- | ---------------------------------- | --------- |
| `llm/src/LlmClient.ts`           | `usage` has prompt/completion only | modify    |
| `llm/src/providers/anthropic.ts` | Discards both cache counters       | modify    |
| `llm/src/providers/openai.ts`    | Discards `prompt_tokens_details`   | modify    |
| `llm/src/providers/ollama.ts`    | No cache to report                 | untouched |
| `promptlab/src/run/runSuite.ts`  | No cache totals                    | modify    |
| `cli/src/commands/prompt.ts`     | Nothing rendered, nothing warned   | modify    |

## Workstreams

### 1. Carry the numbers

`CompletionResponse.usage.cacheReadTokens` and `cacheWriteTokens`,
populated by Anthropic and OpenAI. Acceptance: when a provider reports
a cache read, the response shall carry it; and when a provider reports
nothing, the fields shall be absent rather than zero.

### 2. Total them per run

Acceptance: when a sweep completes, the report shall carry the tokens
read from and written to the cache across every call.

### 3. Say when it did not work

Acceptance: when a run requested caching, made more than one call, and
read nothing back, the operator shall be told -- naming the likely
cause, since the mechanism has exactly two (a prefix below the model's
minimum, or a prefix that changed between calls).

## Risks and testing

- **A false alarm would be worse than none.** The first call of any run
  writes and reads nothing, so the warning must require more than one
  call before it can fire. Tested.
- **A provider that reports nothing must not look like a cache miss.**
  Ollama has no cache; absent fields and zero reads mean different
  things, and only the former should be silent.
- **The warning must not fire when caching was never requested.** A
  single-call run deliberately asks for nothing (barwise-822).
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to what is cached or when.
- No currency, no price tables.
- No automatic remediation.
