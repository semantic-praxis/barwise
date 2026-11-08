# Two gates that can pass without seeing their input

Status: Draft

Created: 2026-11-08
Last-updated: 2026-11-08
Tracking: barwise-wrr, barwise-fzd
Touches: barwise/docs/adr/determinism-in-core.md,
barwise/docs/adr/probes.json, barwise/docs/ARCHITECTURE.md,
barwise/scripts/check-source-sites.mjs,
barwise/scripts/tests/check-source-sites.test.mjs,
barwise/scripts/check-core-purity.mjs,
barwise/scripts/tests/check-core-purity.test.mjs,
barwise/scripts/tests/expected-counts.json,
-barwise/packages/llm/tests/modelSdkBoundary.test.ts

## Problem

Two checks that hold `determinism-in-core` can report a pass on a change
they never looked at.

1. **The model SDK boundary (barwise-wrr).**
   `packages/llm/tests/modelSdkBoundary.test.ts` holds
   `determinism-in-core#one-layer-out`: only `@barwise/llm` imports
   `@anthropic-ai/sdk` or `openai`. It reads every other package's `src`
   from inside `llm`'s vitest suite. Turborepo caches that suite on
   `llm`'s own hash, so an SDK import added to `cli/src` or `mcp/src`
   does not change the hash, and CI and `ci:local` replay the cached
   pass. Batch 9 met the same trap and moved its cross-package scans to
   the uncached script gate `check:source-sites`
   (`adr-batch9-enforcers.spec.md`, Risks).
2. **Randomness from `node:crypto` (barwise-fzd).** `check:core-purity`
   refuses four named imports from `node:crypto` (`randomUUID`,
   `randomBytes`, `randomInt`, `getRandomValues`). Any other random
   source imported by name passes: `randomFillSync`, `randomFill`,
   `generateKey`, `generateKeyPairSync`, `webcrypto`, `randomPrime`.
   The rule lists names where the decision is about a module.

## Principle

Determinism in the core (primary) is what both checks hold; a check that
can pass unseen holds nothing (`gate-refusal-contract`, "a gate that
cannot see its input must not print PASS"). The fix in each case is to
make the check's input the whole thing the rule is about: every
package's source on every run, and every name `node:crypto` exports.
Define errors out of existence: an allowlist of the one name core needs
replaces a denylist that every Node release can outgrow.

## Scope

1. **WS1: the boundary moves to `check:source-sites`.** A third rule,
   `model-sdk-boundary`, beside `orm-version-writers` and
   `ossie-schema-refs`. It reads, for every `packages/*/src` file outside
   `llm` (the same extension set the test uses, `.d.ts` included),
   TypeScript's `preProcessFile` import list, and for every
   `packages/*/package.json` outside `llm` the four dependency fields; an
   SDK specifier (`@anthropic-ai/sdk`, `openai`, or a subpath of either)
   in either place is a finding. The vitest file is deleted in the same
   commit, so the rule has one home. `check:source-sites` already runs
   in CI with no `if:` and no cache, and already refuses (exit 2) on no
   source read.
2. **WS2: `node:crypto` as one set.** In `check:core-purity`, a named
   import from `node:crypto` (or `crypto`) other than `createHash` is a
   finding; a default or namespace import of it is a finding; `import
   type` stays allowed. The four `RANDOM_NAMES` member and qualified
   rules stay, since they catch the global `crypto.*` and
   `Math.random` paths an import rule cannot see.
3. **The ADR.** `determinism-in-core.md`'s `Enforced-by:` moves
   `one-layer-out` from `tests (one-layer-out)` to
   `npm run check:source-sites (one-layer-out)`, and the sentence naming
   the test file names the rule instead. `probes.json` gets a probe for
   `one-layer-out` whose plant is an SDK import in `cli/src`, the case
   the cache hid.

## Workstreams

### 1. `model-sdk-boundary` in `check:source-sites` (barwise-wrr)

Port the test's reader into the script, add the rule's tests to
`check-source-sites.test.mjs` (an SDK import, a subpath, a dynamic
import, a `require`, a re-export, a `.mjs` file, a `package.json`
dependency; the word `"openai"` in a string is not an import; `llm`
itself is exempt), delete the vitest file, restate the ADR line, add the
probe. Plant: an `import Anthropic from "@anthropic-ai/sdk"` in
`cli/src` turns `npm run check:source-sites` red with no package
rebuilt. Closes barwise-wrr.

### 2. `node:crypto` allowlist in `check:core-purity` (barwise-fzd)

Replace `importedNames` for crypto with an allowlist check, add tests
for `randomFillSync`, `randomFill`, `generateKey`, `webcrypto`, a
namespace import and a default import (each red), and `createHash` and
`import type { Hash }` (each green). Plant each with `mutate.mjs`.
Closes barwise-fzd.

## Alternatives considered

- **Give `llm`'s test task the other packages' sources as Turbo inputs**
  (`$TURBO_ROOT$/packages/*/src/**`). Rejected: every change anywhere
  would rerun `llm`'s whole suite, and the next cross-package test would
  need the same edit; the script gate is where batch 9 put this class.
- **A depcruise rule.** Rejected for the reason the test's header gives:
  `includeOnly` limits the graph to packages' `src`, so an import of a
  package in `node_modules` is outside it.
- **Extend `RANDOM_NAMES`.** Rejected: a denylist of crypto's random
  exports is the shape that left this gap; Node adds exports, and core
  needs one.

## Open decisions (for review)

1. **Where the boundary rule lives.** Recommended: a rule of
   `check:source-sites`, which already scans every package uncached, over
   a new `check:model-sdk` script with its own CI step. A new script would
   cost a CI step, a fault-matrix entry and a capability of its own for
   one rule.
2. **`hash` helpers beyond `createHash`.** Core imports only `createHash`
   today. Recommended: allow exactly `createHash`; widening the list (say,
   `createHmac`) is a one-line change with its reason, when core needs it.

## Risks and testing

- **The script must read what the test read.** The tests in WS1 port
  every case the vitest file covered before it is deleted, so nothing it
  caught is dropped; the review compares the two case lists.
- **Fault matrix.** `check:source-sites` and `check:core-purity` are
  already matrix gates; no new refusal path is added beyond the existing
  "no source read" refusal.
- **A false finding in core.** The allowlist run over today's core
  finds nothing (two `createHash` imports); the plant shows red.

## Non-goals

- A plain `fetch` to a provider's host from outside `llm` stays the gap
  the ADR already names.
- Purity's other open gaps (the boot-path registration, purity WS2) are
  separate work.
