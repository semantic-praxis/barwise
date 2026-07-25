# UUIDv7 identifiers: creation order visible in the id

Status: Accepted (user-directed 2026-07-25) -- design ready for
implementation
Created: 2026-07-25
Last-updated: 2026-07-25
Tracking: project-owner directive (2026-07-25) alongside the role-path
sign-off; docs/BACKLOG-2026-07-25.md item 1 note

## Principle

Freshly minted model-element ids become UUIDv7, whose leading 48 bits
are a millisecond timestamp, so sorting ids lexicographically shows the
order in which elements were added to a model. Core stays clock-free:
the v7 bits are computed by a pure function in core from a timestamp
and random bytes supplied by the caller, and the ambient clock/random
wiring lives at the surfaces -- the same one-layer-out rule that keeps
LLM calls and network I/O out of core (S-DET-2/S-DET-3,
`check-core-purity`).

## Problem

Every element id today is `randomUUID()` (v4) minted inside core as a
constructor default (`model/ModelElement.ts:18`,
`model/FactType.ts:109`, `model/Population.ts:66,119`). v4 ids carry no
order: given two object types, nothing in the model says which was
added first. Modelers reviewing an evolving `.orm.yaml` -- and diff
tooling attributing changes across sessions -- want cheap creation-order
evidence.

UUIDv7 (RFC 9562) provides it: ids sort by creation time, remain
globally unique, and stay opaque strings to every consumer. But a naive
v7 implementation calls `Date.now()`, and core forbids clock reads --
the purity gate (`scripts/check-core-purity.mjs`) fails on `Date.now`
/ `new Date` in `core/src`. The current v4 default slips through only
because `randomUUID` is a named `node:crypto` import with no clock.

## Should the generator live in core or be injected? (resolved: pure kernel in core, ambient wiring injected from the surfaces)

Three options:

1. **v7 inline in core with `Date.now()`.** Rejected: breaks S-DET-3
   and the purity gate; the gate would need a sanctioned exception,
   eroding the pillar the 2026-06-23 review singled out as holding
   under pressure.
2. **Move all id minting out of core.** Rejected: every caller of
   `addObjectType`/`addFactType` would need to mint ids, a breaking
   API ripple across five packages for no modeling gain.
3. **Injectable generator with a pure v7 kernel (chosen).** Core gains
   `model/id.ts`: a pure `uuidv7FromParts(unixMs, randomBytes)`
   (deterministic given inputs -- unit-testable with fixed vectors) and
   a module-level `setIdGenerator(fn)` / `generateId()` seam defaulting
   to `randomUUID`. `ModelElement`, `FactType`, and `Population` mint
   through `generateId()`. Each surface entry point (CLI, MCP server,
   VS Code activation) installs
   `() => uuidv7FromParts(Date.now(), webcrypto.getRandomValues(...))`
   once at startup. Registration-at-startup is the established house
   seam -- `registerStandardFormats()` works the same way.

The small ambient closure is duplicated per surface; per the DRY-is-
secondary rule that duplication is preferred over a shared wiring
package that would couple the surfaces.

## Scope

- When a surface process starts, the system shall install a UUIDv7
  generator so ids minted during that process embed the creation
  timestamp.
- When core mints a default id with no generator installed, the system
  shall fall back to `randomUUID()` (v4) -- bare library consumers see
  no behavior change and no clock read.
- When two ids are minted in the same process at increasing
  timestamps, the system shall produce lexicographically increasing
  ids; within one millisecond, a monotonic counter in the ambient
  wiring keeps mint order and sort order aligned.
- When an element is created with an explicit id (serializer,
  importers, merge), the system shall preserve it unchanged -- v7
  applies only to fresh mints.

Out of scope: migrating existing ids (ids are opaque; mixed v4/v7/slug
models are valid); changing the JSON schema (ids stay unconstrained
strings); exposing timestamp extraction as a query primitive (possible
follow-up once ids are v7 in practice).

## Alternatives considered

- **The `uuid` npm package (v7 support).** Rejected: the no-trivial-
  dependency rule names `uuid` as its canonical example; the v7 bit
  layout is ~15 lines.
- **Sortable non-UUID ids (ULID, KSUID).** Rejected: `randomUUID`
  compatibility keeps every existing id valid under one format family,
  and NORMA/SQL tooling already round-trips UUID-shaped tokens.

## Workstreams

1. **Core kernel + seam.** `model/id.ts` with `uuidv7FromParts`,
   `generateId`, `setIdGenerator`; switch the three mint sites to
   `generateId()`. Fixed-vector tests (RFC 9562 version/variant bits,
   timestamp round-trip); purity gate stays green.
2. **Surface wiring.** Install the v7 generator in `cli` entry, `mcp`
   server startup, and `vscode` activation, with the same-millisecond
   counter. Per-surface smoke test: two models created in order carry
   ordered ids.

## Open decisions

- **Should `@barwise/llm`'s draft parsing also wire v7?** It mints
  nothing today (ids come from core defaults during model assembly),
  so the surface wiring covers it transitively; if extraction later
  mints ids directly, wire it then. Recommendation: no extra work now.

## Risks and testing

- _Purity._ `uuidv7FromParts` takes both inputs explicitly; the gate
  and a fixed-vector test guard it.
- _Uniqueness._ v7 carries 74 random bits per RFC 9562 -- collision
  risk is not worse than the practical v4 posture; the counter guards
  same-ms ordering, not uniqueness.
- _Round-trip._ Property round-trip suites already assert ids are
  preserved verbatim through serialization; they cover v7 ids for free.
