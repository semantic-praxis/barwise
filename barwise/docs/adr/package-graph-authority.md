# Package graph authority

Scope: architecture
Date: 2026-10-23
Tracking: barwise-ubc, docs/specs/architecture-index.spec.md
Enforced-by: npm run depcruise (intended-is-graph),
npm run check:architecture (intended-is-graph, claude-md-rendering, runtime-deps-within),
none (barwise-ym8.d3m: intended-is-graph)

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

## Consequences

- Changing the graph is one edit to `INTENDED` plus the `CLAUDE.md` row
  in the same commit; `check:architecture` fails until both agree, and
  `depcruise` fails on an import the map does not allow.
- A layering decision taken in a `package.json`, where depcruise does not
  look, fails `check:architecture` instead of shipping.
- The per-package `CLAUDE.md` dependency-rule prose is not yet checked
  against the map (barwise-873).
