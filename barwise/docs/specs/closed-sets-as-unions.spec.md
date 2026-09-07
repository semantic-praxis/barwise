# Closed sets belong in the type system: rule ids and change descriptions as unions

Status: Draft -- no workstream implemented
Created: 2026-09-07
Last-updated: 2026-09-07
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

### 2. `RuleId` as a closed union

Add `core/src/validation/ruleId.ts` with the `Record`-derived union and
runtime list, export both from core's root, and narrow
`Diagnostic.ruleId`. The 76 literals in the rule modules do not change
text; they become checked. Resolve the one non-core producer per the
first open decision.

Acceptance: when a rule module emits a `ruleId` that is not a member of
`RuleId`, the build shall fail; and when a consumer needs the ids as
data, `RULE_IDS` shall provide them.

### 3. Change descriptions as a discriminated union

Replace `changeDescriptions: readonly string[]` with a variant array,
render the prose from the variant for display, and make
`classifyChange` exhaustive with a `never` default. Retire WS1's
enumeration test, which the compiler now subsumes. Keep a
`changeDescriptions` getter deriving the strings, so CLI and MCP output
and their tests are unaffected.

Acceptance: when a variant is added to `ChangeDescription` without a
`classifyChange` arm, the build shall fail; and when the diff output is
rendered, the text shall be unchanged from today's for every existing
variant, pinned by the existing diff tests.

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

- **Where the one non-core rule id lives.** `cli/src/commands/
  validate.ts` mints `project/file-unresolved`, and core cannot know
  about ids its own rules do not emit. Option A: move that id into
  core's project rule set, since it is a project-level diagnostic and
  core already has `projectRules.ts`. Option B: export a documented
  `HostRuleId` escape (a template type such as `` `host/${string}` ``)
  so a surface can mint its own without weakening core's set. Option C:
  leave `Diagnostic.ruleId` as `string` and apply `RuleId` only inside
  core's rule modules, which keeps the guarantee where the literals are
  and gives consumers nothing. Recommend A: one id, it belongs in core
  by kind, and it keeps the union closed. B is the right answer only if
  more surfaces start minting ids, which none do today.
- **How far WS3's variants decompose.** A change can be a bare field
  marker (`{field: "definition"}`) or carry its values
  (`{field: "arity", from, to}`). Carrying values makes the prose
  derivable and lets a consumer program against the change; bare
  markers are a smaller diff. Recommend carrying values where
  `elementDiff.ts` already interpolates them into the prose, and bare
  markers where it does not, so no information is invented and none is
  discarded.
- **Whether WS2 is worth its diff on its own.** 76 rows of a `Record`
  plus one narrowed field is a wide, dull change whose only immediate
  payoff is that a typo becomes a compile error -- no current defect
  traces to a mistyped rule id. Recommend doing it anyway and saying so
  plainly: it is the enabling step for any consumer that wants to
  switch on a rule id exhaustively, and the cost is one hand-edit per
  new rule thereafter. A reviewer who disagrees should say so, and WS1
  and WS3 stand without it.

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

## Non-goals

- No new dependency, no codegen step, and no runtime cost: every
  mechanism here is a type plus one `Object.keys` already used twice in
  core.
- No attempt to type the runtime domains (barwise-945); this spec is
  deliberately the half a compiler can do alone.
