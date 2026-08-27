# ADR 0002: Constraint-extraction coverage policy

Status: Accepted
Date: 2026-08-27
Tracking: barwise-878 (the reference audit; its first-pass inventory
lives in `docs/specs/constraint-extraction-coverage.spec.md`, the
living companion to this record), barwise-845, barwise-846. Prompted
by barwise-863, which restored the Ring/Subset/Equality instruction
blocks to the default extraction prompt.

## Context

The extraction chain instructs, carries, parses, and
population-validates every ring type and set-comparison constraint:
the prompt (all providers, since barwise-863) asks for them, the
response schema enumerates them, the parser maps them to core
constraints, and the validator checks their populations. So an
extracted model can arrive on any surface carrying an `acyclic` ring
or a `subset` constraint, schema-valid and internally consistent.

Nothing in that chain measures whether the extractor gets them right
-- whether a constraint reflects what the transcript settled, or
whether a settled rule was missed. That is the eval suite's job, and
the suite exercises one ring instance (acyclic) and zero
set-comparison instances; `forbids_population` has no set-comparison
kind at all. The capability envelope (what the pipeline accepts) and
the evidence envelope (what any rubric has tested) diverged silently,
and a reader of an extracted model or an eval score had no way to
know. The tempting resolution -- author enough eval cases to certify
every type -- runs into arithmetic and realism, below.

## Decision

1. **The trust statement.** Until a constraint type has rubric-tested
   instances in the eval suite, that type in an extracted model is an
   unreviewed suggestion: plausible, schema-valid, population-checked
   for internal consistency, and unmeasured against the transcript.
   Consumers treat it as they would any unreviewed model content --
   reviewed by a human before it carries weight.

2. **The suite compares; it never certifies.** General-case
   reliability is priced by the rule of three: n distinct passing
   instances bound the true miss rate below roughly 3/n at 95%
   confidence, where an instance is a distinct domain phrasing the
   rule its own way (repeats of one case measure noise on one
   phrasing). An honest "reliably extracts acyclic rules" at a 20%
   bound needs about fifteen instances per type; across eight ring
   types and three set-comparison kinds that authoring program would
   destroy the transcript-realism discipline
   (`docs/specs/eval-transcript-realism.spec.md`). No coverage level
   in this suite supports a certification claim, and none should be
   made.

3. **Two instances per common type is the coverage threshold** -- one
   train, one dev, in different domains with different surface
   phrasing. One instance cannot distinguish "the prompt cannot do X"
   from "the prompt cannot do X in this phrasing"; two domains start
   to, and the dev copy shows the capability was not tuned-to. At
   `repeat 5`, two cases give ten samples per run of the binary
   "was the constraint captured" -- enough for the suite's actual
   jobs, regression detection and variant comparison.

4. **Types are tiered by natural occurrence, and the rare tier never
   enters an eval transcript.** Common tier (each owed two instances):
   `irreflexive`, `acyclic`, `symmetric`, `subset`, set-comparison
   `exclusion` -- rules real facilitated sessions state ("cannot
   approve their own request", "no circular reporting", "is paired
   with", "every approver must also be an employee"). Rare tier:
   `antisymmetric`, `intransitive`, `transitive`, `purely_reflexive`,
   `equality` -- textbook types that would have to be shoehorned into
   a transcript, breaking realism. Their home is a didactic gym
   exercise: the gym is allowed to be pedagogically complete where the
   eval suite must stay naturalistic. Until that exercise exists they
   sit outside the validated envelope and the trust statement applies
   to them indefinitely.

5. **The living inventory stays out of this record.** Which types are
   covered today, and the workstreams closing the gaps, live in
   `docs/specs/constraint-extraction-coverage.spec.md`, updated in the
   same commit that adds a type's first or second tested instance --
   the capability-matrix discipline applied to coverage claims. This
   ADR records the policy, which does not change when an instance
   lands.

## Consequences

- Anyone building on ring or set-comparison extraction reads the trust
  statement first; the `llm` and `promptlab` CLAUDE.mds point here
  ("Instructed is not validated"; "A score vouches only for what some
  rubric tests").
- New eval transcripts (split-spec workstream 3 and after) carry the
  common-tier budget as an authoring constraint, not a new program.
- A future constraint family added to the prompt or schema starts
  inside this policy: instructed-but-unvalidated until its instances
  land, with the spec's inventory saying so from day one.
- Closing subset coverage requires a rubric capability
  (`forbids_population` has no set-comparison kind), so data alone
  cannot close it; that design waits until a transcript settles a
  subset rule.
