# Stop paying full price for the same 5,780 tokens fifty times

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-822. Follows the output-budget work (barwise-818,
barwise-821), which is what made the fixed prefix visible.

## Principle

DRY, in the one place the project's own guidance says duplication is
not a style question. Every extraction call sends a byte-identical
5,780-token preamble -- the system prompt and the response schema --
and pays full input price for it every time. A `--repeat 5` sweep over
ten cases sends that preamble fifty times: 289,000 input tokens of pure
repetition to obtain ten distinct answers.

Also **explicit over implicit**. Caching is a prefix match, so it is
decided by the physical order of what we send, not by an option. That
ordering is currently correct by luck rather than by intent, and
nothing says so or checks it.

## What was measured

Fixed overhead per call, before a single line of transcript:

| Component                                   |  Chars | ~Tokens |
| ------------------------------------------- | -----: | ------: |
| System prompt (`buildSystemPrompt(false)`)  | 18,158 |   4,540 |
| Response schema (the tool's `input_schema`) |  4,719 |   1,180 |
| User-message scaffold                       |    231 |      58 |
| **Total fixed**                             | 23,108 |   5,780 |

For the seven seed cases the transcript is **6%** of what we send
(382 of 6,159 tokens); the rest is our own prompt, identical on every
call. Even `vendor-onboarding`, the largest, is only 43% transcript.

## Why the current layout already works (and must be pinned)

The API renders a request as `tools` -> `system` -> `messages`, and a
cache breakpoint covers everything before it. Our stable content is
exactly the first two -- the schema rides in `tools` as the extraction
tool's `input_schema`, the prompt is `system` -- and the only thing
that varies per case, the transcript, is last in `messages`.

That is the textbook shape, and it is an accident of how the extraction
call was written. Nothing states the dependency, so a later change that
moved the transcript earlier, or interpolated a date into the system
prompt, would silently cost the entire saving with no test failing.
This spec makes the ordering a stated invariant.

## The number that decides whether this works at all

The minimum cacheable prefix is model-dependent and **not monotonic**
across generations:

| Model         |   Minimum | Our ~5,780-token prefix |
| ------------- | --------: | ----------------------- |
| Opus 5        |       512 | caches                  |
| Sonnet 5      |     1,024 | caches                  |
| **Haiku 4.5** | **4,096** | caches, margin 1,684    |

Below the minimum there is no error. `cache_creation_input_tokens`
stays 0 and nothing else changes. Haiku 4.5 has the highest minimum of
any current model and is the model being evaluated, so it sets the
floor -- and a shorter prompt variant could drop under it without a
single visible symptom. That earns a test, not a hope.

## Two breakpoints, not one

The suite runner iterates case-outer, repeat-inner, so the samples of
one case send a byte-identical transcript back to back. Two breakpoints
therefore capture two different kinds of repetition:

| Breakpoint         | Covers                      | Reused by                     |
| ------------------ | --------------------------- | ----------------------------- |
| Last system block  | tools + system (~5,780 tok) | every call in the run         |
| User message block | + the transcript            | repeats 2..n of the same case |

They are decided separately because their break-even conditions differ.
A cache write costs 1.25x and a read 0.1x, so a breakpoint pays off
only from the second request that reads it. The system breakpoint is
worth setting whenever the run makes at least two calls at all; the
transcript breakpoint is worth setting only when `repeat >= 2`. A
single boolean would force one of those two decisions to be wrong.

## Scope

In scope:

- When a completion request asks for its system prompt to be cached,
  the provider shall mark the system block accordingly.
- When a completion request asks for its user message to be cached, the
  provider shall mark that block accordingly.
- When the eval runner will make at least two calls, it shall request
  system-prompt caching; and when it will repeat a case, it shall also
  request user-message caching.
- The rendered prefix shall be asserted to exceed the highest current
  minimum, so a prompt change that silently disables caching fails a
  test instead of a budget.

Out of scope, deferred and named:

- **Reporting cache hits in the eval output.** `cache_read_input_tokens`
  is genuinely useful -- it is the only way to confirm caching is
  working rather than assumed -- but `CompletionResponse.usage` has no
  field for it and adding one touches every provider. Filed as
  barwise-823, and it should come before any wider caching default:
  without it there is no way to tell caching working from caching
  silently costing 25% more.
- **`processTranscript` caching.** A one-shot import reads the cache
  zero times and pays the 1.25x write for nothing. It becomes worth
  doing if a caller repeatedly extracts within a 5-minute window, which
  no current caller does in a single import -- but an interactive
  session plausibly does, which is barwise-824.
- **The 1-hour TTL.** Doubles the write cost and needs three reads to
  pay off. The default 5-minute TTL is ample: eval calls run
  back-to-back, well inside it.
- **Pre-warming.** Trades a write now for lower latency on the first
  real call. Irrelevant to a batch sweep where nothing is waiting.

## Inventory

| Area                             | Current state                     | Verdict   |
| -------------------------------- | --------------------------------- | --------- |
| `llm/src/LlmClient.ts`           | No cache hints on the request     | modify    |
| `llm/src/providers/anthropic.ts` | Sends `system` as a bare string   | modify    |
| `llm/src/providers/openai.ts`    | Caches automatically, server-side | untouched |
| `llm/src/providers/ollama.ts`    | No caching concept                | untouched |
| `promptlab/src/run/runSuite.ts`  | Requests no caching               | modify    |
| `llm/tests/prompt/`              | Nothing pins the prefix size      | new test  |

## Workstreams

### 1. Ask for caching

`CompletionRequest.cacheSystemPrompt` and `cacheUserMessage`, honoured
by the Anthropic provider. Acceptance: when a request asks for its
system prompt to be cached, the provider shall send the system as a
block carrying `cache_control`; and when it does not, the request shall
be byte-identical to what it sends today.

### 2. Use it in the eval lane

Acceptance: when a run will make two or more calls, it shall request
system caching; and when `repeat` is 1, it shall not request
user-message caching.

### 3. Pin the prefix above the minimum

Acceptance: when the rendered system prompt and schema fall below the
highest current minimum cacheable length, a test shall fail.

## Risks and testing

- **A cache hint reaching a provider that ignores it** is fine and must
  stay fine. OpenAI caches server-side with no client control and
  Ollama has no cache; both ignore the fields. This is a hint, not a
  command, and the interface doc must say so -- otherwise a reader
  concludes caching is on for every provider.
- **The estimate in the guard test is chars/4, not a real tokenizer.**
  It is a tripwire against a large regression, not a measurement. The
  margin it asserts is wide enough that tokenizer disagreement cannot
  flip it, and the alternative -- `countTokens` -- needs a network call
  and an API key, which no test here may have.
- **Caching must not change what is measured.** It reuses the prefill
  of byte-identical tokens; the model sees the same input either way.
  The answer-key test pinning `order-management` at 0.98 covers this.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to the prompt text, the scorer, or the suite.
- No 1-hour TTL, no pre-warming, no cache-hit reporting yet.
