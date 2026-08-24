# Prompt optimization harness: DSPy-optimized, per-provider prompt artifacts for the LLM surfaces

Status: Accepted (merged in PR #289). Workstreams 1 (artifact seam),
2 (promptlab: eval suite, scorer, runner, CLI) and **3 (the DSPy
`optimizer/` project, 2026-08-23 -- see
`docs/specs/dspy-optimizer.spec.md`)** implemented. Workstreams 4-6
open.
Created: 2026-08-08
Last-updated: 2026-08-23

> **Correction (2026-08-09).** Workstream 1 shipped the artifact seam
> but not its production wiring, and two claims in this spec were
> written as settled fact before that was true. `processTranscript`
> accepts an artifact and renders it, but **nothing resolves one**:
> all five production call sites omit the parameter, so every
> extraction on every provider renders `defaultExtractionArtifact`.
> `resolveArtifact` and `loadArtifactsFromDir` have exactly one
> caller, `barwise prompt eval --artifacts`. The two affected claims
> are marked inline below. Completing the wiring is specified in
> `docs/specs/artifact-resolution-in-production.spec.md`.

Tracking: `docs/ARCHITECTURE.md` open question #4 ("LLM prompt as a
managed artifact"). No bd issue yet -- the bd binary is unavailable in
this web session; file one before the first implementation PR.

## Principle

The harness serves **explicit over implicit** and reuses **determinism
in the core** as its measuring instrument.

Barwise sends prompts to LLMs from exactly two API surfaces, both in
`@barwise/llm`: transcript extraction
(`src/prompt/systemPrompt.ts`, 161 lines of hardcoded template
literal) and model review (`src/review/reviewModel.ts:33-83`). Both
prompts are implicit artifacts: unversioned strings compiled into the
package, with no recorded score, no per-provider variants, and no way
to tell whether an edit made extraction better or worse. The only
quality evidence is a pair of hand-scored A/B scorecards
(`docs/extraction-quality-v0.2.*.md`, last updated 2026-03-01), and
the `tests/live/` directory that `packages/llm/CLAUDE.md` and
`ARCHITECTURE.md` section 7.5 both prescribe for prompt-engineering
runs does not exist. Meanwhile the provider factory supports three
providers plus Copilot, different surfaces run different models, and
models change under the prompt without any signal that quality moved.

The fix is the DSPy discipline: separate the prompt (a declared,
versioned artifact) from the metric (a programmatic scorer), and let
an optimizer search the prompt space against the metric. Barwise
already owns the metric's raw material. An extraction produces an
`OrmModel`; `@barwise/learn` already grades an `OrmModel` against a
declarative rubric byte-for-byte deterministically
(`evaluateCandidate`); and `enforceConformance` already counts
deterministic corrections on every extraction. Nothing wires them
together. This spec adds the wiring in TypeScript -- a prompt-artifact
seam and a deterministic scorer with a CLI -- and puts DSPy itself, as
an offline Python tool, in the optimizer seat. Every score is
reproducible from checked-in fixtures; the only non-determinism is
the LLM call, which stays at the boundary where it belongs.

## Should the optimizer be DSPy itself or a TypeScript port of its technique? (resolved: DSPy itself, offline)

DSPy runs as a dev-time tool in a contained Python project; nothing in
the barwise runtime, npm workspace, or install path touches Python.

The value of DSPy is its optimizers -- BootstrapFewShot, MIPROv2, GEPA
-- which are the actively moving part of the field. A TypeScript port
would freeze one algorithm at one point in time and take on permanent
chase-work to track the frontier; the port would also be the least
interesting code in the system, since barwise's contribution is the
metric, not the search. Running the real framework gets the current
optimizers and every future one for free.

The boundary that makes this safe is the same one `@barwise/dbt` set
for the `dbt` subprocess: a tool with its own runtime lives behind an
explicit process boundary and owns its I/O. Concretely:

- **Optimization-time lane (Python, offline).** A DSPy program
  mirrors the extraction task (transcript in, schema-constrained
  extraction JSON out). Its metric shells out to
  `barwise prompt score`, so every candidate is judged by the exact
  production parse-and-score path -- `DraftModelParser`,
  `enforceConformance`, `evaluateCandidate` -- not a Python
  approximation of it. The compiled program (tuned instructions plus
  selected demos) is exported to a `.prompt.yaml` artifact.
- **Runtime lane (TypeScript, unchanged).** `processTranscript`
  resolves and renders the checked-in artifact. Production never
  imports DSPy, and a team that never runs optimization never
  installs Python.
  **[Corrected 2026-08-09: the resolution half was never built.
  `processTranscript` renders an artifact it is handed and resolves
  nothing; production renders `defaultExtractionArtifact`
  unconditionally. The DSPy-independence claim in the second sentence
  still holds.]**

The seam between the lanes is data: `.prompt.yaml` artifacts flowing
one way, JSON scores flowing the other. DSPy's internal score during
compilation is a search signal only; the acceptance gate is re-scoring
the exported artifact through `barwise prompt eval`, the TypeScript
pipeline that production actually runs.

## Should the metric be an LLM judge? (resolved: no -- deterministic checks only)

The score for an extraction is computed entirely by existing
deterministic primitives, in three parts:

1. **Rubric checks** (the grade): each eval case ships a rubric using
   the `@barwise/learn` check vocabulary -- `must_validate`,
   `requires_verbalization`, `forbids_population`, `requires_element`
   -- evaluated by `evaluateCandidate` against the extracted model.
   Score contribution: fraction of checks passed.
2. **Conformance penalty**: `enforceConformance` corrections are
   already computed on every extraction
   (`TranscriptProcessor.ts:81-85`) and today discarded into warnings.
   Each correction subtracts a small penalty -- an extraction the
   pipeline had to repair is worse than one it did not.
3. **Validation penalty**: error-severity diagnostics remaining after
   conformance repair subtract a larger penalty.

An LLM judge would reintroduce the problem being solved: a score that
moves when the judge's model moves. With a deterministic scorer, a
score delta means the prompt or the target model changed, nothing
else. This is the same argument the modeling gym spec made for keeping
the grader deterministic ("the pass or fail is not the model's
opinion"), applied to prompts instead of learners. The gym's boolean
`GymReport` becomes a numeric score by a thin fold in the harness --
no change to `@barwise/learn`. A deterministic metric is also what
makes DSPy compilation trustworthy: the optimizer can run hundreds of
candidate evaluations with no judge drift.

The LLM call under evaluation is itself non-deterministic, so a score
is a sample, not a constant. The harness runs each case N times
(default 1, configurable) and reports mean and worst-case; the
determinism claim is scoped to the scorer, and eval reports say so.

> **Correction (2026-08-21): determinism is not resolution.** "Makes
> DSPy compilation trustworthy" above is true of the scorer's freedom
> from judge drift and false of the suite's ability to separate two
> candidates, and anyone building `optimizer/` will read it as the
> stronger claim. Measured on the n=5 runs of 2026-08-21, the suite
> resolves a difference of about 0.09 and no less; resolving 0.02 would
> need roughly n=190 per configuration. A search whose candidates
> differ by less than its metric can see does not converge slowly, it
> converges to noise.
>
> `docs/specs/eval-metric-readiness.spec.md` is the prerequisite and
> has landed: the suite now separates collapse from quality, carries
> ten cases, and holds three of them out as a dev split. Build
> `optimizer/` to search on the composite score over `train` and to
> gate on `dev` -- an optimizer that never sees a held-out set will
> reproduce, faster, the overfitting already visible in `haiku45-2`,
> which improves six of seven training cases and regresses the
> seventh beyond noise.

## Scope

In scope:

- A prompt-artifact seam in `@barwise/llm`: prompts become loadable,
  versioned artifacts with per-provider variants. When no variant is
  declared for a (surface, provider) pair, the system shall use the
  default artifact, which reproduces today's prompt text byte for
  byte.
- A deterministic scorer and eval runner in a new package (working
  name `@barwise/promptlab`). When `barwise prompt eval --provider X
  --model Y` runs against an eval suite, the system shall extract each
  suite transcript through `processTranscript` with the resolved
  artifact and print per-case and aggregate scores, in `text` and
  `json` formats.
- A single-extraction scoring entry point for the DSPy metric. When
  `barwise prompt score --case <id> --extraction <file>` runs, the
  system shall parse the extraction JSON through `DraftModelParser`,
  apply `enforceConformance`, score against the case rubric, and
  print a `CaseScore` as JSON.
- A schema export for the DSPy signature. When
  `barwise prompt schema --surface extraction` runs, the system shall
  print the structured-output JSON Schema
  (`prompt/responseSchema.ts`) so the Python lane constrains output
  with the same schema as production, never a hand-copied one.
- An eval-case format (`.eval.yaml`): transcript + rubric checks
  (reusing the `@barwise/learn` check schema) + reference model for
  `forbids_population` derivation. A seed suite of 4-6 cases, starting
  from the existing fixture transcript and the nine dimensions of the
  manual scorecards.
- The DSPy optimizer project (Python, offline): the extraction
  program, the shell-out metric, optimizer configuration, and an
  exporter from the compiled program to `.prompt.yaml`. When an
  optimization run completes, the system shall write a candidate
  artifact plus a delta report, and shall not modify the active
  artifact in place. Adoption is a human act: re-run
  `barwise prompt eval` on the candidate, review, commit.
- Score history. When an eval run completes, the system shall append a
  dated record (artifact version, provider, model, per-case scores) to
  a checked-in history file, so drift across model releases is visible
  in git.

Out of scope, deferred and named:

- The process skills and steering texts with no deterministic metric:
  the guidance prompts (`packages/mcp/src/prompts/guidance/`), the MCP
  prompts, the chat-participant prompt, and the `.claude/` skills
  (`spec-writer`, `articulation`, `release`, `gym-coach`,
  `barwise-modeling`). Their output is prose or process; scoring them
  needs a judge, which reintroduces the drift this harness exists to
  kill. They stay hand-authored.
- Optimizing the two `.claude/` subagents
  (`barwise-transcript-extractor`, `barwise-model-reviewer`). Their
  deliverable is an `.orm.yaml` the scorer can grade, so they get
  measure-first regression evals (workstream 6) -- but they stay out
  of the DSPy loop: each evaluation is a full agent session (an order
  of magnitude more cost and variance than one completion), and their
  instruction text is single-sourced for human maintainability.
- The review surface (`reviewModel.ts`). Its output is a finding list,
  so its metric needs seeded-defect fixtures (planted defects, score =
  recall), which is real authoring work. Workstream 5, provisional.
- `CodeExtractionPrompt` in `@barwise/code-analysis`: dead code today
  (built, exported at `src/index.ts:31`, never sent to a model). It
  joins the harness when it gains a call site.
- A scheduled CI workflow. Re-evaluation is a local act triggered by
  a model release (see Decisions); the checked-in score history is
  the durable record.
- Multi-turn few-shot demos. `CompletionRequest` is a single
  systemPrompt + userMessage (`LlmClient.ts:8-14`); exported demos
  render inline into the system prompt. Extending `LlmClient` to
  message arrays is a separate change with four provider
  implementations in its blast radius.

## Inventory

| Area                                        | Change                                                                                                                                   | Verdict   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `packages/llm/src/prompt/systemPrompt.ts`   | Becomes the default extraction artifact; `buildSystemPrompt` reads an artifact                                                           | refactor  |
| `packages/llm/src/prompt/artifacts/`        | Artifact types, loader, resolver (surface x provider -> artifact)                                                                        | new       |
| `packages/llm/prompts/`                     | Checked-in artifact variants (`*.prompt.yaml`) with provenance metadata                                                                  | new       |
| `packages/promptlab/`                       | Eval-case loader, scorer, suite runner, history writer                                                                                   | new       |
| `packages/promptlab/evals/`                 | Seed suite (`*.eval.yaml` + reference `*.orm.yaml` + transcripts)                                                                        | new       |
| `optimizer/`                                | DSPy project: extraction program, shell-out metric, exporter (Python, uv)                                                                | new       |
| `packages/cli/src/commands/prompt.ts`       | New `barwise prompt` command (eval, score, schema, history); adds promptlab dep                                                          | additive  |
| `packages/llm/src/TranscriptProcessor.ts`   | Accepts an optional artifact (default preserves current behavior)                                                                        | additive  |
| `@barwise/learn`                            | Consumed as-is: `evaluateCandidate`, check types, `GymReport`                                                                            | untouched |
| `@barwise/core`                             | Consumed as-is through existing subpath exports                                                                                          | untouched |
| `packages/cli/src/commands/import/batch.ts` | Stays; its concern is bulk import, and eval supersedes it for scoring                                                                    | untouched |
| `packages/mcp`, `packages/vscode`           | **[Corrected 2026-08-09: false.]** They pick up nothing -- both call `processTranscript` without an artifact, so both render the default | untouched |
| `CLAUDE.md` dependency graph                | Add the `promptlab` node; note the offline `optimizer/` lane                                                                             | doc       |

The review prompt (`reviewModel.ts`) looks affected but is not until
workstream 5: the artifact seam is designed for both surfaces, but
only extraction is wired in this spec's mainline.

## Target architecture

```
Runtime lane (TypeScript -- what ships)

@barwise/core                          (unchanged)
  ^
  |--- @barwise/learn                  (unchanged; exports evaluateCandidate,
  |                                     GymCheck vocabulary, GymReport)
  |--- @barwise/llm                    (gains the artifact seam)
  |      prompt/artifacts/  PromptArtifact, loadArtifact(.prompt.yaml),
  |                         resolveArtifact(surface, provider, model)
  |      prompts/           extraction.default.prompt.yaml   (== today's text)
  |                         extraction.<variant>.prompt.yaml (optimized, scored)
  |      TranscriptProcessor.processTranscript(transcript, client, {artifact?})
  |
  |--- @barwise/promptlab              (new; depends on core, llm, learn)
  |      evalcase/   EvalCase, loadEvalCase(.eval.yaml)
  |      score/      scoreExtraction(payload, case) -> CaseScore
  |                  (parse -> conformance -> GymReport fold + penalties)
  |      run/        runSuite(suite, client, artifact, {repeat}) -> SuiteReport
  |      history/    appendHistory(report) -> evals/history.jsonl
  |      evals/      seed suite (*.eval.yaml + references + transcripts)
  |
  |--- @barwise/cli   barwise prompt eval|score|schema|history

Optimization lane (Python, offline -- never shipped, never imported)

optimizer/                             (uv-managed; dspy dependency)
  program.py    dspy.Signature/Module for extraction; output constrained
                by `barwise prompt schema --surface extraction`
  metric.py     candidate output -> subprocess `barwise prompt score` -> float
  compile.py    run BootstrapFewShot / MIPROv2 / GEPA within a call budget
  export.py     compiled program -> packages/llm/prompts/<candidate>.prompt.yaml
                + delta report

  data flow:  evals/*.eval.yaml --> compile.py --> candidate .prompt.yaml
              candidate --> barwise prompt eval (acceptance gate) --> commit
```

The artifact and its resolution are explicit: a `.prompt.yaml` names
its surface, an optional provider/model-family match, its instruction
text, inline demos, and provenance metadata (optimizer and proposer
model, target model, suite version, score, date). `resolveArtifact`
takes declared variants only -- no fuzzy matching, no auto-discovery
-- and falls back to the default artifact, mirroring how formats
register through named descriptors rather than being inferred.

The artifact contract:

```ts
interface PromptArtifact {
  surface: "extraction" | "review";
  version: string; // artifact version, not package version
  match?: { provider?: ProviderName; modelPrefix?: string; };
  instructions: string; // the system-prompt body
  demos: PromptDemo[]; // rendered inline into the system prompt
  provenance?: {
    optimizer?: string; // e.g. "dspy/MIPROv2", plus dspy version
    proposerModel?: string; // model DSPy used to propose instructions
    scoredAgainst?: string; // target model id
    suiteVersion?: string;
    score?: number;
    date?: string; // ISO date of the accepting eval run
  };
}

interface PromptDemo {
  transcriptExcerpt: string;
  extraction: string; // canonical JSON of the expected tool-call payload
}
```

The scorer's contract (also the JSON printed by
`barwise prompt score`):

```ts
interface CaseScore {
  caseId: string;
  rubricPassed: number; // checks passed
  rubricTotal: number;
  conformanceCorrections: number;
  validationErrors: number;
  score: number; // rubricPassed/rubricTotal - penalties, floor 0
}
```

## Alternatives considered

- **A TypeScript reimplementation of the DSPy technique.** Rejected
  by the requester, and rightly: the optimizers are the moving
  frontier, a port freezes one algorithm and inherits chase-work, and
  the port itself duplicates effort the framework has already spent.
  Barwise's contribution is the metric and the artifact seam; the
  search belongs to the tool built for it.
- **DSPy in the runtime path** (Python service or subprocess at
  extraction time). Rejected: the runtime lanes (CLI, MCP, VS Code)
  are TypeScript, and `ARCHITECTURE.md` 4.2.2 keeps LLM integration a
  swappable boundary. Optimization is a dev-time activity; its
  toolchain must not become an install-time requirement.
- **DSPy metric implemented natively in Python.** Rejected:
  re-implementing parse, conformance, and rubric checks in Python
  forks the ground truth -- the optimizer would chase a score
  production does not compute. The subprocess call per candidate is
  the cost of a single source of truth, and it is small relative to
  the LLM call the candidate already made.
- **LLM-as-judge scoring.** Rejected above: the score must not move
  when a judge's model moves. Deterministic checks are the project's
  standing answer (`modeling-gym.spec.md`).
- **Harness inside `@barwise/llm`.** One less package, and the
  artifact seam has to be there anyway. Rejected on orthogonality:
  `llm` constructs prompts and calls providers; scoring prompts is a
  meta-concern with its own vocabulary (eval case, suite, score
  history) and its own content directory. The gym set the precedent:
  the evaluator lives one package out from what it evaluates.
- **Harness inside `@barwise/learn`.** The check vocabulary lives
  there, which tempts. Rejected: `learn` grades humans and depends
  only on `core`; a prompt harness must call `processTranscript`,
  which would add an `llm` dependency to a pedagogy package and tangle
  two audiences in one place.
- **Extend `barwise import batch` instead of a new command.** Batch
  already fans out transcripts x models
  (`commands/import/batch.ts:119-127`) but its concern is bulk import,
  and its output is element counts. Scoring belongs to the harness;
  batch stays as-is. The eval runner borrows its sweep shape, not its
  code path.
- **Reference-model diffing as the metric.** Rejected for the same
  reason the gym rejected it: many valid ORM forms, and `diffModels`
  flags cosmetic variation as error. The rubric vocabulary exists
  precisely to compare meaning.

## Workstreams (each independently shippable)

### 1. Artifact seam in `@barwise/llm`

Extract the extraction system prompt into
`prompts/extraction.default.prompt.yaml`, add the `PromptArtifact`
types, loader, and resolver, and thread an optional artifact through
`buildSystemPrompt` and `processTranscript`. Behavior-preserving by
construction: a golden test asserts the default artifact renders byte-
identically to the current `buildSystemPrompt` output (including the
`includeAlternatives` suffix). Smallest blast radius: no consumer
changes, no new package. The existing `ExtractionPrompt.test.ts`
content assertions keep passing untouched.

### 2. `@barwise/promptlab`: eval cases, scorer, runner, CLI

The new package with `EvalCase` loading, `scoreExtraction` (parse
through `DraftModelParser`, then `enforceConformance`, then the
GymReport fold plus penalties), `runSuite` with repeat support, the
history writer, and a seed suite of 4-6 cases. First case ports the
existing `order-management` fixture transcript; the rest are authored
against the nine scorecard dimensions so the manual eval's coverage
survives into the automated one. CLI gains `barwise prompt eval`,
`prompt score`, `prompt schema`, and `prompt history`; `score` and
`schema` exist for the Python lane but are ordinary commands anyone
can call. Depends on workstream 1's artifact resolution. Live LLM
calls happen only when the user runs `eval` with keys configured; the
package's CI tests use mock `LlmClient`s with canned responses, per
`llm` convention.

### 3. `optimizer/`: the DSPy project (implemented 2026-08-23)

> **Grounded, and two of the three notes below changed the design.**
> DSPy renders its own field protocol around the instructions, so the
> compiled program's score is a search signal and never the accepted
> number. And demos do not fit naively: the system prompt is ~4,540
> tokens against demo payloads of 1,103-3,851 (mean 1,984), so
> `BootstrapFewShot`'s 4-16 default is a 3x to 8x prompt paid on every
> call -- the exporter budgets and truncates, and the compile step caps
> demos at 2. Full spec: `docs/specs/dspy-optimizer.spec.md`.

The Python project: the extraction signature constrained by
`barwise prompt schema` output, the metric shelling to
`barwise prompt score`, optimizer configuration with an explicit LLM
call budget, and the exporter writing a candidate `.prompt.yaml` plus
a delta report. uv-managed, pinned dspy version, outside the npm
workspace; CI does not execute it. Grounding notes before building:
confirm DSPy's adapter can emit JSON against the exported schema for
each target provider (Anthropic tool-use vs. OpenAI json_schema), and
confirm exported demos fit provider token budgets (the extraction
system prompt is already 161 lines; demos with full JSON payloads may
need excerpt-truncation rules in the exporter).

### 4. Per-provider variants in the wild (provisional: not yet grounded)

Run the optimizer against the provider/model pairs in active use
(at minimum one Anthropic and one OpenAI-compatible target), gate each
candidate through `barwise prompt eval`, and commit the accepted
variants with provenance metadata. This workstream is content plus
process, not code; it proves the resolver's fallback story, exercises
the export-then-gate loop end to end, and populates the score history
with a baseline.

### 5. Review-surface evals (provisional: not yet grounded)

Seeded-defect eval cases for `reviewModel`: fixture models with
planted defects per review category, metric = recall of planted
defects. Wires the artifact seam (already designed for both surfaces)
into `buildReviewSystemPrompt` and adds a review program to
`optimizer/`. Deferred until the extraction harness proves the shape.

### 6. Agent-output evals for the `.claude/` subagents (provisional: not yet grounded)

Measure-first, optimize-never: a runner that headlessly drives
`barwise-transcript-extractor` (Claude Agent SDK or `claude -p`
against the barwise MCP server) over the suite transcripts, scores
each resulting model through the same `barwise prompt score` path,
and appends to the same history file. This gives the agentic surface
the regression signal across Claude releases that workstream 2 gives
the API surfaces, and it answers a question the extraction evals
cannot: whether the multi-turn validate-and-revise path beats
single-shot `processTranscript` on the same cases. No DSPy
involvement; the agent and skill texts stay hand-authored, and a
skill only becomes an optimization candidate if this history shows it
bleeding score across model releases. Grounding notes before
building: confirm a headless runner can drive the MCP tools
noninteractively, and bound per-run session cost.

## API and migration impact

- `@barwise/llm`: `processTranscript` gains an optional
  `artifact` option; default behavior is byte-identical, so the three
  existing callers (CLI, MCP, VS Code) need no changes. New public
  exports: artifact types, `loadArtifact`, `resolveArtifact`.
- New package `@barwise/promptlab` (depends on `core`, `llm`,
  `learn`); the dependency graph stays one-way. `@barwise/cli` adds
  the dependency and the `prompt` command.
- `optimizer/` sits outside the npm workspace and the Turborepo
  graph; no package.json anywhere references it. Its only contract
  with the monorepo is the CLI it shells to and the artifact files it
  writes.
- `@barwise/mcp` and `barwise-vscode`: no changes in this spec. An
  MCP `prompt_eval` tool is a possible follow-up once the CLI surface
  settles; adding it would bump `SERVER_VERSION`.
- `CLAUDE.md` dependency graph and the package list gain `promptlab`;
  the optimizer lane is documented as offline tooling.

## Decisions (resolved 2026-08-08: single-maintainer mode)

The project has one user, who is also the maintainer and reviewer.
The decisions below are resolved for that operating mode; the ones
marked with an asterisk trade away protections that only matter with
multiple users, and should be reopened if the project gains any.

- **Package name (resolved: `@barwise/promptlab`).** "Gym" is taken
  by a learner-facing capability, and folding into `llm` loses the
  orthogonality argued above.
- **Where the Python project lives (resolved: in-tree, top-level
  `optimizer/`).** It is a lane, not a package; top level keeps it
  visibly outside the workspace. In-tree keeps artifact schema, eval
  suite, scorer semantics, and optimizer versioned together -- any
  git SHA is self-consistent, and no cross-repo compatibility matrix
  exists to maintain. Extract to its own repository only if a second
  project ever consumes it; the coupling is one CLI call and two file
  formats, so extraction stays cheap.
- **First optimizer to wire (resolved: MIPROv2).** Instruction + demo
  search, well-documented, bounded budget. GEPA and BootstrapFewShot
  remain one-line swaps in `compile.py`; the exporter is
  optimizer-agnostic.
- **Rollout policy (resolved: gate-then-commit, no PR ceremony).***
  A candidate that passes the `barwise prompt eval` acceptance gate
  is committed directly with its delta report; the maintainer
  reviewing their own PR adds process without protection. The gate
  and the committed history are the governance. With multiple users,
  return to reviewed-PR-only.
- **Where "periodically" runs (resolved: locally, on model
  releases).*** The trigger is a model release, not a calendar date.
  The maintainer runs `barwise prompt eval` with local keys and
  commits the history row; no CI workflow, no CI key management. A
  scheduled agent session re-running the eval and reporting drift is
  a compatible later convenience, since the keys and the machine are
  the maintainer's own.
- **Score weights (resolved: 0.02 per conformance correction, 0.10
  per residual validation error, floor 0).** Declared in the suite
  file, not hardcoded, so reweighting is a data change recorded in
  history.

## Risks and testing

- **Risk: the default-artifact refactor silently changes the prompt.**
  Guard: the byte-identity golden test in workstream 1, plus the
  existing `ExtractionPrompt.test.ts` substring assertions.
- **Risk: DSPy's rendering and the TypeScript rendering diverge.**
  The prompt DSPy scored during compilation is assembled by DSPy's
  adapters; the prompt production sends is assembled by
  `buildSystemPrompt` from the exported artifact. The two are close
  but not identical, so a compiled score can overstate the shipped
  score. Guard: the acceptance gate -- a candidate's recorded score
  comes only from `barwise prompt eval` on the exported artifact, run
  through the production path; the DSPy-internal score is never
  written to provenance.
- **Risk: rubric checks overfit to one phrasing.**
  `requires_verbalization` compares whitespace-normalized FORML
  strings; an optimizer chasing that check could bias extraction
  toward the reference's naming. Mitigation: author rubrics leaning on
  `must_validate`, `forbids_population`, and `requires_element`
  (name-robust via the population mapping and query), and use
  `requires_verbalization` sparingly, as the gym spec already advises.
- **Risk: overfitting to the suite itself.** An optimizer can win the
  cases it trained on. Mitigation: split the suite (compile on a
  train subset, gate on the held-out subset) once the suite is large
  enough; until then, the delta report flags that train and gate sets
  overlap.
- **Risk: sampling noise masquerades as improvement.** A one-run delta
  on a non-deterministic model is weak evidence. Mitigation: the
  `repeat` option, worst-case reporting, and the delta report stating
  N; the acceptance gate compares means over the same N.
- **Risk: optimization cost.** Each compile iteration is
  (candidates x cases) LLM calls plus a subprocess per score.
  Mitigation: the explicit call budget in `compile.py`, and Ollama as
  the zero-cost local target for developing the loop.
- **Testing:** promptlab unit tests run entirely on mock `LlmClient`s
  and canned extraction payloads (scorer determinism: same payload +
  case gives a byte-identical `CaseScore`); loader round-trip tests
  for `.prompt.yaml` and `.eval.yaml`; a resolver test matrix (variant
  present, absent, modelPrefix match); CLI command tests calling the
  action directly, per house convention. The optimizer lane is
  exercised manually (it exists to spend tokens); its exporter output
  is validated by the same artifact loader tests. Live runs stay
  manual, per the existing `tests/live/` policy -- which this harness
  finally implements.

## Implementation notes

### Workstream 1 (2026-08-08)

Grounding forced three deviations from the brief; the mechanism is
otherwise as specified, and the golden byte-identity guard holds.

- **The default artifact lives in code, not in
  `prompts/extraction.default.prompt.yaml`.** `@barwise/llm` publishes
  only `dist/` and is bundled into the VS Code extension by esbuild, so
  the default prompt cannot depend on loading a YAML file at runtime.
  `defaultExtractionArtifact` is exported from
  `src/prompt/systemPrompt.ts` with the historical text; `.prompt.yaml`
  files are the format for _variants_, loaded explicitly via
  `loadArtifact`/`loadArtifactsFromDir`. The `packages/llm/prompts/`
  directory appears when workstream 4 lands the first variant.
- **`match.provider` is a string, not `ProviderName`.** The VS Code
  Copilot client lives outside the factory union; typing the match to
  `ProviderName` would make a Copilot variant undeclarable.
- **Resolution is pure.** `resolveArtifact(artifacts, query)` takes an
  explicit artifact list (no ambient directory scanning inside
  resolution); the most specific applicable variant wins (a modelPrefix
  match outweighs a provider match) and an equal-specificity tie throws
  an authoring error rather than picking silently.
- Demos render inline as a `## Worked Examples` section appended to the
  instructions (before the alternatives section); an empty demo list
  renders nothing, which is what keeps the default byte-stable. The
  golden files live in `packages/llm/tests/fixtures/prompts/` and were
  generated from the build preceding the refactor.

### Workstream 2 (2026-08-08)

As specified, with three grounded refinements:

- **The seed references are generated, not hand-authored.** Each
  `*.reference.orm.yaml` was produced by running the corresponding
  recorded extraction payload (from `packages/llm/tests/fixtures/`)
  through `parseExtractionFromJson` and serializing, so the references
  cannot drift from what the pipeline builds. The recorded payloads
  double as the suite's answer keys: each passes its full rubric, with
  exact scores pinned in `tests/scoreExtraction.test.ts` (0.98 / 0.96 /
  0.96 / 0.94 -- below 1.0 only by the conformance penalty, which is
  the scorer working as designed).
- **Rubrics reuse the gym wholesale.** An eval case's `checks` are
  literal `GymCheck` values; the scorer adapts the case to the
  exercise shape and calls `evaluateCandidate`, so the four check
  runners are shared, not copied. One authoring limit surfaced: the
  counterexample generator could not derive a forbidden population for
  the mandatory constraint on employee-hierarchy's subtype-heavy
  works-in fact type, so that rubric uses the department-name
  uniqueness instead.
- **`prompt score` throws on an unparseable payload** (exit 1); the
  suite runner and the DSPy metric treat that as a zero-scored run.
  Suite manifests declare weights and the case list explicitly -- no
  directory discovery.

### Workstream 4, first slice (2026-08-08)

First variant landed: `packages/llm/prompts/extraction.sonnet5.prompt.yaml`
(`sonnet5-1`, match: anthropic + `claude-sonnet-5`), produced by manual
failure analysis rather than DSPy (workstream 3 remains open). Full delta
report: `docs/prompt-eval-sonnet5-2026-08-08.md`. Grounding notes:

- **The session had no API keys**, so completions came from Claude Code
  subagents pinned to the target models over the byte-exact rendered
  prompts, scored through the normal `scoreExtraction` path. That
  channel is fine for within-session comparison but is not the
  production tool-use path, so no rows were appended to
  `evals/history.jsonl`; the acceptance gate stays a keyed
  `barwise prompt eval` run (commands in the delta report).
- **The eval-vs-prompt consistency risk is real and bit immediately**:
  the order-management answer key predated the prompt's ternary
  order-line rule, so the rubric punished prompt-compliant extractions
  (witness mapping fails across a binary/ternary arity difference).
  Fixed by updating the promptlab answer key to the ternary and
  regenerating the reference; pinned scores were unchanged. When
  authoring or editing prompts, re-check that each case's answer key is
  something the current prompt would actually produce.

### Workstream 6, first data point (2026-08-09)

First agent-output measurement, same keyless session channel as the
workstream 4 slice: `docs/agent-eval-2026-08-09.md`, with a companion
audit of the skills and subagents (`docs/skill-audit-2026-08-09.md`).
Grounding notes:

- **The MCP server never registered outside the maintainer's machine**
  (`.mcp.json` pinned a machine-specific `cwd` and pointed at the
  esbuild bundle that `npm run build` does not produce), so the
  subagents ran without their tools and hand-authored models instead.
  Fixed in the same PR; the true `import_transcript` + validate loop
  remains unmeasured until a keyed session runs it.
- **The revise step is where the agentic surface earns its keep**: one
  hand-authored model scored 0.000 on a missed schema conditional and
  went to 1.000 after a single revise cycle against real validator
  output -- but the extractor agent's instructions never tell it to
  revise (audit finding F2, diff proposed).
- **The suite is saturating at the top**: agent hand-authoring matched
  the tuned sonnet5-1 variant at 1.000 across the board. Harder cases
  are the prerequisite for further conclusions at this end of the
  scale.
- **Eval hygiene**: the graded references are browsable by the agent
  under measurement; one run had to be discarded for consulting them.
  The eventual headless runner should isolate `evals/` from the
  agent's view.

## Non-goals

- **No new modeling capability and no core change.** The harness
  composes `processTranscript`, `evaluateCandidate`,
  `enforceConformance`, and validation as a consumer.
- **Not an agent-prompt optimizer.** The guidance texts, MCP prompts,
  chat participant, and `.claude/` skills stay hand-authored. The
  subagents get measured (workstream 6), never machine-rewritten.
- **Not a model picker.** The harness scores (prompt, model) pairs; it
  does not recommend models or manage the scattered model-ID defaults
  (`anthropic.ts:39`, `vscode/package.json`, tool descriptions). That
  cleanup is real but separate; file it as its own finding.
- **Not continuous deployment of prompts.** Artifacts change only by
  a commit that passed the eval gate; nothing rewrites a live prompt.
