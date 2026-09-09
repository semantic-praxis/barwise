# Functional design quality: five caller-side measures for core, each a ratchet

Status: Draft -- the five open decisions resolved in review 2026-09-09
(see Decisions); no workstream implemented
Created: 2026-09-09
Last-updated: 2026-09-09
Tracking: barwise-981 (this spec); barwise-x4z (the purity half of the
analysis this answers; the type-system half went to
`core-branching-load.spec.md`); barwise-e8m (the standing commitment to
a clean functional core); the omission defects that ground it:
barwise-927, -931, -934, -937 (2026-09-06), -958, -961, -962 (found by
the laws that `core-model-laws.spec.md` landed)

In one sentence: measure how functional core is by five properties a
caller can observe -- determinism, no escaping mutation, totality,
knowable domains stated as types, and law coverage -- each as a check
with a baseline that moves in one direction, and not by size or syntax
counts, because size predicts churn rather than defects and syntax
counts reward style over substance. Beside the five, Sarkar's
API-based modularization measure replaces the raw export count as the
interface instrument (Decisions).

The measurements below were taken on 2026-09-09 against main `a3c6a86`.
Every number is reproducible from the command that produced it, and
each workstream's first act is to re-take it.

## Principle

Determinism in core is the pillar, and `check-core-purity.mjs` checks
its floor: no I/O, no clock, no randomness, no SDK. Nothing checks the
rest of what a functional core promises its caller. Inputs come back
unchanged. Failure is in the return type, so the caller cannot forget
it. The type admits exactly the values the domain admits, so a reader
learns the rule from the type and the compiler enforces it at every
construction site. What holds for one fixture holds for every model.
Each of these is currently a discipline, and a discipline is what
Ousterhout calls an unknown unknown: nothing tells the reader of
`ModelMerge.ts` that it must copy every field, so a forgotten field is
invisible until a law finds it. Four such defects landed in two days.

Composability is why the five are measured separately rather than as
one score. Each names one property, one instrument and one baseline;
fixing one cannot move another; and each is a candidate the ReScript
experiment (`core-in-rescript.spec.md`) can read on both sides of its
language boundary, which a single "functional score" would hide.

## Should the measure be size or syntax? (resolved: neither)

Harrison, Samaraweera, Dobie and Lewis (1995) correlated cheap static
indicators of twelve SML programs against what happened during their
development. Size and function counts predicted modification requests
and felt complexity. Nothing predicted error counts or fix time. El
Emam et al. (2001) then showed that of 24 published design metrics,
four survived controlling for size; Graves et al. (2000) that change
history out-predicts every product metric; and Di Penta et al. (2024)
that changes touching lambdas, comprehensions and map/filter/reduce in
200 Python projects had higher odds of inducing a later fix than other
changes. Size is a churn proxy, and syntax-level functional style is
not the property that matters.

Our own history says the same thing and adds a twist. The paper's
crudest indicator, line count, points straight at the files where the
four September omission defects lived. So does one of the measures
below, and that one is not a size proxy:

| Core file                     | Lines | Mutable-container parameters | Omission defects |
| ----------------------------- | ----: | ---------------------------: | ---------------- |
| `mapping/RelationalMapper.ts` |   854 |                           14 | -931, -961, -962 |
| `diff/ModelMerge.ts`          |   739 |                            6 | -927, -937       |
| `diff/elementDiff.ts`         |   512 |                            3 | -934             |
| `validation/ruleId.ts`        |   959 |                            0 | none             |
| `model/Constraint.ts`         |   704 |                            0 | none             |

The two largest files in core carry no mutable parameters and no
omission defects. The three defect files carry 23 of the 39 mutable
parameters in the package. A function that threads a `Map<string,
MutableTable>` through its callees is one whose result is assembled by
side effect, and a field forgotten by one callee is exactly the defect
class the laws keep finding. That is the caller-side property; the line
count is the shadow it casts.

## Scope

In scope, stated as requirements:

- When `npm run audit:functional -- --check` runs, the system shall
  fail on a detected candidate absent from `functional-baseline.json`
  AND on a baseline entry no longer detected, for each of four
  detectors: `invariant` (a comment carrying invariant vocabulary over
  a type in `packages/core/src/model`), `throw` (a `throw` site in
  `packages/core/src` classified as lookup, construction, boundary or
  removal-guard, plus each by-id lookup method on `OrmModel` typed
  `T | undefined` with its call-site count), `law` (a capability
  directory under `packages/core/src` with no test under
  `packages/core/tests/laws`), and `api` (a cross-directory import
  inside `packages/core/src` that does not go through the target
  directory's `index.ts`).
- When `npm run lint` runs over `packages/core/src`, the system shall
  fail on assignment to a parameter or to a property of one
  (`no-param-reassign` with `props: true`), with no baseline: the two
  sites that exist are fixed in the same workstream.
- When `npm run lint` runs over `packages/core/src`, the system shall
  fail on a function parameter or declared return type typed as a
  mutable container (`T[]`, `Array<T>`, `Map`, `Set`, `Record`) that is
  absent from `eslint-suppressions.json`, and on a suppression no
  longer used. ESLint 10.9.1 does both: an unused suppression exits 2
  naming `--prune-suppressions`, a new violation exits 1, and a count
  exceeded surfaces every violation in that file (verified 2026-09-09).
- When any of the checks above fails, the system shall print the
  candidate's stable key, the file, and the sentence that says what to
  do (fix, or classify in the baseline with an issue), matching
  `audit-duplication.mjs`.
- When the gates' own tests run (`npm run test:scripts`), the system
  shall show each new check RED on a defect planted where it looks,
  from three working directories, as `ci.yml` requires of every
  enumerating gate.
- When `node scripts/defect-correlation.mjs` runs, the system shall
  emit a dated markdown report correlating per-file size, churn and
  each measure above against defects recorded in `.beads/issues.jsonl`,
  using rank correlation, so the ratchets are validated against this
  repository's outcomes rather than the paper's.

Out of scope, and where it lives instead:

- Splitting the loaded document from the well-formed model so that
  capabilities receive a type that excludes invalid states. That is
  `model-graph-and-id-spaces.spec.md` (shipped 2026-09-09) and
  `core-branching-load.spec.md` WS1; this spec measures the gap those
  close.
- A `Result` type and a migration of throw sites to it. This spec
  classifies and ratchets the sites; what replaces them is settled in
  Decisions (nothing: the sealed record defines them out), and the
  deletion itself is `core-branching-load` WS1's.
- Any rule against loops. See Alternatives.
- The ReScript adoption decision. The measures here are the
  TypeScript side of that experiment's criteria; the experiment reads
  them and does not decide them.

## Inventory

| Property                           | Instrument today                                      | Measured 2026-09-09                                                                                                                                                                  | Verdict                                             |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Determinism                        | `scripts/check-core-purity.mjs`                       | 0 violations                                                                                                                                                                         | stays; the floor                                    |
| No escaping mutation: assignment   | none                                                  | 2 sites, both `renderers/openapi.ts` (rebinding the `path` parameter)                                                                                                                | hard rule, WS2                                      |
| No escaping mutation: input types  | none                                                  | 39 of 1,762 parameters typed as a mutable container; 90 typed readonly; 464 untyped (inferred)                                                                                       | ratchet, WS2                                        |
| No escaping mutation: return types | none                                                  | 119 of 1,071 functions declare a mutable-container return; 24 readonly; 414 inferred; 68 of the 119 are `Diagnostic[]` in `validation`                                               | ratchet, WS2                                        |
| Totality                           | none                                                  | 95 `throw` sites: 50 construction, 28 boundary, 8 lookup, 6 removal-guard, 3 impossibility; 9 by-id lookups on `OrmModel` typed `T \| undefined`, 220 call sites across the packages | classify and ratchet, WS3                           |
| Knowable domains as types          | `core-branching-load` evidenced sites, by hand        | 88 comment lines carrying invariant vocabulary over `src/model`; 36 in `Constraint.ts` (provisional: crude word list)                                                                | ratchet, WS1                                        |
| Law coverage                       | `tests/laws/`, by hand                                | 5 laws over 5 capabilities (serialization, merge, counterexample, sample population, mapper); 17 top-level directories, not all of them capabilities                                 | ratchet, WS4                                        |
| Interface (Sarkar)                 | the `exports` map, 10 entries, enforced for consumers | inside core, 240 cross-directory imports, 0 through a directory `index.ts`; 10 of 17 directories have one; 167 names from `src/index.ts`                                             | `api` detector, WS5; the raw count is recorded only |
| Module-level mutable state         | none                                                  | 1 site: `model/id.ts` `installedGenerator`, the id-generator install hook                                                                                                            | accept in baseline; it is the seam the laws use     |

The 95 throw sites classify by what the caller can do about them.
Construction (50) is `createObjectType` refusing an empty name or an
entity without a reference mode: the parse boundary, where a throw is
the honest answer to malformed input. Boundary (28) is the same thing
one layer out: `QueryParseError`, `ModelSplitError`,
`DeserializationError`. Impossibility (3) is `assertNever` and the two
range checks in `id.ts`. The 14 that matter for totality are the eight `not found` throws and
the six removal guards, and grounding them changed their shape: all 14
sit on `OrmModel`'s mutating methods (`removeObjectType`,
`removeFactType`, `removeSubtypeFact`, `removeObjectifiedFactType`,
`removePopulation`, `removeDiagramLayout`, `updateDiagramLayout`), and
outside core one caller uses that API (`learn`'s `forbidsPopulation`
check, through `removePopulation`). The getters do not throw: nine
by-id lookups on `OrmModel` return `T | undefined`, with 220 call
sites across the packages (123 of them `getObjectType`), each guarding
a state `structural/dangling-role-reference` already refuses. That is
the same totality gap in a different costume, and the Decisions below
count it as the same debt.

The 464 untyped parameters are arrow-function callbacks whose type is
inferred from the collection they iterate. They are not a gap: an
inferred `readonly` element type is as readonly as a declared one. The
detector counts declared types only.

## Target architecture

```
barwise/scripts/audit-functional.mjs          three detectors, one report, one baseline; --check
                                              diffs both directions, like audit-duplication.mjs
  invariant   a comment line over a type declaration in packages/core/src/model whose
              vocabulary states a rule the adjacent type does not carry
              ("must", "at most one", "two or more", "within the same", "if present",
              "non-empty", "only if", "exactly one"); keyed by file + the comment's
              normalised text, never by line
  throw       a `throw` in packages/core/src, classified by the error class and message:
              construction | boundary | impossibility (accepted-benign by rule)
              lookup | removal-guard (tracked: each row names its issue)
              plus each by-id lookup on OrmModel typed T | undefined, with its call-site
              count (tracked against model-graph-and-id-spaces.spec.md)
  law         a top-level directory of packages/core/src with no matching
              tests/laws/<name>.law.test.ts; keyed by directory name
  api         a cross-directory import inside packages/core/src that does not resolve to
              the target directory's index.ts; keyed by importing file + target directory
barwise/functional-baseline.json              every candidate carries a verdict:
                                              accepted-benign or tracked:<issue>
barwise/eslint.config.mjs                     a block scoped to packages/core/src/**/*.ts:
  no-param-reassign: ["error", { props: true }]
  functional/prefer-immutable-types: parameters and returns ReadonlyShallow (Decisions)
barwise/eslint-suppressions.json              the 39 parameter and 119 return sites, written once with
                                              --suppress-all; an unused entry exits 2 (verified)
.github/workflows/ci.yml                      `npm run audit:functional -- --check` beside
                                              audit:duplication, so ci-local.mjs derives it
barwise/scripts/defect-correlation.mjs        churn + size + the five measures per file,
                                              against beads issues labelled as defects;
                                              writes a dated report under docs/
packages/core/tests/laws/<capability>.law.test.ts   the unit the law detector counts
```

The detectors are text-level, like the purity gate, and for the same
reason: they must read a `.res` file on the ReScript branch as readily
as a `.ts` file, and the properties they measure are visible in text.
The one type-level instrument, `prefer-immutable-types`, needs the
TypeScript program and is scoped to `packages/core/src`; the ReScript
package records its own answer in that spec's Inventory.

## Alternatives considered

- **A size ratchet (lines per file).** It points at the right files
  today, and it would have banned `ruleId.ts` (959 lines, a registry,
  no defects) while saying nothing about a 200-line function that
  assembles its result by side effect. Size is the shadow; measure the
  object.
- **A loop rule (`functional/no-loop-statements`).** Core has 429 `for`
  loops and 532 `push` calls. A sample of the loops shows local
  accumulators returned from pure functions: `flatMap` over fact types
  and constraints, index building, `find`-shaped searches, a fold over
  migration steps, and a worklist in `query/evaluate`. A loop writing
  to a local that never escapes is referentially transparent. Banning
  it trades a readable fold for a `reduce` with a spread, which is
  quadratic, and Di Penta's finding is that this trade induces fixes.
- **`functional/immutable-data` across core.** It cannot tell a local
  accumulator from an escaped one, so it would flag the 532 `push`
  sites and bury the 39 that matter. The two rules chosen instead
  answer the caller's question directly: is my input mutated, and does
  the signature promise it will not be.
- **Measuring inside the ReScript experiment only.** That spec's
  criteria compare the two implementations, so they need the same
  measures taken on the TypeScript side first. These ratchets are
  those measures.
- **A findings document.** The `barwise-x4z` acceptance criterion asks
  for one. CLAUDE.md's rule is that a finding is not closed by a
  document, and the two audits before this one (`duplication`,
  `rubric`) each landed as a ratchet for that reason. This spec is the
  findings document, and its workstreams are the checks that keep it
  true.

## Workstreams (each independently shippable)

Ordered by blast radius. WS1 through WS5 touch scripts, config and
tests only and change no behaviour. WS6 changes public types. WS7 is
analysis.

### 1. The `invariant` detector and the baseline

`scripts/audit-functional.mjs` with the `invariant` detector only,
`functional-baseline.json` classifying every candidate it finds, the
`audit:functional` script in `package.json` and the root forwarder
(`npm run check:root-scripts` fails otherwise), the `ci.yml` line, and
the planted-defect tests under `test:scripts`. The 88-line count above
is from a crude word list; the detector's vocabulary is the one fixed
here, and the first baseline enumerates what it finds.

Each `tracked` row names the type change that closes it. From
`Constraint.ts` alone: `ConstraintBase.id?` (a constraint without an
identity is representable; 27 `?? ` fallbacks downstream exist to cope,
10 of them in `joinConstraintRules.ts`); `ValueConstraint.roleId?`
standing in for a role-level versus type-level choice; "two or more
role ids" over `readonly string[]` on `DisjunctiveMandatoryConstraint`
and `ExclusionConstraint`; "within the same fact type" on
`InternalUniquenessConstraint.roleIds`, which is cross-element and
stays with the validator.

### 2. Escaping mutation: the hard rule and the type-level ratchet

`no-param-reassign` with `props: true` as an error on
`packages/core/src`, and the two `openapi.ts` sites fixed. Both are
`normalizePath` rebinding its `string` parameter, which mutates
nothing; they are fixed with a local `const` so the rule can be an
error rather than a baseline, because the property-mutation half of
the rule is the one that matters and it should never acquire a first
entry.
Then `eslint-plugin-functional` (v10, ESLint 10; a devDependency that
solves a real problem, not a trivial one) with `prefer-immutable-types`
enforcing `ReadonlyShallow` on parameters and return types, and the
158 existing sites (39 parameters, 119 returns) in
`eslint-suppressions.json`, written once with `--suppress-all`. Of the
119 returns, 68 are `Diagnostic[]` from the validation rules; typing
those `readonly Diagnostic[]` is one mechanical change whose consumer
radius (`push` and spread sites) WS2 counts before it starts.

The baseline is expected to shrink in three moves, none of them lint
fixes. `RelationalMapper`'s 14 sites thread `Map<string, MutableTable>`
through its phases; that is a builder, and `core-branching-load` WS6
(typed `RelationalSchema`) is where it becomes one. `ModelMerge`'s six
and `elementDiff`'s three thread id maps; `core-branching-load` WS7
(`ElementChange`) owns those. `joinConstraintRules` takes `diagnostics:
Diagnostic[]` as an out-parameter at three sites and returns nothing;
that one is a local change to return the array, and it lands here.

### 3. The `throw` detector

Classification by error class and message, as in the Inventory, with
construction, boundary and impossibility accepted by rule and every
lookup and removal-guard site a tracked row. The detector also counts
each by-id lookup on `OrmModel` typed `T | undefined` with its
call sites, one tracked row per method. It fails on a new site of
either kind, so the count of "the caller cannot see this in the
signature" only falls. What the rows become is settled (Decisions):
the 14 throws are deleted with the mutable removal API by
`core-branching-load` WS1, and the lookup rows close as
`model-graph-and-id-spaces.spec.md`'s resolve-once work gives callers
references instead of ids. Nothing in this workstream migrates a site;
it makes the debt visible and one-directional.

### 4. The `law` detector

One row per top-level directory of `packages/core/src`, tracked when it
has no `tests/laws/<name>.law.test.ts`; `util`, `format`, `import` and
`export` hold types and helpers rather than capabilities and are
accepted by rule. Five are covered today. Each
tracked row names the law that would earn the test, or records that
none has been found -- the deferral `conformance-property.spec.md`
already uses, made visible per capability. `query`, `verbalization`
and `describe` are the three where a law is nameable now: a query over
a model and its serialization round-trip agree; every constraint
verbalizes to a non-empty sentence whose reading order is the fact
type's; `describe` of a model equals `describe` of its round-trip.

### 5. The `api` detector

Sarkar, Rama and Kak measure modularization by whether inter-module
calls go through declared interfaces. The module grain that has
interfaces here is the top-level directory of `packages/core/src`: ten
carry an `index.ts`, and the package's `exports` map exposes nine of
them as subpaths. The detector keys each cross-directory import by
importing file and target directory; a candidate is one that does not
resolve to the target's `index.ts`. Today that is all 240, 197 of them
into `model`, which has no index because the sealed record
(`core-branching-load` WS1) is what its public surface will be. A
directory gaining an index and its importers rerouting removes rows;
the first baseline accepts `model` and `util` until WS1 lands there.
Cross-package imports are not counted: the `exports` map and
`depcruise` already make a non-API import fail to resolve.

### 6. Three constraint types tightened (provisional: not yet grounded)

Separate PRs, in this order, each removing rows from the WS1 baseline:

1. `ConstraintBase.id` required. `FactType` already mints an id for
   every constraint it is given (`model/FactType.ts`, the
   `c.id ? c : { ...c, id: generateId() }` at construction), so no
   built model holds a constraint without one and the 27 `?? `
   fallbacks guard a state that cannot occur. This step makes the type
   say so and deletes the fallbacks; the serializer's own `if (c.id)`
   branch (`serialization/yaml/constraint.ts`) goes with them. Nothing
   written to disk changes, which the example-output drift test
   (`tests/integration/exampleOutputDrift.test.ts`) confirms.
2. `ValueConstraint` as a union on `scope: "type" | "role"`, with
   `roleId` only in the second arm; 11 consumer sites.
3. Arity as a tuple type: `readonly [string, string, ...string[]]` on
   `DisjunctiveMandatoryConstraint.roleIds` and
   `ExclusionConstraint.roleIds`. Array literals type-check unchanged;
   a `string[]` variable passed through does not, and the count of
   those is the grounding this step needs. Constraint literals outside
   core: `formats` 63, `dbt` 9, `llm` 8.

Whether these three belong here or in `core-branching-load` WS1 is an
Open decision.

### 7. The correlation on our own history

`scripts/defect-correlation.mjs`: per file under `packages/core/src`,
lines, commits touching it (Graves), relative churn (Nagappan and
Ball), and the measures above; against it, the beads issues labelled
`defect` whose closing commit touched the file. Spearman and Kendall,
as the paper used, because the distributions are skewed. Output is a
dated point-in-time report under `docs/`. It runs by hand, not in CI;
its job is Kitchenham's validation step for the ratchets above, and
its first finding is whether the 23-of-39 concentration survives at
the file level across the whole history rather than one week's.

## API and migration impact

- WS1 through WS4 and WS7 change no public export. WS2 adds a
  devDependency and a suppressions file at `barwise/`.
- WS6 changes `Constraint` types exported from `@barwise/core`. The
  build fans out to `formats`, `dbt`, `llm`, `diagram` and `vscode`
  (the `roleIds` readers) and the compiler enumerates every site. Run
  `npm run build` from `barwise/` before any per-package type-check,
  per CLAUDE.md.
- No surface (CLI, MCP, VS Code) gains or loses a capability; the
  capability matrix is untouched.

## Decisions (resolved in review, 2026-09-09)

Each was an open decision in the first draft. The resolution, and what
settled it.

- **Lint baseline mechanism: ESLint's suppressions file.** Settled by
  experiment on 10.9.1 with a scratch config over `packages/core/src`:
  `--suppress-all` wrote the two `openapi.ts` sites with counts; a
  planted stale entry made the run exit 2 with a message naming
  `--prune-suppressions`; a new violation in an unsuppressed file
  exited 1; a third violation in a file suppressed at count 2 surfaced
  all three. Both directions are loud, which is the ratchet property,
  and no custom baseline is needed.
- **What the tracked throws become: nothing, they are defined out.**
  All 14 sit on the mutable removal API with one external caller.
  Under the sealed-record design (`core-branching-load` WS1) removal
  is constructing a new value: removing an absent id yields the same
  value, and a removal that leaves a dangling reference yields a
  document validation diagnoses. WS3 ratchets the 14 until that
  workstream deletes the API; a site that survives it takes the
  builder's ok/fail union. No `Result` type, no `Diagnostic[]` return,
  no library. The reviewer added the `T | undefined` lookups as the
  same debt: WS3 counts the nine methods and their 220 call sites,
  tracked against `model-graph-and-id-spaces.spec.md`, and each row
  closes as its callers come to hold references.
- **Where the constraint type tightenings land: here, as three PRs**
  (WS6). Branching-load WS1 is the element kinds and the builder;
  these are constraint-local with their own radius.
- **`prefer-immutable-types` on returns: both halves from the start.**
  One suppressions file and one migration, 158 entries to begin with.
- **Interface size: Sarkar's API-based measure, not the raw count.**
  Core's `exports` map declares ten entry points and Node resolution
  enforces them for consumers, so at the package grain the API-based
  measure is 100 percent by construction. Inside core it is not: 240
  cross-directory imports, none through a directory's `index.ts`, and
  7 of the 17 directories have no index at all (`model`, `validation`,
  `serialization`, `util`, `format`, `import`, `export`). That is what
  the `api` detector (WS5) ratchets, and it says something the raw
  count cannot: core is one module with directories, not modules with
  interfaces. The 167 stays recorded in the WS7 report.

## Risks and testing

- Every new gate is proven RED on a planted defect from three working
  directories under `test:scripts`, the convention `ci.yml` states for
  enumerating gates (barwise-905, -906).
- Both directions of every baseline are loud, so closing a finding
  forces removing its row and closing its issue, as with
  `audit-baseline.json`. The cost is that WS6 and the
  `core-branching-load` workstreams each carry a baseline edit; that is
  the point.
- WS2's two code changes are local rebindings; the openapi renderer
  tests and the `formats` package tests cover the renderer output.
- WS6 is the only behaviour-adjacent change: a required `id` changes
  what the serializer writes for a constraint that had none, which the
  serialization law (`tests/laws/serialization.law.test.ts`) and the
  example-output drift test will show.
- The word list in the `invariant` detector will have false positives.
  A false positive is an `accepted-benign` row with a reason, the
  same as a benign parallel in the duplication baseline; the detector
  is not tuned to zero.

## Non-goals

- No rule against `for`, `let` or `push`. Local mutation inside a pure
  function is not the property.
- No size gate.
- No migration of construction or boundary throws; those are the parse
  edge doing its job.
- No change to `check-core-purity.mjs`; the floor stays where it is.
- No decision on ReScript.

## Literature

The papers this spec rests on, each tied to the measure it grounds.
Venue and year identify each; all were checked against their
publisher pages on 2026-09-09.

| Paper                                                                                    | What it establishes                                                                 | Grounds                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| Harrison, Samaraweera, Dobie, Lewis 1995, "Measuring the Quality of Functional Programs" | Size and call counts predict modification requests and felt complexity, not errors  | the resolved question above                  |
| Harrison et al. 1996, Software Engineering Journal                                       | Same programs in SML and C++: no difference on direct quality measures              | why language is not the measure              |
| Kitchenham, Pfleeger, Fenton 1995, IEEE TSE                                              | What a validated measure needs: attribute, unit, instrument, relation to an outcome | WS7                                          |
| El Emam, Benlarbi, Goel, Rai 2001, IEEE TSE                                              | After controlling for size, 4 of 24 design metrics relate to faults                 | no size ratchet                              |
| Graves, Karr, Marron, Siy 2000, IEEE TSE                                                 | Change history out-predicts product metrics                                         | WS7's churn columns                          |
| Nagappan and Ball 2005, ICSE                                                             | Relative churn predicts defect density; absolute churn does not                     | WS7                                          |
| Di Penta et al. 2024, Empirical Software Engineering                                     | Functional constructs in Python have higher fix-inducing odds                       | no loop rule                                 |
| Moseley and Marks 2006, Out of the Tar Pit                                               | Mutable state is the main accidental complexity; confine it to the edges            | WS2                                          |
| Turner 2004, JUCS, Total Functional Programming                                          | Totality as a design discipline                                                     | WS3                                          |
| Claessen and Hughes 2000, ICFP; Goldstein et al. 2024, ICSE                              | Laws over generated inputs; why practitioners do and do not write them              | WS4                                          |
| Gao, Bird, Barr 2017, ICSE                                                               | Method: check out the fixed bug, add types, see whether the checker catches it      | the ReScript criteria, and WS7's defect join |
| Sarkar, Rama, Kak 2007, IEEE TSE                                                         | API-based modularization metrics                                                    | the interface-size decision                  |
