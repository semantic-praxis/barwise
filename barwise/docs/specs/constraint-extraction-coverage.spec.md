# Constraint-type coverage: what the eval suite can vouch for, and the tiered target

Status: Accepted (decision record; the closing work is tracked, not
yet done -- see Workstreams)
Created: 2026-08-27
Last-updated: 2026-08-27
Tracking: barwise-878 (the reference audit, which carries the
inventory below as its first pass); barwise-845 (the irreflexive
instance arrives with the dev references); barwise-846 (the authoring
budget rides split-spec workstream 3). Prompted by barwise-863, which
restored the Ring/Subset/Equality instruction blocks to the default
extraction prompt.

## Principle

Explicit over implicit, applied to a claim readers were left to
assume. The extraction prompt now instructs every provider to extract
ring and set-comparison constraints, the schema carries them, the
parser maps them, and the validator checks their populations -- so an
extracted model can arrive carrying an `acyclic` ring or a `subset`
constraint on any surface. Nothing in that chain says whether the
extractor gets them RIGHT: the eval suite exercises exactly one ring
instance and zero set-comparison instances, so for every other type
the capability is instructed but unvalidated. A reader of an extracted
model, or of an eval score, has no way to know that unless it is
written down. This spec writes it down.

**The trust statement.** Until a constraint type has tested instances
in the suite, treat that type in an extracted model as an unreviewed
suggestion: plausible, schema-valid, population-checked for internal
consistency -- and unmeasured for whether it reflects what the
transcript settled or missed what it should have caught. As of
2026-08-27 that is every ring type except `acyclic`, and all of
`subset`, `equality`, and set-comparison `exclusion`.

## How many instances is enough? (resolved: 2 per common type -- the suite is a comparative instrument, not a certification)

Two claims hide in "confident in the general case", and only one is
affordable.

General-case certification is priced by the rule of three: n distinct
passing instances bound the true miss rate below roughly 3/n at 95%
confidence, where an instance is a distinct domain phrasing the rule
its own way (repeats of one case only measure noise on one phrasing).
One instance says the miss rate could be 95%; three say 63%; an honest
"reliably extracts acyclic rules" at a 20% bound needs about fifteen
per type. Across eight ring types and three set-comparison kinds that
is an authoring program the realism rules
(`docs/specs/eval-transcript-realism.spec.md`) would not survive --
most of those types essentially never occur in a real facilitated
session.

What the suite is actually for -- detecting regression and resolving
differences between prompt variants -- needs far less: **two instances
per type, one train and one dev, in different domains with different
surface phrasing.** One instance cannot distinguish "the prompt cannot
do X" from "the prompt cannot do X in this phrasing"; two domains
start to, and the dev copy shows the capability was not tuned-to. At
`repeat 5`, two cases yield ten samples of the binary
"was the constraint captured" per run, enough to see a capability
flap. The suite never certifies; it compares, and this is the coverage
at which a comparison about a constraint type means something.

## Inventory (2026-08-27, the barwise-878 first pass)

Swept: ten transcripts, seven references, seven recorded payloads, one
gym exercise.

| Type                                                                                   | Settled in a transcript | In a reference | Rubric-tested | Verdict                                       |
| -------------------------------------------------------------------------------------- | ----------------------- | -------------- | ------------- | --------------------------------------------- |
| ring: acyclic                                                                          | project-staffing        | yes            | yes           | the one wired instance; needs a second domain |
| ring: irreflexive                                                                      | incident-response       | no (dev, none) | no            | arrives with barwise-845; check the payload   |
| ring: asymmetric, antisymmetric, intransitive, symmetric, transitive, purely_reflexive | none                    | none           | no            | zero evidence anywhere                        |
| subset, equality, exclusion (set-comparison)                                           | none                    | none           | cannot be     | zero evidence AND no check kind (see below)   |

The machinery envelope exceeds the evidence envelope on purpose to
note: `generateCounterexampleForConstraint` derives counterexamples
for **all eight** ring types, so any ring a reference carries is
immediately testable via `forbids_population`. Set-comparison is
different in kind: `ConstraintKind` is
`{internal_uniqueness, mandatory, value, frequency, ring}`, so a
subset in a reference could not be rubric-tested today even if one
existed. Closing subset coverage needs data and a check capability;
`requires_verbalization` is the interim check until then.

## The tiered target

- **Common tier -- two instances each, per the resolution above:**
  `irreflexive`, `acyclic`, `symmetric`, `subset`, set-comparison
  `exclusion`. These occur naturally ("cannot approve their own
  request", "no circular reporting", "is paired with", "every approver
  must also be an employee", "cannot be both driver and passenger").
- **Rare tier -- never forced into eval transcripts:** `antisymmetric`,
  `intransitive`, `transitive`, `purely_reflexive`, `equality`.
  Textbook types that would break transcript realism. Their home is a
  **didactic gym exercise**: the gym is allowed to be pedagogically
  complete where the eval suite must stay naturalistic. Until such an
  exercise exists they are simply outside the validated envelope, and
  the trust statement applies indefinitely.

## Workstreams (each rides work already tracked)

### 1. The irreflexive instance (with barwise-845)

When the incident-response reference is pinned, add the ring
`forbids_population` check for "Incident is duplicate of Incident".
If the recorded payload missed the settled ring, record that as
prompt-headroom evidence rather than picking a payload that happens to
carry it -- the miss is a finding.

### 2. The common-tier authoring budget (with split-spec workstream 3)

The new long transcripts barwise-846 authors carry the budget: across
them, each common-tier type gains its second (or first) instance,
phrased in that domain's own voice. The budget is a constraint on
transcripts already being written, not a new authoring program.

### 3. Set-comparison checks (provisional: not yet grounded)

Extend the rubric's reach to subset -- either a set-comparison
`ConstraintKind` backed by counterexample derivation, or a documented
`requires_verbalization` pattern. Provisional and deliberately last:
spec it only after a transcript exists that settles a subset rule,
so the design is grounded in a real instance rather than an invented
one.

### 4. The rare-tier gym exercise (unscheduled)

One ring-constraints exercise covering the rare types, with reference
and `forbids_population` checks (the counterexample generator already
covers all eight). Closes the pedagogical half without touching the
eval suite.

## Non-goals

- No general-case certification claims at any coverage level; the
  suite compares, it does not certify.
- No transcript rewritten or authored to shoehorn a rare type in.
- No change to scoring, weights, or splits here; rubric additions land
  with their workstreams and bump the suite version per the 2.1.0
  precedent.
