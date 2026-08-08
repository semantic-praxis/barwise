# Prompt eval: Sonnet 5 extraction variant (delta report)

Date: 2026-08-08
Suite: `@barwise/promptlab` seed suite 1.0.0 (4 cases), weights 0.02 /
correction, 0.10 / validation error
Candidate artifact: `packages/llm/prompts/extraction.sonnet5.prompt.yaml`
(version `sonnet5-1`, matches provider `anthropic` + modelPrefix
`claude-sonnet-5`)
Baseline: Claude Fable 5 on the default artifact (1.0.0)

## Measurement channel (read this first)

This session had no Anthropic API key, so these runs did NOT go through
`barwise prompt eval` / the `AnthropicLlmClient` tool-use path. Each
completion was produced by a Claude Code subagent pinned to the target
model, given the byte-exact production system prompt, user message, and
response schema, and instructed to emit only the raw extraction JSON.
Scoring is the normal deterministic path (`scoreExtraction`: parse ->
`enforceConformance` -> rubric -> penalties), run locally.

Consequences:

- The agent harness adds its own scaffolding around the prompt and does
  not constrain output with `tool_choice`, so absolute scores are not
  directly comparable to API-channel scores. Comparisons WITHIN this
  report (same channel on both sides) are meaningful.
- Nothing was appended to `evals/history.jsonl` -- that file is reserved
  for the production path. The acceptance gate for this variant is a
  keyed run on the maintainer's machine:

  ```sh
  barwise prompt eval --provider anthropic --model claude-sonnet-5        # default artifact
  barwise prompt eval --provider anthropic --model claude-sonnet-5 \
    --artifacts packages/llm/prompts                                      # sonnet5-1 variant
  barwise prompt eval --provider anthropic --model claude-fable-5         # baseline row
  ```

- One sample per case (`repeat=1` equivalent). Per the spec, a score is
  a sample; re-run with `--repeat 3` before trusting small deltas.

## Suite defect found and fixed (order-management)

The order-management transcript contains the exact sentence the system
prompt uses as its canonical ternary example ("Each line in the order
specifies a product and a quantity"), and the prompt instructs modeling
it as a ternary "Order contains Product with Quantity" with composite
uniqueness. The recorded answer key predated that rule and modeled a
binary "Order contains Product"; the generated reference inherited it.
Because `forbids_population` maps counterexample witnesses by
player-name multiset, any prompt-compliant (ternary) extraction failed
the "Customer places Order is mandatory" check with "no fact type
matching" -- the metric punished exactly what the prompt instructs, and
an optimizer chasing it would have learned to violate the ternary rule.

Fix: the promptlab answer key now models the ternary (Quantity value
type, three-role fact type, composite uniqueness on Order+Product), and
the reference was regenerated from it through the production parse path.
The answer key still passes its full rubric at the pinned score (0.98,
1 conformance correction), so `tests/scoreExtraction.test.ts` is
unchanged. The `@barwise/llm` copy of the fixture
(`packages/llm/tests/fixtures/responses/order-management.json`) is
intentionally untouched -- it pins the parsing pipeline, not the rubric;
the two copies now differ deliberately.

## Scores

Default artifact (1.0.0), one sample per case:

| Case                  | Fable 5 (baseline) | Sonnet 5          |
| --------------------- | ------------------ | ----------------- |
| order-management      | 0.980              | 1.000             |
| university-enrollment | 0.533              | 1.000             |
| clinic-appointments   | 0.447              | 1.000             |
| employee-hierarchy    | 0.700              | 0.700             |
| **mean / worst**      | **0.665 / 0.447**  | **0.925 / 0.700** |

(Scores above are against the fixed suite; before the reference fix,
order-management read 0.813 / 0.833 for Fable / Sonnet.)

Candidate artifact `sonnet5-1` on Sonnet 5: see the table below,
appended after the candidate runs.

## Failure analysis driving the variant

Every rubric failure below 1.0 in the default-artifact runs, on both
models, traces to one family: populations that are partial or that
contradict the model's own constraints.

- Sonnet 5 / employee-hierarchy: a "Department has DepartmentName"
  population whose instances carry only the DepartmentName role value.
  Two instances with an absent Department value collide on the unique
  Department role -> uniqueness violation -> must_validate fails.
- Fable 5 / university-enrollment: Course examples captured without the
  paired CourseCode identifier instances -> mandatory identifier role
  unpopulated -> 3 validation errors.
- Fable 5 / clinic-appointments and employee-hierarchy: duplicate
  instances violating the model's own single-role uniqueness.

The default prompt invites this: its Populations section offers
"Status can be scheduled, completed, or cancelled" as a population
example -- a one-role value list that belongs in a value_constraint.

## Variant changes (sonnet5-1 vs default)

Two localized edits; everything else byte-identical to the default:

1. Populations section rewritten: instances must supply a value for
   every role; enumerated value lists go to value_constraint, not
   populations; populations must satisfy the model's own uniqueness and
   mandatory constraints (identifier fact types above all) or be
   omitted; genuine example-vs-constraint conflicts become ambiguities.
2. Critical Rules addition: populations are optional, and an incomplete
   or constraint-violating population invalidates the model.

The same failure family appears in the Fable 5 baseline, so these edits
are candidates for the default artifact too -- deferred until a keyed
`barwise prompt eval` run can gate that change for all providers.

## Candidate results (same channel)

| Case                  | Sonnet 5 default  | Sonnet 5 sonnet5-1 |
| --------------------- | ----------------- | ------------------ |
| order-management      | 1.000             | 1.000              |
| university-enrollment | 1.000             | 1.000              |
| clinic-appointments   | 1.000             | 1.000              |
| employee-hierarchy    | 0.700             | 1.000              |
| **mean / worst**      | **0.925 / 0.700** | **1.000 / 1.000**  |

Versus the Fable 5 default-artifact baseline (0.665 / 0.447), the
candidate improves the suite mean by +0.335 and the worst case by
+0.553 on this channel.

One behavioral observation: under the variant's rules all four runs
emitted zero populations. That is the correct reading of this suite --
every example in these transcripts is a one-role value list ("like
Payroll or Field Operations", "like CS101"), which the rules route to
value_constraint, and all four answer keys also carry zero populations.
But the suite currently has no case that rewards a genuinely complete
example fact, so nothing guards against the rules suppressing
populations that should be captured. See follow-ups.

## Follow-ups

- Run the acceptance gate with keys (commands above) and append the
  history rows; adopt or reject `sonnet5-1` on that evidence.
- Consider promoting the population rules into the default artifact
  (Fable 5 shows the same failure family), gated the same way.
- `populationMapping` matches fact types by exact player multiset; an
  arity difference (binary vs ternary) makes a witness unmappable and
  fails the check with a misleading message. Consider a subset-aware
  fallback or a clearer "arity mismatch" message in `@barwise/learn`.
- Add an eval case whose transcript states a complete example fact
  ("Customer Alice placed Order 123") with an answer key that captures
  it, so the population rules are tested in both directions.
- The bd binary is unavailable in this session; file bd issues for the
  items above when back on a keyed machine.
