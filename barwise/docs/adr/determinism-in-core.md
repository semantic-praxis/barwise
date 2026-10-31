# Determinism in core

Scope: architecture
Date: 2026-10-24
Tracking: barwise-ubc, docs/specs/archive/uuid7-identifiers.spec.md,
docs/specs/uuid7-generator-factory.spec.md,
docs/specs/archive/architecture-analysis.spec.md
Enforced-by: npm run purity (pure-ops, ambient-as-argument),
none (barwise-fzd: pure-ops, ambient-as-argument),
none (barwise-ym8.lxl: pure-ops), none (barwise-ym8.r6i: ambient-as-argument),
none (barwise-ym8.kys: one-layer-out), none (barwise-ym8.sit: mint-on-create)

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
it. The injected-sources design for ids, and why the default id is v4,
are in the two uuid7 specs above; the gate is from the archived
architecture-analysis spec.

## Decision

1. **Core's operations are deterministic.** {#pure-ops} Validation, verbalization,
   mapping, diff and query return the same output for the same input
   on any machine: no file system, subprocess, network, environment
   variable, working directory, locale, clock, random number or LLM
   SDK in `barwise/packages/core/src`. Orderings use a fixed comparison
   (code-unit order, or a collator with an explicit locale), never the
   process locale.
2. **Non-determinism lives one layer out.** {#one-layer-out} A capability that cannot be
   deterministic goes in an outer package: `@barwise/llm` for model
   calls, a connector package (`@barwise/formats`, `@barwise/dbt`,
   `@barwise/code-analysis`) for a format that owns its own I/O, and
   the tool layer (`cli`, `mcp`, `vscode`) for anything else.
3. **When core needs a clock or randomness, it takes it as an
   argument.** {#ambient-as-argument} The logic stays in core and the ambient source stays at
   the surface: `createUuidv7Generator({ now, randomBytes })` is the
   worked example, installed by each surface with `setIdGenerator(...)`.
4. **Ids are minted only when an element is created.** {#mint-on-create} `generateId()`
   is the one ambient source core keeps: with no generator installed it
   falls back to `randomUUID()` (v4), which reads no clock. An
   operation's output may depend on which ids its input carries -- diff
   and merge pair elements by id first -- but an operation in 1 never
   mints a fresh id into its output; an id it needs is derived from
   content, as `serialization/derivedId.ts` derives constraint ids.

## Consequences

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
