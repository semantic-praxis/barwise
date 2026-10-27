# Production prompt resolution

Scope: architecture
Date: 2026-08-26
Tracking: barwise-ubc, barwise-855, barwise-882, barwise-qxt, barwise-9z7, barwise-49k,
docs/specs/artifact-resolution-parity.spec.md,
docs/specs/artifact-resolution-in-production.spec.md

## Context

`barwise prompt eval --artifacts <dir>` could measure a prompt that
`barwise import transcript` and `barwise review` were structurally unable
to send, "which prompt gets sent" was answered separately in four places,
and nothing recorded which prompt a run had used. A model's output cannot
be audited, and a score cannot be compared with production, unless the
prompt behind it can be named afterwards. The rule is stated in the root
`CLAUDE.md` (the `--artifacts` row of the capability matrix and the
paragraph beneath it), in `packages/llm/CLAUDE.md` ("What may bypass
that promotion path") and in `packages/cli/CLAUDE.md`. The three faults, the alternatives and the
resolved Open decision 1 (keep production narrow, complete the dev lane)
are in `artifact-resolution-parity.spec.md`.

## Decision

1. **Production resolves over the shipped artifacts alone.** On a
   production path -- `barwise import transcript`, `barwise review`, the
   MCP tools, and the VS Code commands and language-model tools -- the
   prompt is chosen by
   `selectArtifact` over `builtinArtifacts`, falling back to the surface's
   default. A prompt reaches that set only through `regen:builtins`, the
   drift test and review.
2. **Unshipped candidates stay in the `prompt` lane.** `barwise prompt
   eval`, `prompt artifact` and `prompt run` may take `--artifacts <dir>`
   (and `eval` and `artifact` take `--artifact-version`); `import
   transcript` and `review` must not. Trying a candidate against a live
   model is `prompt run`.
3. **What production sent is recovered, not recorded.** Because of 1, the
   prompt a production run sent follows from barwise version, surface,
   provider and model, plus, for extraction, whether `--alternatives` was
   set, which appends a section. `barwise prompt artifact` prints
   `version@hash` for that join. `withCallLog` records `promptHash` of the
   system prompt only -- never the user message -- and no
   `artifactVersion`.
4. **The library seam stays open.** `processTranscript` and `reviewModel`
   still accept an explicit `artifact`, guarded by `assertArtifactSurface`;
   what does not exist is a production CLI flag that passes one.

## Consequences

- Widening 2 to a production command breaks 3: a production hash could
  match no shipped rendering, and `artifactVersion` would have to be
  recorded after all (Open decision 1, option 1).
- No gate script checks this rule. What holds each decision is code shape
  and unit tests, run in CI by `npm run test:coverage` (`if:
  steps.changes.outputs.docs_only != 'true'`), or nothing:
  - 1: `selectArtifact` takes no candidate list and reads
    `builtinArtifacts` (`llm/src/prompt/selectArtifact.ts`). The drift
    test (`llm/tests/prompt/artifacts/builtins.test.ts`) checks that the
    compiled set equals `prompts/`; review is the PR's. The CLI and MCP
    review tests assert their `reviewModel` options exactly, so an extra
    `artifact` there fails. Nothing would fail if `selectArtifact` also
    read a directory, or if the transcript-import call sites (CLI, MCP,
    `import batch`) or the VS Code ones passed an `artifact`
    (barwise-qxt).
  - 2: `cli/tests/commands/promptRun.test.ts` ("the production surfaces
    stay narrow") checks that `review --help` and `import transcript
    --help` carry no `--artifacts`, and that `prompt run` does. Nothing
    checks `--artifact-version` on those commands, or `import batch`
    (barwise-qxt).
  - 3: `llm/tests/observe/callLog.test.ts` pins that a record carries no
    part of the user message. `prompt artifact` prints only the hash of
    the rendering without `--alternatives`, so an alternatives run's hash
    has no command that prints it. The prompt lane writes to the same call
    log as production (`prompt eval` and `prompt run` wrap their clients
    with `withCallLog`), and a row names neither command, surface nor
    barwise version, so a hash that matches no shipped rendering may be a
    candidate run rather than a bypass (barwise-49k). `artifactByVersion`
    (`cli/src/workspace/promptArtifacts.ts`) restates the surface defaults
    as a two-way ternary; no caller reaches a third surface today, since
    `prompt eval` passes extraction and `prompt artifact`'s `render` is
    typed to the two surfaces, but the copy would not fail the build
    itself (barwise-9z7).
  - 4: `llm/tests/prompt/selectArtifact.test.ts` covers the surface guard.
- Decided: an embedder can pass an artifact to the library, within the
  surface guard (spec, Open decision 1, resolved 2026-08-26: "this
  removes no capability, only a CLI affordance on the wrong command").
- Deferred, not decided: MCP and VS Code write no call record, so their
  prompts are recorded nowhere (spec, Out of scope: "Recording from MCP
  and VS Code. Still deferred").
- Left to the owner: `barwise import batch` also resolves through
  `selectArtifact` and takes no `--artifacts`, but no source names it in
  Decision 2.
- barwise-0wa (in progress) is re-deciding every capability-matrix row
  marked "deliberate", this one included. Mirroring the override into MCP
  or VS Code would change Decisions 1 to 3.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: `packages/llm/CLAUDE.md` (the promotion-path note);
  `packages/cli/CLAUDE.md`; `artifact-resolution-parity.spec.md` (Open
  decision 1); the `selectArtifact.ts` header; the `promptHash` comment
  in `callLog.ts`; the `prompt artifact` and `prompt run` comments in
  `cli/src/commands/prompt.ts`; and the header of `promptRun.test.ts`.
