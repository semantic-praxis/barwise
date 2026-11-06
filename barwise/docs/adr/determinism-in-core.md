# Determinism in core

Scope: architecture
Date: 2026-11-05
Tracking: barwise-ubc, barwise-wcg.vlv, docs/specs/iri-identity.spec.md,
docs/specs/archive/architecture-analysis.spec.md
Enforced-by: npm run purity (pure-ops), tests (one-layer-out),
none (barwise-ym8.lxl: pure-ops)

## Context

`@barwise/core` powers the CLI, the MCP server and the VS Code
extension, and its validation, verbalization, mapping, diff and query
results are compared, cached, golden-tested and diffed across runs. A
result that depends on the clock, the environment, the machine or a
model call cannot be compared with an earlier one, and a failing test
on it cannot be reproduced. The rule is stated as a design principle in
the root `CLAUDE.md` and as scenarios S-DET-1 to S-DET-5 in
`docs/architecture-scenarios.md`, and is enforced by a pattern gate.
This ADR is the one statement of the decision; those places link to
it. How an element's id is built from its name is in the iri-identity
spec; the gate is from the archived architecture-analysis spec.

## Decision

1. **Core's operations are deterministic.** {#pure-ops} Validation, verbalization,
   mapping, diff and query return the same output for the same input
   on any machine: no file system, subprocess, network, environment
   variable, working directory, locale, clock, random number or LLM
   SDK in `barwise/packages/core/src`. Orderings use a fixed comparison
   (code-unit order, or a collator with an explicit locale), never the
   process locale. An id core needs is derived from content, never
   drawn from a clock or a random source: an element's id is its name
   (the readable IRI of `ossie-interchange.md#readable-iri`), and an
   element a person does not name, such as a constraint, gets a name
   minted from the sentence that states it (`model/mint.ts`); a
   constraint id a 2.0 file leaves out is derived from the constraint's
   content (`serialization/derivedId.ts`). A value core would need from a
   clock or a random source arrives as an argument from the surface that
   owns it.
2. **Outside core, only `@barwise/llm` imports a model SDK; a package
   that needs a model reaches it through `@barwise/llm`'s
   `LlmClient`.** {#one-layer-out}

## Consequences

- Decision 2 was restated on 2026-11-06 (`adr-refactor.spec.md`, row 3)
  from "non-determinism lives one layer out" to its one checkable rule.
  The rest is true by construction or held elsewhere: a host-mediated
  client (VS Code's language-model API, MCP sampling) lives in the
  surface that owns the host connection; "core calls no model" and
  "non-determinism lives outside core" are decision 1; a format's own
  I/O is `connector-packages.md#connector-owns-io`; core's external
  dependencies are `package-graph-authority.md#core-external-deps`.
  With the tool-layer clause gone, `learn` and `promptlab` need no
  placement. `llm/tests/modelSdkBoundary.test.ts` holds it
  (`purity-and-model-boundary.spec.md`): it fails when TypeScript's
  import list for any `packages/*/src` file outside `llm` names
  `@anthropic-ai/sdk` or `openai` (subpaths, dynamic imports,
  `require` and re-exports included), or a `package.json` outside `llm`
  lists either. A depcruise rule, the form first planned, cannot see a
  package in `node_modules` under the config's `includeOnly`. A plain
  `fetch` to a provider host stays a gap.
- `npm run purity` (`barwise/scripts/check-core-purity.mjs`, a CI gate)
  parses core's tracked source with TypeScript and walks the syntax
  tree, so a comment, string or regex literal can neither hide nor raise
  a finding, and a type position is told from a value
  (`purity-and-model-boundary.spec.md`). It fails on an `fs`,
  `child_process`, `os`, network, `dns`, `undici`, `process`,
  `module`, `worker_threads`, `readline`, `vm` or `perf_hooks` import
  in any form, a runtime `import()`, a model SDK, and the identifiers
  `process`, `fetch`, `performance`, `localeCompare`, `Intl`,
  `toLocale*` and the named randomness functions, beside `new Date`,
  `Date.now`, `Math.random` and the global `crypto`; it refuses when it
  can list no source. Core's four locale-dependent sorts use
  `compareCodeUnits` (barwise-c3z, fixed; a test shows one order under
  sv_SE and en_US for the comparator and query's entity and anchor
  orderings; diff's and replay's sorts are held by the gate's
  `localeCompare` rule, not by that test).
- Two places in core break the decision today, neither visible to the
  gate:
  - `resolveArtifactInManifest` resolves relative paths against the
    working directory rather than the manifest's (barwise-dko);
  - counterexample generation mints fresh population ids, so its
    output differs per call (barwise-uam).
- Placement is a review judgment made in the spec (S-DET-5); the gate
  catches a violation only after it is written.
