# Determinism in core

Scope: architecture
Date: 2026-11-05
Tracking: barwise-ubc, barwise-wcg.vlv, docs/specs/iri-identity.spec.md,
docs/specs/archive/architecture-analysis.spec.md
Enforced-by: npm run purity (pure-ops), none (barwise-ym8.lxl: pure-ops),
none (barwise-ym8.kys: one-layer-out)

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
  placement. Its check, a depcruise rule forbidding
  `@anthropic-ai/sdk` and `openai` outside `@barwise/llm`, is batch 8
  of that spec; a plain `fetch` to a provider host stays a gap.
- `npm run purity` (`barwise/scripts/check-core-purity.mjs`, a CI gate)
  fails on an `fs`, `child_process`, `os` or network import, on
  `process.env`, `new Date()`, `Date.now()`, `Math.random()`, the
  global `crypto`, and on the LLM SDKs, in core's source outside
  tests. It matches static imports and exact call shapes only, so a
  dynamic import, global `fetch`, `performance.now()`, `process.cwd()`
  or a named randomness import from `node:crypto` passes it
  (barwise-fzd).
- Three places in core break the decision today, none visible to the
  gate:
  - query and diff sort with `localeCompare` and no locale, so their
    order follows the machine (barwise-c3z);
  - `resolveArtifactInManifest` resolves relative paths against the
    working directory rather than the manifest's (barwise-dko);
  - counterexample generation mints fresh population ids, so its
    output differs per call (barwise-uam).
- Placement is a review judgment made in the spec (S-DET-5); the gate
  catches a violation only after it is written.
