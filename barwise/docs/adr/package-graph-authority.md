# Package graph authority

Scope: architecture
Date: 2026-11-06
Tracking: barwise-ubc, docs/specs/architecture-index.spec.md,
docs/specs/format-renderers-to-connectors.spec.md
Enforced-by: npm run depcruise (intended-is-graph),
npm run check:architecture (intended-is-graph, claude-md-rendering, runtime-deps-within, core-external-deps)

## Context

The intended package graph -- which `@barwise/*` package may import which
-- was stated in three places: the root `CLAUDE.md` "Dependency Graph"
block, the map in the dependency-cruiser rules, and a copy inside
`scripts/arch-triage.mjs`. Each said the root `CLAUDE.md` was its source,
nothing compared them, and the arch-triage copy had drifted: it lacked
promptlab entirely, and diagram-ui under cli and mcp. The reasoning and
the alternatives are in the spec named above.

## Decision

1. **`INTENDED` in `barwise/scripts/lib/intended.cjs` is the package
   graph.** {#intended-is-graph} It is the map dependency-cruiser enforces against real
   imports (`npm run depcruise`), and every script that needs the graph
   requires it; none keeps a copy.
2. **The root `CLAUDE.md` block is a rendering of it for readers** {#claude-md-rendering},
   drawn to the grammar `npm run check:architecture` reads, and checked
   against it in both directions.
3. **A package's runtime dependencies stay within it.** {#runtime-deps-within} `dependencies`,
   `peerDependencies` and `optionalDependencies` may name only the
   internal packages `INTENDED` allows; `devDependencies` may reach
   further, for tests.
4. **Core's external runtime dependencies are a reviewed list.** {#core-external-deps}
   Core's `dependencies`, `peerDependencies` and `optionalDependencies`
   name only the external packages `barwise/scripts/lib/external-deps.cjs`
   lists for it, and core imports only what its manifest declares. Every surface ships what core depends on,
   so adding a library to core is a decision taken in that file, in
   review, rather than in a manifest line.

## Consequences

- Changing the graph is one edit to `INTENDED` plus the `CLAUDE.md` row
  in the same commit; `check:architecture` fails until both agree, and
  `depcruise` fails on an import the map does not allow.
- A layering decision taken in a `package.json`, where depcruise does not
  look, fails `check:architecture` instead of shipping.
- `package-graph-authority.md#intended-is-graph`: `check:architecture`
  also holds the copies depcruise cannot see. Each package `CLAUDE.md`
  states its internal dependencies as Upstream rows of its
  `## Dependencies` table (all twelve carry one; core's says `none`), and
  those rows are compared with `INTENDED` both ways; external rows such as
  diagram-ui's `react` are ignored. The `## Dependency Rule` prose lists
  no internal package. In `barwise/scripts/` (tests and `intended.cjs`
  excepted) a property keyed by a package whose value is an array of
  package names fails, found by TypeScript's parser: that is one adjacency
  entry. A copy written another way, as `"cli->core"` strings or a `Map`,
  passes; every copy found so far had the adjacency shape.
- `package-graph-authority.md#core-external-deps`: `check:architecture`
  compares core's runtime dependency fields with its list both ways, so an
  unlisted package, a listed one core dropped, and a listed name that
  installs something else (an `npm:` alias, a `file:` or git source) all
  fail. `knip`'s `unlisted` check, a CI step, fails an import in core
  that its manifest does not declare at all. It runs in default mode,
  which counts `devDependencies` as declared, so `check:architecture`
  also reads the bare module specifiers in `core/src` (type-only imports
  count, because core's `.d.ts` re-exposes them; relative paths, `node:`
  and Node builtins are purity's) and fails any package missing from
  core's runtime fields, a `devDependencies` entry included. `knip`
  is not named in `Enforced-by:` because `check:architecture` accepts
  only gate names there (`check:*`, `audit:*` and its listed exceptions),
  and widening that list is a separate decision. The list lives in its own file
  because every consumer of `intended.cjs` reads each key as a package.
  Other packages' external dependencies are not listed or checked.
