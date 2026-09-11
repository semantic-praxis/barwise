# What actually catches a wrong spec: a taxonomy of 34 recorded corrections

Created: 2026-09-11
Method: every `docs/specs/*.spec.md` paragraph matching correction
markers (`the draft`, `was wrong`, `turned out`, `did not survive
grounding`, `could not fail`, `not decidable as written`, `deviation`
excluding `standard deviation`, `did not anticipate`, `was dropped`),
read and classified by hand. 52 raw records across 28 specs; 34 after
merging duplicates and dropping paragraphs that matched a marker without
recording a correction.

Single-rater classification of a small corpus. The counts below are
judgment, not measurement, and the boundary between "reasoning" and
"grounding by reading code" is the softest one. Treat the ratios as
order-of-magnitude.

## The question

Barwise invests in how specs are written -- `spec-writer`, `editing.md`,
`llm-tics.md`, `articulation`, and now `distill`. That investment is
worth making only if defects in specs are the kind of thing a reader can
catch. The specs record their own corrections, so the question is
answerable from evidence rather than belief.

## What caught each defect

| Catch mechanism                                                                                                      | Count |
| -------------------------------------------------------------------------------------------------------------------- | ----: |
| Execution -- implementing it, writing the test, re-running, re-measuring, probing, mutation, replaying recorded data |    25 |
| Reasoning or review, before or without execution                                                                     |     8 |
| Writing the claim down with the command that produced it                                                             |     1 |

Roughly three quarters of recorded spec defects were caught by running
something, not by reading anything.

The repo states this itself, in `core-branching-load.spec.md`:

> Both were found by re-running a count rather than by reading the
> prose, which is the argument for re-running every count.

## Could reading have caught them?

A different cut, because "what caught it" understates what a better
document might have caught. Judging each defect on whether a careful
reader could have found it from the draft alone:

|                                                                                                     | Count |
| --------------------------------------------------------------------------------------------------- | ----: |
| Readable in principle                                                                               |    12 |
| Required execution -- depends on a fact about the code or a tool's behaviour that no prose contains |    22 |

Of the 12 readable in principle, reading actually caught 6. Execution
caught the other 6, which is the number that matters: on defects a
reader _could_ have found, reading found half.

## The sharpest finding: a rule in prose did not prevent its own defect

Four of the 34 corrections are the same defect shape -- **a check that
cannot fail**:

| Spec                           | The defect                                                    | Caught by |
| ------------------------------ | ------------------------------------------------------------- | --------- |
| `core-branching-load`          | a guard chain ending in a fallback cannot fail                | the probe |
| `gate-refusal-contract`        | the cwd test skipped when `some` run exited 2                 | `mutate`  |
| `mutation-verification-helper` | `restoreOrDie` wrote the file before hashing it               | a test    |
| `pair-coverage-floors`         | raising a floor above its count only proves the matcher works | reasoning |

Reading caught one of four. This is the defect class barwise already has
a **written rule against** -- `assertion-audit` rule 1b, "an assertion
that cannot fail is not a test", plus the barwise-906 ledger. The rule
existed, in prose, in a skill, and the defect shipped four more times.

`mutation-verification-helper.spec.md` says why, and it is the most
useful sentence in the corpus:

> That is the same defect as barwise-906's own fourth occurrence,
> reproduced inside the script written to prevent it -- which is the
> strongest argument available for why the check has to be a mechanism
> rather than a rule, **since the rule was in the author's head at the
> time.**

The author knew the rule and wrote the defect anyway. No improvement to
how that rule was _worded_ would have changed the outcome.

## Verbosity was never the cause

Searched for any correction attributed to a document being too long,
verbose, buried, or unclear. **Zero of 34.** The three hits for that
language are unrelated: a bill nobody reads, a risk that front matter
goes unread, and `distill`'s own text.

This is a real negative result, not an absence of data: the corpus
records causes explicitly and in detail, and this cause never appears.

## What the document-side levers actually are

The 9 defects caught without execution point at three practices, none of
which is concision:

1. **Provenance -- every number carries the command that produced it.**
   `model-graph-and-id-spaces.spec.md`: "And writing it down is what
   caught it being wrong." Attaching the instrument to the claim exposed
   the claim. This is also the _enabler_ for the dominant catch class:
   you cannot re-run a count that never said how it was counted.

2. **Adversarial framing -- state the objection, and what lazy
   compliance looks like.** `test-quality.spec.md` twice: "**The
   objection:** an arbitrary that constructs the shape a rule looks for,
   and then asserts that rule fires, has encoded the rule twice", and a
   marker "added after asking what a lazy compliance would look like".
   This is the only practice that fires at design time, before code.

3. **Grounding before drafting.** `export-artifact-validation.spec.md`:
   "Probed against the built bridge before it was written." Cheaper than
   discovering it in implementation, and it converts a Category-2 defect
   into no defect at all.

## Consequence for `distill`

Concision is not on the list, and distillation carries a specific risk
against lever 1. A compressor sees

> the guard count is 12 by `grep -rn -A2 ... | grep -cE 'if \(!|\?\?|continue|\?\.'`

as an ugly command attached to a small number. Cutting it preserves the
claim and destroys its re-runnability -- removing the enabler for the
mechanism that catches three quarters of defects.

`distill` does list commands under "what never gets cut", but justifies
it as "the cheapest content per word in the document", which is an
aesthetic argument. The corpus supplies the real one: **the command is
what makes the claim falsifiable later.** That reason should replace the
aesthetic one, and the ratio band should be stated as conditional on the
input being padded rather than as a target.

## The loop that is open (closed 2026-09-11 by `audit:corrections`)

Specs record their own corrections. Nothing aggregated them, and nothing
fed the aggregate back into how the next spec is written: each spec
learned its lesson and the corpus learned nothing.

`npm run audit:corrections -- --check` now closes that, per CLAUDE.md's
"a finding is not closed by a document". The classification lives in
`correction-baseline.json`, one row per record saying what caught it,
and the gate fails on a new unclassified record AND on a row no longer
detected (`docs/specs/correction-record-ratchet.spec.md`, barwise-1013).

**The counts in this document are a dated reading, not the live ones.**
They were taken by hand on 2026-09-11 over a narrower marker set than
the gate now uses -- building the gate turned up a record the markers
missed, which is why `provenance` has an entry at all. The baseline is
the authority; restating its totals here would be a must-agree copy with
nothing checking it, which is the defect this repository keeps finding.
For current counts, run the gate.
