# The conformance/validator correspondence, enumerated and then mechanized

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-831. The audit that barwise-830 argued for, after
barwise-826 and barwise-830 each closed one instance of the same class.

## Principle

Define errors out of existence, applied to a correspondence rather than
to a call site. Three times a validator rule with no conformance
counterpart surfaced as an unavoidable eval penalty, and all three were
found by a live run costing real money rather than by a test. Each fix
closed one instance and left a comment stating the general rule, which
is precisely the shape of an unknown unknown: a reader finishing
barwise-826 would have believed the class was closed, because the
comment said so and the code covered one case.

This audit does the enumeration the last two specs kept deferring, and
then removes the need to remember it.

## The enumeration

Nineteen rule ids across twenty diagnostic sites in
`core/src/validation/rules/constraintConsistency.ts`
(`constraint/ring-invalid-role` fires from two). Classified as
**structural** (decidable from the extraction payload, before a model
exists) or **semantic** (needs the built model, or is a modeling
judgement rather than a defect):

| Rule                                  | Severity     | Class      | What stops it today                |
| ------------------------------------- | ------------ | ---------- | ---------------------------------- |
| `internal-uniqueness-invalid-role`    | error        | structural | parser: roles resolve from `ft`    |
| `mandatory-invalid-role`              | error        | structural | parser: roles resolve from `ft`    |
| `value-constraint-invalid-role`       | error        | structural | parser: roles resolve from `ft`    |
| `ring-invalid-role` (x2)              | error        | structural | parser: roles resolve from `ft`    |
| `frequency-invalid-role`              | error        | structural | parser: roles resolve from `ft`    |
| `disjunctive-mandatory-too-few-roles` | error        | structural | conformance check 5 (barwise-826)  |
| `exclusion-too-few-roles`             | error        | structural | conformance check 5 (barwise-826)  |
| `exclusive-or-too-few-roles`          | error        | structural | conformance check 5 (barwise-826)  |
| `frequency-empty-roles`               | error        | structural | conformance check 5 (exactly 1)    |
| `frequency-invalid-min`               | error        | structural | conformance check 5b (barwise-830) |
| `frequency-max-less-than-min`         | error        | structural | conformance check 5b (barwise-830) |
| `subset-arity-mismatch`               | error        | structural | parser: explicit arity skip        |
| `equality-arity-mismatch`             | error        | structural | parser: explicit arity skip        |
| `cardinality-invalid-role`            | error        | structural | vocabulary: no `cardinality` type  |
| `cardinality-non-unary`               | error        | structural | vocabulary: no `cardinality` type  |
| `cardinality-max-less-than-min`       | error        | structural | vocabulary: no `cardinality` type  |
| **`ring-different-players`**          | **error**    | structural | **nothing**                        |
| `external-uniqueness-all-local`       | warning      | semantic   | nothing, by design                 |
| `spanning-all-roles`                  | info/warning | semantic   | nothing, by design                 |

Three findings worth stating separately, because the table flattens
them:

**One real gap.** `constraint/ring-different-players` is an error, is
structural, and nothing stops it. A ring constraint whose two roles are
played by different object types survives conformance, survives the
parser, and lands in the model as an error the extraction could not have
avoided -- the exact shape of barwise-826 and barwise-830.

**Most of the class was already closed, but not by conformance.** Seven
of the invalid-role rules are unreachable because
`resolveRolesByPlayerName` only ever returns ids drawn from the fact
type it was handed, and the three `cardinality` rules are unreachable
because the extraction vocabulary has no such type. That is "define
errors out of existence" working correctly, and it is worth recording:
a future reader auditing conformance alone would find seven rules
apparently unmirrored and be tempted to add seven dead checks.

**Two rules are correctly unmirrored.** `external-uniqueness-all-local`
and `spanning-all-roles` are advisories about modeling style, not
structural defects. Suppressing them in conformance would hide exactly
the feedback they exist to give. They are named here so the next
auditor does not re-derive the question.

## Why a ring over two players is removed, not repaired

Consistent with barwise-826 and barwise-830, and the easiest of the
three to defend. Ring constraints -- irreflexive, acyclic, symmetric --
are defined over a relation on a single set. A ring over two different
object types is not a weak or partial constraint; the predicate it names
has no meaning, and there is no repair that preserves the author's
intent because no coherent intent can be recovered. Picking one player
and dropping the other role would invent a constraint the extraction
never stated, which is the failure mode barwise-827 was about.

Removing charges 0.02 as a conformance correction rather than 0.1 as a
validation error, which is the right relative price for dropping
something malformed instead of shipping something invalid.

## Why the correspondence is then mechanized

The enumeration above is a hand-maintained claim, and this repository
has already been taught what those are worth: the capability matrix in
CLAUDE.md asserted parity that did not hold for two years because
nothing checked it. An audit that ends in a table is the same artifact
-- correct on the day it is written, and silently wrong afterwards.

So the deliverable is not the table. It is a test that feeds a
deliberately-malformed constraint of every type in the extraction
vocabulary through conformance, parses whatever survives, and asserts
the resulting model carries no `constraint/*` **error**. A new rule in
`constraintConsistency` with no counterpart fails it without a live run.

The test asserts on severity `error` rather than on diagnostics
generally, which is what keeps the two correctly-unmirrored advisories
from forcing a wrong fix. That distinction is the whole design of the
test: an assertion of "no `constraint/*` diagnostics" would be stricter,
would look more thorough, and would be wrong.

## Scope

In scope:

- When a ring constraint's two roles resolve to different object types,
  conformance shall remove it and record a correction.
- A ring constraint over two roles played by the same object type shall
  survive untouched, whether its roles are named by role name or by a
  repeated player name.
- A test shall assert, across every constraint type the extraction
  vocabulary can express, that nothing surviving conformance produces a
  `constraint/*` error.

Out of scope, deferred and named:

- **Mirroring the two advisories.** They are feedback, not defects.
- **Rules outside `constraintConsistency`.** The issue scoped this to
  one rule module; other modules deserve the same audit and will not
  get it here (barwise-834).
- **A property-based generator.** The issue floated one. Eleven types
  with one hand-written malformed shape each is legible and complete
  over the vocabulary; a generator would need a per-type notion of
  "malformed" anyway, which is the hand-written table with extra steps.

## Inventory

| Area                                         | Current state               | Verdict |
| -------------------------------------------- | --------------------------- | ------- |
| `llm/src/ExtractionConformance.ts`           | No ring player check        | modify  |
| `llm/tests/ConstraintCorrespondence.test.ts` | Does not exist              | add     |
| `llm/tests/ConstraintArity.test.ts`          | Covers arity and bounds     | none    |
| `core/.../rules/constraintConsistency.ts`    | Correct; the reference side | none    |

The sweep goes in a new file rather than into `ConstraintArity.test.ts`,
which already carries two topics and would be misnamed by a third. The
split is also the honest one: that file pins the two specific gaps that
were found, and this one asserts the property they were instances of.

## Risks and testing

- **Mirroring the parser's role resolution incorrectly.** Conformance
  must resolve a role identifier the same way
  `resolveRolesByPlayerName` does -- role name first, case-insensitively,
  then player name, each match consuming a role so a repeated name picks
  distinct roles. A conformance check that resolved differently would
  reject valid rings or admit invalid ones, reintroducing this exact
  class of bug one level down. The recorded `project-staffing` payload
  is the live case: `Employee mentors Employee` with roles named
  `["Employee", "Employee"]`, which only survives if the repeated player
  name consumes two distinct roles.
- **A ring whose roles cannot be resolved at all.** Left alone here:
  the unresolvable-role check already runs ahead of this one, and the
  parser skips what it cannot resolve.
- **A sweep that passes either way.** The whole value of this test is
  that it fails when the correspondence breaks, and a sweep asserting an
  absence can easily assert nothing at all. Verified by disabling the
  ring check and re-running: four tests fail, including the sweep's own
  `ring over different players` entry. A future edit to the sweep should
  be checked the same way rather than trusted because it is green.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to `constraintConsistency` itself.
- No change to the scoring weights.
- No prompt change.

## Follow-up: the sweep tested the check, not its arithmetic (barwise-840)

The first diagnostic round to run with `errorsByRule` reported a single
`constraint/disjunctive-mandatory-too-few-roles` in fifteen dev runs --
a rule this spec's own check is supposed to make impossible.

`isValidArity` counted `ic.roles.length`, the role _hints_ the model
emitted. `resolveRolesByPlayerName` consumes each role it matches, so
the two disagree, and three shapes carried the difference into a model:

| Shape                             | Why it resolved short                               |
| --------------------------------- | --------------------------------------------------- |
| `["Incident", "Incident"]`        | one role, named twice                               |
| `["Incident", "Customer"]`        | check 4's name set is **global**, not per fact type |
| `["originates from", "Incident"]` | a role name and a player name, one role             |

**The sweep passed throughout**, because every probe used distinct
resolvable names. It asserted the check existed and never that its
arithmetic was right -- the same failure mode one level in from the one
this spec was written about.

The check now measures the resolved count, and only for
`disjunctive_mandatory`, `exclusion` and `exclusive_or`. That scope is
not an approximation: every other type the parser skips outright when
the resolved count is wrong, and a skipped constraint never reaches the
validator, so checking them here would charge 0.02 for constraints
already dropped for free -- a score change dressed as a correctness fix.
The two uniqueness types do build on a short resolution, and a
uniqueness constraint over one role is valid ORM.

One resolver now serves the arity check, the ring-player check and
population completeness. Three copies of a consuming name match is how
this divergence grows.

Verified by mutation: disabling it fails 9 tests, 3 of them sweep
entries.
