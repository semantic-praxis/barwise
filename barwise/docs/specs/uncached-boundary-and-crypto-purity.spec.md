# Two gates that can pass without seeing their input

Status: Planned; plan reviewed 2026-11-08 (one round, eight findings, all addressed)

Created: 2026-11-08
Last-updated: 2026-11-08
Plan-reviewed: acefbc5b (code-review, pr-review)
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
   commit, so the rule has one home. `check:source-sites` is uncached (a
   root script, not a package test) and runs in CI on every change but a
   docs-only one, which cannot add an import or a dependency
   (`package.json` is never classed docs-only). The script's existing
   walk filters out `package.json` and `.test.`/`.spec.` files, so the
   rule has its own pass over the same git listing: it reads every
   `packages/*/package.json` (a parse failure refuses, exit 2, where the
   test skipped it) and every source file under `src`, test files
   included, as the vitest scan did. It reads tracked files only, like
   the script's other rules; an untracked file is reported by
   `noteUntrackedInput`, not read.
2. **WS2: `node:crypto` as one set.** In `check:core-purity`, every
   reference to `node:crypto` (or `crypto`) binds only `createHash`: a
   named import, `export { x } from`, `import x = require(...)` or a
   destructuring `require(...)` of any other name is a finding; a
   default or namespace import is a finding (today only a binding named
   `crypto` is caught, through the global-name rule; an alias such as `c`
   passes); `import type` and type-only specifiers stay allowed, which
   needs new code, since the walker reads neither `isTypeOnly` flag
   today. `importedNames` and its index leave `PURITY_RULES` (nothing
   else reads them). The `RANDOM_NAMES` member and qualified rules stay,
   since they catch the global `crypto.*` and `Math.random` paths an
   import rule cannot see.
3. **The ADR.** `determinism-in-core.md`'s `Enforced-by:` moves
   `one-layer-out` from `tests (one-layer-out)` to
   `npm run check:source-sites (one-layer-out)`, and the sentence naming
   the test file names the rule instead. `probes.json` gets a probe for
   `one-layer-out` whose plant is an SDK import in `cli/src`, the case
   the cache hid.

## Workstreams

### 1. `model-sdk-boundary` in `check:source-sites` (barwise-wrr)

Port the test's reader into the script and every case the vitest file
checks into `check-source-sites.test.mjs`, each tagged
`[adr:determinism-in-core#one-layer-out]`: an SDK import, a subpath, a
type import of a subpath (`@anthropic-ai/sdk/resources/messages`), a
dynamic import, a `require`, a re-export, a `.mjs` file, a
`package.json` dependency in each of the four fields; negatives: the
word `"openai"` in a string, in a comment, and the package
`openai-compat` (the prefix guard); `llm` itself is exempt. The test's
sanity floors become refusals, so a layout change cannot turn the rule
into a pass over nothing: the rule refuses (exit 2) when `cli`, `mcp`
or `vscode` has no source file in the listing, or when no
`package.json` outside `llm` is read. Delete the vitest file, restate
the ADR's `Enforced-by:` and Consequences sentence, regenerate
`ARCHITECTURE.md`, add the probe (with `gate: "check:source-sites"`
and an `old` string that occurs once in its `cli/src` file). Plant: an
`import Anthropic from "@anthropic-ai/sdk"` in `cli/src` turns
`npm run check:source-sites` red with no package rebuilt. Closes
barwise-wrr.

### 2. `node:crypto` allowlist in `check:core-purity` (barwise-fzd)

Replace `importedNames` for crypto with the allowlist, add tests for
`randomFillSync`, `randomFill`, `generateKey`, `webcrypto`, a namespace
import and a default import under an alias (`c`), `export {
randomFillSync } from`, `import c = require(...)` and a destructuring
`require` (each red), and `createHash`, `import type { Hash }` and
`import { type Hash, createHash }` (each green). Plant the allowlist and
the type-only exemption with `mutate.mjs`. Closes barwise-fzd.

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
- **Fault matrix.** Whether `check:source-sites` and `check:core-purity`
  are matrix gates, and whether the new refusals (a missing expected
  package, an unparseable `package.json`) need matrix entries, is checked
  in WS1 against `lib/ci-gates.mjs` and the matrix run, not assumed.
- **A false finding in core.** The allowlist run over today's core
  finds nothing (two `createHash` imports); the plant shows red.

## Non-goals

- A plain `fetch` to a provider's host from outside `llm` stays the gap
  the ADR already names.
- Purity's other open gaps (the boot-path registration, purity WS2) are
  separate work.
