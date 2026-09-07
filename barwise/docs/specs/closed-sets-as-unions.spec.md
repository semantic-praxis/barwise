# Closed sets belong in the type system: rule ids and change descriptions as unions

Status: WS1 and WS2 implemented (barwise-946 closed); WS3 not started
Created: 2026-09-07
Last-updated: 2026-09-07 (WS1 shipped; WS2 scope revised and shipped)
Tracking: barwise-947 (this spec); barwise-946 (breaking-change
severity string-matches prose);
the Evidenced-sites section of `core-branching-load.spec.md`, whose
"typed intermediates erased to strings" looseness this closes two
instances of

In one sentence: two sets in core are closed, finite and known at
compile time, and both are typed as open `string` -- the 76 validation
rule ids and the diff's change descriptions -- so a typo is
undetectable, no consumer can be checked for exhaustiveness, and one
consumer already gives the wrong answer.

## Principle

This is the cheapest available instance of "rich types drive
correctness," and it needs no new mechanism: core already derives a
runtime list from a compile-checked `Record<T, true>` twice
(`RING_TYPES`, `CONCEPTUAL_DATA_TYPE_NAMES`, both from barwise-869) for
exactly this reason. The idiom exists; two sets that qualify have not
been moved to it.

The distinction that makes these two worth doing before the larger
rich-types work is that **both sets are known statically**. The domains
in barwise-945 -- which values a population tuple may hold -- are
runtime data, so no annotation can carry them and the enforcement has
to be a constructor. A rule id and a change description are neither:
they are written as literals in core's own source, so a union costs
nothing at runtime and the compiler does the whole job.

One consumer already diverges, which is what moves this from tidiness
to a defect: `breakingLevel.ts` classifies a change by string-matching
prose `elementDiff.ts` wrote, and an object type's definition change
reads `safe` while a standalone definition's text change reads
`caution`, for the same conceptual change, because a third producer
spelled it differently (barwise-946).

## Scope

In scope, stated as requirements:

- When a validation rule emits a diagnostic, the system shall type its
  `ruleId` as a member of a closed union, so an identifier absent from
  that union is a compile error.
- When a consumer needs the rule ids as data, the system shall derive
  the runtime list from the same declaration the union is derived from,
  so the list cannot lag the union.
- When the diff reports a modification, the system shall carry each
  change as a discriminated variant, and `classifyBreakingLevel` shall
  switch over those variants exhaustively, so a variant added without a
  classification is a compile error.
- When a change description is displayed, the system shall render it
  from its variant, so the prose has exactly one producer.
- When an object type's definition changes and when a standalone
  definition's text changes, the system shall report the same breaking
  level.

Out of scope, deliberately:

- The runtime domains of barwise-945 (which values a population tuple
  may hold) and the smart constructors they need. Different mechanism,
  different spec; noted here only because it is the natural next step
  and this one is a prerequisite for none of it.
- Branding the id types (`RoleId`, `ObjectTypeId`). Worth doing and
  independent: a brand answers "what kind of id is this", where this
  spec answers "is this one of the known values". Listed under
  Alternatives so the reviewer can pull it in.
- Any change to what the validator checks, or to which rules exist.
- `Diagnostic.elementId`, which is a reference into the model and so is
  a barwise-945-shaped problem, not this one.

## Inventory

| Module                                           | Current state                                           | Verdict                                        |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------- |
| `core/src/validation/Diagnostic.ts`              | `ruleId: string`                                        | narrows to `RuleId` (WS2)                      |
| `core/src/validation/rules/**` (17 files)        | 76 distinct `ruleId: "..."` literals, none interpolated | unchanged text; the union is derived from them |
| `core/src/model/Constraint.ts`                   | `RING_TYPE_MEMBERS` / `RING_TYPES`                      | untouched; the idiom WS2 copies                |
| `cli/src/commands/validate.ts:67`                | mints `ruleId: "project/file-unresolved"`               | the only non-core producer; see Open decisions |
| `core/src/diff/elementDiff.ts`                   | writes 20+ prose descriptions                           | emits variants instead (WS3)                   |
| `core/src/diff/breakingLevel.ts`                 | matches those strings by `===`, `startsWith`, regex     | switches on the variant (WS3); patched in WS1  |
| `core/src/diff/deltas.ts`                        | `changeDescriptions: readonly string[]`                 | gains the variant array (WS3)                  |
| `cli`, `mcp`, `vscode` diagnostic consumers      | pass `ruleId` through to display and logs               | untouched: a union is assignable to `string`   |
| `promptlab`, `llm` observation code              | declare their own local `ruleId?: string`               | untouched; structural, not core's type         |
| `learn/src/evaluate/checks/forbidsPopulation.ts` | uses `ruleId` inside a dedupe key                       | untouched                                      |

Two facts that decide the shape below, both verified rather than
assumed. No rule id anywhere is built by interpolation -- all 76 are
literals -- so a union is viable. And exactly one rule id is minted
outside core.

## Target architecture

```ts
// core/src/validation/ruleId.ts

// Record-typed for the reason RING_TYPE_MEMBERS is (barwise-869): a
// member added to the union without a row here is a compile error,
// where a bare literal array would type-check while incomplete.
const RULE_ID_MEMBERS = {
  "structural/dangling-role-reference": true,
  // ... 75 more
} as const satisfies Record<string, true>;

export type RuleId = keyof typeof RULE_ID_MEMBERS;
export const RULE_IDS = Object.keys(RULE_ID_MEMBERS) as readonly RuleId[];

// core/src/diff/deltas.ts

export type ChangeDescription =
  | { readonly field: "definition"; }
  | { readonly field: "note"; }
  | { readonly field: "arity"; readonly from: number; readonly to: number; }
  | {
    readonly field: "rolePlayer";
    readonly index: number;
    readonly from: string;
    readonly to: string;
  }; // ... one per thing the diff can report

// core/src/diff/breakingLevel.ts

function classifyChange(change: ChangeDescription): BreakingLevel {
  switch (change.field) {
    case "definition":
      return "safe";
    case "arity":
      return "breaking";
    // ...
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}
```

The `never` default is the whole point of WS3: today an unrecognized
description falls through to `return "caution"`, so a new one is
misclassified silently. After it, a new variant does not compile until
it is classified.

## Alternatives considered

- **Leave `ruleId` a string and fix barwise-946 alone.** Cheaper, and
  it closes the live defect. Rejected as the whole answer because the
  same class recurs -- the diff comparing four fields short
  (barwise-934) and the merge dropping element kinds (barwise-937) are
  both "a consumer enumerated by hand and missed one", and each was
  found by a defect rather than by a compiler. WS1 does exactly this
  much, immediately, and the rest follows.
- **Brand the ids instead.** A brand answers a different question --
  role id versus object type id -- and does not make a value's
  membership in a known set checkable. Both are worth having; they do
  not substitute for each other, and branding is the larger job because
  every id-minting boundary needs a cast.
- **Generate the rule-id union from the source.** A codegen step
  scanning for `ruleId:` literals would keep the union current with no
  discipline. Rejected: it adds a generator and a drift test to save
  one hand-edit per new rule, and the `Record` idiom already makes
  forgetting the edit a compile error at the point of use.
- **Keep the prose and add a parity entry.** `parity.manifest.json`
  would pair `elementDiff.ts` with `breakingLevel.ts`. It is the
  project's standard answer for a must-agree copy, and it is weaker
  here than the type: a parity check fires when the files diverge
  textually, where a discriminated union makes the divergence
  unrepresentable. Prefer the type where a type will do.

## Workstreams (each independently shippable)

### 1. Close barwise-946 where it stands

Teach `classifyChange` the description it does not know, so an object
type's definition change and a standalone definition's text change
agree, and add a test that enumerates every string `elementDiff.ts` can
emit and asserts each is explicitly classified rather than reaching the
fallback. That test is the drift guard the pair needs today and is
retired by WS3.

Acceptance, in EARS form: when a standalone definition's text changes,
the system shall report the same breaking level as when an object
type's definition changes; and when `elementDiff.ts` emits any change
description, the test shall find it explicitly classified.

This ships first because it is a live, user-visible wrong answer and it
does not depend on either union.

**Shipped 2026-09-07, and it found more than the issue recorded.**
barwise-946 named one unclassified description; the scanner found
four -- `cardinality changed`, `derivation changed`, `definition text
changed` and `context: ... -> ...` -- all silently taking the caution
fallback. Two are now `safe` (the standalone definition's text and its
bounded context, matching how an object type's `definition` and
`sourceContext` are already treated, which is the drift the issue
named); two stay `caution` with the verdict unchanged and only the
intent new.

Making the drift testable needed one refactor the workstream did not
anticipate: `classifyChange` returned the literal `"caution"` both for
a deliberate caution and for an unrecognized string, so the two were
indistinguishable and no test could tell them apart. It now returns
`BreakingLevel | undefined` as `classifyKnownChange`, with
`classifyBreakingLevel` applying the caution default, so behaviour is
unchanged for anything still unknown.

The guard derives the producer's side from the producer's source rather
than restating it, so a description added without a classification
fails; a hand-written list of expected strings would simply not mention
the new one. Watched failing on a planted description before it was
believed, and it names the offending string.

### 2. The rule registry owns id, severity and message

Add `core/src/validation/ruleId.ts` holding a `Record<RuleId,
RuleDescriptor>` rather than a `Record<RuleId, true>`, derive the union
and the runtime list from it, export all three from core's root, and
make `Diagnostic` generic as `Diagnostic<R extends string = RuleId>`.
The 76 literals in the rule modules do not change text; they become
checked.

The descriptor is deliberately a subset of SARIF's
`reportingDescriptor` -- a short description, a default level, and room
for a help URI -- so the registry is the data a SARIF exporter needs
rather than a second thing to maintain beside it. That is what makes
the 76 rows worth writing: a bare `true` is ceremony, while a
descriptor means a rule cannot be registered without being described,
and `barwise` gains a documented rule catalogue it does not have today.

Each surface that mints its own ids gets its own registry of the same
shape, scoped to what that surface owns. The composition is explicit
and local: the one such site today types its diagnostics
`Diagnostic<RuleId | CliRuleId>`. Core never learns a surface's ids;
`mcp` never sees `cli`'s.

Acceptance, in EARS form: when a rule module emits a `ruleId` that is
not a member of `RuleId`, the build shall fail; when a rule id is added
to the registry without a description and a default level, the build
shall fail; and when a surface mints an id of its own, it shall do so
from its own registry, with core unchanged.

Verified by spike before this was written, on the real 76-member union:
core's 125 `Diagnostic[]` signatures compile unedited because the
default type parameter absorbs them; the CLI fails on exactly the one
out-of-set literal, named in the error; and all 12 packages build once
the CLI declares its own set. The cost outside core is four lines.

A rule's identity, its severity and its message text all live in the
registry; an emit site names the rule and supplies only the occurrence:

```ts
diagnostics.push(report(RULE_ID.subtypeCycle, "default", nodeId));
diagnostics.push(
  report(RULE_ID.exclusionViolation, "spanning", ft.id, roles, value, count),
);
```

`messages` is a dictionary keyed by message id, following SARIF's
`reportingDescriptor.messageStrings`, because nine rules legitimately
report more than one condition -- `population/exclusion-violation` fires
both for roles within one fact type and for roles spanning several, and
those are different sentences. Naming the message rather than splitting
the rule is what SARIF does, and it keeps the distinction machine-
readable: the message id maps onto a result's `message.id` on export.

The message is a typed function rather than a `{0}`-placeholder string:

```ts
[RULE_ID.objectCardinalityViolation]: {
  severity: "error",
  description: "An object type's population size falls outside its declared bounds.",
  messages: {
    aboveMaximum: (typeName: string, count: number, max: number | "unbounded") =>
      `Object type "${typeName}" has ${count} instance(s), above the maximum of ${max}.`,
  },
},
```

With `report<K extends RuleId, M extends MessageId<K>>(id: K, messageId:
M, elementId: string, ...args: Parameters<...>)`, an unknown message id,
a wrong argument type and a wrong arity are all compile errors --
verified by spike before this was written. The cost is that a function
cannot be exported as a SARIF `messageString` for localization, so a
writer emits the rendered `message.text`, which the standard permits.
barwise has no localization requirement and does have a defect history
of hand-copied lists, so the typing wins.

Two things stay at the emit site. Roughly twenty rules derive severity
at runtime through `severityForModality` (a deontic constraint lowers a
violation to a warning), so they override the descriptor's default. And
a few messages are computed rather than templated, and pass the computed
piece as an argument.

**Shipped 2026-09-07.** The spike's numbers held:**Shipped 2026-09-07.** The spike's numbers held:**Shipped 2026-09-07.** The spike's numbers held: core's 125
`Diagnostic[]` signatures compiled unedited, and the only downstream
break was the CLI's one out-of-set literal, named in the error.

Three things the workstream did not anticipate.

The registry needed a _second_ drift direction guarded. The compiler
rejects a rule emitting an unregistered id, but a registry listing an id
no rule emits any more still compiles and still passes every other
test -- which is how a catalogue quietly fills with rules that were
deleted. The test scans both ways.

`merge-error` is in the set and is not a validation rule: `mergeAndValidate`
mints it when a merge throws. It is described as such rather than
renamed, because the string reaches consumers today and renaming it
would be a behaviour change this workstream has no reason to make.

Writing the descriptions found one of its own: a test requiring a
description longer than its identifier caught `"Two fact types share a
name."`, which restates the id and explains nothing. Both duplicate-name
rules now say why it matters. The threshold stayed; the descriptions
improved.

### 3. Change descriptions as a discriminated union

Add a variant array to `ModelDelta`, render the prose from the variants
for display, and make `classifyChange` exhaustive with a `never`
default. Retire WS1's enumeration test, which the compiler now
subsumes.

`changeDescriptions` stays, as a getter deriving today's exact strings
from the variants, so the CLI's output, the MCP `executeDiff` JSON and
every existing test are unaffected. That is deliberate: this workstream
makes the data available without changing what any surface emits.
Exposing the structured variants through the MCP tool's JSON is a
surface change with a capability-matrix row, and belongs to whoever
wants it, not here.

Per the resolved decision above, variants carry copied plain data --
never a model instance, never a live reference -- so a delta stays
JSON-serializable and stable against later mutation of the models it
came from. `constraints added` carries the constraints, not a list of
their type names, which is the largest single recovery of information
in this workstream.

Acceptance: when a variant is added to `ChangeDescription` without a
`classifyChange` arm, the build shall fail; and when the diff output is
rendered, the text shall be unchanged from today's for every existing
variant, pinned by the existing diff tests.

## Measured blast radius

Spiked rather than estimated, 2026-09-07, by generating the union from
the 76 literals, narrowing `Diagnostic.ruleId`, building core and
type-checking all eleven downstream packages. The spike was reverted.

| Package         | WS2 errors | What broke                                         |
| --------------- | ---------- | -------------------------------------------------- |
| `core`          | 0          | nothing: all 76 literals already satisfy the union |
| `cli`           | 1          | `validate.ts:67`, the one non-core producer        |
| everything else | 0          | a union is assignable to `string`                  |

WS2 is therefore far smaller than its row count suggests. The 17 rule
modules do not change at all -- narrowing a _produced_ value costs its
producers nothing when their literals are already members, and the
compiler simply starts checking them. The whole diff is one new file of
76 rows, one narrowed field, one export, and one decision about
`project/file-unresolved`.

WS3 is the larger half, and it is concentrated in core:

| Package                    | Sites | Kind                                       |
| -------------------------- | ----- | ------------------------------------------ |
| `core/src` (2 files)       | 12    | the real work: `deltas.ts`, `ModelDiff.ts` |
| `core/src/elementDiff.ts`  | 20+   | the producers, rewritten to emit variants  |
| `core/tests`               | 31    | fixtures, not type-checked (barwise-944)   |
| `cli`, `vscode`, `mcp` src | 6     | all read-and-join, for display only        |

Every downstream site iterates or joins the strings, so keeping
`changeDescriptions` as a derived getter leaves all six untouched. That
is the difference between WS3 as scoped here and a rewrite that changes
what four packages display.

## API and migration impact

- `Diagnostic.ruleId` narrows from `string` to `RuleId`. Narrowing a
  produced value is safe for every consumer that reads it: a union is
  assignable to `string`, so display, logging and dedupe code compiles
  unchanged. The breaking direction is code that _assigns_ an arbitrary
  string into a `Diagnostic`, and there is exactly one such site
  outside core.
- Core gains two exports, `RuleId` and `RULE_IDS`, and in WS3 a
  `ChangeDescription` union. `changeDescriptions` remains readable as
  strings.
- No behaviour changes except WS1's corrected severity, which is the
  point of WS1.

## Open decisions (for review)

- **Where the one non-core rule id lives. (resolved: each surface owns
  its own registry.)** Core exports `Diagnostic<R extends string =
  RuleId>` and its own registry; a surface declares a registry of its
  own and composes explicitly at the sites that handle both. Core knows
  that surfaces _may_ extend -- that is what the type parameter says --
  without knowing which do. The rejected alternatives are worth
  recording. Moving the id into core makes core name a CLI concern and
  breaks the dependency rule. A `` `host/${string}` `` template leaves
  the escape half unchecked. The TypeScript ecosystem's standard answer,
  a declaration-merging registry (`interface RuleIdRegistry {}` plus
  `keyof`, as React uses for `ReactNode`), is the closest call: it
  removes the need to touch any consumer, because `RuleId` widens
  globally. It loses on two counts -- the widening is global and
  unconditional, so `mcp` would carry `cli`'s ids without depending on
  cli, which is the coupling this decision exists to avoid; and it
  destroys exhaustiveness, since a `switch` over `RuleId` stops being
  total the moment any surface augments. SARIF reached the same
  decomposition independently: `tool.driver.rules[]` for the core
  component and `tool.extensions[].rules[]` per contributor, with each
  result's id scoped to its component.

- **How far WS3's variants decompose. (resolved: carry the values, as
  plain copied data.)** Today's prose splits, and splits the wrong way:
  it keeps the values for scalars (`kind: entity -> value`, `arity: 2
  -> 3`, `role 0: player Customer -> Client`) and discards them for
  every structured one (`value constraint changed`, `cardinality
  changed`, `aliases changed`, `readings changed`, `derivation
  changed`), while `constraints added: internal_uniqueness` collapses
  the actual constraint objects to a deduplicated list of type names.
  The richest data is exactly what is lost, so a variant set that
  carried only what the prose carries would preserve that loss in a new
  shape.

  Three consequences follow, and they are the substance of this
  decision rather than the headline.

  **Copies, not references.** A variant holding a live reference into a
  model can be corrupted by a later mutation of that model -- the same
  aliasing shape as the merge carrying diagram layouts by reference,
  found on 2026-09-07. The values here are small (a value constraint is
  a few strings; readings are a few templates), so copying costs
  nothing and makes the delta stable.

  **Plain data, never model instances.** A variant carries
  `{id, name, playerId, playerName}` for a role, not a `Role`. This
  keeps a delta JSON-serializable, which is what the MCP path needs and
  what makes the copy trivially correct; `structuredClone` (Node core,
  no dependency) handles plain data and would lose a class prototype.

  **Both id and name where the prose resolved a name.** `role 0: player
  Customer -> Client` reads names resolved against two _different_
  models, so a consumer holding only the delta cannot re-derive them.
  The variant carries the id for identity and the name for rendering.

  The objection a reviewer will raise: `ModelDelta` already holds
  `existing` and `incoming`, so the values are reachable and this
  duplicates them. The answer is that a variant is a derivation
  computed once at diff time from those same inputs and never mutated
  afterwards -- memoized, not a second maintained copy -- so it cannot
  drift within a delta. It is not the must-agree case
  `duplication-drift-guards.spec.md` governs.

- **Whether WS2 is worth its diff on its own. (resolved: yes, once the
  rows carry descriptors.)** As originally drafted -- 76 rows of
  `Record<RuleId, true>` -- it was a wide, dull change whose only payoff
  was a typo guard no current defect traces to, and the honest
  recommendation was "do it anyway". Shaping the rows as SARIF
  descriptors changes that: the same diff also produces a rule
  catalogue with a description and a default level per rule, which
  barwise has never had, and it is the prerequisite for emitting SARIF
  at all. The row stops being ceremony and starts carrying the
  documentation a new rule would otherwise ship without.

## Risks and testing

- The absent-data rule set of `core-model-laws.spec.md`'s WS4 is
  **not** dissolved by WS2, and an earlier reading of this said it was.
  A union makes the ids in that set compile-checked as _existing_ ids,
  which removes one drift risk; it does not check that the set is the
  right one, because "reads `buildObjectUniverse`" is a property of the
  rule's implementation, not of its id. `buildObjectUniverse` has four
  callers today (`mandatory`, `cardinality`, `spanning`, `joinPath`).
  WS4's parity row is still needed; it just gets safer entries.
- WS3 changes a public type on `ModelDelta`. The `changeDescriptions`
  getter keeps the rendered strings available so no downstream display
  code changes, but anything constructing a `ModelDelta` by hand in a
  test will need the variants. Test files are not type-checked
  (barwise-944), so those breaks surface at runtime rather than at
  build -- expect to fix them from failing tests, not from `tsc`.
- A 76-member union produces long error messages when a mismatch
  occurs. Tolerable, and the message names the offending literal.
- Each workstream keeps the full suite green and is one PR.

## The SARIF exporter is a follow-up, not part of this

Aligning the registry with SARIF's `reportingDescriptor` is in scope
because it decides the shape of a table this spec is writing anyway.
Emitting SARIF is not: `barwise validate --format sarif` needs a
component assembly, a mapping from `elementId` to a real source
location (the VS Code server already has `YamlSourceMap`, which core
does not), a severity-to-level mapping, and a row in the capability
matrix. That is its own spec and its own PR, and it is the reason the
descriptors are worth shaping correctly now rather than being
retrofitted. Filed as barwise-948.

## Non-goals

- No new dependency, no codegen step, and no runtime cost: every
  mechanism here is a type plus one `Object.keys` already used twice in
  core.
- No attempt to type the runtime domains (barwise-945); this spec is
  deliberately the half a compiler can do alone.
