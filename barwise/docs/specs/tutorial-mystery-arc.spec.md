# Tutorial mystery arc: constraint induction as detective cases

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-07-01
Last-updated: 2026-07-01
Tracking: feature (gamified ORM tutorial); builds on `tutorial-beginner-arc.spec.md`

## Principle

The intermediate modeling skill is induction: inferring the
constraints of a world from its data. The arc teaches it as detective
work, because the two are the same act -- an alibi check is an
exclusion constraint, impostor detection is external uniqueness, a
forged provenance chain violates a ring constraint. Each case is a
constraint family with a plot.

Determinism in core dictates the split that makes an LLM safe to
involve: the LLM proposes, the deterministic core disposes. Grading
never touches an LLM; narration and witness dialogue never touch
grading. Generated content enters the bank only after a deterministic
certification gauntlet built from the same primitives that judge
learners. Both sides of the table face the same judge.

## Should the culprit check be a population query? (resolved: no -- story elimination)

The original frame -- "run a suspect query over the evidence; a
well-formed schema returns exactly one name" -- died on a verified
fact: the query engine is structural only. All fourteen `ModelQuery`
kinds read object types, fact types, and constraints
(`core/src/query/types.ts`); none reads fact instances. Building a
population query engine in core is a large capability this arc does
not need.

Story elimination replaces it using only what exists. Each suspect
carries a hidden story: the population set describing the world in
which they did it. The canonical schema admits exactly the culprit's
story; every innocent story contains a violation -- an impossible
world. The learner's schema is judged by running every story through
`populationValidationRules`:

- Under-constrained schema: several stories validate. The theory of
  the world is too loose; it admits worlds that could not have
  happened.
- Over-constrained schema: the culprit's story is rejected. The
  theory calls true facts impossible.
- Well-formed schema: exactly one story survives, and it names the
  culprit.

This is also the better teaching device: the failure modes map
one-to-one onto the two ways real models go wrong, and both render as
plot ("the suspect walks free" / "your own evidence is thrown out")
rather than as a score.

## Anchors (grounding)

- `populationValidationRules` covers every constraint family the
  season teaches -- uniqueness, external uniqueness, mandatory,
  disjunctive mandatory, subset, ring, exclusion, frequency -- with
  stable rule ids
  (`core/src/validation/rules/populationValidation.ts`).
- `generateCounterexamples` is the deterministic inverse of
  population validation (`core/src/counterexample/Counterexample.ts`;
  guarded by `counterexample-roundtrip-guard.spec.md`), and emits
  segmented, renderable text. This powers the escape-route feedback.
- The MCP server exposes no population-validation or counterexample
  tool today (`packages/mcp/src/tools/index.ts`: fourteen tools, all
  structural or import/export). The game-master workstream must add
  its own tools; nothing existing serves.
- `createLlmClient` (`packages/llm/src/providers/factory.ts`) is the
  provider seam for witnesses and generation; it lives outside core
  and stays there.
- Dead anchor, recorded: population-level querying (see the resolved
  question above). If a future arc genuinely needs "which instances
  satisfy X," that is a core spec of its own, not a tutor patch.

## Scope

In scope: the case-file format (a third puzzle kind extending the
beginner spec's format), the accusation judge, escape-route feedback,
the season-one content pack (six episodes), case certification, MCP
game-master tools, and pure witness/narrator prompt builders.

Out of scope: lying witnesses (season-two mechanic); deontic
"broken rule" mechanics (open decision below); contests or
leaderboards; a population query engine in core; the drill bank; the
VS Code walkthrough.

## Inventory

| Area                   | Current state                           | Verdict                                    |
| ---------------------- | --------------------------------------- | ------------------------------------------ |
| `packages/tutor`       | judge and format from the beginner spec | extends: case kind, accusation judge       |
| `packages/tutor` (LLM) | no LLM surface                          | adds pure prompt builders only             |
| `packages/core`        | validation, counterexamples, verbalizer | unchanged                                  |
| `packages/mcp`         | no population or tutor tools            | adds game-master tools (workstream 5)      |
| `packages/llm`         | provider factory, transcript extraction | unchanged; hosts wire its clients to tutor |
| `packages/cli`         | `learn` command from the beginner spec  | extends: case sessions                     |
| `docs/specs`           | no mystery/case spec                    | this spec                                  |

## Target architecture

```
@barwise/tutor  (still core-only; still pure)
  src/case/        CaseFile types, loader; extends puzzle schema with kind: case
  src/judge/       accuse(caseFile, schema, suspect) -> CaseVerdict
  src/certify/     certifyCase(caseFile) -> Diagnostic[]   (the gauntlet)
  src/prompts/     buildWitnessPrompt, buildNarratorBriefing  (pure string builders)
  content/season1/ ep1 .. ep6 *.puzzle.yaml (public half) + hidden solutions

@barwise/mcp    += game-master tools: tutor_open_case, tutor_interview_brief,
                   tutor_submit_accusation  (wires prompts to an LlmClient)
@barwise/cli    += case sessions under `barwise learn` (no LLM in v1 CLI play)
```

The case file splits into a public half (setting, cast, evidence
rows, given object type names and reference schemes) and a hidden
half (canonical schema, per-suspect stories, culprit, lesson
constraint list). Hosts hand the narrator the public half only.

## Accusation judge

EARS-phrased:

- When an accusation `(schema, suspect)` is submitted, the judge
  shall bind and validate every suspect story against the schema and
  return case-closed only when the accused's story is the sole story
  that validates and the accused is the culprit.
- When an innocent's story validates against the learner schema, the
  judge shall name the canonical constraint whose rule id fires on
  that story under the canonical schema, and render its
  counterexample segments -- the escape route the learner's schema
  left open.
- When the culprit's story is rejected, the judge shall report the
  learner constraint whose diagnostic fired -- the over-constraint
  that throws out true evidence.
- When any story cannot be bound to the learner schema, the judge
  shall return the beginner spec's `cannot-record` verdict for it.

Evidence binding is inherited unchanged from the beginner spec;
stories are name-keyed rows like all other puzzle evidence.

## Case certification (the gauntlet)

`certifyCase` admits a case into the bank only when, deterministically:

- The canonical schema validates cleanly and admits the culprit's
  story; every innocent story is rejected under it.
- Every lesson constraint is load-bearing: removing it from the
  canonical schema admits at least one innocent story. A case that
  teaches a constraint the solution does not need is rejected.
- Story binding is unambiguous against the canonical schema.

A host-side, non-blocking check complements the gauntlet: a solver
pass that tries to name the culprit from the public flavor text
alone, without evidence. A case that leaks its answer through prose
is sent back for reskinning. This check is LLM-based and advisory;
it never gates in CI.

## LLM surfaces (hosts only)

- **Witnesses.** Each cast member gets a pure prompt built from the
  subset of evidence rows their character can know
  (`buildWitnessPrompt`). Hosts wire the prompt to `createLlmClient`.
  Ground truth bounds what a witness can truthfully assert; grading
  never reads witness text -- only facts the learner files are
  judged.
- **Narrator.** Briefed with the public half only. Information
  hiding, not instruction-following, is what makes spoilers
  impossible: the narrator model never receives the culprit or the
  hidden schema.
- **Generation.** Variety enters at three layers with different risk:
  deep structure (hand-authored templates -- the pedagogy; the LLM
  never touches it), populations (derived deterministically from the
  canonical schema, reusing the counterexample machinery's minting
  patterns), and surface (names, setting, prose -- LLM-reskinned
  freely). Every generated case passes `certifyCase` before a
  learner sees it; generation runs ahead of play and fills the bank,
  it is not a per-play dependency.

## Season one (six episodes)

| Episode | Case                     | Constraints taught                       |
| ------- | ------------------------ | ---------------------------------------- |
| 1       | The Locked Vault         | internal uniqueness; mandatory role      |
| 2       | The Second Badge         | external uniqueness                      |
| 3       | The Man Who Wasn't There | mandatory; disjunctive mandatory         |
| 4       | The Uninvited Reader     | subset                                   |
| 5       | The Provenance Loop      | ring (acyclicity)                        |
| 6       | The Forger's Web         | exclusion; frequency; composition of 1-5 |

Episode 6 is the capstone: planted inconsistencies from episodes 1-5
resolve only under the composed schema. The setting carries over from
the prologue (the institute; the records the learner filed there are
this season's evidence corpus).

## Workstreams (each independently shippable)

### 1. Case format, accusation judge, certifier

Extends `tutor` with the `case` kind, `accuse`, and `certifyCase`.
Pure; fixture cases exercise every verdict branch including
load-bearing rejection.

### 2. Episode 1 end-to-end through the CLI

One hand-authored case played start to finish via `barwise learn`,
no LLM. Proves the format and the judge on real content before the
season is authored; format changes are cheap while there is one case.

### 3. Escape-route feedback rendering

The innocent-story-admitted verdict rendered with counterexample
segments and the canonical rule id, in CLI output. Small, isolated,
high pedagogical value.

### 4. Season one content (provisional: not yet grounded)

Episodes 2-6 plus certification. The authoring cost estimate (six
casts, roughly five stories each) is unverified until episode 1
lands; treat the episode table as the plan of record, not a sizing.

### 5. MCP game-master tools and witness wiring (provisional: not yet grounded)

`tutor_open_case`, `tutor_interview_brief`, `tutor_submit_accusation`;
the interview tool returns the witness prompt and knowledge subset
for the host's LLM to play. Ground against `packages/mcp/CLAUDE.md`
conventions and the tool-surface spec before implementation.

### 6. Generation pipeline (provisional: not yet grounded)

Template reskinning through the gauntlet into the bank; the solver
leakage check. Deliberately last: it multiplies content that
workstreams 1-4 prove people want.

## API and migration impact

- `@barwise/tutor` grows the `case` module and prompt builders; its
  dependency set is unchanged (core only -- prompt builders are pure
  string functions).
- `mcp` adds tutor tools; `cli` extends `learn`. No core change; no
  existing export moves.

## Open decisions (for review)

- **Where witness prompts live.** `tutor` (pure builders, hosts wire
  clients) vs `llm` (beside the other prompt builders). Recommend
  `tutor`: the prompts are tutorial domain knowledge, and keeping
  `tutor` free of an `llm` dependency preserves its determinism
  boundary at the package level.
- **MCP tool surface.** Tutor-specific tools only, vs also exposing
  generic `validate_population` / `generate_counterexamples` tools.
  Recommend tutor-specific now; the generic tools are useful but are
  their own small spec against the MCP tool-surface conventions.
- **Suspect count per case.** More stories mean sharper elimination
  but higher authoring cost. Recommend four to six; revisit after
  episode 1 (workstream 2 tripwire).
- **Deontic constraints as a mechanic.** Population validation
  already grades deontic violations as warnings, not errors
  (`core/src/validation/rules/population/shared.ts`) -- a "rule was
  broken, so it is suspicious but possible" mechanic falls out
  naturally. Recommend deferring to a season-two spec; season one
  teaches alethic constraints only.

## Risks and testing

- Content authoring dominates engineering cost. Mitigations:
  workstream 2 proves the format on one episode first; the certifier
  makes bad cases cheap to detect; generation (workstream 6)
  amortizes templates.
- A certified case can still be humanly ambiguous (two defensible
  culprits despite unique story survival). Tripwire: if playtesting
  episode 1 finds this, the gauntlet gains a check before the season
  is authored.
- Narrator leakage is bounded by information hiding, and witness
  fabrication is bounded by ground-truth prompts but not eliminated;
  the design's guarantee is that grading never depends on LLM text.
- The judge extensions land behind the beginner spec's judge tests;
  target 95%+ coverage on `src/case/` and `src/judge/`.

## Non-goals

- No population query capability in core.
- No lying witnesses, contests, or leaderboards in season one.
- No per-play LLM generation; the bank is filled ahead of play.
- No change to `@barwise/llm`; hosts compose its clients with
  `tutor` prompts.
