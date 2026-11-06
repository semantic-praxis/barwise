# Core purity widened, and the model SDK boundary held

Status: Draft -- no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 8), barwise-ym8.lxl,
barwise-ym8.iyw, barwise-ym8.kys, barwise-ym8.2n3, barwise-fzd,
barwise-c3z
Touches: barwise/scripts/check-core-purity.mjs, barwise/scripts/tests/,
barwise/packages/core/src/query/evaluate.ts,
barwise/packages/core/src/diff/elementDiff.ts,
barwise/packages/core/src/serialization/replay.ts,
barwise/packages/llm/tests/, barwise/docs/adr/determinism-in-core.md,
barwise/docs/adr/connector-packages.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md

## Principle

`npm run purity` holds `determinism-in-core#pure-ops` and
`connector-packages#connector-owns-io` by matching lines of
`packages/core/src` against eleven patterns. The gap issues measured
forms it misses: a line led by a block comment, a named import from
`node:process`, `createRequire`, other ambient modules, dynamic imports,
`process.cwd()`, `fetch`, `performance.now()`, named randomness from
`node:crypto`, and orderings that follow the process locale. Each is
still literal text in core's source, so the gate's instrument is right
and its vocabulary is short. Decision 2 of `determinism-in-core`
(`one-layer-out`, restated 2026-11-06) now says only `@barwise/llm`
imports a model SDK; nothing checks that.

## The reading this spec starts from (main at 0389c384)

- `check-core-purity.mjs` skips any line that starts with `//`, `*` or
  `/*`, so `/* c8 ignore */ import { readFileSync } from "node:fs"`
  passes (barwise-ym8.iyw, measured). It walks `core/src` with
  `readdirSync` and prints OK over however many files it found, zero
  included.
- In `core/src` today: four `localeCompare` calls with no locale
  (`query/evaluate.ts` twice, `diff/elementDiff.ts`,
  `serialization/replay.ts`; barwise-c3z: the order changes between
  en-US, sv-SE and da-DK); sixteen `import("...")` uses, all in type
  positions; none of the other new patterns.
- Only `@barwise/llm` imports `@anthropic-ai/sdk` or `openai` and lists
  them as dependencies. `.dependency-cruiser.cjs` sets `includeOnly:
  "^packages/[^/]+/src/"`, so a depcruise rule cannot see an import of a
  package in `node_modules` (the refactor plan named a depcruise rule).

## Scope

1. **`check-core-purity.mjs` reads code, not lines.** Comments (line and
   block, wherever they sit) are stripped with strings kept, so a
   comment cannot hide a line and a comment's text cannot raise a
   finding. Files come from `git ls-files` (tracked, as the other gates),
   and zero files is a refusal (exit 2), per the gate-refusal contract.
2. **New patterns**, each a finding in `core/src`:
   - imports (static, `export ... from`, `require(`, a dynamic import at
     runtime) of `node:process`, `node:module`, `node:worker_threads`,
     `node:readline`, `node:dns`, `node:vm`, `node:perf_hooks`, `undici`;
     a runtime dynamic import of anything (`await import(`, or
     `import(...).then`), which the type form `import("x").T` is not;
   - `process.cwd()`, `process.` anything else ambient (`hrtime`,
     `argv`, `platform`), global `fetch(`, `performance.now(`;
   - named randomness from `node:crypto` (`randomUUID`, `randomBytes`,
     `randomInt`, `getRandomValues`);
   - a `localeCompare` call with fewer than two arguments, and any
     `toLocaleString`, `toLocaleUpperCase`, `toLocaleLowerCase` or
     `Intl.` use with no explicit locale argument.
3. **The four locale-dependent sorts in core** pass an explicit `"en"`,
   which decision 1 allows ("a collator with an explicit locale") and
   which keeps today's order wherever the tests run (barwise-c3z).
4. **`one-layer-out`**: a test in `llm` (beside `keyFromEnvironment.test.ts`,
   reusing its source helper) fails when any `packages/*/src` outside
   `llm` imports `@anthropic-ai/sdk` or `openai` in any form, or any
   `package.json` outside `llm` lists them; tagged
   `[adr:determinism-in-core#one-layer-out]`. A plain `fetch` to a
   provider host stays a gap, as the restatement says.

Out of scope: `explicit-registration` (barwise-ym8.2n3), per-surface
tests through each surface's real boot path, which the CLI's lazy
per-command registration makes a design of its own (WS2, provisional);
`format-in-its-connector`'s second half (barwise-ym8.x9w).

## Alternatives considered

- **A depcruise rule for the SDK boundary** (the refactor plan's form).
  `includeOnly` drops `node_modules` from the graph, and widening it
  changes every other rule's input. Rejected for a source test.
- **Code-unit order for the four sorts.** Equally deterministic, but it
  reorders case-mixed names (`Zebra` before `apple`) and would rewrite
  goldens. An explicit `"en"` keeps the order the tests already pin.
- **A TypeScript AST walk for purity.** Exact, but the patterns are all
  literal text once comments are stripped; the gate stays a pattern
  check, as its header says.

## Workstreams

### 1. Purity widened, and the four sorts fixed

Scope 1 to 3, with each new pattern planted red in a `gates.test.mjs`
case (a throwaway core file) and the existing pure-ops probe still
CAUGHT; the four sorts' tests still green.

### 2. Registration through each surface's boot path (provisional)

### 3. The model SDK boundary

Scope 4, planted red (an `openai` import in `cli/src`, the SDK in
`mcp`'s `package.json`).

## Risks and testing

- A wider pattern can flag a legitimate future use (an explicit
  `Intl.Collator("en")` is allowed, a bare one is not); the gate's
  message names the rule and the fix.
- The comment stripper must not hide code; it keeps strings, and the
  gate's tests plant a violation after a block comment on the same line.
