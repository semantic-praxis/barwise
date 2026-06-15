# Implicit Sensemaking in Barwise

Status: draft
Owner: design conversation (sensemaking initiative)
Tracking: no REPO_REVIEW finding; originates from the sensemaking
design thread. File bd issues per workstream when this lands.

## Principle / Problem

Barwise is already a latent sensemaking engine, but the discipline is
not surfaced. ORM 2's method -- fact-based verbalization checked against
sample populations -- is Gary Klein's data-frame expectancy loop in
disguise: it exists to close the gap between the modeler's frame and the
domain. Yet a modeler (human or agent) driving barwise gets the
primitives without the loop. The LLM tools hand back a single
unquestioned model; verbalization reads the model back but never asks
the modeler to confirm what the model _rules out_; nothing nudges the
modeler to hold a rival framing or to premortem a model before declaring
it done.

This touches two pillars. **Determinism in core**: the deterministic
half of sensemaking (generating the population a constraint forbids,
comparing rival models) belongs in `core`; the non-deterministic half
(constructing rival frames, abductive critique) belongs one layer out in
`llm`/`mcp`. **Composability**: the strongest version rides surfaces
barwise already has -- verbalization output, the shared guidance module,
the existing `diff` -- rather than adding a parallel paradigm.

This spec covers the first two of four initiatives, with the latter two
drafted provisionally for ordering:

1. Embed the data-frame loop into the MCP prompts and the two barwise
   agents (guidance only; no core change).
2. Add deterministic counterexample probes in `core` -- for each
   constraint, the minimal population it forbids -- surfaced alongside
   verbalization through CLI, MCP, and VS Code.
3. (Later) Multi-candidate framing in the `llm` importers, compared via
   the existing `diff`.
4. (Later) An anchors view and a reasoning-trail artifact.

## Should we surface counterexamples through verbalization or validation? (resolved: verbalization)

Verbalization, not validation. A counterexample is an expectancy probe
-- "this constraint rules out the following; confirm that is truly
impossible" -- not an error. Validation only emits a diagnostic when a
constraint is _violated_; a satisfied constraint produces nothing to
attach a probe to. Routing probes through the validation channel would
both find no anchor to hang on and conflate "the model is malformed"
with "confirm your intent." Verbalization already produces one
structured reading per constraint (`ConstraintVerbalizer.verbalize`),
which is exactly where a per-constraint counterexample belongs.

## Scope

In scope:

- A deterministic counterexample generator in `core` for
  intra-fact-type constraints, reusing `FactInstance`/`Population` and
  the population-validation tuple machinery.
- Opt-in surfacing through `verbalize_model` (MCP), `barwise verbalize`
  (CLI), and the VS Code hover.
- A `SENSEMAKING_GUIDANCE` block in the shared guidance module, wired
  into the `analyze-domain` and `review-model` prompts, plus updates to
  the `barwise-model-reviewer` and `barwise-transcript-extractor` agent
  definitions.

Out of scope (this spec):

- Counterexamples for cross-fact-type constraints (mandatory,
  disjunctive mandatory, exclusion, exclusive-or, subset, equality,
  external uniqueness). Drafted as WS4, provisional.
- Multi-candidate framing (#3) and the anchors/reasoning-trail artifact
  (#4). Drafted as WS5/WS6, provisional.
- Any change to validation semantics or to the `.orm.yaml` format.
- LLM-generated counterexamples. Generation stays deterministic in core.

## Inventory

| Area                                                  | Change                                                  | WS | Verdict                                      |
| ----------------------------------------------------- | ------------------------------------------------------- | -- | -------------------------------------------- |
| `mcp/src/prompts/guidance/guidance.ts`                | Add `SENSEMAKING_GUIDANCE` constant                     | 1  | Additive; single source of truth             |
| `mcp/src/prompts/analyzeDomain.ts`, `reviewModel.ts`  | Compose in the new guidance                             | 1  | Additive                                     |
| `.claude/agents/barwise-model-reviewer.md`            | Add a premortem/expectancy step                         | 1  | Guidance only                                |
| `.claude/agents/barwise-transcript-extractor.md`      | Record anchors; surface ambiguities as rival framings   | 1  | Guidance only                                |
| `core/src/counterexample/` (new module)               | `Counterexample` type + generator (intra-fact-type)     | 2  | New, additive public API                     |
| `core/src/validation/rules/populationValidation.ts`   | Extract `makeCompositeKey` to a shared helper for reuse | 2  | Refactor; behavior-preserving                |
| `core/src/index.ts`                                   | Export the new API                                      | 2  | Additive                                     |
| `mcp/src/tools/verbalize.ts`                          | Add `counterexamples?: boolean` (default false)         | 3  | Additive, opt-in                             |
| `cli/src/commands/verbalize.ts` + `helpers/format.ts` | Add `--counterexamples`; append under each constraint   | 3  | Additive, opt-in                             |
| `vscode/src/server/HoverProvider.ts`                  | Add a "Rules out" section to the hover                  | 3  | Additive                                     |
| `core/src/counterexample/` (cross-fact-type)          | Extend generator to spanning constraints                | 4  | Provisional: shares the cross-population gap |

## Target architecture

```
core/src/counterexample/                 # new, deterministic, pure
  Counterexample.ts        # type carrying the forbidden population + reading
  CounterexampleGenerator.ts # generate(model) / generateForConstraint(...)
  values.ts                # deterministic placeholder-value minting

# Counterexample reuses existing primitives -- no enum widening:
interface Counterexample {
  readonly constraintId: string;
  readonly factTypeId: string;
  readonly forbidden: Population;            # minimal population the constraint forbids
  readonly segments: readonly VerbalizationSegment[];  # reuses verbalization segments
  readonly text: string;                     # flattened reading
}

# Generator is the inverse of populationValidation: for every
# Counterexample it emits, feeding `forbidden` back through
# populationValidation MUST report a violation of `constraintId`.
generate(model: OrmModel): Counterexample[]
generateForConstraint(c: Constraint, ft: FactType, model: OrmModel): Counterexample | undefined

# Surfacing (opt-in, default off), riding existing verbalization plumbing:
#   MCP    verbalize_model(..., counterexamples=true)
#   CLI    barwise verbalize <file> --counterexamples
#   VSCode hover -> "Rules out:" subsection

# #1 guidance, single source of truth:
mcp/src/prompts/guidance/guidance.ts
  SENSEMAKING_GUIDANCE   # data-frame loop adapted to ORM, propagates to
                         # MCP prompts, barwise-modeling skill, Copilot chat
```

## Alternatives considered

- **Counterexamples on the validation `Diagnostic` channel.** Rejected
  (frame-breaking): a satisfied constraint emits no diagnostic, so there
  is nothing to attach the probe to, and it conflates malformed-model
  with confirm-intent. This was the obvious first instinct (and the one
  an agent reached for, complete with an error marker); grounding the
  validation behavior against the code broke it.
- **A standalone `probe_model` tool / `barwise probe` command.** More
  explicit as a named surface, but it duplicates the verbalization
  traversal and is less "implicit." Resolution: keep generation an
  explicit, named core capability, but surface it _through_ verbalize
  (opt-in), so it is available everywhere verbalization already is
  without a parallel surface.
- **Widen `Verbalization.category` with `"counterexample"`.** Rejected:
  widening the union forces a new case on every exhaustive consumer of
  the category. The standalone `Counterexample` type reuses
  `VerbalizationSegment` for hyperlinking without touching the enum.
- **A dedicated `sensemaking` MCP prompt.** Deferred: folding
  `SENSEMAKING_GUIDANCE` into the existing prompts reuses the single
  source of truth and reaches the skill and Copilot channels for free. A
  dedicated prompt can come later if the loop needs its own entry point.

## Workstreams

Ordered smallest-blast-radius first; each keeps the full suite green as
its own PR.

- [ ] **WS1 -- Sensemaking guidance (#1).** Add `SENSEMAKING_GUIDANCE`
      to `guidance.ts`; compose it into `analyze-domain` and
      `review-model`; update the two agent definitions
      (`barwise-model-reviewer` gains a premortem/expectancy step;
      `barwise-transcript-extractor` records identification-scheme
      anchors and frames `import_transcript` ambiguities as rival
      framings to resolve). No core change. Expectancy guidance uses
      `verbalize_model`, which exists today; the counterexample mention
      is added in WS3 once the flag lands.
- [ ] **WS2 -- Counterexample generator, intra-fact-type (#2 core).**
      New `core/src/counterexample/` module generating the minimal
      forbidden `Population` for internal uniqueness, value, frequency,
      and ring constraints. Extract `makeCompositeKey` from
      `populationValidation.ts` into a shared helper and reuse it.
      Deterministic value minting (no RNG, no clock). Export through
      `index.ts`. Unit tests via `ModelBuilder`, including the
      round-trip: every generated `forbidden` population must fail
      `populationValidation` on exactly its constraint.
- [ ] **WS3 -- Surface counterexamples (#2 surfacing).** Add
      `counterexamples` to `verbalize_model`, `--counterexamples` to the
      CLI, and a "Rules out" hover subsection; all opt-in, default off.
      Append the counterexample reference to `SENSEMAKING_GUIDANCE`.
      Surfacing degrades gracefully where no generator exists yet
      (cross-fact-type constraints simply produce no probe).
      _(provisional: not yet grounded -- confirm the CLI/hover insertion
      points hold before building.)_
- [ ] **WS4 -- Cross-fact-type counterexamples (#2b).** Extend the
      generator to mandatory, disjunctive mandatory, exclusion,
      exclusive-or, subset, equality, and external uniqueness. _(provisional:
      not yet grounded -- these need the cross-population representation
      that `populationValidation` itself does not yet implement; ground
      that gap before scoping.)_
- [ ] **WS5 -- Multi-candidate framing (#3).** The `llm` importers
      return two or three candidate models at genuine modeling forks,
      compared via the existing `diffModels`. _(provisional: not yet
      grounded.)_
- [ ] **WS6 -- Anchors view and reasoning trail (#4).** A `core` anchors
      query (identification schemes, preferred identifiers) and a
      reasoning-trail artifact served as an MCP resource. _(provisional:
      not yet grounded.)_

## API and migration impact

All changes are additive and non-breaking.

- `core` gains a new `counterexample` module and exports; no existing
  signature changes. The `makeCompositeKey` extraction is internal and
  behavior-preserving (covered by existing population-validation tests).
- `verbalize_model` and `barwise verbalize` gain an optional, default-off
  parameter; existing callers are unaffected. No MCP `SERVER_VERSION`
  bump is required to add an optional tool parameter; releasing remains a
  separate, intentional act.
- The VS Code hover gains an optional subsection.
- WS1 changes are documentation/guidance and carry no code blast radius,
  but they edit the single-source-of-truth guidance module, so the
  barwise-modeling skill and the Copilot chat participant inherit the
  sensemaking block automatically -- verify their rendering does not
  overflow context budgets.

## Open decisions

- **Counterexample representation.** _Recommend_ a standalone
  `Counterexample` type reusing `VerbalizationSegment`, over widening
  `Verbalization.category`. Trade-off: the standalone type leaves every
  exhaustive category consumer untouched; widening the enum is tidier but
  forces a new case across verbalization consumers.
- **Module placement.** _Recommend_ a new `core/src/counterexample/`
  module over folding into `verbalization/`, to keep the generator
  orthogonal (it depends on the model and a shared tuple helper, not on
  the verbalizer).
- **Surfacing default.** _Recommend_ opt-in, default-off on every
  surface (explicit over implicit; avoids flooding verbalize and hover),
  over on-by-default in the hover.
- **MCP surface.** _Recommend_ extending `verbalize_model` with a
  `counterexamples` parameter over a new `probe_model` tool
  (composability; rides the existing surface).
- **#1 packaging.** _Recommend_ folding `SENSEMAKING_GUIDANCE` into the
  existing prompts and guidance module over a dedicated `sensemaking`
  prompt, to reuse the single source of truth.

## Risks and testing

- **Determinism (core pillar).** Placeholder value minting must be a pure
  function of role/object identity -- stable tokens (e.g. `Customer#1`,
  `Customer#2`), never `randomUUID`, RNG, or a clock. Test: `generate`
  is referentially transparent (same model in, identical output out).
- **Correctness via round-trip.** The generator is the inverse of the
  validator, so the strongest test is the round-trip: for every
  `Counterexample`, `populationValidation(forbidden)` must report a
  violation of exactly `constraintId`. This expectancy doubles as the
  coverage guarantee per constraint type.
- **Over-promising coverage.** WS2/WS3 cover only intra-fact-type
  constraints; surfacing must degrade silently for constraints with no
  generator yet, and guidance must not claim "every constraint."
- **Output noise.** Default-off opt-in everywhere; the hover shows probes
  on demand only.
- **No emoji** in any surfaced output (project-wide rule). The
  counterexample marker is a word ("Rules out:"), not a symbol.
- **Guidance context budget.** `SENSEMAKING_GUIDANCE` rides
  context-hygiene-sensitive channels; keep it tight and reference the
  counterexample capability rather than restating the theory.

## Non-goals

- Changing validation semantics or the `.orm.yaml` format.
- Persisting generated counterexamples into the model file as
  populations.
- LLM-based counterexample generation.
- Implementing #3 or #4 in this spec.
