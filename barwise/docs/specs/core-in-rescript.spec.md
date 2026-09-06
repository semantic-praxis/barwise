# Core in ReScript: an experiment measured against the TypeScript sealed-record metamodel

Status: Accepted (all five decisions resolved 2026-09-06) -- no workstream
implemented; to run on a long-lived branch with the decision criteria
below fixed before the branch starts
Created: 2026-09-06
Last-updated: 2026-09-06
Tracking: barwise-933; depends on `core-branching-load.spec.md` (its WS1
and WS3 define the surface this experiment reimplements and the test
suite it is measured against)

## Principle

The sealed-record design for core (`core-branching-load.spec.md`) asks
TypeScript to hold four guarantees by convention that an ML-family
compiler holds by construction: a closed set of subtypes, exhaustive
matching including nested patterns, records that cannot be mutated
after construction, and structural equality. TypeScript spells the
first as a union declaration, the second as a `switch` plus a typed
table or `assertNever`, the third as `readonly` plus a freeze in the
builder, and the fourth as a function someone writes. Each is a rule a
reader has to know and a reviewer has to check.

ReScript is the ML-family language that compiles to JavaScript with a
runtime representation the author controls, so it can meet the product
constraint that rules out a JVM or native core: the extension host, the
CLI and the MCP server are Node, and the graph must cross no
serialization boundary between core and its consumers. The question
this spec pre-registers is narrow: **are the compiler's guarantees
worth a second language in a twelve-package TypeScript monorepo whose
every gate is TypeScript-shaped?** The answer is an experiment on a
branch, not an argument, and the criteria for reading its result are
written here before a line of ReScript exists so the outcome cannot be
argued after the fact.

Determinism in core is untouched by the choice of language; a ReScript
core is as pure as a TypeScript one. Orthogonality is where the cost
lands: a second toolchain is a second concern every gate has to know
about, and the Inventory below is the accounting of that cost.

## Should this be an experiment rather than a decision? (resolved: yes)

The branch is the cheapest way to know. The four guarantees are real,
but the sealed-record spec gets most of their value by discipline, and
the size of the remainder -- how many defects the TypeScript compiler
lets through that ReScript's would not, how much the boundary types
cost consumers, what the gates cost to teach -- is not knowable from
reading. A migration decided now would be decided on taste. A branch
that ports the metamodel and two capability clusters against the
existing test suite produces numbers, and the criteria table turns
the numbers into a recommendation.

## What ReScript gives that the TypeScript spec asks for by convention

| Guarantee                                        | TypeScript spec mechanism                      | ReScript mechanism                                                   | Enforced by             |
| ------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| Closed set of subtypes                           | `type ObjectType = EntityType \| ValueType`    | a variant                                                            | compiler                |
| Exhaustive match, including nested patterns      | `switch` + `Record<Kind, fn>` or `assertNever` | `switch`, with warning 8 (non-exhaustive match) promoted to an error | compiler                |
| Records immutable after construction             | `readonly` + `Object.freeze` in the builder    | records are immutable unless a field is marked `mutable`             | compiler (records only) |
| Arrays immutable after construction              | `readonly T[]` (erased at runtime)             | none: ReScript arrays are JavaScript arrays and the stdlib mutates   | convention, both sides  |
| Structural equality                              | a hand-written comparison                      | `==` is deep structural                                              | language                |
| Runtime shape `{ kind: "entity", ... }`          | written by hand                                | `@tag("kind")` on the variant, `@as("entity")` on the constructor    | compiler                |
| Optional fields that serialize as absent         | `field?: T`                                    | optional record fields (`field?: t`), `None` emitted as `undefined`  | compiler                |
| Dispatch by kind, one table per operation module | `Record<Kind, Handler>`                        | a record of functions or a first-class module; no type classes       | compiler                |
| Type declarations for TypeScript consumers       | the source is the declaration                  | `@genType` emits `.gen.tsx` beside each module                       | compiler                |
| Ids of one kind not usable as another            | not done (branding rejected as its own work)   | an abstract type per id kind, free                                   | compiler                |

The arrays row is the honest gap: the sealed-record spec chose arrays
in the value for serialization order, and ReScript does not make them
immutable. Both implementations rely on the same convention there.

## Scope

In scope, on the branch:

- When the package builds, the system shall emit JavaScript whose
  runtime shapes are identical to the TypeScript WS1 records (`kind`
  and `type` discriminants, plain objects, arrays in declaration order,
  `undefined` for an absent field), so the golden corpus and every
  consumer see the same values.
- When `packages/core`'s test suite runs with the alias configuration,
  the system shall pass every test unchanged against the ReScript
  build, so the TypeScript suite is the oracle and no test is rewritten
  for the port.
- When a variant gains a member, the system shall fail the build at
  every `switch` without a case for it, including cases nested inside
  another pattern.
- When any gate in `ci:local` runs on the branch, the system shall
  either apply it to the ReScript package or record in the Inventory
  why it does not apply, so the branch stays green throughout.

Out of scope: porting any consumer package; changing `.orm.yaml` or
its schema; porting clusters beyond the three named in the
workstreams; performance work; and the adoption decision itself, which
is the experiment's output and the subject of a later spec if it says
adopt.

## Inventory: what each gate does with a ReScript package

`ci:local` derives 27 gates from `ci.yml`. Each needs a treatment
before the branch can stay green, and each treatment is a cost the
criteria count.

| Gate                                         | What it reads today                       | Treatment on the branch                                                                           |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fmt:check` (dprint)                         | `.ts`, `.json`, `.md`                     | no ReScript plugin exists; add `rescript format -check` as a sibling gate in `ci.yml` (WS0)       |
| `oxlint`, `lint` (eslint)                    | `packages/*/src/**/*.ts`                  | nothing to read; emitted JavaScript is build output and is ignored like `dist`                    |
| `depcruise`, `check:depcruise-gate`          | import graph of `.ts`                     | run over the emitted `lib/es6` so the one-way graph is still checked (WS0 verifies it resolves)   |
| `purity` (`check-core-purity.mjs`)           | `packages/core/src/**/*.ts` text patterns | extend the file glob to the new package's `src/**/*.res`; the patterns are text, language-neutral |
| `check:parity`, `audit:duplication`, `dup`   | manifest; jscpd over `.ts`                | a ReScript port of a TypeScript module is a deliberate parallel, not drift: exclude `.res` (WS0)  |
| `knip`                                       | unused exports in TypeScript              | mark the package as an entry with no consumers until adoption; otherwise every export is "unused" |
| `build` (turbo)                              | `tsc` per package                         | `rescript build` as the package's build script; `rescript` is a devDependency; turbo orders it    |
| `test`, `test:coverage`                      | vitest per package                        | the package has no suite of its own; `packages/core` gains `vitest.rescript.config.ts` (WS1)      |
| `publint`                                    | the five published packages               | not published; not listed                                                                         |
| `bundle` (mcp, cli), vscode esbuild          | ES modules from `dist`                    | consume the emitted ES modules unchanged; measured for size (criterion 7)                         |
| `filesize`, `check:no-nul`, `check:shell`    | file-level checks                         | apply as-is                                                                                       |
| `audit:specs`, `check:beads`, `audit:rubric` | docs and tracker                          | unaffected                                                                                        |
| `validate:examples`                          | the CLI over `examples/`                  | unaffected until the CLI is pointed at the port, which is not in scope                            |

Coverage is the one instrument that does not carry over: v8 measures
the emitted JavaScript, whose branch structure is the compiler's, not
the author's. The experiment does not set a coverage threshold on the
package and does not compare branch counts across languages; it
compares what the criteria table names instead.

## Target architecture

```
packages/core-rescript/                     @barwise/core-rescript, private, in the workspace so every gate sees it
  package.json                              "build": "rescript build", devDependency rescript 12.3.1 (pinned; Decisions)
  rescript.json                             sources: src (subdirs); module: esmodule; in-source: false; suffix: .res.mjs
                                            warnings: { "error": "+8" }   // non-exhaustive match is a build failure
                                            gentypeconfig: { "module": "esmodule" }   // .gen.tsx beside each .res
  src/model/ObjectType.res
    @genType @tag("kind")
    type t =
      | @as("entity") Entity({ id: string, name: string, referenceMode: string, ...base })
      | @as("value")  Value({ id: string, name: string, dataType: DataType.t, valueConstraint?: ValueConstraint.t, ...base })
    // emits { kind: "entity", id, name, referenceMode, ... } -- the TypeScript WS1 shape, byte for byte
  src/model/Constraint.res                  @tag("type") variant of sixteen inline records; id: string; modality: t
  src/model/Model.res                       type t = { name, objectTypes: array<ObjectType.t>, factTypes: array<FactType.t>, ... }
  src/model/Builder.res                     a module holding a mutable state record; add* functions with the TypeScript names;
                                            build: t => buildResult   (shape settled in WS0 and aligned across both specs; Decisions)
  src/model/Graph.res                       graphOf: Model.t => t; player, rolesOf, hopsFrom, resolve -- total by construction
  src/validation/**                         WS2: rules over Graph.t; ring algebra as a record of property handlers
  src/verbalization/**                      WS3: the sentence tables
  lib/es6/**/*.res.mjs, **/*.gen.tsx        build output, gitignored; dist/ is what consumers and the harness import

packages/core/vitest.rescript.config.ts     resolve.alias: /\.\.\/(\.\.\/)?src\/(model|validation|verbalization)/ -> core-rescript/dist/$2
                                            npm run --workspace=@barwise/core test:against-rescript
                                            // the existing tests, unchanged, are the oracle; a failure is a finding either way
```

The alias is the whole measurement instrument. `packages/core`'s tests
import by relative path (`../../src/model`, 98 sites; `../../src/validation`,
27), so one regex alias redirects a cluster to the port without
touching a test file. A test that fails against the port is either a
bug in the port or a test that pinned TypeScript representation rather
than behaviour, and the experiment records which.

## Beyond core: where the language boundary would fall

The experiment measures core, but a reader will ask whether ReScript
could replace TypeScript across the monorepo. It could, in the sense
that it compiles to JavaScript and can bind to anything; the question
is where it pays, and the package graph already draws the line.

| Package                                                          | Source lines | What it is                                                              | Fit                                                          |
| ---------------------------------------------------------------- | -----------: | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `core`                                                           |       18,813 | types and algorithms, two external imports                              | this experiment                                              |
| `learn`, `promptlab`, `diagram`, `diagram-ui`                    |        9,936 | pure over core; the last is a React renderer                            | second wave if core adopts; React is first-class in ReScript |
| `llm`, `formats`, `dbt`, `code-analysis`, `mcp`, `cli`, `vscode` |       34,919 | glue over SDKs, Node APIs, the TypeScript compiler API, the VS Code API | stays TypeScript, indefinitely                               |

The reason the shell stays is the inverse of the reason core might
move. Every library the shell touches ships its own TypeScript types
and the compiler checks each call against them for free. In ReScript
each of those calls goes through a hand-written `external` binding,
which is a claim about a library that nothing checks; a wrong binding
is a runtime error TypeScript would have caught at compile time. At
the ecosystem boundary the safety argument inverts, and the VS Code
API is the worst case: enormous, revised monthly, with partial
community bindings. So the language boundary, if there is one, falls
where the dependency graph already puts the I/O boundary: an ML core
and a TypeScript shell, which is "functional core, imperative shell"
with the languages matched to the halves.

One trade inside core that WS2 must answer: the sealed-record spec's
field tables and dispatch tables get compiler-checked completeness
from TypeScript's type-level programming (`keyof`, mapped types,
`Record<Union, ...>` with `satisfies`). ReScript has none of that; it
gets exhaustiveness from variants and pattern matching. A field table
in the port is either an explicit list guarded by a drift test or
generated, and the experiment records which and what it cost.

## Alternatives considered

- **Gleam.** Compiles to JavaScript, ML-family, small.
  Erlang is its first target, it emits no TypeScript declarations, and
  its runtime representation of custom types is not configurable to
  the `{ kind: "entity" }` shape. The boundary would need hand-written
  declarations and adapters, which is the cost this experiment is
  trying to measure at its smallest.
- **F# through Fable.** Mature, with type providers and computation
  expressions. Needs the .NET SDK in every environment and in CI, which
  is a third toolchain, not a second.
- **PureScript.** Type classes, which ReScript lacks, and the closest to
  Haskell. Its runtime representation of data types is constructor
  objects, not plain records, so the emitted values would not be the
  TypeScript shapes and the golden corpus could not be the oracle.
- **OCaml through Melange.** The same lineage as ReScript with more of
  OCaml. Builds with dune rather than npm and emits declarations less
  directly. ReScript's JavaScript-first output and npm packaging are
  the reason to prefer it in an npm workspace.
- **Rust compiled to WebAssembly.** The strongest type system on the
  list and a real option for a core engine, but every model crosses a
  serialization boundary into and out of the module, which is the
  layer of erased intermediates the sealed-record spec exists to
  remove.
- **A TypeScript library for matching (ts-pattern) or effects
  (effect).** Libraries, not compilers: neither adds exhaustiveness
  beyond what `switch` narrowing gives, and the no-trivial-dependencies
  rule asks what they solve that `switch` does not.
- **Wait for the sealed-record WS1 to land and see whether the
  conventions hold.** Cheaper, and the honest default. The branch is
  preferred because the two proceed in parallel and the port's oracle
  is the suite WS1 produces; the experiment's Phase A (WS0 below)
  answers the interop questions before WS1 lands, and its Phase B waits
  for it.

## Workstreams (each independently shippable, on the branch)

The branch is long-lived and merges `main` in on the repo's convention
for shared branches (no rebase, no force-push once shared), at least
weekly, and stays green under `ci:local` at every push. Each
workstream is a PR into the branch, reviewed like any other.

### 0. Pin and probe (Phase A: interop, before the TypeScript WS1 lands)

The package skeleton with ReScript pinned at 12.3.1;
`ObjectType`, `Constraint`, `Role` and `FactType` as variants and
records; `@genType` on each; one TypeScript vitest file in the new
package that imports the emitted modules and asserts, field by field,
that the runtime values equal the sealed-record spec's sketch. This
workstream answers, and records in Implementation notes: the exact
emitted shape of a tagged variant with an inline record; how `None` is
emitted in an optional record field; what `.gen.tsx` looks like for a
variant and whether a consumer needs a cast; cold and warm build time;
and the treatment of every gate in the Inventory, applied so the
branch's first push is green. Every command named in this spec
(`rescript format -check`, the warnings key, genType's configuration)
is verified against the pinned version here, and the spec is corrected
where the pin differs.

### 1. Model, builder, graph, with the alias harness (Phase B: after the TypeScript WS1 merges)

The full WS1 and WS3 surface of the sealed-record spec: every element
kind, `Builder` returning the aligned `buildResult`, `Graph` with the
accessors sketched there, and the modification path through a builder
seeded from a value. `packages/core/vitest.rescript.config.ts` with the
alias for `src/model`; `npm run --workspace=@barwise/core
test:against-rescript` passes the model tests unchanged. Waits for the
TypeScript WS1 because that is what rewrites the model tests to the
builder API; until it merges, the branch keeps its own tests from WS0.

### 2. Validation, with ring types as algebra (Phase B)

The densest representation-driven cluster (3,188 lines, 661 branches)
and the one where nested matching matters: population rules over
tuples of role values, the ring property table as a record of
handlers, `constraintConsistency` exhaustive over sixteen kinds. The
alias extends to `src/validation`; the 27 validation test files are
the oracle. This is where criterion 3 (compiler-found defects) is
expected to score, if it scores anywhere.

### 3. Verbalization (Phase B)

The string-heavy cluster (1,521 lines): the sentence tables, segment
building, the corpus as oracle. This one measures ergonomics rather
than safety, because building prose from segments is where an
ML-family language's string handling either reads well or does not.

### 4. Measure, decide, record

Fill the criteria table with the branch's numbers; write the
recommendation into this spec's Implementation notes; set `Status`. If
the recommendation is adopt, open the adoption spec (consumer
migration, publishing, gate rewiring) as its own document; if it is
stop, close the branch with the record intact so the next person who
asks the question starts from measurements.

## Decision criteria (fixed before the branch starts)

| # | Criterion                                 | How measured                                                                                                                                             | Counts as met when                  |
| - | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1 | The oracle passes                         | `test:against-rescript` over the aliased clusters                                                                                                        | every test passes unchanged         |
| 2 | Golden bytes are identical                | serializer round-trip corpus and `validate:examples` through the port                                                                                    | zero byte differences               |
| 3 | The compiler found what the suite did not | count of exhaustiveness, immutability or shape errors raised while porting code the TypeScript build accepted, each classified: caught by a test, or not | at least one not caught by any test |
| 4 | Source size                               | lines of `.res` per ported cluster against lines of `.ts`                                                                                                | reported; no threshold              |
| 5 | The boundary needs no casts               | `any`, `unknown` and `as` in `.gen.tsx` output and in the harness                                                                                        | zero on the model surface           |
| 6 | Build time                                | warm `rescript build` of the package against warm `tsc` of `packages/core`                                                                               | within 2x                           |
| 7 | Bundle size                               | the vscode extension bundle with the port's `dist` aliased in, against today                                                                             | growth under 10%                    |
| 8 | Every gate has a treatment                | the Inventory table, applied; CI green on every push to the branch                                                                                       | required                            |
| 9 | Contributor experience                    | one paragraph from each person who wrote or reviewed ReScript on the branch                                                                              | reported; no threshold              |

The decision rule, also fixed now: recommend adopting ReScript for
core only if 1, 2, 5 and 8 are met and 3 is at least one. Otherwise
record the numbers and stop. Criteria 4, 6, 7 and 9 inform the
adoption spec's shape if one is written; they do not decide.

## API and migration impact

- Nothing on `main` changes until the branch's outcome is decided; the
  branch adds a private workspace package, one vitest configuration in
  `packages/core`, one npm script, and gate configuration edits.
- If adopted, `@barwise/core`'s source becomes the port and its
  published `dist` is the emitted JavaScript plus `.gen.tsx`
  declarations; consumers are unchanged to the extent criterion 5
  holds, which is why it is a gate rather than a report.
- Turborepo orders `rescript build` before any consumer's build through
  the existing `dependsOn`; the extension's esbuild consumes ES modules
  and needs no change.

## Decisions (resolved in review, 2026-09-06)

Five questions were put to the owner as open decisions and settled.
They are recorded here with the choice and its reason so the branch
does not reopen them.

- **The ReScript pin is 12.3.1.** The release line, not the 13 alpha
  under `next`: an alpha is not a pin, and the experiment's numbers
  must be reproducible. Re-pinning is a WS0-style probe, not a
  re-decision.
- **The package is `packages/core-rescript`, inside the workspace.**
  Turbo and every gate see it, so the Inventory's treatments are real
  and criterion 8 measures something. A directory beside the workspace
  would have measured nothing about the toolchain cost.
- **Emitted JavaScript is not committed.** `lib/` is gitignored and
  turbo builds it; WS0's Implementation notes quote representative
  output so a reviewer can see it without a checkout. Committed build
  output is the drift the repo's regen gates exist to prevent.
- **The runtime shape of `buildResult` is settled in WS0.** The
  sealed-record spec sketches a boolean `ok` tag; whether ReScript can
  emit that on a tagged variant is the first thing WS0 finds out. The
  PR that finds out edits whichever spec has to move, in the same PR,
  so the two specs never disagree.
- **The owner reviews every ReScript PR, with guidance from the
  session that wrote it.** Each PR into the branch carries, in its
  body, a reading guide written for someone reading `.res` for the
  first time: what each construct is, which TypeScript construct it
  replaces, and where the compiler is doing work a reviewer would
  otherwise do by hand. Criterion 9 is the owner's paragraph after
  each review. Self-review is not accepted on the branch.

## Risks and testing

- The suite is the test. Criterion 1 is not "tests were written for
  the port" but "the existing tests pass against it", so a port that
  needs its own tests to look green has failed the criterion.
- A green experiment can still be the wrong decision: community size,
  hiring, and a second language for a small team are not in the
  criteria because they are not measurable on a branch. Criterion 9
  is where they get a voice, and the adoption spec is where they get
  decided. This spec's decision rule says what the numbers say, no
  more.
- genType is part of the compiler since the 11 line and its output
  format is the boundary the whole experiment rests on; WS0 pins it
  and quotes it. A change to it in a later ReScript release is a
  reason to re-pin, not to re-decide.
- Array mutability is the same convention in both implementations;
  the port must not use the stdlib's mutating array functions on a
  built model, and the review of each workstream checks for it.
- The branch can rot. Weekly `main` merges and the green-at-every-push
  rule are the guard; a branch that has been red for a week is closed
  under WS4's "stop" path with what was learned.

## Non-goals

- Deciding to adopt ReScript. This spec decides how to find out.
- Migrating any consumer, publishing the port, or replacing
  `@barwise/core` on `main`. The second wave named above is a
  candidate list for the adoption spec, not a commitment.
- Porting anything beyond model, validation and verbalization.
- Comparing branch counts across languages: the coverage engine
  measures emitted code and the numbers would not mean what they mean
  for TypeScript.

## Implementation notes

- To be filled by WS0 with the pinned version's actual behaviour
  (variant shapes, `None` emission, `.gen.tsx` samples, build times,
  gate treatments as applied) and by WS4 with the criteria table's
  numbers and the recommendation.
