# Population-blind rejection: forbids_population must judge by new errors, not attributed ones

Status: Approved for implementation with suite 2.7.0 (barwise-895; the
barwise-896 vendor licence rides the same bump)
Created: 2026-08-29
Last-updated: 2026-08-29
Tracking: barwise-895, barwise-896. Evidence: the opus repeat-1 probe
(subscription payload with all three "missing" mandatories declared),
the synthetic reproduction in this spec, and the 29 populated payloads
of the recorded `eval-payloads/20260828-1647/` round.

## Principle

A `forbids_population` check asks one question: does injecting the
forbidden population cause the candidate's own constraints to reject
it? "Cause" is the load-bearing word. The current implementation
answers a different question when the candidate carries populations of
its own -- "is some error attributed to the injected population's id"
-- and the attribution is a fiction the validator never promised:
mandatory and cardinality violations attach to the constraint or
object type (`c.id ?? ft.id`, `ot.id`), never to a population.
Reproduced minimally: a candidate with the reference's mandatory
DECLARED passes the check with no populations and fails the identical
check the moment it carries one sample population.

The extraction prompt instructs models to capture example populations,
so the evaluator systematically punishes the models that obey. The
opus probe surfaced it; the recorded round is not immune: 29 of its
saved payloads carry populations, concentrated in the sonnet dev
cells the 2.6.0 baseline called "genuine".

## Design: compare errors before and after, keyed, as a multiset

Replace both branches of `candidateRejects` with one rule:

1. Validate the candidate BEFORE injection; collect error-severity
   `population/*` diagnostics as a multiset keyed by
   `ruleId + elementId + message`.
2. Inject, validate again, collect the same way, restore.
3. The candidate rejects the injection iff some key occurs MORE times
   after than before.

This is "define errors out of existence" applied to attribution: no
rule needs to say which population caused it, because causation is
observed as the delta. Properties, each previously a special case:

- A candidate with no populations has an empty before-multiset, so the
  rule degenerates to today's `popErrors.length > 0` -- byte-identical
  behavior for every unpopulated payload, which is how the answer keys
  pin the change as rescue-only (the one populated key,
  freight-corrections, validates clean, so its before-multiset is
  empty too and its pins hold).
- A candidate whose own data already violates its constraints does not
  vacuously pass: pre-existing errors appear on both sides and cancel.
  This is the intent the elementId filter was reaching for, kept.
- An injection that fixes one pre-existing error while causing another
  still rejects: keys are compared individually, not as a net count.
- A multiset rather than a set, because the mandatory rule's message
  names the violating value: a second entity tripping the same
  constraint is a new occurrence of a distinct key in practice, and
  where a rule ever emits byte-identical messages the count comparison
  still catches the addition.

The check's callers do not change; the fix is one function.

## The rider: barwise-896, the vendor fold licence

The opus vendor payload models the exact entity-fold shape (ternary
"Vendor in Region has primary Contact" with the Meridian uniqueness
over Vendor+Region, Contact evidenced by its own attribute binaries)
and scores "does not carry" because it names the value types
`EmailAddress` and `PhoneNumber` where the reference says
`ContactEmail`/`ContactPhone`. The transcript's own words are "Name,
email, phone number" -- both namings are faithful, so per
eval-name-licensing the synonymy is declared: vendor-onboarding's
vocabulary gains `[ContactEmail, EmailAddress]` and `PhoneNumber`
joins the existing `[ContactPhone, ContactPhoneNumber]` set.
`ContactName` matched without help and gets no set: the licence
declares only pairs the record shows diverging.

## Suite 2.7.0

Both changes move scores (the fix raises populated payloads that
declared their mandatories; the licence rescues a vendor shape), so
rows either side are incomparable and the manifest records why. The
2.5.0/2.6.0 answer keys must pin their exact scores unchanged -- all
of them validate clean, so the before-multiset is empty everywhere and
any movement is a finding.

## Workstreams

1. **The fix**, in `learn/src/evaluate/checks/forbidsPopulation.ts`:
   the before/after multiset in `candidateRejects`, with unit tests
   pinning: the synthetic reproduction flips to pass; a candidate
   whose own population already violates the constraint does NOT
   vacuously pass; the unpopulated paths are unchanged.
2. **The licence**, in `promptlab/evals/vendor-onboarding.eval.yaml`,
   with the 2.7.0 `suite.yaml` changelog naming both reasons and the
   answer-key re-verification.
3. **The offline re-read** of `eval-payloads/20260828-1647/` at 2.7.0,
   appended to `docs/prompt-baseline-2.6.0-2026-08-28.md`: the sonnet
   dev cells are the ones expected to move, and the re-graded verdicts
   go next to the originals.

## Risks and non-goals

- The extra validation pass runs only per check invocation and only
  costs a second `ValidationEngine().validate` on populated
  candidates; the evaluator is offline and this is noise.
- Out of scope: which constraints are checked, counterexample
  generation, barwise-894's broader question of whether rejection
  should be constrained to the mapped carrier's own constraint kind --
  this spec removes a false negative; 894 is about a false positive
  and stays open.
