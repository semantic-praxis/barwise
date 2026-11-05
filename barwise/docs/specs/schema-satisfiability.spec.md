# Schema satisfiability: a bounded solver answers what no population can

Status: Draft -- no workstream implemented (a throwaway spike ran on
2026-11-05 in a scratch directory; its numbers are in "What the spike
found" and nothing of it is committed)

Created: 2026-11-05
Last-updated: 2026-11-05
Tracking: barwise-cpc (barwise-5v9 is WS3's finding, barwise-yjo is WS4's;
barwise-1008, barwise-1014 and barwise-1017 are the earlier pairwise
findings this subsumes; `docs/specs/core-model-laws.spec.md` deferred the
Alloy oracle this revisits)
Touches: +barwise/reasoner/, barwise/pyproject.toml, barwise/uv.lock,
barwise/package.json, package.json, .github/workflows/ci.yml,
barwise/scripts/lib/changed-class.mjs, CLAUDE.md,
barwise/packages/core/src/validation/rules/constraintConsistency.ts,
barwise/packages/core/src/validation/ruleId.ts,
barwise/packages/core/tests/arbitraries/model.ts,
barwise/docs/adr/probes.json

In one sentence: a bounded SAT encoding of an `.orm.yaml` schema, run by
a Python lane beside the optimizer, says whether every fact type and
object type can be populated under all constraints at once, which
constraint is implied by the others, and which constraints conflict --
questions the validator and the counterexample generator cannot ask,
because both need a population in hand.

## Principle

**Define errors out of existence**, against **explicit over implicit**
read too narrowly. The validator checks each constraint for shape
(`constraintConsistency.ts`: valid role references, `max >= min`, enough
roles, matching arity) and checks populations against constraints one
rule at a time. Nothing reads two constraints together. A model whose
constraints jointly admit no population -- "each Order plays A and B, and
A excludes B" -- passes `barwise validate` on every surface, and the
modeller finds out when the first real population fails, or never. The
counterexample generator works one constraint at a time too: it builds
the population one constraint forbids, and barwise-1015 and barwise-995
record that those populations trip the fact type's other constraints,
because nothing in core asks what the constraints require together.

Solving one constraint at a time is the explicit-over-implicit habit
applied where it does not belong: the joint question has one answer,
and pushing it to the modeller is the shallow interface. A solver answers
it once, centrally, from the schema alone.

**Determinism in core** decides where the answer is computed, not whether.
`docs/adr/determinism-in-core.md` decision 2 puts a capability one layer
out when it cannot be deterministic, or when its dependency does not
belong in core; a SAT solver is deterministic (same input, same solver
build, same answer) but it is a native dependency weighing tens of
megabytes, and the translation it needs is work. So the solver is a
dev-time lane, like `optimizer/`, and anything core learns from it lands
in core as a pure rule.

## Is this the deferred Alloy oracle? (resolved: no -- it is a second use, and the first was never grounded)

`core-model-laws.spec.md` considered "an Alloy translation as a validator
oracle" and deferred it: it would test barwise's code by comparing
solver-found populations with the validator's verdicts, and the laws
reach that defect class more cheaply. The deferral stands; the spike
supports it (see "What the spike found": no shipped model shows a
conflict, so an oracle over them would have had nothing to compare).

What that spec did not consider is the use that needs no barwise defect
at all: diagnosing the **user's** model. A jointly unsatisfiable schema
is a modelling mistake, and no test of barwise's own code would ever
surface it, because barwise's code is behaving correctly when it reports
such a model as fine. That is this spec's primary use. The oracle use
stays deferred under the laws spec's own revisit trigger, and inherits
whatever WS1 builds if it is ever picked up.

The laws spec also gave "a solver is I/O and not deterministic" as the
placement reason. Half of that is wrong: a solver is a pure function of
its input and its own version. The reasons that hold are dependency
weight and translation effort, both of which `determinism-in-core.md`
already covers under decision 2. This spec corrects the record here
rather than editing the laws spec, whose conclusion was right.

## Should a solver run, rather than more pairwise rules? (resolved: both, and the solver says which rules)

barwise-1008 asks for a rule reporting two frequency constraints on one
role whose intervals do not meet, and two value constraints with disjoint
sets; barwise-1017 asks for one reporting an enumeration no member of
which its data type admits. Each is a decidable pairwise check that
belongs in core as a pure rule, and the spike found five more of the
kind (table below). Writing them one by one is the escape trail the laws
spec named as its revisit trigger -- and it is also the right fast path,
because a rule in core runs on every surface with no Python installed.

The resolution is the shadow-and-property split from the root
`CLAUDE.md`: the solver is the instrument that can see the whole class
(any conflict among the encoded kinds, at any distance), and the pairwise
rules are the cheap observable that catches the common shapes in-process.
The solver decides which pairwise rules are worth writing, by naming the
unsat cores that occur; a rule is written for a core shape that recurs,
and the solver remains the check that the rules have not fallen behind.
Neither alone is right: rules alone cannot see a three-constraint conflict
across fact types (gen-216 below needs equality, exclusion and subset
together), and the solver alone is a dev-time tool with a native
dependency.

## What the spike found

A throwaway encoder (about 300 lines of Python over `z3-solver` 4.15.4,
in the session scratch directory, run through a temporary uv dependency
group that was reverted by hand, which the lockfile rule gives a spike no
better way to do: barwise-0vn) read a JSON projection of each model -- object
types with their enumeration size and cardinality, fact types with roles
and internal constraints, external constraints, subtype facts,
objectifications -- written by a throwaway vitest file through core's
own deserializer and `arbOrmModel` at the laws' `SEED` and `RUNS`.
Nothing of either survives in the tree; WS1 is their committed form.

**The encoding.** One boolean per object-type instance (`N` per type,
capped at the enumeration size for a value type with a value constraint;
a subtype shares its supertype's index space) and one per possible fact
tuple. A tuple implies its players exist. Internal uniqueness is
at-most-one per projection; mandatory is "exists implies plays";
disjunctive mandatory, exclusion and exclusive-or are an OR, an
at-most-one, or both, over roles or over subtypes; subset and equality
are implications between projections; frequency is a count bound per
projection; cardinality (unary role and object type) is a count bound;
a role value constraint caps that role's index; value comparison tests
the indices; the eight ring types are their first-order definitions over
the pair projection (acyclic as "no closed walk of length `<= N`");
objectification equates the instance count with the tuple count. Not
encoded, and counted: external uniqueness, the four join kinds, value
constraints with ranges, and deontic constraints (an "ought" does not
restrict a population). Each constraint is asserted under a selector
literal, so a `check` with that fact type forced non-empty returns, on
unsat, the **unsat core**: the constraint ids that conflict. That core
is the diagnostic a user would be shown.

**The two hand-encoded examples behave as predicted**, at `N = 3` and
`N = 5`:

| Model                                                                    | Result                                   | Unsat core                                           |
| ------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------- |
| Order plays A and B (both mandatory), A excludes B                       | both fact types and Order unpopulatable  | `each_Order_A`, `each_Order_B`, `A_excludes_B`       |
| Employee holds Certification `>= 3` times, pair unique, 2 Certifications | the fact type and Employee unpopulatable | `holds_at_least_3` (and the mandatory, for Employee) |

**governance.orm.yaml is jointly satisfiable, and no rule is implied.**
Seven fact types, seven object types, twelve encoded constraints (seven
uniqueness, five subset). Every fact type and object type is populatable
at `N = 3` and `N = 5`, and none of the five subset rules is implied by
the other four within either bound (0.04 s). So the governance model has
nothing for a solver to fix today; the value is the check staying true
as rules are added.

**The twenty shipped models show nothing.** `examples/models`,
`examples/output`, `examples/auction-project/domains`, the eight
tutorial steps and `governance.orm.yaml`: 222 fact types, 247 object
types, 0 unpopulatable fact types and 0 uninstantiable object types at
`N = 3` (1.2 s in all) and `N = 5` (6.2 s; the two largest domains take
2.4 s and 2.3 s). Two external uniqueness constraints were not encoded.
One "implied" constraint was reported, tutorial step 8's frequency
`1..5` on Order includes Product -- a bound artifact: with at most five
Products no population can exceed five, so the constraint cannot be
violated within the bound. **This is the plain outcome the request
asked to be stated plainly: no real model in the repository has a joint
conflict**, which supports the laws spec's deferral of the code-testing
use.

**The generated models show a lot, and the validator says nothing about
any of it.** Over `arbOrmModel` at `SEED = 20260907`, `RUNS = 250` (586
fact types, 848 object types): 112 unpopulatable fact types in 56 models
at `N = 3`, and 110 in 54 at `N = 5` (5.7 s in all), so the result is
bound-stable. The 141 uninstantiable object types are the same at both
bounds. The cores, classified by the constraint kinds they name at
`N = 5`:

| Core shape (count of fact types)                             | What it means                                                                                  | Example                                                                   | Validator today                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| one object-type cardinality, `0..0` (34)                     | a type declared empty, so every fact type it plays is empty                                    | gen-248: `ot3` is `0..0`, two fact types fall                             | silent                                                     |
| one object-type cardinality, min above enumeration size (32) | a value type with 1 or 2 values and "at least 3 instances"                                     | `values=2`, cardinality `3..5`                                            | silent (barwise-1017's shape, one declaration over)        |
| disjunctive mandatory over subtypes + two cardinalities (25) | the supertype needs `>= k`, every instance must be a subtype, the subtype allows fewer         | gen-194: `ot0` is `2..6`, exhaustive over `ot1`, `ot1` is `0..1`          | silent                                                     |
| frequency alone (5)                                          | `min >= 2` over every role of its fact type: a set of tuples cannot repeat one                 | gen-241: unary fact type, frequency `2..6`                                | silent on the schema; errors only once a population exists |
| equality + exclusion, sometimes + subset (3)                 | two role sequences that must be equal and disjoint are both empty, and a subset of them is too | gen-216: `ft3.r0 = ft1.r0`, `ft3.r0` excludes `ft1.r0`, `ft0.r0 ⊆ ft1.r0` | silent                                                     |
| ring + value comparison (1)                                  | symmetric on `(r0, r1)` with `r0 > r1`: `(a, b)` forces `(b, a)`, and both cannot hold         | gen-071                                                                   | silent                                                     |
| unary cardinality `0..0` (1)                                 | a fact type declared empty                                                                     | gen-039                                                                   | silent on the schema                                       |
| other mixes of the above (9)                                 |                                                                                                |                                                                           |                                                            |

The ten models named here were run through `ValidationEngine`: every
non-info diagnostic is `structural/id-not-from-name`, a completeness
warning, or a population error against a sample population the generator
happened to attach. Not one diagnostic reads the schema and says it
admits no population.

Two things follow. First, every class is a genuine conflict, not a bound
artifact: `0..0` is empty at any bound, an enumeration of two has two
members at any bound, and a set cannot hold a tuple twice at any bound.
Second, most of them are the **generator's**: `arbOrmModel` draws
object-type cardinality `min 0..3, span 0..5`, so `0..0` arrives in 28 of
848 object types, and it draws cardinality independently of the
enumeration size and of subtyping. That is barwise-1014's finding
(same-path join operands) at a larger scale: the laws run over models
that admit no population, and a reader of a law failure may hunt a
defect that is not there. Which of those draws are legitimate inputs the
laws should tolerate, and which are generator defects, is WS4's question
(barwise-yjo); the validator's silence on every class is WS3's
(barwise-5v9). Either way the lane is the instrument that measures it,
and nothing else can.

**Caveats the spike established, which WS1 must carry into the tool's
output:**

- A satisfying assignment at bound `N` is a real population; "unsat at
  `N`" is relative to the bound. Frequency and cardinality minimums are
  the kinds that can exceed a small bound, and the tool must report when
  a core contains one whose minimum exceeds the bound, rather than call
  the schema unsatisfiable.
- An implication proved at `N` is bound-relative too (step 8 above); a
  witness that a constraint is _not_ implied is real. Report "not implied
  (witness)" firmly and "implied within `N`" as such.
- Implication is only meaningful once satisfiability holds: an
  unpopulatable base implies everything, and the Order example's two
  uniqueness constraints came back "implied" for that reason.
- z3 returns one witness of many, and an unsat core that is not
  guaranteed minimal; both are stable for one solver build and one input,
  but neither is canonical across versions. A golden test may pin a
  verdict, never a witness.

## Scope

In scope:

- When given a format 4.0 `.orm.yaml` and a bound `N`, the lane shall
  report, for each fact type and each object type, whether a population
  obeying every encoded alethic constraint exists in which it is
  non-empty, and for each that cannot, the unsat core by constraint id.
- When a core names a frequency or cardinality constraint whose minimum
  exceeds what the bound allows, the lane shall label the finding
  bound-limited rather than unsatisfiable.
- When asked, the lane shall report each encoded constraint that is
  implied by the others within the bound, only for a model every fact
  type of which is populatable, and with a witness population for each
  constraint that is not implied.
- When a constraint is of a kind the lane does not encode (external
  uniqueness, the join kinds, ranged value constraints, deontic
  modality), the lane shall count and name it in the report, and never
  silently drop it.
- When it cannot read its input (a version other than 4.0, a file it
  cannot parse, a reference it cannot resolve), the lane shall exit 2,
  per `docs/adr/gate-refusal-contract.md`; a finding exits 1.
- When a shipped example model or `governance.orm.yaml` stops being
  strongly satisfiable, `npm run check:schema-satisfiable` shall fail,
  and a probe in `probes.json` shall show it failing on a planted
  conflict.
- When a pairwise conflict shape the spike found recurs in the solver's
  cores, a pure rule in core shall report it on every surface (WS3 names
  the first set).

Out of scope, deferred to a named place:

- Population-equivalence of two model versions for diff and merge: WS5,
  provisional, after WS1 proves the encoding.
- A user-facing surface (`barwise validate --satisfiability`, an MCP
  tool): Open decisions; nothing here changes the capability matrix.
- The validator-oracle use from `core-model-laws.spec.md`: stays
  deferred there.
- Encoding external uniqueness and join constraints: a later workstream
  once WS1's report says how often they occur in models that matter.
- Full ORM 2 reasoning without a bound: undecidable in general (Keet,
  "Mapping the Object-Role Modeling language ORM2 into Description Logic
  language DLRifd", 2007; Jarrar, "Towards Automated Reasoning on ORM
  Schemes", ER 2007). Bounding is the design, not a shortcut.

## Inventory

| Module                                                        | Current state                                                                               | Verdict                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/core/src/validation/rules/constraintConsistency.ts` | shape checks on one constraint at a time; no rule reads two constraints together (verified) | WS3 adds the pairwise rules the cores justify; nothing else changes  |
| `packages/core/src/validation/rules/completenessWarnings.ts`  | `checkConflictingIdentification` is the one "conflict" rule, and it is about identifiers    | untouched                                                            |
| `packages/core/src/counterexample/`                           | one population per constraint; unaware of the others (barwise-1015)                         | untouched; WS1's witness is the joint counterpart, not a replacement |
| `packages/core/tests/arbitraries/model.ts`                    | draws cardinality `0..3 + span 0..5` independently of enumeration and subtyping             | WS4 decides which draws are defects, measured by the lane            |
| `optimizer/`                                                  | the DSPy lane: Python, dev-time, shells out to the CLI                                      | untouched; the pattern, not the home (Open decision 1)               |
| `pyproject.toml`, `uv.lock`                                   | one project, dependency groups `sqlglot` and `scripts`                                      | WS1 adds group `reasoner` with a pinned `z3-solver`                  |
| `scripts/lib/changed-class.mjs`, `.github/workflows/ci.yml`   | the `optimizer` predicate gates `test:optimizer`                                            | WS1 adds a `reasoner` predicate and step on the same pattern         |
| `docs/adr/governance.orm.yaml`, `scripts/check-adr-model.mjs` | the schema judges populations drawn from the repository                                     | untouched; WS2 checks the schema itself                              |
| `docs/adr/probes.json`                                        | 14 gated decisions probed                                                                   | WS2 adds the row for the new gate                                    |
| `packages/dbt/src/sql/SqlglotBridge.ts` (and formats' twin)   | a TS surface running `uv run --frozen --only-group sqlglot` with an embedded program        | untouched; the precedent any later surface would follow              |

`check:adr-model` looks affected and is not: it fills the governance
schema's populations and asks core whether they obey it. WS2 asks the
orthogonal question -- whether the schema admits populations at all --
and shares no code with it.

## Target architecture

```
barwise/
  pyproject.toml            [dependency-groups] reasoner = ["z3-solver==<pinned>"]
  reasoner/                 the solver lane (Python, dev-time only, like optimizer/)
    CLAUDE.md               dependency rule: nothing here is imported by shipped code
    barwise_reasoner/
      reader.py             format 4.0 .orm.yaml -> Schema (refuses other versions: exit 2)
      encode.py             Schema x bound -> z3 constraints, one selector per constraint
      queries.py            populatable(ft|ot), implied(c), later equivalent(a, b)
      report.py             the JSON and text report; bound-limited vs unsatisfiable
      __main__.py           `check <file> --bound N [--implication] [--json]`
    tests/                  offline: the two hand examples, governance, one shipped
                            model, the spike's six generated shapes as fixtures,
                            a drift test of reader.py's field names against
                            packages/core/schemas/orm-model.schema.json
  package.json              "test:reasoner": "uv run --frozen --only-group reasoner pytest -q reasoner"
                            "check:schema-satisfiable": "uv run --frozen --only-group reasoner
                                 python -m barwise_reasoner check examples/... docs/adr/governance.orm.yaml --bound 4"
  scripts/lib/changed-class.mjs   reasoner: /^barwise\/reasoner\//
  packages/core/src/validation/rules/constraintConsistency.ts
                            WS3: the pairwise rules, pure, from the cores that recur

Dependency direction: reasoner/ -> (uv) z3; reasoner/ reads .orm.yaml files.
Nothing in packages/ imports reasoner/. If a capability here is ever needed
at run time, it is rewritten in TypeScript one layer out (the optimizer rule).
```

## Alternatives considered

- **Alloy.** Relational logic is Alloy's native domain and ORM
  populations are relations, so the translation is natural, and the
  Alloy Analyzer finds bounded instances the way the spike does. It lost
  on three counts: it is a JVM tool, so the lane would carry a Java
  runtime beside the pinned Python; its API is the Java one, so driving
  it from a uv lane means a subprocess and a text format; and the
  encoding the spike needed is already propositional, so Alloy's
  relational layer buys readability of the model text at the cost of a
  second language in the repository. Alloy remains the right tool if
  someone wants to _read_ the encoding; nobody reads a gate's encoding.
- **A direct SAT or SMT encoding, from Python (chosen).** The spike is
  this. z3 gives booleans, cardinality (`AtMost`, `Sum`), assumptions
  and unsat cores in one API; `pysat` would do the same with explicit
  cardinality encodings and a smaller wheel. z3 is recommended because
  the unsat core is the diagnostic and z3 returns it without extra
  machinery; the choice is Open decision 3.
- **A direct SAT encoding in TypeScript, in core.** Deterministic, so
  the determinism rule allows it, and it would reach all three surfaces
  in-process. It needs a solver: a pure-JS CDCL is a real dependency
  (not the "trivial" kind the root `CLAUDE.md` forbids, but a weighty
  one), and writing one is not this project's work. It is the right
  shape _if_ WS1 shows the check is worth shipping to users; the
  decision is then made with WS1's numbers rather than before them,
  which is the optimizer lane's own rule applied here (a capability
  needed at run time moves to TypeScript).
- **Hand-written pairwise rules only.** barwise-1008's design. Right for
  the recurring shapes and wrong as the whole answer: a rule cannot see
  gen-216's three-constraint conflict across three fact types without
  becoming a solver. Kept as the fast path (WS3), with the solver saying
  which rules to write.
- **The polynomial subset.** Smaragdakis, Csallner and Subramanian
  ("Scalable satisfiability checking and test data generation from
  modeling diagrams", Automated Software Engineering 16(1), 2009) define
  ORM⁻, a restriction checkable in polynomial time, and report that of
  about 1800 constraints in 160 diagrams only 24 fall outside it. That
  is the algorithm to reach for if the bounded encoding ever becomes
  slow; at 6 s for every shipped model at `N = 5` it has not, and a
  bounded encoding handles the 24 as well. Noted as the escape route,
  not pursued.
- **A description-logic reasoner.** Keet's and Jarrar's DLR mappings
  give unbounded reasoning for the decidable fragment, through a DL
  reasoner (RACER, HermiT). A second heavy runtime, a translation that
  has to stay inside the fragment, and no witness population. Not
  pursued.
- **Do nothing; keep the deferral.** Supported by the shipped models,
  which show no conflict. Rejected because the generated models show
  seven classes the validator cannot see, two of which are open issues
  already (barwise-1008, barwise-1017), and because the cheapest form of
  the lane (WS1) is a few hundred lines with one pinned dependency.

## Workstreams (each independently shippable)

### 1. The reasoner lane

`barwise/reasoner/` as sketched above: the 4.0 reader, the encoder with
the spike's kinds and its counted exclusions, the per-element
satisfiability query with cores, the implication query gated on
satisfiability, the bound-limited label, the JSON and text report, the
three exit codes. Dependency group `reasoner` in `pyproject.toml` with
`z3-solver` pinned to an exact version; `uv.lock` re-resolved; a
`reasoner/CLAUDE.md` stating the dependency rule; `test:reasoner` in
`package.json` and the root forwarder (`npm run regen:root-package`); a
`reasoner` predicate in `changed-class.mjs` and a CI step on the
optimizer step's pattern, under the same docs-only guard. Tests are
offline and fixture-based: the two hand examples, `governance.orm.yaml`,
`order-management.orm.yaml`, and the six generated shapes from the table
above saved as 4.0 files, each asserting the verdict and the core's
constraint ids, never a witness. The reader's field names are a copy of
the 4.0 schema's and carry a drift test against
`packages/core/schemas/orm-model.schema.json` in this workstream
(`docs/adr/must-agree-copies.md`).

First because it is self-contained: nothing in `packages/` changes, and
every later workstream reads its output.

### 2. The gate over shipped models and the governance schema

`npm run check:schema-satisfiable` runs the lane over `examples/`, the
tutorial models and `docs/adr/governance.orm.yaml` at `N = 4` (above
every frequency and cardinality minimum the shipped models declare, so
no finding can be bound-limited; re-derive the number if a model adds a
larger minimum), with `--implication` on the governance schema, and
exits 1 on any unpopulatable fact type or object type or any implied
governance rule. A probe row in `probes.json` plants an exclusion
between two mandatory roles of one shipped model and shows the gate red
(`adr-writing.md`). Whether it runs in CI or on demand is Open
decision 4; whether it is an ADR decision's enforcer is Open decision 5.

### 3. Pairwise rules in core for the recurring cores (provisional: not yet grounded)

barwise-5v9. The shapes the spike found that a pure rule can decide without a solver,
each a present-data rule over the model's declarations, reported on
every surface: a frequency with `min >= 2` spanning every role of its
fact type (a set cannot repeat a tuple); an equality and an exclusion
over the same role sequences; a cardinality `0..0` on an object type or a
unary role (a warning: a type declared empty); a value type whose
enumeration is smaller than its cardinality minimum; a symmetric or
reflexive ring with a strict value comparison on the same roles; and
barwise-1008's two (disjoint frequency intervals, disjoint value sets on
one role). Severity is Open decision 6, and the eval suite bumps in the
same commit if any lands at warning or error, as barwise-1008 records.
Grounding before implementation: rerun the lane over the arbitraries
after WS4 and keep only the shapes that still occur.

### 4. The generator's satisfiability (provisional: not yet grounded)

barwise-yjo. A vitest script (not a law) writes `arbOrmModel`'s sample at `SEED` and
`RUNS` as 4.0 files to a directory, and the lane reads them. From the
report, decide per draw whether it is a generator defect, as
barwise-1014 decided for same-path join operands: `0..0` cardinality,
cardinality minimum above enumeration size, and a supertype minimum above
an exhaustive subtype's maximum are the candidates. A draw kept as a
legitimate input is recorded in the laws' baselines with the lane's
count as its evidence; a draw removed changes `model.ts` and moves the
counterexample law's baseline, as barwise-1014's acceptance criteria say.
Not a law itself: a law cannot shell out to Python, and it should not.

### 5. Equivalence of two schema versions (provisional: not yet grounded)

Encode two 4.0 files over a shared vocabulary (elements paired by id, as
diff pairs them) and ask for a bounded population legal under one and
illegal under the other, in each direction. A witness is a real
behavioural difference the structural diff cannot state ("version B
admits an Order with no Customer"); "equivalent within `N`" is
bound-relative and reported as such. Where this would surface -- the
`diff` output, a merge pre-check -- is a later spec's question; this
workstream delivers the query and a report.

## API and migration impact

- No package's public API changes in WS1, WS2, WS4 or WS5. WS3 adds rule
  ids to `ruleId.ts` and diagnostics to `constraintConsistency.ts`,
  which every surface shows without wiring; a severity above info moves
  recorded eval scores (barwise-1008).
- The dependency graph is unchanged: `reasoner/` is outside it, as
  `optimizer/` is, and the root `CLAUDE.md`'s "one thing outside that
  graph" paragraph becomes two things. `check:architecture` reads
  `INTENDED` and is unaffected.
- `uv.lock` gains the `reasoner` group; `uv run --frozen --only-group
  sqlglot` and the optimizer's `--extra dev` are unaffected, because a
  group is additive only when named.

## Open decisions (for review)

1. **Where the lane lives.** A sibling directory `barwise/reasoner/`
   (recommended: a solver is not prompt optimization, and the optimizer's
   `CLAUDE.md` describes a lane that shells out to the CLI and spends
   money, neither of which this does), or a package inside
   `barwise/optimizer/` sharing its pytest run (one lane to document and
   gate, at the cost of a name that misdescribes half of it).
2. **How the lane reads a model.** A Python reader of format 4.0 only,
   with a drift test against the JSON Schema (recommended: no change to
   `packages/`, and `barwise migrate` already upgrades older files), or a
   solver-neutral IR exported by the CLI, the way `barwise prompt schema`
   is the optimizer's seam (no second reader, at the cost of a CLI
   command or export format whose only consumer is this lane). The IR is
   the better shape if WS5 needs the in-memory pairing diff computes;
   decide then.
3. **Solver.** `z3-solver` (recommended: assumptions and unsat cores in
   the API, used by the spike) or `pysat` (smaller wheel, explicit
   cardinality encodings, cores via its own API). The encoding is the
   same booleans either way, so a switch is confined to `encode.py`.
4. **Does `check:schema-satisfiable` run in CI?** Recommended yes, after
   WS2 measures it: the spike's 6 s at `N = 5` over every shipped model
   is cheap, the gate reads files CI already has, and the question it
   asks (does a shipped example still make sense) is one a PR should
   answer. The alternative is on demand, like `adr-probes` and
   `fault-matrix`, if the uv group's install time in CI turns out to
   dominate.
5. **Is there an ADR decision here?** The request suggests "every fact
   type in a shipped example model is strongly satisfiable" as a
   decision an ADR's `Enforced-by:` could name. The mechanics fit:
   `check:schema-satisfiable` is a `check:*` gate `gateName` accepts,
   `check:architecture` would see it in `ci.yml`, and a `probes.json`
   row proves discrimination. The open question is whether it is a rule
   other work must follow (an ADR) or a quality gate on example content
   (a spec decision). Recommended: a spec decision in WS2, promoted to an
   ADR only if a second decision wants the same enforcer -- for example,
   "the governance schema's rules are independent", which the spike
   showed true today and which `check:adr-model` cannot state.
6. **Severity of WS3's rules.** Error (the model admits no population;
   defensible) or warning (fires on models that import cleanly today,
   and `0..0` may be deliberate). Recommended: error for a conflict
   between constraints, warning for a single constraint that declares an
   element empty. Either moves eval scores and bumps the suite.
7. **The default bound.** `N = 4` for the gate, derived from the shipped
   models' largest minimum plus one; the tool itself takes `--bound` and
   reports bound-limited findings. A bound is a threshold, and the number
   must say why: it is the smallest at which no finding over the shipped
   models can be an artifact of the bound.
8. **Deontic constraints.** The spike skipped them (221 of the generated
   models' constraints). A deontic constraint states what ought to hold,
   so a population may break it; encoding it as if alethic would report
   conflicts the model does not have. Recommended: skip and count, as the
   spike did, with a `--include-deontic` switch for a modeller who wants
   to know whether the oughts are jointly satisfiable.

## What would tell us to drop the idea

- WS1 lands and the lane, run over the shipped models and over the
  arbitraries after WS4 has removed the generator's own defects, reports
  no unpopulatable element and no non-trivial implication. Then the
  pairwise rules of WS3 are the whole value, the lane has done its one
  job (saying which rules to write), and it can be retired to a tagged
  commit rather than maintained.
- The unsat cores do not name the modeller's mistake. The spike's cores
  were two to four constraints and read as the explanation; if real
  models produce cores of twenty constraints that need a human to
  reduce, the diagnostic is not a diagnostic.
- The bound bites. If shipped models need `N` large enough that the gate
  takes minutes, the polynomial ORM⁻ algorithm is the next thing to try,
  and if that too misses the constraints that matter, stop.

## Risks and testing

- No existing behaviour changes before WS3, so nothing in the suite
  guards WS1 and WS2 but their own tests; WS3 is covered by the
  validator's fixture tests and the laws, and its baselines move as
  barwise-1008 and barwise-1017 record.
- The Python tier is a second runtime in CI. The optimizer step's
  comments in `ci.yml` record every way that went wrong (an unpinned
  interpreter, a lock with two resolutions, a project that was not an
  ancestor); WS1 follows them and runs `--locked` in CI.
- A verdict pinned in a test is stable across z3 versions; a witness or
  a core's exact membership is not guaranteed to be. Tests assert
  verdicts and core _ids_, and the pin on `z3-solver` is what makes the
  core assertion safe; bumping the pin may move a core, and the test
  then says so.
- The lane's reader is a copy of the 4.0 format's field names; the
  drift test is its check. A field added to the format that the encoding
  should read (a new constraint kind) fails the drift test rather than
  being silently uncounted.
- While this spec is Draft, its `Touches:` names code paths main changes
  often (`probes.json` with every ADR edit, `changed-class.mjs`,
  `model.ts`). `audit:specs` reads a main merge that touched one of them
  as work since the spec's last edit, at CI's merge ref only, even when
  the merge's own diff on those paths is empty (barwise-ibf,
  barwise-dm0; it happened to this spec's own PR on #932's merge). Until
  that gate is fixed, a Draft spec re-edited after merging main passes;
  one that merges main and is not re-edited goes red at the merge ref.

- No solver, SMT library or Alloy dependency in any npm package; nothing
  in `packages/` imports `reasoner/`.
- No change to the capability matrix: no CLI command, MCP tool or VS Code
  command in this spec.
- No encoding of external uniqueness or join constraints, and no
  unbounded reasoning.
- No replacement of the counterexample generator; its one-constraint
  populations and the lane's joint witnesses answer different questions.
- No edit to `core-model-laws.spec.md`; its deferral of the oracle use
  stands, and this spec records the correction to its determinism
  remark.
