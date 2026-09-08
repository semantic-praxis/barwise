# An object type says how it is identified once, or the model says so

Status: Implemented (see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-969 (this spec); follows
`identification-materialised-once.spec.md`, which resolved the other
double declaration (a reference mode against a preferred identifier)

In one sentence: an object type can declare its identity twice -- by
objectifying a fact type and by an identifying subtype fact -- and the
mapper resolves it silently, so the model that caused barwise-965 was
never reported to the person who wrote it.

## Principle

**Explicit over implicit.** `completenessWarnings` already states the
rule: an entity should have exactly one preferred identifier, and "more
than one is contradictory". It enforces that for one KIND of
declaration, counting internal uniqueness constraints marked preferred,
and is silent about the other two ways an object type acquires an
identity.

An entity that objectifies a fact type is identified by that fact type.
An entity whose subtype fact declares `providesIdentification` is
identified by inheriting its supertype's identifier. `identificationGraph`
in `model/identification.ts` already knows both -- it is how the mapper
gets a settlement order -- so the model has the answer and no rule asks
it.

This is not an identification cycle, so `structural/identification-cycle`
does not fire: the graph simply has two out-edges from one node. And it
is not two preferred uniqueness constraints, so
`completeness/multiple-preferred-identifiers` does not fire either. The
gap is exactly "more than one KIND", where the existing rule covers
"more than one of one kind".

It was barwise-965's actual cause. The subtype arm built its shared key
from the subtype's own first key column, and dual identification was the
only way that key could be composite by the time it ran, so a composite
absorbed key was truncated to one column and the shared-key foreign key
aimed at the wrong column. The mapper now resolves it deterministically
-- the objectification wins, being the more specific statement -- and
that resolution stays. This adds the report, not a behaviour change.

## Which kinds count, and what fires (resolved: inheritance is exclusive)

The rule fires when an object type inherits its identity through an
identifying subtype fact AND declares one of its own. It does not fire
on several sources of one kind, because
`completeness/multiple-preferred-identifiers` already reports that and
reporting it twice helps nobody -- and it does not fire on an objectified
type that carries its own reference scheme, which is ordinary ORM.

The first draft was "more than one kind", and measurement said no: see
the resolved section below.

A reference mode is deliberately not one of the kinds. It is shorthand
for an identifying binary rather than an independent declaration, and
`identification-materialised-once.spec.md` already made the preferred
identifier override it. Counting it would make every objectified entity
that also carries one a conflict -- 25 types in this repository, none of
them contradictory.

| Sources                                         | Reported by                                  |
| ----------------------------------------------- | -------------------------------------------- |
| two preferred uniqueness constraints            | `multiple-preferred-identifiers` (unchanged) |
| objectification + identifying subtype fact      | this rule                                    |
| preferred uniqueness + identifying subtype fact | this rule                                    |
| preferred uniqueness + objectification          | nothing: legitimate ORM                      |
| all three                                       | both rules                                   |

## An objectified type may carry its own reference scheme (resolved: measured, and excluded)

The draft rule fired on any two kinds. That charged for good modelling,
and the recorded eval round said so before the rule shipped.

ORM lets an objectified fact type carry a simple reference scheme:
"Review has ReviewId" on a `Review` that objectifies "Reviewer reviews
Paper" is ordinary, not a contradiction. Rescoring the committed
20260828-1647 round with the draft rule moved 13 of 115 payloads and six
of the eight arms -- and every one of the 13 was that shape, on `Review`,
`Enrollment` and `PlanChange`, from four different model arms. Nothing
was contradictory; the rule was.

What IS contradictory is inheritance plus a declaration:
`providesIdentification` says "identified by my supertype's identifier",
and a type that says that and also objectifies a fact type, or also
carries its own preferred identifier, has said two things. So the rule
fires only where an identifying subtype fact meets another source.

With that narrowing, all eight arm means rescore to their pinned values
to six places, so the suite needs no version bump.

## How much this fires (resolved: measured, and silent on everything shipped)

Zero object types in the repository.

Measured by deserializing every `.orm.yaml` that parses -- 59 of 63 --
and counting object types whose sources include an identifying subtype
fact and something else: none. So no shipped model's diagnostics change
and `examples/output/*.diagnostics.txt` needs no regeneration.

The generated corpus is where it lives: 5 of 250 models at the fixed
seed carry the objectification-plus-subtype shape (barwise-969's own
measurement). That matters for which family the rule can belong to: the
serialization law asserts every generated model carries no
`structural/*` diagnostic, so a structural rule would fail that law
until the generator was taught to avoid the shape. A `completeness/*`
warning is unconstrained there, and warning is the right severity
anyway: the resolution is defensible and the schema it produces is
valid.

## Scope

In scope, stated as requirements:

- When an object type inherits its identity through an identifying
  subtype fact and also declares one of its own, the system shall report
  a warning naming that object type and the other source.
- When an objectified object type carries its own preferred identifier
  and no identifying subtype fact, the system shall report nothing.
- When an object type has more than one source of a single kind, the
  system shall report only the existing rule for that kind.
- When the mapper maps such a model, its output shall be unchanged.

Out of scope: the mapper's resolution, which is already settled and
tested; teaching the generator to avoid the shape; and the adjacent
false positive below.

## The adjacent false positive, named and not fixed here

25 objectified entity types in shipped models are reported today as
`completeness/missing-preferred-identifier`, and each of them is
identified -- by the fact type it objectifies.

`checkPreferredIdentifiers` counts preferred uniqueness constraints and
treats zero as "the relational mapper must guess", with one escape for
a subtype that inherits identification. Objectification is not an
escape, so an objectified entity with no preferred uniqueness reports
as unidentified. Measured across the 59 models that parse: 25 entity
types, including every objectified type in the auction project.

Fixing it means `identificationSources` answering the zero case as well
as the many case, which changes diagnostics on four shipped
`examples/output/*.diagnostics.txt` files and possibly promptlab's
scoring inputs. That is a wider behaviour change than this issue asks
for, so it is filed separately with this measurement rather than folded
in. The function this spec adds is what it will be built on.

## Inventory

| Module                                              | Current state                                                              | Verdict                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| `core/src/model/identification.ts`                  | `identificationGraph`, `identificationOrder`, `preferredIdentifyingBinary` | gains `identificationSources`                 |
| `core/src/validation/ruleId.ts`                     | 2 references to a rule id anywhere in the repo per rule                    | gains one id and its metadata                 |
| `core/src/validation/rules/completenessWarnings.ts` | `checkPreferredIdentifiers` counts preferred uniqueness only               | gains the cross-kind check                    |
| `core/src/mapping/RelationalMapper.ts`              | objectification wins over an identifying subtype fact                      | untouched: this adds a report, not a change   |
| `examples/output/*.diagnostics.txt`                 | 4 files carry `missing-preferred-identifier` lines                         | untouched: the new rule fires on none of them |

The two `untouched` rows are claims. The mapper is untouched because
nothing in the validator feeds it. The diagnostics files are untouched
because the rule fires on zero shipped object types, measured rather
than assumed.

## Target architecture

```ts
// core/src/model/identification.ts
export type IdentificationSource =
  | { readonly kind: "preferred-uniqueness"; readonly factTypeId: string; }
  | { readonly kind: "objectification"; readonly factTypeId: string; }
  | { readonly kind: "identifying-subtype"; readonly supertypeId: string; };

export function identificationSources(
  model: OrmModel,
  entity: ObjectType,
): readonly IdentificationSource[];
```

A discriminated union rather than a count, because the report names the
kinds and a count cannot. It lives beside `identificationGraph`, which
already walks two of the three sources for the mapper's settlement
order -- "what identifies what" is one metamodel question with one home,
and the validator and the mapper are both callers.

## Alternatives considered

- **Extend `checkPreferredIdentifiers` to count all three kinds** under
  the existing rule id. One rule for one concept, and it would fix the
  false positive above in the same move. Rejected for this change
  because it alters an existing rule's meaning and message and changes
  diagnostics on four shipped files; it is the right shape for the
  follow-up, once that delta is measured deliberately.
- **A `structural/*` rule.** The shape is a modelling contradiction,
  not a broken reference, and the serialization law forbids
  `structural/*` on generated models where 5 of 250 carry it. It would
  fail that law until the generator was taught, which is generator work
  this issue does not ask for.
- **Report nothing and keep resolving silently.** What happens today.
  The resolution is defensible, but a modeller who wrote both probably
  meant one, and this shape has already cost one real defect.

## Workstream: report an identity declared more than one way

Add `identificationSources`, add
`completeness/conflicting-identification` with its metadata, and check
it in `completenessWarnings`.

Acceptance, in EARS form: when a model declares both an objectification
and an identifying subtype fact on one object type, `validate` shall
report a warning naming that object type; and when a model declares two
preferred uniqueness constraints on one entity, it shall report only
`completeness/multiple-preferred-identifiers`. The mapper's existing
fixture "an objectification outranks an identifying subtype fact on the
same type" shall still pass unchanged.

## API and migration impact

- No package API change: `model/identification.ts` is internal.
- One new diagnostic id. `validate` output changes only for models
  carrying the shape, of which there are none in the repository.
- No mapper change, so no schema, golden, or example output changes.

## Risks and testing

- **The risk is a rule that cannot fire**, since nothing shipped
  exercises it. The fixtures are therefore hand-built for both firing
  pairs and for the pair that must NOT fire, and the rule is shown red
  before it is trusted green.
- **The second risk is a rule that fires too much**, which the draft did.
  The recorded eval round is the check that caught it, and it is a check
  worth running against any new validation rule: `rescoreDirectory` over
  `eval-payloads/20260828-1647` says what a rule change costs on 115 real
  extractions before it is charged to anyone.
- The second risk is double reporting. The two-preferred-uniqueness case
  is asserted to produce exactly one diagnostic, not two.
- One PR, followed by `npm run ci:local` from `barwise/` with the exit
  code read directly.

## Non-goals

- No change to the mapper's resolution.
- No change to `completeness/missing-preferred-identifier`, including
  its 25 false positives, which are filed separately.
- No generator work.

## Implementation notes

**The draft rule was wrong, and the eval payloads said so.** "More than
one kind" fired on 13 of 115 recorded payloads, all of them an
objectified type carrying its own reference scheme -- `Review`,
`Enrollment`, `PlanChange`, from four model arms. That is legitimate ORM,
and charging it would have moved six of the eight arms:
default-haiku-train -0.004235, default-sonnet-dev -0.003718,
default-sonnet-train -0.003557, sonnet5-3-train -0.003771, haiku45-2-dev
-0.001010, sonnet5-3-dev -0.000866. Measured by dumping per-payload
scores with the rule on and off and diffing. With the rule narrowed to
inheritance-plus-declaration, all eight arms rescore to their pinned
values to six places and `suite.yaml` needs no bump.

It was caught by `recordedEvidencePin.test.ts` failing in the
`test:coverage` gate -- a test written to force exactly this
deliberation. The scan that missed it looked at `.orm.yaml` files, and
the eval payloads are extraction JSON, so a repository-wide scan for
"which models carry this shape" was answering a narrower question than
it appeared to.

**Red-first proof.**

| Mutation                                  | Killed                                              |
| ----------------------------------------- | --------------------------------------------------- |
| the check is not called                   | both firing fixtures                                |
| it fires on one source (`kinds.size < 1`) | the single-source fixture and the two-preferred one |

**What is still not guarded.** The rule reports; it does not stop the
mapper resolving, which is deliberate. And the 25 objectified entity
types wrongly reported as missing a preferred identifier are untouched
and filed as barwise-972, built on the same `identificationSources`.
