# Constraint-type coverage: the living inventory and the closing workstreams

Status: Accepted (companion to ADR 0002, which holds the policy; this
file holds the state that changes as coverage closes)
Created: 2026-08-27
Last-updated: 2026-08-28 (workstream 1 done: the irreflexive check is
live at suite 2.5.0)
Tracking: barwise-878 (the reference audit; the inventory below is its
first pass); barwise-845 (the irreflexive instance arrives with the
dev references); barwise-846 (the authoring budget rides split-spec
workstream 3). Policy: `docs/adr/0002-constraint-coverage-policy.md`
-- the trust statement, the comparative-not-certifying resolution, the
two-instances-per-common-type threshold, and the common/rare tiering
all live there and are not restated here.

## Principle

Explicit over implicit, applied to a claim readers were left to
assume: the extraction chain's capability envelope exceeds the eval
suite's evidence envelope, and nothing said so. ADR 0002 records the
policy that closes the gap on purpose rather than by authoring
program; this spec records where coverage stands and which tracked
work closes each gap. **Update the inventory in the same commit that
adds a type's first or second tested instance** -- a coverage table
nobody is obliged to update is the stale capability matrix again.

## Inventory (2026-08-27, the barwise-878 first pass)

Swept: ten transcripts, seven references, seven recorded payloads, one
gym exercise.

| Type                                                                                   | Settled in a transcript             | In a reference | Rubric-tested          | Verdict                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------- | -------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| ring: acyclic                                                                          | project-staffing, incident-response | yes (both)     | one (project-staffing) | second reference instance landed with 2.5.0; untested there (see below)              |
| ring: irreflexive                                                                      | incident-response                   | yes            | yes (2.5.0)            | first instance live; needs a second domain                                           |
| ring: asymmetric, antisymmetric, intransitive, symmetric, transitive, purely_reflexive | none                                | none           | no                     | zero evidence anywhere                                                               |
| subset, equality, exclusion (set-comparison)                                           | subset: vendor-onboarding (weakly)  | subset: yes    | cannot be              | no check kind (see below); the vendor reference carries a redundant PO-vendor subset |

The incident-response reference carries acyclic as well as irreflexive
on "Incident is duplicate of Incident" (the sweep payload extracted
both; a conformance bug that dropped same-role rings as duplicates was
fixed in the same change). Only the irreflexive one is rubric-tested
there: `forbids_population` takes the first constraint of the named
kind, and the transcript settles irreflexive harder ("stated") than
acyclic ("the rule as intended. It's not enforced"). The
vendor-onboarding subset is the payload's approximation of "POs only
against active vendors" -- it asserts something true but redundant
(every vendor has a status anyway), and set-comparison has no check
kind, so it sits in the reference untested, which is what the ADR's
trust statement says to expect.

The machinery envelope exceeds the evidence envelope, worth noting on
purpose: `generateCounterexampleForConstraint` derives counterexamples
for **all eight** ring types, so any ring a reference carries is
immediately testable via `forbids_population`. Set-comparison is
different in kind: `ConstraintKind` is
`{internal_uniqueness, mandatory, value, frequency, ring}`, so a
subset in a reference could not be rubric-tested today even if one
existed. Closing subset coverage needs data and a check capability;
`requires_verbalization` is the interim check until then.

## Workstreams (each rides work already tracked)

### 1. The irreflexive instance (with barwise-845) -- DONE, suite 2.5.0

The incident-response reference is pinned and the ring
`forbids_population` check is live. The contingency (payload missed
the ring) did not arise: the best recorded payload carried the
irreflexive ring at high confidence, sourced to the transcript's
settling lines, so the check has a genuine answer key.

### 2. The common-tier authoring budget (with split-spec workstream 3)

The new long transcripts barwise-846 authors carry the budget: across
them, each common-tier type gains its second (or first) instance,
phrased in that domain's own voice. The budget is a constraint on
transcripts already being written, not a new authoring program.

### 3. Set-comparison checks (provisional: not yet grounded)

Extend the rubric's reach to subset -- either a set-comparison
`ConstraintKind` backed by counterexample derivation, or a documented
`requires_verbalization` pattern. Provisional and deliberately last:
spec it only after a transcript exists that settles a subset rule, so
the design is grounded in a real instance rather than an invented one.

### 4. The rare-tier gym exercise (unscheduled)

One ring-constraints exercise covering the rare types, with reference
and `forbids_population` checks (the counterexample generator already
covers all eight). Closes the pedagogical half without touching the
eval suite.

## Non-goals

- No restatement of the policy: trust statement, thresholds, and
  tiering are ADR 0002's alone. A change to those is a new ADR, not an
  edit here.
- No transcript rewritten or authored to shoehorn a rare type in.
- No change to scoring, weights, or splits here; rubric additions land
  with their workstreams and bump the suite version per the 2.1.0
  precedent.
