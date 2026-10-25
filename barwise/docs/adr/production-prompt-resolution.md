# Production prompt resolution

Scope: architecture
Date: 2026-08-28
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
paragraph beneath it) and in `packages/llm/CLAUDE.md` ("What may bypass
that promotion path"). The three faults, the alternatives and the
resolved Open decision 1 (keep production narrow, complete the dev lane)
are in `artifact-resolution-parity.spec.md`.

## Decision

1. **Production resolves over the shipped artifacts alone.** On a
   production path -- `barwise import transcript`, `barwise review`, the
   MCP tools and the VS Code commands -- the prompt is chosen by
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
    compiled set equals `prompts/`; review is the PR's. No test would fail
    if `selectArtifact` also read a directory, or if a production call site
    passed an `artifact` (barwise-qxt).
  - 2: no test. The production commands declare no `--artifacts`, so
    commander rejects it as an unknown option until someone declares it
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
    as a two-way ternary, so a third surface would get the extraction
    default there instead of failing the build (barwise-9z7).
  - 4: `llm/tests/prompt/selectArtifact.test.ts` covers the surface guard.
- Decided limits:
  - MCP and VS Code write no call record, so their prompts are recorded
    nowhere; deferred, not rejected (spec, Out of scope: "Recording from
    MCP and VS Code. Still deferred");
  - an embedder can pass any artifact to the library (spec, Open decision
    1, resolved 2026-08-26: "this removes no capability, only a CLI
    affordance on the wrong command").
- Left to the owner: `barwise import batch` also resolves through
  `selectArtifact` and takes no `--artifacts`, but no source names it in
  Decision 2.
- barwise-0wa (in progress) is re-deciding every capability-matrix row
  marked "deliberate", this one included. Mirroring the override into MCP
  or VS Code would change Decisions 1 to 3.
- Until architecture-index WS5 replaces them with links, the root
  `CLAUDE.md` (the `--artifacts` matrix row and the paragraph beneath it),
  `packages/llm/CLAUDE.md` (the promotion-path note),
  `artifact-resolution-parity.spec.md` (Open decision 1), the
  `selectArtifact.ts` header, the `promptHash` comment in `callLog.ts` and
  the `prompt artifact` comment in `cli/src/commands/prompt.ts` also state
  this rule (barwise-ubc, WS5).
