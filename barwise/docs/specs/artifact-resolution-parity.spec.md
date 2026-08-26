# Resolve the prompt in one place, record which one ran, and keep the candidate override in the eval lane

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-26
Last-updated: 2026-08-26
Tracking: barwise-855, item 2 -- this spec answers it differently than
it was filed, so the issue needs editing rather than implementing (item
1 has already shipped; see "What grounding corrected"). Precedent:
barwise-850. Extends `docs/specs/artifact-resolution-in-production.spec.md`
(which deferred the review surface) and
`docs/specs/llm-call-observability.spec.md` (whose `promptHash` has been
deferred twice). Sibling: `docs/specs/review-surface-evals.spec.md`.
No new bd issues filed -- `bd` is unavailable in this container.

## Principle

Orthogonality, and the invariant the 2026-08-25 unwired-capability
audit distilled from six instances of this defect class:

> Every declared capability has a consumer, and every fallback says it
> fell back.

`barwise prompt eval --artifacts <dir>` can measure a prompt that
`barwise import transcript` and `barwise review` are structurally
incapable of sending. That is one observation and three separable
faults, and only one of them is the asymmetry itself.

**Fault A, duplicated resolution.** "Which prompt gets sent" is
answered independently in four places -- `processTranscript`,
`reviewModel`, `prompt eval`, `prompt artifact` -- over two different
candidate sets, plus a fifth statement of the rule in prose in
`packages/llm/CLAUDE.md` ("Both LLM surfaces resolve their prompt the
same way"). They agree today by construction of parallel code, not by
sharing an answer. barwise-850 was this exact defect inside the CLI:
two commands, one question, two answers, and the divergence went
unnoticed for months because falling back to the default is
indistinguishable from choosing it. The remedy that closed barwise-850
was one module owning the candidate set; this spec applies the same
remedy one layer down, to the whole answer.

**Fault B, reach.** Whether `--artifacts` belongs on the production
surfaces at all. Explicit-over-implicit argues it does not -- a shipped
prompt is declared (YAML, regenerated into `builtins.generated.ts`,
committed, drift-tested, golden-tested), and a directory read at
runtime is not -- but the argument is close enough that it belongs to
the reviewer. It is carried to Open decisions with a recommendation.

**Fault C, no record.** Nothing records which prompt ran. `ExtractionRecord`
carries corrections, parser warnings, skipped constraints and built
counts, and no artifact identity; `LlmCallRecord` carries model,
tokens, latency and outcome, and no artifact identity. So fault B
cannot be settled before fault C: widening reach without
provenance would let an unreviewed prompt do real modelling work with
nothing able to say so afterwards.

## What grounding corrected (2026-08-26)

Re-verified against `7b8849b`. All eight claims in the brief hold. Four
things it did not say change the design:

- **Four resolution answers, not two.** `reviewModel.ts:407-414`
  carries a third copy of the same resolve-or-default shape, and
  `prompt artifact` (`prompt.ts:391`) carries a fourth over the wider
  candidate set. The surface-mismatch guard is duplicated verbatim in
  three files (`TranscriptProcessor.ts:108`, `reviewModel.ts:401`,
  `runSuite.ts:339`), two of them byte-identical.
- **The divergence is already observable, not latent.** `barwise
  prompt artifact` is described as printing "the prompt artifact a
  given target would actually resolve". Given `--artifacts <dir>` it
  prints one that no production path can resolve, and says nothing
  about the difference. That is a false claim in shipped help text
  today, and it is the invariant's second half ("every fallback says it
  fell back") failing in the one command whose entire job is to answer
  this question.
- **barwise-855 is half stale.** Its item 1 (`prompt schema --surface
  review`) shipped: `buildReviewResponseSchema` is exported at
  `llm/src/index.ts:103` and wired at `prompt.ts:344`. Only item 2
  remains, and item 2's second half ("no way to tell from the output
  which prompt produced it") is fault C, not fault B.
- **Two commands the call-log spec promised were never wired.**
  `llm-call-observability.spec.md`'s Inventory marks
  `cli/src/commands/{import,review,prompt}` as `modify (W2)`. Only
  `import` was: `review.ts` and `prompt.ts` build a client and never
  wrap it, so `barwise review` produces no record of any kind. An
  Inventory row that promised work and did not get re-checked -- the
  failure mode the spec convention already names.

## Can the prompt that produced an extraction be recovered without recording it? (resolved: yes, and only while the override stays out of production)

Yes, and this is what makes fault C cheap. With production
resolving over `builtinArtifacts` alone, the prompt sent by any run is
a pure function of four things a reader already has: the barwise
version, the surface, the client's provider, and the client's model.
`barwise prompt artifact --surface <s> --provider <p> --model <m>`
computes exactly that function, offline, with no API key.

So the fix is not to thread an `artifactVersion` field through
`ExtractionRecord`, a review record that does not exist, and every
record a future surface adds. It is to record one derived
fingerprint -- `hashPrompt` of the system prompt that was actually
sent -- at the seam every surface already passes through, and let the
version be recovered by rendering the shipped builtins and matching.
Define the error out of existence rather than making each record type
carry the answer.

The seam is `withCallLog`, which already sees `request.systemPrompt`
and today throws it away. One decorator covers extraction, review, the
eval sweep, batch import, and anything added later, with no call site
changing -- which is the test `llm-call-observability.spec.md` set for
itself and passed.

Two things keep this honest:

- **The hash covers the system prompt only, never the user message.**
  The system prompt is repo-authored; the transcript is client
  material, and the standing rule is that no client content enters a
  log. `hashPrompt`'s existing contract already draws this line, for a
  different reason (a per-case hash is useless as a run identifier),
  and the two reasons agree.
- **Recovery is exact only if the rendering is known.**
  `buildSystemPrompt(includeAlternatives, artifact)` emits different
  bytes under `--alternatives`, so a hash resolves against two
  renderings per artifact rather than one. That is a small search, not
  an ambiguity, and naming it is what stops a later reader treating a
  miss as corruption.

The coupling to fault B is the point: **recovery works because the
override is not reachable from production.** Widen `--artifacts` to
`import transcript` and `review` and a production hash may match no
shipped artifact at all, at which point the recorded `artifactVersion`
this design avoids becomes necessary after all. Fault B is therefore
a decision about how expensive fault C is, and it is stated as one
in Open decisions.

## Scope

In scope:

- When a caller runs extraction or review without an explicit
  artifact, the system shall select the artifact through a single
  exported function rather than through per-surface code.
- When a caller supplies an artifact whose `surface` does not match
  the call, the system shall reject it before the LLM call, through
  that same function.
- When `barwise prompt artifact` prints an artifact drawn from a
  `--artifacts` directory, the system shall state on stderr that the
  printed prompt is a candidate and is not what a production run on
  that target would send.
- When `barwise prompt artifact` prints an artifact, the system shall
  print its prompt hash alongside its version.
- When a client wrapped by `withCallLog` completes or fails a call,
  the system shall record the hash of the system prompt that was sent.
- When a call record is written, the system shall not include the user
  message, its hash, or any part of it.
- When `barwise review` or `barwise prompt eval` runs with recording
  enabled, the system shall append call records, as
  `barwise import transcript` already does.
- When `barwise llm-usage` reports, the system shall list the distinct
  prompt hashes seen per model.
- When the capability matrix in the root `CLAUDE.md` is read, it shall
  carry a row for the prompt-artifact override naming each surface's
  reach, and a sentence beneath it stating which CLI commands may take
  a candidate directory and which may not.

Out of scope, deferred and named:

- **Artifact provenance written into the model itself.** Neither
  `.orm.yaml` nor the `.trail.json` sidecar records what produced it,
  and neither is the right home: `ReasoningTrail` is derived purely
  from the model's content and has no provenance header, and
  `pipeline-observability.spec.md` already rejected hanging telemetry
  on `DraftModelResult` for the same widen-without-removing reason. A
  model that travels between people carrying its own generation
  provenance is a real want and a different design; file it against
  `docs/specs/model-history.spec.md` rather than folding it here.
- **A review-side pipeline record.** `ExtractionRecord` exists because
  conformance silently rewrites the payload; review has no such pass,
  so there is nothing for a `ReviewRecord` to say that the call record
  does not. See Open decisions.
- **Recording from MCP and VS Code.** Still deferred, on the same
  ground `llm-call-observability.spec.md` gave: the CLI is where the
  question is asked, and the decorator makes the later wiring a line.
- **Authoring any artifact**, promoting any rule, or touching
  `resolveArtifact`'s matching semantics or the `PromptArtifact`
  contract.

## Inventory

| Area                                          | Current state                                                   | Verdict       |
| --------------------------------------------- | --------------------------------------------------------------- | ------------- |
| `llm/src/prompt/artifacts/selectArtifact.ts`  | Does not exist; the one answer to "which prompt"                | new (W1)      |
| `llm/src/prompt/artifacts/resolveArtifact.ts` | Pure matcher over a candidate list                              | untouched     |
| `llm/src/prompt/systemPrompt.ts`              | Holds `defaultExtractionArtifact`                               | untouched     |
| `llm/src/review/reviewModel.ts`               | Holds `defaultReviewArtifact` + a resolve-or-default copy       | modify (W1)   |
| `llm/src/prompt/reviewPrompt.ts`              | Does not exist; receives the moved review default               | new (W1)      |
| `llm/src/TranscriptProcessor.ts`              | Third resolve-or-default copy; own guard                        | modify (W1)   |
| `promptlab/src/run/runSuite.ts`               | Duplicates the extraction guard string verbatim                 | modify (W1)   |
| `cli/src/commands/prompt.ts`                  | Two `resolveArtifact` calls over `artifactCandidates`           | modify (W1-2) |
| `cli/src/workspace/promptArtifacts.ts`        | Owns the widened candidate set; the barwise-850 remedy          | untouched     |
| `promptlab/src/provenance/promptHash.ts`      | `hashPrompt`, in the package that cannot be imported from `llm` | move (W2)     |
| `llm/src/observe/callLog.ts`                  | Sees `request.systemPrompt`; discards it                        | modify (W2)   |
| `llm/src/observe/extractionLog.ts`            | No artifact identity, deliberately after W2                     | untouched     |
| `cli/src/commands/review.ts`                  | Builds a client; never wraps it                                 | modify (W2)   |
| `cli/src/commands/llmUsage.ts`                | Groups by `modelUsed`, falling back to `model`                  | modify (W2)   |
| `llm/prompts/*.prompt.yaml`, regen + drift    | The promotion path; unchanged whichever way B goes              | untouched     |
| `CLAUDE.md` capability matrix                 | No row for the artifact override                                | modify (W3)   |
| `mcp/src/workspace/lineageIo.ts`              | An unrelated `resolveArtifact` (lineage, not prompts)           | untouched     |

`extractionLog.ts` is untouched on purpose, and it is the row most
worth disputing. Adding `artifactVersion` there is the obvious fix for
fault C and it is the wrong one: it records the authored string
that `promptHash` exists because it cannot be trusted, it covers
extraction only, and it makes every future record type re-answer a
question the call seam already answers for all of them.

## Target architecture

```
@barwise/llm
  prompt/
    systemPrompt.ts    defaultExtractionArtifact
    reviewPrompt.ts    defaultReviewArtifact   <- moved out of review/,
                                                  so artifacts/ can import
                                                  both defaults without a cycle
    promptHash.ts      hashPrompt              <- moved from promptlab
    artifacts/
      resolveArtifact.ts   unchanged: match a query against a candidate list
      selectArtifact.ts    NEW: the whole answer, not just the match
        selectArtifact(surface, identity, override?) -> PromptArtifact
          override?.surface !== surface -> throw (the one guard)
          override
            ?? resolveArtifact(builtinArtifacts, {surface, ...identity})
            ?? DEFAULT_FOR[surface]

  TranscriptProcessor  artifact = selectArtifact("extraction", client, opts?.artifact)
  review/reviewModel   artifact = selectArtifact("review",     client, opts?.artifact)

  observe/callLog.ts   withCallLog now emits promptHash: hashPrompt(request.systemPrompt)
                       -- system prompt only; the user message is never hashed

@barwise/promptlab
  provenance/promptHash.ts   re-exports hashPrompt from @barwise/llm
                             (public API and history semantics unchanged)
  run/runSuite.ts            uses the exported guard; still receives a
                             resolved artifact from its caller

@barwise/cli
  workspace/promptArtifacts.ts   artifactCandidates(dir) -- unchanged, and
                                 deliberately NOT what selectArtifact reads
  commands/prompt.ts             artifact: prints version@hash, and says
                                 "candidate, not what production sends"
                                 whenever the answer came from --artifacts
  commands/review.ts             wraps its client, like import already does
```

The naming is deliberate. `resolveArtifact` matches a query against a
list a caller supplies; `selectArtifact` answers the whole question,
including which list and which default. Keeping both names is what lets
`prompt eval` and `prompt artifact` go on asking the wider question --
over `artifactCandidates` -- while production asks the narrow one, and
lets a reader tell from the call site which question was asked.

## Alternatives considered

- **Leave the three resolve-or-default copies alone.** DRY is the
  secondary principle and four lines repeated twice is not obviously
  worth an abstraction. Rejected on change amplification, not on
  duplication: the surface-to-default mapping is currently spread
  across three files plus a sentence of prose, so adding a third
  surface -- which `PromptSurface` is shaped to allow and the harness
  spec's workstream 6 anticipates -- means editing all four and
  hoping. `selectArtifact` is not a wrapper that renames parameters;
  it hides the candidate set, the surface-to-default table, and the
  guard, and removes them from what a caller has to know.
- **Put `artifactVersion` on `ExtractionRecord` and on a new review
  record.** The direct reading of fault C. Rejected: it records the
  hand-maintained string `promptHash` exists to distrust, it needs a
  new record type per surface forever, and it is strictly less
  informative than the hash on a record every surface already writes.
- **Hash inside `processTranscript` and `reviewModel` instead of at the
  client.** Rejected for the reason `llm-call-observability.spec.md`
  gave for the call record itself: three call sites today, four
  tomorrow, each needing the same code. The decorator is the seam, and
  it already holds the bytes.
- **Duplicate `hashPrompt` into `llm` rather than move it.** Rejected;
  the dependency runs `promptlab -> llm`, so a copy would drift and the
  score history would silently stop being comparable to the call log.
  The re-export costs one line and keeps promptlab's public API.
- **Fold `artifactCandidates` into `selectArtifact` so production and
  the eval lane share one candidate set.** This is fault B decided by
  code shape rather than by argument. Rejected as a design move; it is
  Open decision 1, and whichever way it goes it should be a stated
  decision with a matrix row, not a consequence of a refactor.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Workstream 3 is last because it is
the only one that needs a reviewer's answer; 1 and 2 are correct under
either answer, which is why they are not gated on it.

### 1. One `selectArtifact`, and one guard

Move `defaultReviewArtifact` and its instruction literal from
`review/reviewModel.ts` to `prompt/reviewPrompt.ts` (a file move, no
byte changes), add `selectArtifact`, and point `processTranscript` and
`reviewModel` at it. Export the surface guard as `assertArtifactSurface` and use it in
`runSuite.ts`. Have `prompt artifact` print `version@hash` and, when
its answer came from `--artifacts`, say on stderr that the prompt is a
candidate rather than what a production run would send.

Acceptance: when `processTranscript` runs against a client reporting
`claude-haiku-4-5`, the system shall render bytes identical to today's
output; when `reviewModel` runs against any client, the system shall
render bytes identical to `defaultReviewArtifact`; and when
`prompt artifact --artifacts <dir>` prints a directory-loaded variant,
the system shall say so on stderr.

First because it changes no behaviour except one stderr line, and
because it creates the single place where workstream 3's decision gets
encoded -- whichever way that decision goes, it is an edit to one
function rather than to two packages.

The move of `defaultReviewArtifact` is what makes this one PR rather
than two: `prompt/artifacts/` cannot import `review/reviewModel.ts`
without a cycle, so the default has to move before the table can exist.
Both golden tests (the extraction default's bytes and the review
default's 2,609) are the guard, and neither may move.

### 2. Record which prompt ran

Move `hashPrompt` into `@barwise/llm`, re-exporting from `promptlab`.
Add `promptHash` to `LlmCallRecord`, computed in `withCallLog` from
`request.systemPrompt` on both the success and the failure path. Wrap
the clients in `barwise review` and `barwise prompt eval`, closing the
two Inventory rows `llm-call-observability.spec.md` promised and did
not deliver. Report distinct hashes per model in `barwise llm-usage`.

Acceptance: when a wrapped client completes a call, the record shall
carry the hash of the system prompt sent; when a wrapped client's call
fails, the record shall carry it too; when a record is serialised, it
shall contain no part of the user message; and when `barwise review`
runs with `BARWISE_CALL_LOG` set, the system shall append a record.

Inert unless a sink is configured, so the cost of the hash is paid only
by an operator who asked for the log. The absence test is the one that
matters and is written the way `extractionLog`'s was: over
`JSON.stringify` of the whole record, not field by field, so a field
added later without thought cannot leak the transcript.

### 3. Settle the reach of `--artifacts`, and write it down (blocked on Open decision 1)

Whichever way the decision goes, this workstream ends with the
asymmetry stated where a reader will meet it: a row in the root
`CLAUDE.md` capability matrix for the artifact override, and a
paragraph in `packages/llm/CLAUDE.md` next to the "variants are
compiled in, not read from disk" note, saying what the promotion path
is and what may bypass it.

Under the recommended answer it also adds a one-shot candidate runner
to the `prompt` lane, so "try this variant on a real model and read the
prose" stops requiring an edit to `packages/llm/prompts/` and a
rebuild. That is the legitimate need barwise-855 item 2 names, and it
is answerable without production learning a new flag.

Acceptance: when the capability matrix is read, it shall carry the
override row and the sentence beneath it; when `packages/llm/CLAUDE.md`
is read, it shall state the promotion path, what may bypass it, and how
a recorded `promptHash` is resolved back to a shipped artifact; and
under option 2, when `barwise prompt run --surface review --artifacts

<dir>` is given a model file, the system shall send the resolved
candidate once and print the review it returned.

## API and migration impact

- `@barwise/llm` gains `selectArtifact` and `assertArtifactSurface`,
  and re-homes `defaultReviewArtifact` (same export name from the
  barrel, different module). `hashPrompt` becomes an `llm` export.
- `@barwise/promptlab` keeps exporting `hashPrompt`, now as a
  re-export. No consumer changes; history rows keep the same semantics
  because it is the same function over the same input.
- `LlmCallRecord` gains an optional `promptHash`. Additive; the
  `llm-usage` reader already tolerates rows without newer fields.
- No downstream package adds a dependency, and the one-way graph is
  unchanged. `mcp` and `vscode` are untouched in every workstream.
- The DSPy lane is untouched: it reaches the workspace only through
  `barwise prompt schema` and `barwise prompt score`, neither of which
  changes shape.

## Open decisions (for review)

- **Does `--artifacts` belong on `barwise import transcript` and
  `barwise review`?** Three options.

  1. _Widen production._ Add the flag to both commands, as barwise-855
     item 2 proposes for review. Honest about what an author needs, and
     symmetrical. Costs: an unreviewed prompt can do real modelling
     work; the recorded hash stops being resolvable to a shipped
     artifact, so `artifactVersion` has to be recorded after all; and
     the CLI gains a capability MCP and VS Code do not have, which is a
     new unmarked gap unless three surfaces move together.
  2. _Keep production narrow, and complete the dev lane_
     **(recommended)**. Production resolves over `builtinArtifacts`
     only; the `prompt` lane -- already a deliberate CLI-only row --
     gains a one-shot runner (`barwise prompt run --surface <s>
     --artifacts <dir>`) that sends a candidate once and prints the
     answer. The complaint behind barwise-855 item 2 is that judging a
     review prompt needs its prose, which the eval metric refuses to
     grade by design; a runner answers that without production learning
     anything. The library seam stays open regardless -- an embedder
     can already pass `artifact` to `processTranscript` and
     `reviewModel` -- so this removes no capability, only a CLI
     affordance on the wrong command.
  3. _Keep production narrow and add nothing._ Cheapest, and defensible
     since `prompt artifact` already prints a candidate's text.
     Rejected as a recommendation: reading a prompt is not reading what
     it produces, and leaving no path at all is what makes people edit
     `packages/llm/prompts/` and rebuild, which is the workflow
     barwise-855 filed against.

  The trade is explicitness against convenience. Option 1 makes the
  surfaces symmetrical and makes provenance genuinely necessary; option
  2 keeps "what production sends is reviewed and reproducible" a
  structural property rather than a convention. Recommend 2, and edit
  barwise-855 item 2 to name the runner rather than the flag.

- **Does the review surface get its own pipeline record?**
  `ExtractionRecord` exists because conformance silently rewrites the
  payload before the parser sees it. Review has no equivalent pass;
  `parseReviewResponse` drops malformed suggestions, which is arguably
  the same class of silent edit and is currently recorded nowhere.
  Recommend not now -- the call record's hash answers "which prompt",
  and a record whose only content is a dropped-suggestion count is thin
  -- but a reviewer who reads the drop as the same defect class that
  motivated `ExtractionRecord` would be consistent to ask for it.

- **A matrix row, or a note under the matrix?** The capability matrix's
  axis is per surface, and the sharp asymmetry here is within the CLI:
  `prompt eval` can override, `import transcript` and `review` cannot.
  A row records the surface story (`CLI dev-lane only / no / no`) and
  says nothing about the within-CLI boundary; a note says the second
  and sits outside the table the audit checks. Recommend both -- one
  row so the audit's row-by-row pass sees it, one sentence beneath so
  the boundary is not left to inference.

## Risks and testing

- **The two golden tests are the whole guard on workstream 1.** The
  extraction default's rendered bytes and the review default's 2,609
  are pinned; a file move must not touch either, and if one moves the
  change reached further than intended.
- **`builtins.test.ts` asserts reach, not just resolution.** Its "reaches
  production" case pins that a client on `claude-haiku-4-5` gets the
  `haiku45` variant through `processTranscript`. Workstream 1 must keep
  it green unmodified; a test that needed editing would mean
  `selectArtifact` changed what production sends.
- **Hashing must never reach the user message.** Asserted over the
  serialised record, not field by field, mirroring the extraction-log
  test that established the rule.
- **The hash costs a sha256 per call.** Only when a sink exists --
  `withCallLog` is not applied otherwise -- and it is computed once per
  call against a prompt of a few thousand tokens. Measured, not
  assumed, before the workstream closes.
- **A stale hash reads as corruption.** Two renderings per artifact
  (`--alternatives` on and off) means a naive one-rendering lookup
  reports "unknown prompt" for a legitimate run. Workstream 3's
  `packages/llm/CLAUDE.md` paragraph states this.
- **Name collision.** `mcp/src/workspace/lineageIo.ts` exports an
  unrelated `resolveArtifact` over lineage artifacts. Nothing here
  touches it; it is named so a grep does not mislead the implementer.
- **Tripwires.** If workstream 1 needs an edit to `builtins.test.ts`,
  the refactor changed behaviour -- stop. If two shipped artifacts ever
  hash equal, the twelve-hex abbreviation is too short for this corpus.
  If a `promptHash` in the call log matches no rendering of any shipped
  builtin while Open decision 1 stands at option 2, either production
  acquired a bypass or the recovery procedure is wrong; both are
  findings, not noise.
- Full gate after each workstream: `npm run build`, `test`, `lint` from
  `barwise/`, plus `npm run fmt`.

## Non-goals

- No artifact authored, no rule promoted, no prompt text changed.
- No change to `resolveArtifact`'s matching semantics, to
  `PromptArtifact`, or to `PromptSurface`.
- No provenance written into `.orm.yaml`, the annotator's comments, or
  the `.trail.json` sidecar.
- No change to `@barwise/mcp`, `barwise-vscode`, or the DSPy lane.
- No prompt or response text in any record, under any flag.
- No pricing, and no change to how `llm-usage` groups by model.
