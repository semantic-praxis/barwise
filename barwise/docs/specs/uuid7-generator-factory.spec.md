# One UUIDv7 generator, built in core from an injected clock

Status: Implemented -- both workstreams landed together

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1071

The UUIDv7 generator's logic moves into `@barwise/core` as a factory,
`createUuidv7Generator({ now, randomBytes })`, and each surface installs it
with one line. The factory reads no clock or random source of its own: it
calls only the functions a surface hands it. (Core's existing v4 fallback in
`generateId()`, `randomUUID()`, is unchanged and out of scope.) The three byte-identical copies of
`installUuidv7IdGenerator` in the CLI, MCP server and VS Code extension, and
the parity-manifest entry that keeps them identical, go away. The same-
millisecond ordering, today tested only by whatever the real clock happens
to do, becomes testable with a fake one.

## Principle

**Determinism in the core, and composability.** The UUIDv7 spec
(`archive/uuid7-identifiers.spec.md`) put the pure bit layout,
`uuidv7FromParts`, in core and left "the ambient clock and randomness" to
the surfaces. It drew the line one step too far out: the surfaces now hold
not just the clock but the whole generator -- the per-millisecond counter
and how it feeds the bit layout -- which is logic, not ambience. Logic that
three surfaces need identically belongs where all three already depend,
provided core can hold it without reading a clock. It can, by taking the
clock as an argument.

## What exists (grounded 2026-09-26)

| Site                                                       | What it does                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `core/src/model/id.ts`                                     | `generateId()`, `setIdGenerator()`, pure `uuidv7FromParts(unixMs, random)`; v4 `randomUUID()` fallback                               |
| `cli/src/workspace/idGenerator.ts`                         | `installUuidv7IdGenerator()`: `Date.now()`, `randomBytes(10)`, a 12-bit same-millisecond counter in `rand_a`, then `uuidv7FromParts` |
| `mcp/src/workspace/idGenerator.ts`                         | byte-identical copy                                                                                                                  |
| `vscode/src/client/idGenerator.ts`                         | byte-identical copy                                                                                                                  |
| `parity.manifest.json`, set `surface-id-generator`         | keeps the three copies byte-identical                                                                                                |
| `cli/tests/workspace/idGenerator.test.ts`, `mcp/tests/...` | identical: 50 ids from the real clock are v7-shaped and sorted. VS Code's copy has no test.                                          |
| `promptlab/src/evalcase/renderReference.ts`                | a fourth, deliberately different generator: timestamp 0 and a deterministic counter, so regenerated reference files are byte-stable  |

`scripts/check-core-purity.mjs` rejects `Date.now()`, `new Date()`,
`Math.random()` and global `crypto.*` in `core/src`. A factory that
receives `now` and `randomBytes` contains none of them.

**A latent edge the current tests cannot reach.** The counter is masked to
12 bits (`& 0xfff`), so the 4,097th id in one millisecond wraps to 0 and
sorts before the 4,096th. One run on a web container (Node 26.7.0), from
`barwise/` after `npm run build`:

```sh
node --input-type=module -e '
const core = await import("./packages/core/dist/index.js");
const { installUuidv7IdGenerator } = await import("./packages/cli/dist/workspace/idGenerator.js");
installUuidv7IdGenerator();
const ids = []; const t0 = Date.now();
while (Date.now() - t0 < 200) ids.push(core.generateId());
const perMs = new Map();
for (const id of ids) perMs.set(id.slice(0, 13), (perMs.get(id.slice(0, 13)) ?? 0) + 1);
let back = 0; for (let i = 1; i < ids.length; i++) if (ids[i] < ids[i - 1]) back++;
console.log({ total: ids.length, busiestMs: Math.max(...perMs.values()), outOfOrderPairs: back });'
```

printed `{ total: 32049, busiestMs: 236, outOfOrderPairs: 0 }`. In that run the
busiest millisecond held 236 ids, about 17 times short of the wrap. That is
one observation of one machine, not a bound: a faster `randomBytes` or a
future batch path could get closer. RFC 9562
section 6.2 says what to do on counter overflow: advance the timestamp.
The factory does that, and a fake clock that never moves tests it.

## Requirements

- **R1.** Core shall export `createUuidv7Generator({ now, randomBytes })`,
  returning an `IdGenerator`. The returned generator shall call `now()` once
  and `randomBytes(10)` once for every id it mints -- never once at
  construction with the result reused -- and shall call nothing else
  ambient, so `check:core-purity` stays green and every id carries fresh
  randomness.
- **R2.** When two ids are minted in the same millisecond, the second shall
  sort after the first; when more than 4,096 are minted in one millisecond,
  the generator shall advance the timestamp it encodes rather than wrap the
  counter, so the sort order still holds.
- **R3.** When the clock moves backwards (a clock step, NTP), the generator
  shall keep encoding the last timestamp it used and keep counting, so ids
  stay sorted in mint order. (Today's installer resets the counter and
  encodes the earlier time, which sorts the new id before older ones.)
- **R4.** The CLI, MCP server and VS Code extension shall each install the
  generator with `setIdGenerator(createUuidv7Generator({ now: Date.now,
  randomBytes }))`, and the three `idGenerator.ts` files and the
  `surface-id-generator` parity set shall be removed in the same change.

## Target architecture

```ts
// @barwise/core -- model/id.ts (beside uuidv7FromParts)
export interface Uuidv7Sources {
  readonly now: () => number; // Unix ms; Date.now at a surface, a fake in tests
  readonly randomBytes: (n: number) => Uint8Array; // node:crypto at a surface
}
export function createUuidv7Generator(sources: Uuidv7Sources): IdGenerator;

// each surface's entry point
import { randomBytes } from "node:crypto";
setIdGenerator(createUuidv7Generator({ now: Date.now, randomBytes }));
```

The counter state lives in the returned closure, one per call, so a test
can build two independent generators.

## Alternatives considered

- **Leave it as is.** Three identical files, kept honest by a parity check
  that works. The cost is small but real: R2 and R3 are untestable with
  the real clock, VS Code's copy has no test at all, and a fix to the
  counter has to be made three times. Losing it is cheap; that is the
  argument for doing this, not against.
- **Make UUIDv7 the default inside core** (core calls `Date.now()`). Removes
  the install step entirely. Rejected: it breaks the purity gate and the
  determinism principle it enforces, and bare library use (tests, scripts)
  would start producing time-dependent ids.
- **A shared helper package the three surfaces import.** Keeps the clock
  read out of core entirely. Rejected: it creates a new package, or a new
  dependency edge between surfaces that deliberately do not import each
  other (the parity set's own stated reason), to hold about 20 lines that
  core can hold without reading a clock.

## Workstreams

A single workstream: small, and the parts only make sense together.

1. Add `createUuidv7Generator` and `Uuidv7Sources` to `core/src/model/id.ts`
   and export them. Test in core with a fake clock and a fixed byte
   source: v7 shape and exact bytes for a fixed input; same-millisecond
   ordering; 5,000 ids on a clock that never moves still sort (R2); a
   clock that steps back 10 ms still sorts (R3); two generators do not
   share a counter; a byte source that records its calls shows one
   `randomBytes(10)` per id (R1).
   In the same change, update the contract in `core/src/model/id.ts` (the
   module docblock says fresh ids "embed their creation time"): under R2's
   overflow and R3's rollback the encoded timestamp is a logical one -- the
   last timestamp used, advanced -- not the wall clock at mint time. The
   docs must say ids sort in mint order and approximate creation time, not
   that they record it exactly.
2. Replace the three installers with the one-line call at each entry point
   (`cli/src/index.ts`, `mcp/src/index.ts`, `vscode/src/client/extension.ts`),
   delete the three `idGenerator.ts` files and the two surface tests that
   only re-test the copy, and remove the `surface-id-generator` parity set.
   Keep one surface-level smoke test per surface that the installed
   generator produces v7 ids, since that is the wiring the core test
   cannot see.

## Open decisions (for review)

- **D1. promptlab's deterministic generator.** It could become
  `createUuidv7Generator({ now: () => 0, randomBytes: seeded })`, but its
  counter starts at 1 and fills `rand_b` differently, so every regenerated
  reference file would change bytes. **Recommendation:** leave it; it is a
  fixture policy with a different purpose, not a fourth copy of this one.
- **D2. Keep a named installer in core** as a convenience, for example
  `installUuidv7IdGenerator(sources)`? It could take `Uuidv7Sources` and
  stay pure. **Recommendation:** no. It would be exactly
  `setIdGenerator(createUuidv7Generator(sources))` under another name --
  a second interface to learn that hides nothing, the shallow-module case
  CLAUDE.md names.

## Risks and testing

- Id format is unchanged for the same inputs (`uuidv7FromParts` does not
  change), so existing models and history are unaffected.
- **R2 and R3 are behaviour changes, and R3's case does happen.** R2 fires
  only past 4,096 ids in a millisecond, which the one run above did not
  approach. R3 is different: NTP corrections, manual clock changes, and VM
  suspend/resume all step the wall clock back, and nothing measured here
  says how often. Today such a step makes the next id sort before earlier
  ones; after this change it sorts after them, with an encoded time up to
  the size of the step later than the wall clock. That trade -- mint order
  kept, embedded time approximate -- is the one RFC 9562 section 6.2
  describes, and the workstream's docblock update states it.
- `npm run check:core-purity` must stay green; `npm run check:parity` must
  pass with the set removed.
- Build from `barwise/` before per-package type checks: the change crosses
  from core into three packages.

## Implementation notes

- **The VS Code wiring test needed a stand-in editor, not a real one.**
  The integration suite runs in a real editor but not in CI, so it could
  not be the guard. `vscode/tests/unit/activateIdGenerator.test.ts`
  mocks `vscode`, the language client and `@vscode/chat-extension-utils`
  (a CommonJS dependency that `require`s `vscode` itself) with an inert
  proxy, runs the real `activate()`, and reads the result through
  `generateId()`. The module stand-in answers `has` for every key,
  because vitest checks each named import against the mock.
- **The CLI wiring test spawns the built binary.** The CLI rule is that
  command tests go through `runCli`, but `runCli` never executes
  `src/index.ts`, which is the file under test here. The MCP test reuses
  the existing stdio spawn in `serverSpawn.test.ts`.
- **Mutation checks, run by hand.** Restoring the old counter logic (wrap
  at 4,096, reset on a backward step) fails exactly the R2 overflow test
  and the R3 test in core. Removing the install line from each of the
  three entry points, with the rest of the file compiling, fails that
  surface's wiring test and nothing else.

## Non-goals

- No change to how importers or anything else mint ids; `generateId()`
  stays the one entry point.
- No change to the v4 fallback for bare library use.
