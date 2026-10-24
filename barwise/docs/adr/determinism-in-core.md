# Determinism in core

Scope: architecture
Date: 2026-10-24
Tracking: barwise-ubc, docs/specs/archive/architecture-analysis.spec.md

## Context

`@barwise/core` powers the CLI, the MCP server and the VS Code
extension, and its validation, verbalization, mapping, diff and query
results are compared, cached, golden-tested and diffed across runs. A
result that depends on the clock, the environment, the network or a
model call cannot be compared with an earlier one, and a failing test
on it cannot be reproduced. The rule was stated as a design principle
in the root `CLAUDE.md` and enforced by a pattern gate, and nowhere
said what counts as core, which operations it binds, or what the one
allowed source of randomness is. The scenarios behind the gate
(S-DET-1 to S-DET-3) are in the archived spec named above.

## Decision

1. **Core's operations are pure.** Validation, verbalization, mapping,
   diff and query return the same output for the same input: no file
   system, subprocess, network, environment variable, clock, random
   number or LLM SDK in `barwise/packages/core/src`.
2. **Non-determinism lives one layer out.** LLM calls, network and file
   I/O, and clocks belong to the outer packages (`llm`, `cli`, `mcp`,
   `vscode`) and the connector packages, which own their own I/O. A
   capability that cannot be pure goes there, not into core.
3. **When core needs a clock or randomness, it takes it as an
   argument.** The logic stays in core and the ambient source stays at
   the surface: `createUuidv7Generator({ now, randomBytes })` is the
   worked example, installed by each surface with
   `setIdGenerator(...)`.
4. **The one ambient exception is the default element id.** With no
   generator installed, `generateId()` falls back to `randomUUID()`
   (v4), which reads no clock. An id identifies an element; no
   operation in 1 may depend on its value. Hashing (`createHash`) is
   deterministic and allowed.

## Consequences

- `npm run purity` (`barwise/scripts/check-core-purity.mjs`, a CI gate)
  fails on an `fs`, `child_process`, `os` or network import, on
  `process.env`, `new Date()`, `Date.now()`, `Math.random()`, the
  global `crypto`, and on the LLM SDKs, anywhere in core's source
  outside tests.
- The gate does not see `randomUUID` or `randomBytes` imported from
  `node:crypto`, so a second ambient source like the default id would
  pass it; barwise-fzd tracks closing that.
- A new capability that needs I/O ships as a connector package that
  registers into the `FormatDescriptor` registry (`@barwise/formats`,
  `@barwise/dbt`, `@barwise/code-analysis`), not as an option on a core
  function.
