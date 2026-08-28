# Difficulty-calibrated transcripts: the authoring plan for the suite's next cases

Status: Draft for review (design only -- no transcript authored in this
PR)
Created: 2026-08-28
Last-updated: 2026-08-28
Tracking: barwise-846 (this spec is workstream 3's authoring plan; the
count and split assignment stay that workstream's to ground).
Companions: `eval-transcript-realism.spec.md` (the authoring rules this
extends), `docs/adr/0002-constraint-coverage-policy.md` (the coverage
budget these transcripts carry),
`docs/specs/constraint-extraction-coverage.spec.md` (the inventory to
update as instances land).

## Principle

Explicit over implicit, applied to difficulty. The suite's hardest
cases became hard by accident -- university-enrollment's reification
fork and conference-reviews' associative-entity collapse were
discovered by runs, not designed -- and the 2026-08-27 sweep showed
what that costs: the suite's discriminating power is concentrated in
two cases (one per split carried 76-90% of the noise), and nothing
says which structural device any case is testing. A new case should
declare its difficulty the way it declares its split: as a named
device with a named check that grades it. ADR 0002's comparative frame
is the other half of the argument -- a hard case earns its authoring
cost only if the rubric can see the hardness, because an ungraded
difficulty is an unreviewed suggestion one level up.

## Should difficulty come from vaguer transcripts or harder settled structure? (resolved: harder settled structure)

The realism spec's decidability floor stands: every model check must
be supported by an unambiguous statement, and every conflict must be
settled or parked. Difficulty that comes from _undecidable_ text makes
the rubric a coin flip and the metric noise -- that is the floor's own
words, and the sweep confirms the useful kind is different.
University-enrollment and conference-reviews are hard because the
_settled_ rule has a structurally tempting wrong encoding: the grade
that belongs to a relationship, the review that collapses into an
associative entity. The score distribution splits into modes, and the
modes discriminate prompts. So: harder cases mean settled rules with
better decoys, never mushier settlement. A case whose sd comes from
the transcript being unclear is an authoring bug under this spec
exactly as under the realism spec.

## The device taxonomy

What the sweep's evidence says makes extraction hard, in ascending
order of observed pain. New transcripts declare which devices they
carry; the taxonomy is also the review checklist for whether a
proposed domain earns its slot.

| #  | Device                                                              | Evidence                                                                                      | Graded today by                                                       |
| -- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| D1 | Correction arcs, decoy identifiers                                  | vendor-onboarding tax ID: solved reliably (1.000 key)                                         | `requires_element` + `forbids_population`                             |
| D2 | Conditional participation (mandatory only under a state or subtype) | incident commander, vendor risk tier: extractors soften to plain optionality                  | indirectly (the absence of a wrong mandatory); no direct check        |
| D3 | Irreducible n-aries (no binary decomposition carries the rule)      | subscription's per-account-per-product: haiku modeled binaries and dodged the rule            | `forbids_population` on a spanning `internal_uniqueness`              |
| D4 | Reification forks (the fact is about a relationship)                | university grade (handled, objectification never declared); conference-reviews (2/5 collapse) | `forbids_population` + the objectified-correspondence tier            |
| D5 | Same-player relationships with ring semantics                       | incident duplicate-of: carried correctly with sourced rings                                   | ring `forbids_population` (all eight ring types have counterexamples) |

Two device families are explicitly **not graded today**, verified
against the code, and a transcript may not use either as its central
discriminator until the capability lands:

- **Cross-fact-type constraints**: disjunctive mandatory
  (barwise-885 -- the extraction schema cannot carry one), external
  uniqueness, and every set-comparison kind (`ConstraintKind` has no
  subset/equality/exclusion). A settled rule of this shape in a new
  transcript would grade nothing and pin a known gap as a case score.
- **Role-sequence frequency**: `CounterexampleGenerator` derives
  frequency counterexamples for single roles only
  (`packages/core/src/counterexample/CounterexampleGenerator.ts`,
  the comment above the frequency case). "Each pair of teams meets
  exactly once" is settled, extractable, and ungradable.

Such rules may still appear as parked questions (graded via
`requires_ambiguity`) or as untested reference content, which is the
state ADR 0002's trust statement already names -- but the case's
difficulty budget must be spent on D3-D5.

## Scope

In scope:

- When barwise-846 workstream 3 authors its new transcripts, each
  shall satisfy the realism spec's authoring rules **and** declare at
  least two devices from D3-D5 in its case-file header comment, each
  graded by at least one named check in the same case.
- When a new case lands, the system shall gain each declared device's
  check in the landing commit, and the coverage inventory
  (`constraint-extraction-coverage.spec.md`) shall be updated in that
  commit where a constraint type gains an instance.
- When the suite's splits are reassigned (846 workstream 3), each
  device family in D3-D5 shall appear in both splits, so a prompt
  variant overfitting one device is visible on held-out cases.
- When a new case's first recorded run lands (846 workstream 4), its
  observed distribution (mean, sd, collapse rate) shall be read
  against the difficulty it was authored to have, and a case that
  discriminates nothing recorded as an authoring finding.

Out of scope: the transcripts themselves (846 workstream 3's PRs); any
check-capability work (set-comparison kinds, role-sequence frequency,
barwise-885 -- each is its own spec when a transcript needs it); any
change to scoring, weights, or the collapse floor.

## Candidate domains

Five candidates, assessed against the taxonomy and the ADR 0002
coverage budget (needed: irreflexive second domain, acyclic second
_tested_ domain, symmetric first instance anywhere). Three will be
authored; which three is an open decision below.

| Domain                          | Devices                                                                                                                                                                                      | Coverage budget rows                              | Difficulty vs university                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Manufacturing bill of materials | D5 (part-contains-part: irreflexive + acyclic, both settleable in-voice), D5 (substitute-part: symmetric), D3 (Assembly contains Part in Quantity, spanning IUC), overloaded "part/assembly" | irreflexive #2, acyclic #2 (tested), symmetric #1 | similar; more devices per transcript           |
| Clinical trial protocol         | D4 (adverse event reified over subject-and-trial with severity and causality), D3 (subject-visit-assessment window), D2 (assessments mandatory only once enrolled)                           | none new                                          | harder: the reification is deeper than a grade |
| Crew rostering                  | D3 (qualification as crew-skill-equipment with expiry), D2 (rosterable only while certified), a settled subset rule (rostered within qualified) that is deliberately untestable              | none testable (subset has no kind)                | similar; one device unmeasurable               |
| Tournament scheduling           | same-player pair modeling (a match between two Teams), D5 (ring on beats/seeded-above), the pair-frequency rule as parked-or-untested content                                                | possibly asymmetric #1                            | hardest, but its central rule is ungradable    |
| Curriculum planning             | D5 (prerequisite-of: irreflexive + acyclic), D3 (course counts toward program under a catalog year), overloaded "credit"                                                                     | irreflexive #2, acyclic #2 (tested)               | similar; overlaps university's domain flavor   |

A course-prerequisites _extension of university-enrollment itself_ was
considered and rejected: re-authoring an existing transcript
re-baselines every recorded score for that case (the realism spec's
own exclusion), and the coverage spec's non-goals already forbid
editing a transcript to shoehorn a constraint type in.

## Alternatives considered

- **Buy difficulty with domain obscurity** (reinsurance treaties,
  legal citation networks). Rejected: obscure vocabulary raises the
  licence burden and measures the model's domain knowledge, not the
  extraction prompt. Every current case is a business meeting a
  generalist can follow; difficulty should stay structural.
- **Author the ungraded devices now and let the checks catch up.**
  Rejected as the _central_ device (a case whose hardness the suite
  cannot see is authoring cost buying nothing), accepted as garnish:
  a parked subset rule costs nothing and seeds the set-comparison
  workstream (coverage spec workstream 3) with the real instance it
  is waiting for.
- **A difficulty score per case in the manifest.** Rejected:
  hand-maintained numbers drift (the capability matrix lesson);
  observed distribution under the pinned baseline is the only honest
  difficulty measure, and it lives in recorded history rows, not in
  authored metadata. The declared _devices_ are facts about the
  transcript a reviewer can verify by reading it.

## Workstreams

This spec adds none of its own: the work is barwise-846 workstream 3,
which this document turns from "author three new long transcripts"
into a concrete plan. The sweep supplied the grounding that workstream
was waiting for -- dev sd 0.044 with one case carrying ~90% of it says
the dev error bar is not comfortable, so the three-case count stands
rather than shrinking. Sequence within that workstream: land the
domain trio decision (below) in this spec first, then one
transcript-plus-rubric PR per domain, each with its answer-key payload
recorded per the local-eval runbook's reference procedure, then the
split reassignment as its own PR once all three exist.

## Open decisions (for review)

- **Which three domains.** Recommend bill of materials, clinical
  trial, and curriculum planning: between them they close every open
  common-tier coverage row (irreflexive, acyclic-tested, symmetric),
  carry two independent D4/D3 discriminators, and stay in generalist
  business-meeting register. Tournament is the more interesting
  domain but spends its budget on an ungradable rule; rostering's
  best device is likewise unmeasurable. Both are better revisited
  after a set-comparison or role-sequence-frequency capability lands.
- **Where the new cases sit in the re-split.** The stratification
  spec sketched train 4+3 / dev 3+3 with the new longs in train; but
  dev currently has **no D4 case at all** -- both reification forks
  (university, conference-reviews) are train -- so a prompt tuned to
  reification has no held-out test. Recommend placing the clinical
  trial case (the D4 carrier) in dev and revising the stratification
  sketch accordingly; final assignment stays 846 workstream 3's call
  at grounding time, under this spec's both-splits-per-device rule.
- **Whether the parked subset rule ships in the rostering domain or
  the BOM domain.** Only relevant if the trio changes; if BOM is in,
  a settled-but-untested "only certified substitutes" line can ride
  it, seeding coverage workstream 3 without a fourth transcript.

## Risks and testing

- The realism spec's decidability floor applies unchanged; the device
  declaration adds review surface, not a new gate mechanism. A
  declared device with no named check fails this spec's second Scope
  requirement at review time.
- Answer keys follow the 2.5.0 precedent: best recorded payload, full
  rubric pass required, sub-1.000 pins allowed and named. A device
  the answer key itself fails (the model cannot produce the settled
  structure at all) is a finding to record, not a reason to soften
  the check -- that is the runbook's payload-shopping rule.
- Every new case lands behind a suite version bump (the 2.1.0
  precedent), one bump for the whole trio at the re-split rather than
  three.

## Non-goals

- No re-authoring of any existing transcript.
- No rare-tier ring types in eval transcripts (ADR 0002 sends those
  to the gym exercise).
- No new difficulty metadata in `suite.yaml` or the case schema; the
  device declaration is a case-file header comment, reviewed as
  prose.
- No change to check machinery; capability gaps stay tracked where
  they are (barwise-885, coverage spec workstream 3).
