# An interview guide from a draft model: each claim becomes a case to ask about

Status: Draft -- no workstream implemented
Created: 2026-11-13
Last-updated: 2026-11-13
Tracking: barwise-mef
Touches: +barwise/packages/core/src/interview/,
barwise/packages/core/src/counterexample/,
barwise/packages/core/package.json,
barwise/packages/core/tests/public/exports.json,
+barwise/packages/core/tests/laws/interview.law.test.ts,
barwise/packages/cli/src/commands/verbalize.ts,
barwise/packages/mcp/src/tools/verbalize.ts,
barwise/packages/mcp/src/prompts/guidance/guidance.ts,
barwise/packages/mcp/src/prompts/analyzeDomain.ts,
barwise/packages/vscode/src/mcp/ToolRegistration.ts,
barwise/packages/vscode/package.json

## Principle

Barwise generates, from a draft model alone, a list of concrete cases to
put to a domain expert -- one for each thing the model says cannot
happen, and one for each thing it lets happen that a tighter model would
not -- so the second session tests the draft against what the expert has
lived through instead of asking for the rules again.

**Determinism in the core, and composability.** Which cases a model
raises is a pure function of the model, and half of that function
already exists: `generateCounterexamples` returns the minimal population
each constraint forbids. Two gaps keep it from being an interview
instrument.

- **A missing constraint produces no line.** `verbalize
  --counterexamples` reports only constraints that are present. A rule
  the extraction failed to capture is absent from the output in exactly
  the way a rule the domain does not have is absent. That is an unknown
  unknown: the reader cannot tell what they needed to ask. Extraction
  errors of omission are the ones a readback cannot surface, because a
  readback reads back what was captured.
- **The output is written for a modeler.** `Rules out: two facts of
  Doctor has Specialty that agree on Doctor -- e.g. {Doctor=Doctor#1,
  Specialty=cardiology}; {Doctor=Doctor#1, Specialty=dermatology}` is
  not something to read to an office manager.

The method this borrows is Gary Klein's Critical Decision Method (Klein,
Calderwood and MacGregor, 1989). Its premise is that experts cannot
recite what they know as rules but can retell a case, and the knowledge
shows in the retelling. Seven of the ten eval transcripts barwise ships
are the opposite: a facilitator asks for rules and one expert recites
them. One of the other three shows the premise at work. In
`packages/promptlab/evals/vendor-onboarding.transcript.md` an expert
says each vendor has one primary contact, takes it back, and a
colleague's account of one supplier is what explains why the rule is one
contact per vendor and region. No question was aimed at that account:
the colleague raised it and the facilitator let it run. The guide is a
way to ask for it.
The sensemaking work already frames a counterexample as an expectancy to
confirm (`implicit-sensemaking.spec.md`); this spec gives that expectancy
a form an expert can answer.

## Should core generate the questions, or should guidance tell the agent to? (resolved: core generates the cases; guidance carries the interview)

The split follows the determinism rule. The method has four passes over
one incident: choose it, rebuild its timeline, deepen each decision
point, then ask what-if. Three of those are interviewing skill and
belong in guidance. Only the fourth is a function of the model, and that
is the one core generates. The guide says so on its face, so nobody
mistakes a list of what-ifs for the method.

Guidance alone would be cheaper and would lose the property that
matters. An agent told to "ask about constraints that might be missing"
asks about the ones that occur to it. A generator enumerates a closed
family of candidate constraints, and a law proves no member is skipped:
delete a constraint from a model and its case must reappear on the other
side of the guide (WS4). That law is the acceptance test, and it needs
no model call to run.

## Scope

In scope:

- When a model carries a constraint for which `generateCounterexamples`
  returns a counterexample, the guide shall contain exactly one question
  citing that constraint, on the forbids side.
- When a model carries a constraint for which `generateCounterexamples`
  returns none, the guide shall name that constraint under a "not asked"
  heading with one of two reasons: its kind has no generator (today
  `value_comparison`, `cardinality` and the four join kinds), or the
  generator found no population that violates it.
- When a constraint in the candidate family (Open decision 2) is absent
  from a model and not implied by one that is present, the guide shall
  contain exactly one question for it, on the permits side, or name it
  under "not asked" when the generator returns no population for it.
- When a question is rendered, it shall state the model's claim as its
  existing verbalization and the case as fact sentences built from the
  fact type's reading, never as a tuple.
- When `verbalize` is asked for questions on any of the three surfaces,
  it shall return the same guide for the same model.

Out of scope:

- Recording answers. An answer changes the model through features that
  exist: the incident becomes a sample population, and a constraint
  gains, loses or changes modality. Open decision 4.
- Storing extraction ambiguities. That is `model-open-questions.spec.md`;
  WS5 only reads what it stores.
- Running the interview. A live interviewer is barwise-8ud and
  barwise-1l9.
- Any change to `generateCounterexamples`' output or to the `.orm.yaml`
  format.

## Inventory

| Module                                                      | Current state                                                                                            | Verdict                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `core/src/counterexample/CounterexampleGenerator.ts`        | 11 of 17 kinds have a generator; a covered kind still returns `undefined` when no population violates it | output unchanged; exports the kinds with no generator (WS2)       |
| `core/src/interview/`                                       | does not exist                                                                                           | new: guide type, generator, fact sentences, text renderer (WS2)   |
| `core/src/verbalization/`                                   | verbalizes fact types and constraints; no sentence for a fact instance                                   | untouched; the sentence helper lives in WS2's module              |
| `core/package.json`                                         | `./counterexample` subpath export                                                                        | adds `./interview` (WS2)                                          |
| `cli/src/commands/verbalize.ts`                             | `--counterexamples`                                                                                      | adds `--questions` (WS3)                                          |
| `mcp/src/tools/verbalize.ts`                                | `counterexamples` parameter                                                                              | adds `questions` (WS3)                                            |
| `vscode/src/mcp/ToolRegistration.ts`, `vscode/package.json` | verbalize tool carries `counterexamples`                                                                 | adds `questions` (WS3)                                            |
| `mcp/src/prompts/guidance/guidance.ts`, `analyzeDomain.ts`  | workflow, sensemaking, context-hygiene blocks                                                            | adds `ELICITATION_GUIDANCE`, composed into `analyze-domain` (WS1) |
| `core/tests/laws/`                                          | `counterexample.law.test.ts` round-trips each counterexample                                             | adds `interview.law.test.ts` (WS2 and WS4)                        |
| `core/src/model/` (open questions)                          | no such element; planned by `model-open-questions.spec.md`                                               | read by the guide once it exists (WS5)                            |

The second "not asked" reason is the common one. In the 18 models under
`examples/` and `trial/customers/` at `7e7a9412`, 29 of 1,684
constraints get no counterexample, and 27 of those are of kinds that
have a generator: 14 mandatory, 6 exclusion, 6 exclusive-or and 1
external uniqueness. The generator returns `undefined` for both cases
and says which only in a comment, so the guide cannot tell them apart
today. WS2 has the counterexample module export the kinds it has no
generator for, which makes the reason derived instead of a second list
of six kinds that must agree with the generator's switch.

The capability matrix in the root `CLAUDE.md` gains no row if Open
decision 1 resolves as recommended: `--counterexamples` is carried by the
existing `verbalize` row, and `--questions` rides the same one.
`@barwise/llm` is untouched throughout. The guidance module's header says
the barwise-modeling skill and the Copilot chat participant inherit its
blocks; a search finds only the MCP server and the two prompts importing
them, so WS1 grounds that claim before relying on it.

## Target architecture

```ts
// core/src/interview/ -- pure, deterministic, exported as @barwise/core/interview

/** One case to put to an expert, tied to the claim it tests. */
interface InterviewQuestion {
  /** Stable within a model: side, constraint kind, and the roles involved. */
  readonly id: string;
  /** "forbids": the model has the constraint. "permits": it does not. */
  readonly side: "forbids" | "permits";
  readonly constraintType: Constraint["type"];
  /** Present on the forbids side when the constraint carries an id. */
  readonly constraintId?: string;
  readonly factTypeIds: readonly string[];
  /** What the model says today, as its existing verbalization. */
  readonly claim: string;
  /** The case, one sentence per fact, built from the fact type's reading. */
  readonly scenario: readonly string[];
  /** The population behind the scenario; the same shape a counterexample has. */
  readonly population: readonly Population[];
}

interface InterviewGuide {
  /** Grouped by fact type in model order; identification questions last. */
  readonly questions: readonly InterviewQuestion[];
  /** Claims no question covers, and why. */
  readonly notAsked: readonly {
    side: "forbids" | "permits";
    constraintId?: string;
    constraintType: Constraint["type"];
    reason: "no-generator" | "no-violating-population";
  }[];
}

declare function generateInterviewGuide(model: OrmModel): InterviewGuide;
```

A rendered question reads:

```
The model says: Each Doctor has at most one Specialty.
Case: Doctor D1 has Specialty cardiology.
      Doctor D1 has Specialty dermatology.
Has something like this happened? If it has: walk me through it.
Was it allowed, or a mistake someone corrected? What happened next?
```

The three follow-ups are fixed text, and the answers map to model edits
the same way for every question. The table is printed once at the head
of the guide.

| Side    | Answer                         | What the model does                                  |
| ------- | ------------------------------ | ---------------------------------------------------- |
| forbids | never, and it could not        | nothing; the constraint is confirmed                 |
| forbids | it happened and was a mistake  | constraint stays, `modality: deontic`                |
| forbids | it happened and was legitimate | constraint goes or narrows; the case is a population |
| permits | it happens                     | nothing; the case is a population                    |
| permits | never, and it could not        | add the constraint                                   |
| permits | it happened and was a mistake  | add the constraint, `modality: deontic`              |

The third row closes a loop that already exists: once the case is in the
model as a population, `validate` reports the constraint it violates.

## Alternatives considered

- **Guidance only.** Tell the agent to rephrase each counterexample as a
  question. No code, and no enumeration of what is absent; rejected for
  the reason in the resolution above. It survives as WS1, which is worth
  shipping by itself.
- **A question field on `Counterexample`.** One type, one generator.
  Rejected: a permits-side question has no constraint to hang from, so
  half the guide would have no home, and every exhaustive consumer of
  `Counterexample` would carry a field it does not use.
- **An export format, `--format interview-guide`.** The registry would
  put it on all three surfaces with no wiring, and a guide is a file
  someone carries into a meeting. Rejected as the default because
  `export` is the workflow's last step, for a model that is sound, and a
  guide is for a draft; and because `@barwise/formats` holds interop
  formats, which this is not. It remains Open decision 1.
- **A new command, `barwise interview`.** The clearest name and a new
  row on the matrix for three surfaces. `implicit-sensemaking.spec.md`
  rejected `probe_model` on the same grounds: it repeats the
  verbalization traversal behind a parallel surface.
- **Rank questions by how likely the claim is to be wrong.** Any score
  computed from the model alone is a guess with a number on it. The
  guide orders by structure instead (fact type, then identification
  last) and leaves the choice of what to skip to the facilitator.

## Workstreams (each independently shippable)

### 1. Interview guidance

Add `ELICITATION_GUIDANCE` beside `SENSEMAKING_GUIDANCE` and compose it
into `analyze-domain`: pick an incident the expert handled, rebuild its
timeline, ask at each step which facts they consulted, then ask what-if.
Guidance only, so it ships first. It refers to the questions flag only
after WS3 lands. Before writing it, ground how the skill and the chat
participant receive guidance blocks; the Inventory notes the header's
claim is unverified.

### 2. Forbids-side questions in core

New `core/src/interview/` module with the types above, built over
`generateCounterexamples`. It adds the one piece core lacks: a sentence
for a fact instance, rendered through the fact type's reading. The
counterexample module gains one export, the constraint kinds it has no
generator for, and changes nothing it returns. Law, in
`interview.law.test.ts` over `arbOrmModel`: the forbids-side questions
and the counterexamples are in one-to-one correspondence with equal
populations, and every constraint in the model is either cited by a
question or named in `notAsked`.

### 3. Surface through verbalize

`--questions` on `barwise verbalize`, `questions` on `verbalize_model`
and on the VS Code verbalize tool; text and JSON output. Opt-in and
default off, as `--counterexamples` is. The text renderer is one function
in `core/src/interview/` that all three surfaces call, so wording cannot
drift between them. That is the arrangement `constraintReport.ts` has in
`@barwise/formats`, and not the one counterexamples have, where the CLI
and the MCP tool each render their own.

### 4. Permits-side questions (provisional: not yet grounded)

For each constraint in the candidate family that the model lacks, build
the model with that constraint added, take its counterexample from the
existing generator, and emit it as a permits-side question. No second
generator is written. Law: for a model `M` and a constraint `c` in the
family, the guide for `M` without `c` contains a permits-side question
whose population equals the population of `c`'s forbids-side question in
`M`. Not yet grounded: whether "not implied by a present constraint" can
be decided with what core has, and how many questions the family yields
on the shipped examples.

### 5. Open questions in the guide (provisional: blocked on barwise-vny)

A transcript import raises ambiguities with source references, and they
are the questions most worth asking. Today they reach the model file
only as `TODO(barwise): Ask:` comments that the next save erases, so a
guide generated from the model cannot see them.
`model-open-questions.spec.md` (barwise-vny, draft) makes them a model
collection, `open_questions`, each naming the elements it is about. When
that lands, the guide lists each open question under the fact type it
names, ahead of the generated cases, and core needs nothing from
`@barwise/llm` to do it. This workstream adds no storage of its own and
does not start before that spec's first workstream ships.

## API and migration impact

- `@barwise/core` gains a subpath export, `./interview`. Nothing existing
  changes signature; `core/tests/public/exports.json` gains the entry.
- `verbalize` gains one optional, default-off parameter on each surface.
  JSON output gains a `questions` key only when asked for, as
  `counterexamples` does.
- No `.orm.yaml` change and no new dependency.

## Open decisions (for review)

1. **Where the guide is reached.** A flag on `verbalize` (recommended),
   an export format, or a new command. The flag has precedent, needs no
   matrix row and sits at the workflow step where the expert is in the
   room. The export format costs no surface wiring and writes a file,
   which suits a document. The trade-off is fit against effort: the flag
   is the better fit and three small wirings.
2. **The permits-side candidate family.** Recommended: a mandatory
   constraint on each optional role an entity type plays, and a
   single-role uniqueness on each role of a binary that has no
   single-role uniqueness, whether its only uniqueness spans both roles
   or it declares none (a legal state: `fact-type-without-uniqueness` is
   a warning). Excluded by default: tightening a many-to-one binary
   to one-to-one, because "have two doctors ever shared a specialty" is
   true of almost every such fact type and would bury the questions that
   matter. Excluding it puts one case outside the WS4 law (deleting one
   of the two constraints on a one-to-one), which the law states as a
   premise. The alternative is to include it behind an option.
3. **Identification questions.** In the clinic example, 12 of the 26
   forbids-side questions come from the four reference-mode fact types.
   Recommended: keep them and group them last. "Has one patient ever had
   two record numbers" has a real answer in most businesses (duplicate
   records), and it is the textbook case of a constraint that is deontic
   and not alethic. The alternative is to omit them unless asked.
4. **A home for answers.** Recommended: none in this spec. The outcome
   table maps every answer to an edit the model already supports. If
   facilitators need to record "asked, no change" so a later guide does
   not ask again, the place is an answered entry in `open_questions`
   (`model-open-questions.spec.md` keeps answered questions for exactly
   that reason), not a second file. The alternative, an answer file keyed
   by question id, gives a decision two places to live.
5. **The name.** Recommended: `interview` for the module and
   `--questions` for the flag, which say what a facilitator does with the
   output. The alternative, `probe`, is shorter and is taken: it is the
   counterexample generator's internal word for what it builds, so using
   it here would give one word two meanings in one package.

## Risks and testing

- **Volume.** The clinic example has 11 fact types and yields 26
  forbids-side questions before the permits side adds more. The guide
  groups by fact type so a facilitator can work the fact types an
  incident touched and skip the rest. No cap is proposed: a limit needs a
  ranking, and the Alternatives section says why there is none.
- **One exception distorts the model.** A single incident where a rule
  was broken tempts a modeler to drop the rule. The follow-up "was it
  allowed, or a mistake" and the deontic row of the outcome table are the
  guard.
- **A count of questions is not evidence the method works.** The laws
  prove the guide is complete with respect to the model. They do not show
  that a session run from it produces a better model than a second
  rule-recitation session would. Nothing in this spec measures that. The
  instrument that could is the enterprise trial's elicitation sprint,
  with a persona answering the guide, and it is not built here.
- **Determinism.** `generateInterviewGuide` is referentially transparent;
  the law suite asserts it at the fixed seed the other laws use.
- **Order of landing.** WS2 before WS3; WS4 after both. Run the full
  build and suite after WS2, since it adds to core's public surface.

## Non-goals

- Replacing ORM's Conceptual Schema Design Procedure. The guide tests a
  draft; it does not produce one, and it covers only the facts an
  incident touches.
- Language-model phrasing of questions. An agent may rephrase a case for
  its audience; the case itself comes from core.
- A live interviewer, a chat participant, or recorded answers.
