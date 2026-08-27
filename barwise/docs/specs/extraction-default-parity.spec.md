# Re-home the default prompts to YAML, then bring the extraction default up to the rules its variants carry

Status: Implemented
Created: 2026-08-26
Last-updated: 2026-08-26
Tracking: barwise-863; `docs/logic-duplication-audit-2026-08-26.md`
finding B1. Sibling of `docs/specs/duplication-drift-guards.spec.md`
(whose scope excluded class-B reconciliations because each changes
behavior and needs its own review -- this is that review for B1).

## Principle

One decision, one owner. The ORM extraction instructions exist in four
copies: the hand-maintained TS literal `EXTRACTION_INSTRUCTIONS`
(`packages/llm/src/prompt/systemPrompt.ts:10-160`, the default
artifact, v1.0.0), the two YAML variants
(`packages/llm/prompts/extraction.{sonnet5,haiku45}.prompt.yaml`), and
the drift-tested `builtins.generated.ts` derived from the YAML. The
guarded pair (YAML to generated) has never drifted. The unguarded copy
has: the default is missing three rules the variants carry -- the
every-role instance rule, the enumerated-list-is-a-value-constraint
rule, and the frequency-siding paragraph
(`systemPrompt.ts:108` truncates where the variants continue). Since
`selectArtifact` falls back to `defaultExtractionArtifact` for any
client with no matching variant, this is the live prompt for OpenAI,
Ollama, and unmatched Anthropic models -- those runs are instructed
without rules `ExtractionConformance` enforces downstream, and the
golden test cannot see it: it pins the default against a frozen
fixture, asserting the default never _changes_, not that it _agrees_
with anything.

## Should the default become YAML-authored, be hand-synced, or be declared intentional tiering? (resolved: YAML-authored)

The mechanisms already exist; this is re-homing, not new design.
Verified against the code:

- `PromptArtifact.match` is optional and its doc comment says "Absent
  on a default artifact" -- the contract anticipates a YAML default.
- `loadArtifact` accepts a missing `match` block
  (`loadArtifact.ts:59-61`).
- `resolveArtifact` filters to `a.match !== undefined`
  (`resolveArtifact.ts:24`), so a matchless artifact in
  `builtinArtifacts` is invisible to resolution: adding the default to
  `prompts/` cannot change which variant any client gets.

So the default can live as `extraction.default.prompt.yaml` beside the
variants, flow through `regen:builtins` and the existing drift test,
and be re-exported as `defaultExtractionArtifact` -- deleting the
hand-maintained literal entirely. Editing a rule then happens where
all extraction prompts sit side by side.

Rejected alternatives:

- **Hand-sync the literal and keep it.** Cheapest today; keeps the
  fourth copy, so the next variant improvement drifts again, and the
  guard would have to be a rules-presence test whose rule list is
  itself a fifth statement.
- **Declare the divergence intentional model-tiering.** No rationale
  survives contact with the code: the conformance layer enforces the
  missing rules for every provider, so the default's silence about
  them only lowers extraction quality where no variant exists.

## Scope

In scope:

- When `regen:builtins` runs, the system shall compile the default
  extraction and review artifacts from `prompts/*.default.prompt.yaml`
  into `builtins.generated.ts` alongside the variants.
- When `defaultExtractionArtifact` or `defaultReviewArtifact` is
  imported, the system shall serve the generated artifact, with no TS
  literal copy remaining.
- When resolution runs for any (provider, model), the system shall
  return the same artifact as before the re-homing (matchless
  artifacts are invisible to `resolveArtifact` -- verified, and pinned
  by the untouched reach test).
- When workstream 1 lands, the system shall render byte-identical
  default prompts (the three golden tests pass unmodified).
- When workstream 2 lands, the default extraction artifact shall carry
  the every-role instance rule, the enumerated-list rule, and the full
  frequency-siding paragraph, at version 1.1.0, with the two
  extraction goldens updated in the same commit as the deliberate
  change marker.

Out of scope, deferred and named:

- Any change to the variants' text, to `resolveArtifact`, to
  `selectArtifact`, or to `PromptSurface`.
- A live eval of the updated default against OpenAI/Ollama models --
  the eval lane (`barwise prompt eval`) measures with a configured
  client and remains available; gating this fix on paid calls is not
  warranted for restoring rules conformance already enforces.
- The variants drifting from _each other_ -- inherent to per-model
  tuning, and the audit's prose pass covers it; see Open decisions for
  the optional shared-invariants test.

## Inventory

| Area                                               | Current state                                         | Verdict                                            |
| -------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `llm/prompts/extraction.default.prompt.yaml`       | Does not exist                                        | new (W1)                                           |
| `llm/prompts/review.default.prompt.yaml`           | Does not exist                                        | new (W1)                                           |
| `llm/src/prompt/systemPrompt.ts`                   | Holds `EXTRACTION_INSTRUCTIONS` + the default literal | modify (W1)                                        |
| `llm/src/prompt/reviewPrompt.ts`                   | Holds the review default literal                      | modify (W1)                                        |
| `llm/src/prompt/artifacts/builtins.generated.ts`   | Two variants                                          | regenerated (W1)                                   |
| `llm/tests/prompt/artifacts/builtins.test.ts`      | Pins artifact count and reach                         | modify match-block case (W1); reach case untouched |
| `llm/tests/prompt/systemPrompt.golden.test.ts`     | Pins default bytes against frozen fixture             | untouched (W1); fixture updated (W2)               |
| `llm/tests/review/reviewPrompt.golden.test.ts`     | Pins review default bytes                             | untouched                                          |
| `scripts/regen-builtin-artifacts.mjs`              | Globs `prompts/*.prompt.yaml` via the loader          | untouched                                          |
| `llm/src/TranscriptProcessor.ts`, `selectArtifact` | Consume `defaultExtractionArtifact` by name           | untouched                                          |

The reach case in `builtins.test.ts` ("a client on `claude-haiku-4-5`
gets the haiku45 variant through `processTranscript`") must pass
unmodified -- if it needs an edit, the re-homing changed resolution and
the change reached further than intended. (See Implementation notes:
the count assertion self-adjusts; the test needing a deliberate
rewrite was the match-block one.)

## Workstreams (each independently shippable)

### 1. Re-home both defaults to YAML, bytes identical

Author `extraction.default.prompt.yaml` and `review.default.prompt.yaml`
carrying today's texts verbatim (no `match` block, versions unchanged),
run `regen:builtins`, and make `systemPrompt.ts` / `reviewPrompt.ts`
re-export the generated matchless artifact for their surface, deleting
the literals. Export names and call sites do not change.

Acceptance: when the three golden tests run, they shall pass
unmodified; when `resolveArtifact` is queried for every (provider,
model) the existing tests cover, results shall be unchanged; when
`grep EXTRACTION_INSTRUCTIONS packages/llm/src` runs, it shall find
nothing.

First because it changes no bytes anywhere -- the goldens are the
proof -- and because it makes workstream 2 a YAML edit reviewed as a
prompt change rather than a TS edit reviewed as code.

### 2. Bring the extraction default up to the shared rules

Add the three missing rules to `extraction.default.prompt.yaml` using
the variants' shared sentences verbatim (they are the wording the
conformance layer and the eval references were built against), bump
the artifact version to 1.1.0, regenerate, and update the two
extraction golden fixtures -- the deliberate-change marker the
golden-without-`UPDATE_GOLDEN` design exists to force.

Acceptance: when the default renders, it shall contain the every-role
instance rule, the enumerated-list rule, and the frequency-siding
paragraph ending in the roles-siding instruction; when
`barwise prompt artifact --surface extraction --provider openai` runs,
it shall print version 1.1.0; when the variants render, their bytes
shall be unchanged.

## Open decisions (for review)

- **A shared-invariants test?** After W2 the three YAML prompts can
  still drift on rules that must hold for every extraction artifact.
  A test asserting a short list of canonical rule sentences appears in
  every artifact of the surface would pin them -- at the cost of that
  list being one more statement of the rules. Recommend deferring
  until a real cross-variant drift is observed; the audit's re-sweep
  covers it, and W1 already removes the copy that actually drifted.
- **Does the review default gain a variant-style YAML now?** W1 moves
  it for symmetry and to close the "defaults are the only non-YAML
  prompts" asymmetry the audit noted. A reviewer preferring minimal
  blast radius can drop the review half of W1; the extraction fix does
  not depend on it.

## Risks and testing

- **The goldens are the guard in both directions.** W1 must not touch
  any golden fixture; W2 must touch exactly the two extraction ones.
  A W1 diff in a fixture means the YAML transcription is not verbatim
  (watch trailing whitespace and YAML block-scalar chomping -- the
  literal's exact newlines must survive the round trip).
- **`loadArtifactsFromDir` ordering.** The generated file's artifact
  order may shift when files are added; the drift test compares by
  value (`toEqual` against `fromDisk`), so order changes are visible
  and harmless, but the count assertion must be edited deliberately.
- **W2 changes live behavior** for OpenAI/Ollama extraction runs --
  that is the point; the change is visible in `promptHash` in the call
  log (PR #347's provenance machinery) and recoverable via
  `barwise prompt artifact`.
- Full gate after each workstream: `npm run build`, `test`, `lint`,
  `fmt` from `barwise/`; `npm run regen:builtins` produces no diff on
  a clean tree.

## Non-goals

- No change to variant selection, artifact matching semantics, or the
  prompt-artifact override lanes.
- No new rules authored -- W2 only restores rules the variants already
  carry.
- No change to demos, provenance blocks, or the review artifact's
  text.

## Implementation notes (2026-08-26, both workstreams)

Grounding during implementation corrected four Inventory-level
predictions; the design held unchanged:

- **The count assertion needed no edit** -- it compares against
  `fromDisk.length`, so it self-adjusts. The Inventory's "moves from 2
  to 4" was wrong about the mechanism, right about the count.
- **A different `builtins.test.ts` case needed a deliberate rewrite**:
  "declares a match block on every variant" pinned "matchless = dead
  weight", which this design retires. It now asserts exactly one
  matchless default per surface and a match block on everything else.
- **Two review-side tests pinned the pre-YAML state**:
  `reviewPrompt.golden.test.ts`'s "ships no review artifact yet" (the
  assertion-audit "yet" tell) became "ships no review _variant_ yet",
  and `reviewModel.artifact.test.ts`'s mocked registry needed matchless
  defaults added, because both prompt modules now read their default
  from the registry at module load and throw when a surface has none.
- **The enumerated-list rule forced the Populations intro along with
  it**: the old intro cited "Status can be scheduled, completed, or
  cancelled" as an example to record _as a population_, which the new
  rule contradicts. The variants' intro rewording (byte-identical in
  both) came with the rule; the W2 golden diff is those two population
  bullets, the intro sentence, and the frequency extension -- nothing
  else.

`ALTERNATIVES_SECTION` stays a TS constant in `systemPrompt.ts`: it is
a render-time suffix applied to whichever artifact renders, not part
of any artifact, which is also why a recorded `promptHash` resolves
against two renderings per artifact.
