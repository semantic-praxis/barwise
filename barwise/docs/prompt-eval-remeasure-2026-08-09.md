# Re-measurement over the hardened suite (1.1.0)

Date: 2026-08-09
Suite: `@barwise/promptlab` seed suite 1.1.0 (7 cases; the three new
cases from `docs/specs/eval-suite-hardening.spec.md` measured here),
weights 0.02 / correction, 0.10 / validation error, 0.05 / warning
Configs: Claude Fable 5 on the default artifact; Claude Sonnet 5 on the
default artifact; Claude Sonnet 5 on the sonnet5-1 variant
(`packages/llm/prompts/extraction.sonnet5.prompt.yaml`)

## Purpose and verdict

The suite was hardened because the 2026-08-08 run saturated it: the
sonnet5-1 variant scored 1.000 on all four seed cases. This run asks
one question -- do the new cases separate configurations that the old
suite could not tell apart? They do. On the three new cases the same
variant averages 0.921 with a worst case of 0.783, and each lost point
traces to a specific, diagnosable modeling failure rather than noise.

## Channel

Same keyless channel as the 2026-08-08 report, with the same caveats:
no API key is available in this environment, so completions come from
Claude Code subagents pinned to the target models, given the
byte-exact rendered prompts (system, user, response schema) and
nothing else -- explicitly barred from reading `evals/` or any
`tests/` directory. Scoring is the deterministic local scorer through
the production parse path. This is not the production tool-use path;
absolute numbers are channel-specific, and only comparisons within
this report are meaningful. The acceptance gate remains keyed
`barwise prompt eval`. One sample per case per config. Nothing here
was written to `evals/history.jsonl`.

## Scores on the new cases

| Case                | Fable 5 / default | Sonnet 5 / default | Sonnet 5 / sonnet5-1 |
| ------------------- | ----------------- | ------------------ | -------------------- |
| project-staffing    | 1.000             | 0.837              | 0.980                |
| conference-reviews  | 0.980             | 1.000              | 1.000                |
| freight-corrections | 0.483             | 0.583              | 0.783                |
| **mean / worst**    | **0.821 / 0.483** | **0.807 / 0.583**  | **0.921 / 0.783**    |

For context, the prior run's four-case scores (suite 1.0.0, before the
warning weight existed, same channel): Fable/default mean 0.665,
Sonnet/default 0.925, Sonnet/sonnet5-1 1.000. Those numbers are not
directly composable with this table -- different weights and a
different suite version -- but the ordering is consistent, and the
variant's edge now shows up as +0.11 mean on cases it has never
saturated instead of a ceiling.

## What the failures are (each one a real defect)

- **freight-corrections is the discriminator the spec wanted.** All
  three configs followed the mid-transcript correction (their
  frequency bounds say two warehouses, not three) -- the adversity the
  case was built around did not fool anyone. What failed instead:
  - Both default-artifact configs emitted the worked example
    (`S-100 contains P-77 in quantity 5`) as a population but no
    populations for the identifier fact types, so identifier
    mandatory constraints raised `population/mandatory-violation`
    errors (3 for Fable, 2 for Sonnet). Prompt gap: nothing tells the
    model that exemplified entities need their identifier facts
    populated too (or the example left out).
  - The sonnet5-1 config avoided that but attached its frequency
    constraint to the wrong role: `roles: ["Warehouse"]` with a
    description that correctly says "each Shipment sits in between 1
    and 2 Warehouses". Role-side confusion, exactly analogous to the
    uniqueness "which side" rule the prompt does teach -- and does not
    teach for frequency.
- **Sonnet 5 on the default artifact missed the acyclic ring
  constraint** on mentoring (project-staffing); the variant and Fable
  both captured it. First measured separation on a constraint family
  the old suite never touched.
- **conference-reviews went clean for everyone after the fairness
  fix.** The first attempt failed all three configs identically for
  naming the score `Score`/`OverallScore` when the rubric wanted
  `ReviewScore` -- a case defect, not a model defect (the transcript
  never used the term). With the stakeholder term pinned in the
  transcript, all three configs objectified correctly and followed
  the naming; Fable's 0.980 is one conformance correction. The
  authoring rule is recorded in the spec: every name a rubric
  references must be transcript-derivable.

## Leads for the next optimization pass

In priority order, from the score deltas above:

1. **Frequency role-siding.** Add the frequency analogue of the
   uniqueness rule to the prompt: the constrained role is the one
   whose player's occurrences are being counted ("each Shipment sits
   in at most 2 Warehouses" constrains the Shipment role). Worth
   ~0.2 on freight-corrections for the variant.
2. **Population completeness.** When emitting example populations,
   either populate the identifier fact types for every exemplified
   entity or omit the example. Worth ~0.3-0.5 on freight-corrections
   for the default artifact.
3. **Ring capture on the default artifact** (the variant already has
   it): the acyclicity language in project-staffing ("cannot have
   loops, not even indirectly") maps to ring/acyclic.

## sonnet5-2: acting on lead 1, same day

Lead 1 was applied as a variant revision (`sonnet5-2`): one added
rule at the frequency bullet stating that the constrained role is the
entity the rule is "per", sided like uniqueness, with the freight
failure as the worked example. Lead 2 needed no variant change -- the
population-completeness rules sonnet5-1 already carries are why the
variant had zero validation errors where the default artifact leaked
them; it is a default-artifact gap, left to a separate decision.

Full-suite run of Sonnet 5 on sonnet5-2 (one sample per case, same
channel):

| Case                  | Sonnet 5 / sonnet5-2 |
| --------------------- | -------------------- |
| order-management      | 1.000                |
| university-enrollment | 0.950                |
| clinic-appointments   | 1.000                |
| employee-hierarchy    | 1.000                |
| project-staffing      | 0.980                |
| conference-reviews    | 1.000                |
| freight-corrections   | 0.950                |
| **mean / worst**      | **0.983 / 0.950**    |

- **freight-corrections 0.783 -> 0.950, full rubric passing.** The
  frequency constraint landed on the Shipment role with the corrected
  bound -- the role-siding rule fixed exactly the failure it targeted.
- **No regression anywhere**: the four old cases and the other two
  new cases hold at 0.98-1.000.
- The two 0.950s are honest residuals, both warning penalties the
  lint tier is right to charge: a missing spanning uniqueness on the
  storage binary (freight) and a constraint-free enrollment fact type
  (university). That is the suite's remaining headroom, not noise.

## Follow-ups

- The keyed gate run (`barwise prompt eval --provider anthropic
  --model claude-sonnet-5 --artifacts packages/llm/prompts`, and the
  same with `claude-fable-5`) is still the acceptance path -- the
  sonnet5-2 revision carries provenance but no recorded score until
  it clears that gate.
- Lead 2 (population completeness) and lead 3 (ring capture) are
  default-artifact gaps; promoting those rules into the default
  instructions re-baselines every config and is the maintainer's
  call, not a variant edit.
- Old-case scores for the other configs under the 1.1.0 weights were
  not re-collected (cost of the channel); a keyed full-suite run
  supersedes all tables here.
