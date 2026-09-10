# Test quality: four evidence-side measures, and why coverage is not one of them

Status: WS1 implemented; WS2 through WS5 open. Measure 4 was corrected
after review (see "Measure 4, and how it avoids testing our own
beliefs") -- the first draft would have manufactured its own diagnostics.
Created: 2026-09-10
Last-updated: 2026-09-10
Tracking: barwise-986 (this spec). The design-side sibling is
`docs/specs/functional-design-quality.spec.md` (barwise-983), whose
structure this mirrors and whose WS4 owns the fifth measure. The
immediate prompt was barwise-985, where a law file's premises went
unstated and unchecked for as long as the file existed.

In one sentence: measure what the suite can prove -- that a test can
fail, that its inputs discriminate, that its expected answer comes from
outside the system, and that it reaches the invalid domain -- each as a
check with a baseline that moves one direction, and not by coverage
percentage or test count, because coverage does not predict
effectiveness once suite size is controlled and mutant detection does.

## Principle

**Explicit over implicit**, pointed at the evidence a green suite
represents.

`functional-design-quality.spec.md` argues that a discipline nobody
checks is what Ousterhout calls an unknown unknown: nothing tells the
reader of `ModelMerge.ts` that it must copy every field, so a forgotten
field is invisible until a law finds it. The same argument applies one
layer out, to the laws themselves. Nothing tells the reader of a law
that its generator must reach the branch it asserts on. Nothing tells
the reader of a golden file that its expected bytes were produced by
the code it is checking. Nothing tells the reader of `arbOrmModel` that
every property-based law in the package is conditioned on validity.

Each of those is currently a discipline, held well and stated nowhere.
barwise-985 is what that costs: four of five law files carried a
`describe("coverage: ...")` block, `serialization.law.test.ts` explained
why in a comment -- "a generator that is too tame passes every law and
proves nothing" -- and the fifth file did not, silently, for its whole
life. A rule everyone follows is indistinguishable from a rule nothing
checks until one place stops following it.

Composability is why the measures are separate rather than one score.
Each names one property, one instrument, one baseline; fixing one
cannot move another. A single "test quality score" would hide which of
the four is decaying, which is the same reason its sibling spec keeps
five numbers instead of one.

## Should the measure be coverage or test count? (resolved: neither)

Neither, and the evidence is unusually direct for this field.

Inozemtseva and Holmes (ICSE 2014) measured coverage against
mutant-detection effectiveness across five large Java projects and
found the correlation low to moderate once the number of test cases is
controlled for, with stronger coverage criteria adding no insight. Just
et al. (FSE 2014) ran the complementary study against 357 _real_ faults
in 321,000 lines and found mutant detection does correlate with real
fault detection, independently of coverage. Read together: the thing we
currently measure is the weak proxy, and the thing we already own a
tool for is the strong one.

Our own history says the instrument is not merely weak but unstable.
`packages/core/CLAUDE.md` sets coverage targets of 95% for model,
validation and serialization and 90% for verbalization and mapping.
Root `CLAUDE.md` records what those numbers are worth: V8 omits
functions it never compiled, so `@barwise/code-analysis` read 95%
functions on Node 22 and 81% on Node 26 from identical source. A gate
whose reading depends on the runtime is not measuring the code.

**One result complicates this and is stated rather than omitted.**
Zhang and Mesbah (FSE 2015) composed 6,700 suites from 24,000
assertions and found assertion count _strongly_ correlated with
effectiveness -- and that it mediates the relationship between suite
size and effectiveness. So counting is not uniformly useless. But
assertions correlate because an assertion is the mechanism by which a
test can fail, and that is measure 1, measured directly. Assertion
count is the shadow the property casts, exactly as line count was the
shadow of mutable-parameter threading in the sibling spec -- which
found the same relationship and drew the same conclusion. Measure the
property; let the shadow be a sanity check.

## The four measures

| # | Property                                           | Instrument                                                       | Baseline                                    | Today                                                                                                  |
| - | -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1 | A test can fail on the defect it claims to catch   | mutation score over a declared operator set, per `src` directory | per-directory ratchet                       | `mutate.mjs` does one mutation on demand; no aggregate has ever been taken                             |
| 2 | Generated inputs reach the branch a law asserts on | `describe("coverage: ...")` blocks and their floors              | the floor numbers                           | five law files, all now carrying one (WS1)                                                             |
| 3 | The expected answer comes from outside the system  | oracle kind per assertion group                                  | share that is self-referential, moving down | goldens, round-trips and self-diffs are barwise-vs-barwise; `SqlglotBridge` is the one external oracle |
| 4 | The invalid domain is generated, not fixtured      | rule-id reachability over `RULE_IDS`                             | unreached rule ids, moving down             | 22 of 79 reached; `constraint` 1 of 28 and `structural` 0 of 15                                        |

The fifth measure -- law coverage per capability -- is
`functional-design-quality.spec.md` WS4 and is **not restated here**. It
is referenced, so the two specs cannot drift into two versions of one
rule.

## Measure 4, and how it avoids testing our own beliefs (resolved: generate through the door invalidity actually uses)

Measure 4 is the one with nothing today, and it is the one where a
naive instrument would be worse than none. It gets its own section
because the first draft of this spec got it wrong.

**The draft said:** build an arbitrary that makes exactly one invalid
choice reachable per draw, and assert `structuralRules` reports that
rule. **The objection:** an arbitrary that constructs the shape a rule
looks for, and then asserts that rule fires, has encoded the rule
twice. It tests our belief about what is invalid, which is the same
defect as the hand-written fixture it was meant to replace. The repo
had already spotted this once -- `generator-coverage-floors.spec.md`
refuses to build a second preferred identifier because
"`completeness/multiple-preferred-identifiers` calls that
contradictory, and a generator producing it would be manufacturing the
diagnostic rather than the shape."

**The resolution is to notice which door invalidity comes through.**
`tests/arbitraries/model.ts` builds models by calling
`model.addObjectType(config)` and `model.addFactType(config)` -- the
**validating** API, which throws on a duplicate name and on a dangling
reference. The generator therefore cannot produce what that API
rejects, and that is not a flaw in the generator: it is "define errors
out of existence" working correctly at the constructor. But
`OrmYamlSerializer` takes a `lenient` option that passes
`skipPlayerValidation: true`, so **deserialization constructs models
the API would reject**. Real `.orm.yaml` on disk is the door, and it is
a door the generator has never gone through.

So measure 4 does not manufacture violations. It generates a valid
model, serializes it, perturbs the _text_, loads it leniently, and
asserts which rules fire. The perturbation knows nothing about the rule
set; what makes it non-circular is that the generator does not choose
which rule it trips.

**And the instrument is not a belief either.** `RULE_ID` in
`validation/ruleId.ts` is the closed set of rule identifiers, complete
by construction -- an identifier used in a rule module and missing from
the record is a compile error -- and `RULE_IDS` exports it. That is the
authority for what failures exist. Reachability against it is a number,
measured over the 250 models the generator already draws:

| Namespace      | Rule ids | Reached | Note                                              |
| -------------- | -------: | ------: | ------------------------------------------------- |
| `completeness` |        8 |       7 |                                                   |
| `population`   |       19 |      13 |                                                   |
| `derivation`   |        2 |       1 |                                                   |
| `constraint`   |       28 |       1 | malformed constraint definitions                  |
| `structural`   |       15 |       0 | asserted as a law by `serialization.law`          |
| `project`      |        6 |       0 | takes `OrmProject`; out of this generator's scope |
| `merge-error`  |        1 |       0 |                                                   |
| **Total**      |   **79** |  **22** |                                                   |

`structural` reading zero is not a gap that crept in; it is the law
`serialization.law.test.ts` asserts. `constraint` reading 1 of 28 is
the finding: the largest namespace in the registry, almost entirely
about malformed constraint definitions, and the generator builds
well-formed constraints by construction.

**This also makes measure 4 a dead-code detector, which is a claim to
be careful with.** A rule id no door can reach is either untested or
unreachable, and the count alone cannot say which. Nothing here
establishes that any specific rule is dead -- 57 unreached ids is a
question, not an answer, and the question only becomes answerable once
the lenient-load door is generated over.

The `assertion-audit` skill records the cost of the alternative:
barwise-855 pinned a limitation as a requirement and the suite defended
it for two capability generations. That is what a hand-written
rejection test does when nobody re-derives the belief behind it.

## Scope

In scope, stated as requirements:

- When the core law suite runs, the system shall fail if any
  `*.law.test.ts` file carries no `describe("coverage: ...")` block, or
  if any such block draws its inputs from something other than the
  generator the laws use. (WS1)
- When the mutation score is taken, the system shall record it per
  `src` directory against a baseline that fails on a decrease. (WS2)
- When an assertion group is added, the system shall classify its
  oracle kind, and the share of self-referential groups shall not
  increase. (WS3)
- When `RULE_IDS` gains an identifier, the system shall either reach it
  from a generated input or record it as unreached with a reason. (WS4)

Out of scope:

- The fifth measure. It is `functional-design-quality.spec.md` WS4.
- Removing the existing coverage thresholds. They are a weak instrument
  and this spec argues against ratcheting _on_ them, which is not the
  same as deleting a floor that costs nothing to keep. See Open
  decisions.
- Any change to a law, a golden, or `arbOrmModel`. WS1 adds a check
  over the law files and changes none of them.

## Inventory

| File                                       | Current state                                        | Verdict                       |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------- |
| `core/tests/laws/lawPremises.test.ts`      | did not exist                                        | added by WS1                  |
| `core/tests/laws/*.law.test.ts` (five)     | all five carry a `coverage:` block after barwise-985 | unchanged; now enforced       |
| `scripts/mutate.mjs`                       | one mutation, one command, on demand                 | WS2 builds the batch on top   |
| `core/tests/arbitraries/model.ts`          | valid-only by construction and by law                | unchanged; WS4 adds a sibling |
| `formats/src/sql/SqlglotBridge.ts`         | parses generated SQL with an external parser         | the model for WS3             |
| `packages/core/CLAUDE.md` coverage targets | five percentage thresholds                           | untouched; see Open decisions |

`audit-rubric.mjs`, `audit-duplication.mjs` and `audit-spec-status.mjs`
look adjacent and are not. Each ratchets a finding class; none says
anything about whether a test can fail.

## Target architecture

```
Measure 1  npm run audit:mutation -- --check   ->  mutation-baseline.json
Measure 2  core suite (lawPremises.test.ts)    ->  the floors, in the law files
Measure 3  npm run audit:oracle -- --check     ->  oracle-baseline.json
Measure 4  npm run audit:reachability -- --check ->  reachability-baseline.json

Measure 5  functional-design-quality.spec.md WS4 -- referenced, not owned
```

Two of the four live in the test suite and two are repo-level ratchets,
split by what they read: a measure over the _content_ of one package's
tests is a test, and a measure that must enumerate across packages is a
script with a baseline, matching `audit:duplication` and `audit:rubric`.

## Alternatives considered

- **One "test quality score."** Rejected for the reason the sibling
  spec rejects one functional score: a single number cannot say which
  property is decaying, and the four are independent enough that
  averaging them destroys the signal. It would also be a number nobody
  could act on.

- **Ratchet on coverage percentage, since the thresholds already
  exist.** Rejected on the evidence above -- weak correlation once size
  is controlled, and a reading that changes with the Node major. It is
  the cheapest instrument available and it measures the wrong thing,
  which is the combination that keeps it in use everywhere.

- **Adopt Stryker wholesale for measure 1 and be done.** Not rejected,
  but not decided here; it is Open decision 1. The relevant question is
  whether we want a mutation _number_ or a mutation _engine_, and those
  have different costs.

- **Make WS1 a repo-level gate script rather than a test.** Rejected
  for now: law files exist only in `@barwise/core`, so a script that
  walks every package would be enumerating one directory through more
  machinery, plus a root-script forwarder and a `ci.yml` entry. If laws
  spread to a second package, the check moves and this paragraph is the
  record of why it was not built that way first.

- **An arbitrary that constructs violations directly** (`arbMalformedOrmModel`,
  one invalid choice per draw). This was the first draft's WS4 and it is
  wrong: building the shape a rule looks for and then asserting that rule
  fires encodes the rule twice, which is the fixture problem it was meant
  to solve. Recorded here rather than deleted because it is the obvious
  design and the next reader will propose it again.

- **Assert only that a `coverage:` block exists.** Rejected as too easy
  to satisfy without meaning it: an empty `describe` would pass. WS1
  asserts two markers, the second being that the block draws from
  `fc.sample`, so a coverage block over hand-built fixtures -- which
  counts shapes the laws never saw -- fails.

## Workstreams (each independently shippable)

### 1. The law-premises check (implemented)

`core/tests/laws/lawPremises.test.ts`. Enumerates `*.law.test.ts` in
`tests/laws/`, asserts each carries a `describe("coverage: ...")` and at
least one `fc.sample(`, and guards its own enumeration with a floor so
an empty glob cannot make the other two pass. No law file is edited.

### 2. Mutation score per directory (provisional: not yet grounded)

Take the first aggregate reading over `core/src/diff` and
`core/src/mapping` -- the two directories the September omission defects
lived in -- and record it per directory in a baseline that fails on a
decrease. The point of the first pass is the number, which nobody has.

### 3. Oracle classification (provisional: not yet grounded)

Classify each assertion group by oracle kind, following Barr et al.'s
taxonomy: specified, derived, pseudo-oracle, implicit. Ratchet the
self-referential share downward. The cheapest real win is likely
running exported DDL through the `SqlglotBridge` that already exists,
which turns a golden into a derived oracle.

### 4. Reachability over the lenient-load door (provisional: not yet grounded)

Two steps, and the first is worth landing alone. **(a)** Record the
reachability number against `RULE_IDS` as a baseline, so the 22 of 79
above cannot drift down unnoticed; this needs no new generator and is
the cheapest measure in the spec. **(b)** Generate through the door
invalidity actually uses: draw a valid model, serialize it, perturb the
YAML text, load with `lenient: true`, and record which rules fire. The
perturbation is text-level and rule-agnostic on purpose -- see the
measure 4 section for why constructing violations directly would test
our own beliefs.

### 5. Retire or keep the coverage thresholds (provisional; depends on Open decision 2)

## Open decisions (for review)

- **A mutation number, or a mutation engine?** Options: (a) a scoped
  Stryker run as a devDependency, which gives a real score quickly and
  brings a large tool and a slow job; (b) extend `mutate.mjs` into a
  batch runner over a declared operator list, which owns no new
  dependency and will be less capable than a mature engine for years.
  Recommended: (a) first, scoped to two directories, to learn the
  number -- and then decide, because the number tells us whether owning
  an engine is worth it. Deciding the tool before seeing any score is
  the order that wastes the effort.

- **Do the coverage thresholds stay?** Options: (a) keep them as a
  floor against catastrophe while ratcheting on measures 1 through 4;
  (b) remove them once measure 1 has a baseline, on the grounds that
  two instruments for one property is one too many and the weaker will
  be the one people optimize. Recommended: (a) until WS2 produces a
  number, then revisit. They cost little and the Node-portability
  problem is documented rather than surprising.

- **Where does measure 3's classification live?** Options: (a) a
  baseline file listing groups by oracle kind, like
  `audit-baseline.json`; (b) a comment convention in the test files
  that a script reads. Recommended: (a). A comment convention is a
  discipline, and this whole spec is about what happens to those.

## Risks and testing

- **Every check here must be verified red, not green.** This is a spec
  about checks that cannot fail, so the same trap catches the person
  writing it (assertion-audit rule 0; barwise-906, six occurrences).
  Use `npm run mutate` and establish the failing reading first. WS1's
  three assertions were verified this way; see Implementation notes.
- **Measure 4 could manufacture its own diagnostics**, which is why it
  generates through the lenient-load door rather than constructing
  violations. Even so, a text perturbation can produce YAML the loader
  was never meant to see, and asserting on those pins noise. The
  discriminating assertion is "this rule and no other", not "some
  diagnostic appeared".
- **Measure 1 will surface equivalent mutants**, which are undecidable
  in general and are the standing cost of mutation testing (Papadakis
  et al. 2019). The baseline must tolerate a known-equivalent list
  rather than demanding 100%.
- **Behavior that must not change:** WS1 touches no law and no source
  file. Core suite grows by three tests.

## Implementation notes (WS1)

Landed as specified. Three assertions, all three verified red by
mutation before the green was trusted:

| Mutation                                                 | Reading                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `describe("coverage: ...` renamed in `merge.law.test.ts` | `no describe("coverage: ...") block in: merge.law.test.ts` |
| `fc.sample(` renamed in `counterexample.law.test.ts`     | `no fc.sample(...) in: counterexample.law.test.ts`         |
| the glob suffix changed so it matches nothing            | `expected law files in .../tests/laws, found 0`            |

The third mutation is the one worth recording. With the glob matching
nothing, the two _real_ checks reported green -- they filtered an empty
list and found no offenders -- and only the guard went red. That is the
failure this spec is about, reproduced inside the check written to
prevent it, and it is the argument for the guard existing at all rather
than a paragraph claiming an empty glob is unlikely.

One deviation from the draft: the first draft asserted only the
`describe` marker. The `fc.sample` marker was added after asking what a
lazy compliance would look like -- a `coverage:` block over hand-built
fixtures, which counts shapes the laws never drew.

## Literature

The papers this spec rests on, each tied to the measure it grounds.
Venue and year identify each; all were checked against publisher or
author records on 2026-09-10.

| Paper                                                                                               | What it establishes                                                                                 | Grounds                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Inozemtseva, Holmes 2014, ICSE, "Coverage Is Not Strongly Correlated with Test Suite Effectiveness" | Coverage correlates low-to-moderately with effectiveness once suite size is controlled              | the resolved question                |
| Just, Jalali, Inozemtseva, Ernst, Holmes, Fraser 2014, FSE                                          | Mutant detection correlates with real fault detection over 357 real faults, independent of coverage | measure 1                            |
| DeMillo, Lipton, Sayward 1978, IEEE Computer 11(4)                                                  | Mutation analysis and the coupling effect                                                           | measure 1                            |
| Papadakis, Kintis, Zhang, Jia, Le Traon, Harman 2019, Advances in Computers 112                     | Mutation survey; equivalent mutants as the standing cost                                            | measure 1's baseline                 |
| Zhang, Mesbah 2015, FSE, "Assertions Are Strongly Correlated with Test Suite Effectiveness"         | Assertion count correlates strongly and mediates the size relationship                              | the resolved question's complication |
| Goldstein, Hughes, Lampropoulos, Pierce 2021, ESOP, "Do Judge a Test by its Cover"                  | Combinatorial coverage applied to PBT generator distributions                                       | measure 2's generalization           |
| Kuhn, Wallace, Gallo 2004, IEEE TSE 30(6)                                                           | Failures are triggered by combinations of few conditions                                            | measure 2                            |
| Barr, Harman, McMinn, Shahbaz, Yoo 2015, IEEE TSE 41(5), "The Oracle Problem in Software Testing"   | Oracle taxonomy: specified, derived, implicit, pseudo-oracles                                       | measure 3                            |
| Segura, Fraser, Sanchez, Ruiz-Cortes 2016, IEEE TSE 42(9), "A Survey on Metamorphic Testing"        | Metamorphic relations where no oracle exists                                                        | measure 3                            |
| Hughes 2020, TFP 2019, LNCS, "How to Specify It!"                                                   | Five approaches to writing properties, with bug-finding power compared                              | measures 2 and 4                     |
| Goldstein et al. 2024, ICSE, "Property-Based Testing in Practice"                                   | How practitioners actually use PBT; already cited by the sibling spec                               | measure 4                            |

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No change to any law, golden file, or the existing arbitrary.
- No claim that the four measures are complete. They are the four with
  a nameable instrument today.
- No restatement of the fifth measure, which lives in
  `functional-design-quality.spec.md` WS4.
