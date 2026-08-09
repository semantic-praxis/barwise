# Agent-output eval: extractor subagent over the promptlab suite

Date: 2026-08-09
Suite: `@barwise/promptlab` seed suite 1.0.0 (4 cases)
Surface measured: the `barwise-transcript-extractor` subagent
(workstream 6 of `docs/specs/prompt-optimization-harness.spec.md`,
first data point). Companion audit: `docs/skill-audit-2026-08-09.md`.

## Measurement channel

Same session channel as `docs/prompt-eval-sonnet5-2026-08-08.md`:
Claude Code subagents pinned to the target model, no API keys. Scoring
is deterministic and local -- the agent-written `.orm.yaml` is
deserialized, validated (`ValidationEngine`), and graded by
`evaluateCandidate` against each case's rubric and reference. Score =
rubric fraction minus 0.10 per validation error, floor 0. The
conformance-correction term does not apply (agents author model YAML
directly; there is no extraction payload to repair), so scores are
comparable to the single-shot table's rubric-and-validation component
but not byte-for-byte with `barwise prompt eval` output.

**What this did NOT measure: the production agent loop.** The barwise
MCP server never registered in this environment (broken `.mcp.json` --
finding F1 of the audit, fixed in this PR), so all eight runs had no
`import_transcript`, `validate_model`, or `query_model`. Every agent
fell back to hand-authoring the model from the transcript and
self-checking against the schema files. The numbers below therefore
measure "agent hand-authoring without a validator", plus one controlled
revise-cycle experiment that supplies the real validator output.

## Scores (one run per cell)

Single-shot columns reproduced from the 2026-08-08 delta report for
context; they share the session channel but not the scoring term noted
above.

| Case                  | Fable agent                           | Sonnet agent | Fable single-shot (default) | Sonnet single-shot (sonnet5-1) |
| --------------------- | ------------------------------------- | ------------ | --------------------------- | ------------------------------ |
| order-management      | 1.000                                 | 1.000        | 0.980                       | 1.000                          |
| university-enrollment | 1.000                                 | 1.000*       | 0.533                       | 1.000                          |
| clinic-appointments   | 1.000                                 | 1.000        | 0.447                       | 1.000                          |
| employee-hierarchy    | 0.000 -> 1.000 after one revise cycle | 1.000        | 0.700                       | 1.000                          |
| mean                  | 0.750 (1.000 with revise)             | 1.000        | 0.665                       | 1.000                          |

\* The first Sonnet university-enrollment run was discarded: its agent
consulted the checked-in reference model while checking schema
conventions (see the audit's eval-hygiene follow-up). The score shown
is a clean re-run under an explicit prohibition.

## Findings

1. **The revise loop is the load-bearing part of the agentic surface.**
   Fable 5's employee-hierarchy model scored 0.000 for a single schema
   conditional its manual self-check missed (subtype entity types must
   carry `reference_mode` even when they inherit identification). Fed
   the real validator output for one revise cycle, the same model went
   to 1.000. `validate_model` would have caught this on the first call
   -- but the agent instructions only say to "note" errors, never to
   fix them (audit finding F2), and in this environment the tool was
   unavailable anyway (F1). Both fixes are in this PR (F1 applied, F2
   proposed).
2. **Hand-authoring beats single-shot extraction on this suite.** The
   agent channel (no extraction system prompt, no schema-constrained
   tool call) outscored the default-artifact single-shot runs for both
   models, and matched the tuned sonnet5-1 variant's 1.000. Two
   readings, not exclusive: the models' own ORM knowledge plus
   schema-by-example is strong, and this suite's rubrics are now
   comfortably saturated for Sonnet-class models -- harder cases are
   the next investment (the delta report already proposes one).
3. **Population discipline held without being prompted.** The agentic
   runs emitted no populations (matching the answer keys), consistent
   with the sonnet5-1 analysis that these transcripts only ever give
   one-role value lists.

## Caveats

- One sample per cell; a score is a sample, not a constant.
- The graded materials sit inside the repository the agents can browse;
  one contaminated run was caught only because the agent said what it
  had read. The workstream 6 runner should isolate `evals/` from the
  agent's view rather than rely on instructions.
- The production path (`import_transcript` + validate loop through the
  MCP server) remains unmeasured until a keyed environment runs it;
  with F1 fixed, the next session here can at least exercise the
  validate/query tools.

## Follow-ups

- Re-run this eval with the MCP server registered (F1 fix active) so
  the agent uses the real `validate_model` loop; adopt F2's revise-step
  diff first if accepted.
- Author harder eval cases before drawing further conclusions at the
  top of the scale; the suite no longer discriminates among
  Sonnet-class-and-up extractors.
- File bd issues for the above (bd unavailable in this session).
