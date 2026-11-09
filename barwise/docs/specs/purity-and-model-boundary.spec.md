# Core purity widened, and the model SDK boundary held

Status: WS1 and WS3 implemented 2026-11-06 (purity parses with TypeScript and walks the syntax tree -- code review showed a token scanner misreads a regex after `)` and hides the rest of the file, and cannot tell type from value position -- with the new rules, a refusal on no source, and arch-triage taking its rules; the four sorts use compareCodeUnits with a two-locale test; modelSdkBoundary.test.ts holds one-layer-out); WS2 grounded in `boot-path-registration.spec.md`
Created: 2026-11-06
Last-updated: 2026-11-06
Plan-reviewed: fc79ebb8 (code-review, pr-review)
Tracking: barwise-ym8.gc9 (adr-refactor batch 8), barwise-ym8.lxl,
barwise-ym8.iyw, barwise-ym8.kys, barwise-ym8.2n3, barwise-fzd,
barwise-c3z
Touches: barwise/scripts/check-core-purity.mjs, barwise/scripts/tests/,
barwise/packages/core/src/query/evaluate.ts,
barwise/packages/core/src/diff/elementDiff.ts,
barwise/packages/core/src/serialization/replay.ts,
barwise/packages/llm/tests/, barwise/docs/adr/determinism-in-core.md,
barwise/docs/adr/connector-packages.md, barwise/docs/adr/probes.json,
barwise/scripts/arch-triage.mjs, +barwise/packages/core/src/util/compareCodeUnits.ts,
barwise/packages/core/tests/,
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

1. **`check-core-purity.mjs` reads TypeScript's view of the source**, not
   lines. Module references come from `ts.preProcessFile` (static and
   dynamic imports, `export ... from`, `require`, type imports), and
   names from `ts.createScanner` tokens (implemented as a full parse after code review; see Status), so comments and strings can
   neither hide a violation nor raise one, with no hand-written comment
   stripper (plan review: the one in `llm` goes out of phase on three core
   files with a quote in a regex literal). Files come from `git ls-files`;
   zero files is a refusal (exit 2). The rules are exported, and
   `scripts/arch-triage.mjs` uses them instead of its own copy of the
   eleven patterns (plan review: a must-agree copy with no check).
2. **Rules**, each a finding in `core/src`:
   - modules: the existing `node:fs`, `child_process`, `os`, network
     modules and model SDKs, plus `node:process`, `node:module`,
     `node:worker_threads`, `node:readline`, `node:dns`, `node:vm`,
     `node:perf_hooks`, `undici`;
   - a runtime `import(`: every `import` keyword token followed by `(`
     fails unless it is a type form, `import("...").Ident` with `Ident`
     not `then`, `catch` or `finally`, or `typeof import(...)` (plan
     review: listing bad shapes missed `return import(...)` and others);
   - the identifiers `process`, `fetch`, `performance`, `localeCompare`,
     `toLocaleString`, `toLocaleUpperCase`, `toLocaleLowerCase`, `Intl`,
     `randomUUID`, `randomBytes`, `randomInt`, `getRandomValues`, as
     tokens, whatever form uses them; core uses none of them today except
     the four `localeCompare` calls fixed below (measured);
   - the existing `new Date(`, `Date.now`, `Math.random` and global
     `crypto.` rules, as token sequences.
3. **The four locale-dependent sorts use code-unit order** through one
   `compareCodeUnits` in core. Plan review measured it: with the bare
   calls patched to code-unit order, 12,105 calls in the core, mcp and cli
   suites never disagreed, so no test or golden changes; and code-unit
   order is the same on every ICU build, where an explicit `"en"` still
   depends on the runtime's CLDR data (VS Code runs core in Electron).
   A test sorts barwise-c3z's measured names (`Zebra`, `Ärende`, `Apa`,
   `aa`, `Ab`) through the comparator and through `query`'s by-name
   ordering, in a child process under `LANG=sv_SE.UTF-8` and
   `LANG=en_US.UTF-8`, and asserts one order.
4. **`one-layer-out`**: a test in `llm` fails when `ts.preProcessFile`
   finds `@anthropic-ai/sdk` or `openai` imported by any
   `packages/*/src` file outside `llm`, or a `package.json` outside `llm`
   lists either; a negative self-check keeps the provider name
   `"openai"` in a string (as `mcp/src/tools/review.ts` has) passing.
   Tagged `[adr:determinism-in-core#one-layer-out]`. A plain `fetch` to a
   provider host stays a gap, as the restatement says.

Out of scope, and stated as remaining gaps in the ADRs:
`lineage/resolveArtifact.ts` resolves relative paths with
`path.resolve`, so a match depends on the working directory
(barwise-dko, a known violation of `pure-ops`; `lxl` stays open,
narrowed to it); `explicit-registration` (barwise-ym8.2n3), whose
per-surface boot-path tests are a design of their own given the CLI's
lazy per-command registration (WS2, grounded in
`boot-path-registration.spec.md`); `format-in-its-
connector`'s second half (barwise-ym8.x9w).

## Alternatives considered

- **A depcruise rule for the SDK boundary** (the refactor plan's form).
  `includeOnly` drops `node_modules` from the graph, and widening it
  changes every other rule's input. Rejected for a source test.
- **`localeCompare(b, "en")`** for the four sorts. Deterministic only as
  far as the runtime's ICU data is; code-unit order needs none and, as
  measured, changes no order the suites see.
- **Regexes over comment-stripped text.** That needs a comment stripper
  that knows regex literals, and argument-counting rules cannot be
  checked by text at all. TypeScript's scanner and `preProcessFile` are
  already a dependency (`check-parity.mjs` uses `typescript`).

## Workstreams

### 1. Purity widened, and the four sorts fixed

Scope 1 to 3. Each new rule is planted red in a `gates.test.mjs` case,
staged in a `tempRepo()` at `barwise/packages/core/src/` (an untracked
file is invisible to a gate that reads `git ls-files`, plan review),
beside green cases for the forms that stay allowed (a type-position
`import("x").T`, `typeof import("x")`, a string mentioning `fetch`). The
pure-ops and connector-owns-io probes still CAUGHT.

### 2. Registration through each surface's boot path

Grounded and moved to `boot-path-registration.spec.md`: no surface registers at boot, the CLI registers per command, and the check holds the registry after a fresh-process boot.

### 3. The model SDK boundary

Scope 4, planted red (an `openai` import in `cli/src`, the SDK in
`mcp`'s `package.json`).

## Risks and testing

- Banning identifiers outright is stricter than the decision: a future
  explicit `Intl.Collator("en")` in core is refused too. Core uses no
  `Intl` today, and the gate's message names the rule and the fix
  (`compareCodeUnits`, or an argument from the surface).
- The scanner reads TypeScript; a `.tsx` file in core would need
  `LanguageVariant.JSX`, which the gate sets by extension.
