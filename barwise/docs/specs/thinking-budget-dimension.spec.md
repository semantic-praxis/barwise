# The thinking budget as a measured experiment dimension

Status: Approved for implementation (no suite bump: the scorer is
untouched; what changes is what a run can send and what its history
row records)
Created: 2026-08-29
Last-updated: 2026-08-29
Tracking: the haiku thinking question raised 2026-08-29; builds on
`docs/specs/output-budget.spec.md` (whose per-call budget this
interacts with) and the history provenance conventions.

## Principle

The recorded arms have been comparing two thinking regimes without
saying so: the Anthropic provider sends no `thinking` parameter, which
on Haiku 4.5 (a pre-4.6 model) means thinking OFF and on Sonnet 5
means adaptive thinking ON by default. Haiku's whole record is
no-thinking haiku. The hypothesis worth money -- a smaller model at a
higher thinking level matching a larger one -- is currently
unaskable, and the asymmetry is unrecorded.

The harness's own rule applies: an experiment dimension exists when a
run can set it AND the record can say it was set. A thinking budget
changes scores without changing `promptHash`, provider, or model, so
an unrecorded budget makes two history rows indistinguishable --
exactly the ambiguity `promptHash` and `build` exist to prevent.

## Scope (EARS)

- When `AnthropicClientOptions.thinkingBudget` is set, the provider
  shall send `thinking: {type: "enabled", budget_tokens: N}` on both
  completion paths, and shall raise the request's `max_tokens` by N --
  on these models thinking spends inside `max_tokens`, and the output
  budget (`suggestMaxTokens`) prices the ANSWER; without the raise, a
  thinking run would truncate answers the same budget fit yesterday.
- When `thinkingBudget` is set on a non-Anthropic client, the factory
  shall refuse at construction, naming the option and the provider --
  explicit over implicit; Ollama and OpenAI have no such parameter.
- When `barwise prompt eval` or `barwise prompt run` receives
  `--thinking-budget <n>`, the CLI shall validate it before any client
  is created (an integer, at least 1024 -- the API minimum) and pass
  it through `createLlmClient`. Production commands (`import
  transcript`, `review`) get no flag: like `--artifacts`, this is a
  measurement dimension until a measured winner is promoted, at which
  point promotion is its own reviewed change.
- When a recorded run used a thinking budget, the history row shall
  carry `thinkingBudget`, and `barwise prompt history` shall render it
  beside the artifact -- absent means what it always meant, no
  parameter sent.
- The capability matrix gains the row; the gap on MCP/VS Code is
  deliberate (an experiment dimension, not a user surface).

## What this does not decide

Model-specific dial mapping stays the caller's knowledge: Sonnet 5
rejects `budget_tokens` with a 400, and that 400 arrives on the run's
first call -- before meaningful spend, loudly, naming the parameter.
The flag does not translate budgets into Sonnet's `effort` dial;
if effort experiments are wanted later they are a separate option with
separate recording, not an overload of this one.

## Sequencing and the first experiment

Lands independently of suite versioning (rows at any suite version are
comparable across thinking budgets only via their recorded field).
The first spend should NOT be a full arm: the suite is
near-saturated for haiku, so the designed probe is targeted --
conference-reviews (haiku's one reproducible bimodal regression),
`--repeat 5`, budgets {off, 4096, 16384} -- 15 calls to learn whether
thinking closes the Reviewer-Paper drop, before any wider sweep.

## Workstreams

1. Provider + factory: `thinkingBudget` through
   `AnthropicClientOptions` and `createLlmClient`, the max_tokens
   raise, the non-Anthropic refusal, unit tests on the request shape
   (the provider is testable by injecting the lazily-built client).
2. CLI + provenance: the flag on `eval` and `run` with pre-spend
   validation, `thinkingBudget` on the history entry and in the
   history rendering, offline tests (validation rejects bad values and
   the Ollama loopback refuses the flag cleanly, both before spend).
3. Docs: runbook gains the probe block; capability matrix row.
