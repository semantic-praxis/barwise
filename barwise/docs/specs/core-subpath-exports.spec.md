# Core subpath exports: slim the barrel

Status: Complete -- WS1 (subpaths + exports map), WS2 (consumer
migration), and WS3 (slim the root barrel, 318 -> 143 lines) have landed.
Created: 2026-06-16
Last-updated: 2026-06-17
Tracking: REPO_REVIEW-2026-06-16 finding F2 (originally A3 in the June
2026 review)

## Principle

The single `@barwise/core` barrel (`src/index.ts`, 72 export statements
across ~16 commented groups) is the #3 hotspot in the architecture
triage (22 changes), and the reflexion coupling table shows it dragging
`cli export`, `cli import`, and `mcp importModel` into its change sets:
every new public symbol edits one shared file that every consumer
depends on. That is an _explicit over implicit_ gap -- the file mixes
the foundational metamodel API with capability modules (mapping, diff,
verbalization, lineage, sql, ...) so neither consumers nor `knip` can
see which surface a given import belongs to -- and a mild _orthogonality_
tax, since unrelated capabilities share one edit point.

Subpath exports (`@barwise/core/mapping`, `@barwise/core/diff`, ...) give
each capability its own public entry, so a new mapping symbol no longer
touches the file that verbalization and lineage consumers depend on, and
the import site declares which capability it uses.

This is a P3 nicety, not a correctness fix. The spec keeps the change
staged and additive so it can stop after any workstream with the tree
green.

## Should we split the barrel? (resolved: yes, staged)

Yes. Three facts make it low-risk and worthwhile:

- _All packages are private and unpublished._ The public import surface
  has only in-repo consumers (79 files), all updated in the same build,
  so changing it is cheap -- no semver break, no external breakage.
- _No deep imports exist today._ Nothing imports
  `@barwise/core/<subpath>` yet, and the one cross-package test-helper
  import (`ModelBuilder`) is a _relative_ path
  (`../../../core/tests/helpers/...`), which bypasses the package
  `exports` map. So adding an `exports` map breaks nothing.
- _The folders already mirror the capabilities._ The split follows the
  existing `src/` layout; three folders (`describe`, `project`, `query`)
  already have index barrels.

The refinement that keeps it honest: an `exports` map _restricts_ what is
importable to the listed subpaths. That is the point (it hides
`dist/...` internals), and it is safe here precisely because no consumer
relies on a deep path today.

## Scope

In scope:

- A package `exports` map for `@barwise/core` with a curated root plus
  one subpath per capability module.
- Per-folder index barrels for the capabilities that lack one.
- Migrating the 79 in-repo import sites to the subpaths.
- Slimming the root barrel to the foundational API once nothing imports
  the moved capabilities from root.

Out of scope:

- Splitting `@barwise/core` into multiple packages. This is subpaths
  within one package, not a new node in the dependency graph.
- Re-exporting test helpers as a public subpath. `ModelBuilder` stays a
  relative import; it is a test fixture, not public API.
- Any behavior, type, or serialization change. Pure export topology.

## Inventory

Each barrel group and its target entry. Root keeps the foundational
metamodel and the format-registry seam; capabilities become subpaths.

| Barrel group                             | Target             | Barrel exists? |
| ---------------------------------------- | ------------------ | -------------- |
| Model                                    | root `.`           | add            |
| Serialization                            | root `.`           | add            |
| Validation                               | root `.`           | add            |
| Unified format system (registry)         | root `.`           | add            |
| Import / Export format types             | root `.`           | add            |
| Mapping + renderers + populationRenderer | `./mapping`        | new            |
| Diff / Merge                             | `./diff`           | new            |
| Verbalization                            | `./verbalization`  | new            |
| Counterexample                           | `./counterexample` | new            |
| SQL analysis                             | `./sql`            | new            |
| Annotation                               | `./annotation`     | new            |
| Lineage                                  | `./lineage`        | new            |
| Describe                                 | `./describe`       | exists         |
| Query                                    | `./query`          | exists         |

Root stays the foundational surface (model, serialization, validation,
the format registry, and the import/export interface types) because
those are used broadly and are what "depend on core" means. The nine
capability subpaths are each imported by a minority of consumers.

## Target architecture

```
packages/core/
  package.json
    "exports": {
      ".":                { types: "./dist/index.d.ts",               default: "./dist/index.js" },
      "./mapping":        { types: "./dist/mapping/index.d.ts",       default: "./dist/mapping/index.js" },
      "./diff":           { types: "./dist/diff/index.d.ts",          default: "./dist/diff/index.js" },
      "./verbalization":  { types: "./dist/verbalization/index.d.ts", default: "./dist/verbalization/index.js" },
      "./counterexample": { ... }, "./sql": { ... }, "./annotation": { ... },
      "./lineage": { ... }, "./describe": { ... }, "./query": { ... }
    }
  src/
    index.ts            # curated: model + serialization + validation + format registry
    mapping/index.ts    # new barrel; the mapping group moves here
    diff/index.ts       # new barrel
    ... (one per capability)

consumers:  import { RelationalMapper } from "@barwise/core/mapping";
            import { diffModels }      from "@barwise/core/diff";
            import { OrmModel }        from "@barwise/core";   // foundational stays at root
```

The `exports` map is the explicit public contract: only the root and the
nine subpaths are importable; `dist/...` internals are sealed.

## Alternatives considered

- **Additive only (keep the full root barrel, add subpaths beside it).**
  Zero migration, but the barrel stays the churn magnet and coupling
  point the finding is about -- it solves nothing, just adds aliases.
  Rejected as an end state; it _is_ WS1 (the safe first step) on the way
  to a curated root.
- **One subpath per file, or a flat re-export of everything.** Maximal
  granularity, but it turns every internal move into a public-API edit
  and floods the `exports` map. Rejected: folder-level capability
  subpaths match how the code is already organized and how consumers
  think.
- **Split core into multiple packages.** The strongest separation, but
  it adds nodes to the dependency graph, multiplies build/test/publish
  surface, and is a far larger change for a P3 concern. Rejected;
  subpaths get the legibility win without the package overhead.
- **Leave it (the barrel is only a soft coupling).** Defensible -- the
  coupling never violates the one-way graph. Rejected because the
  hotspot data shows real, recurring churn through one file, and the fix
  is cheap given private packages.

## Workstreams (each independently shippable)

### 1. Add subpath barrels and the exports map (additive)

Create `src/<folder>/index.ts` for `mapping`, `diff`, `verbalization`,
`counterexample`, `sql`, `annotation`, and `lineage` (describe, project,
and query already have one). Add the `exports` map listing root plus the
nine subpaths. The root `index.ts` is unchanged -- it still re-exports
everything, now partly by re-exporting the new subpath barrels. No
consumer changes; the build and every downstream import keep working.
Register the subpaths as `knip` entry points so the new barrels are not
flagged unused. This step is pure addition and reversible.

### 2. Migrate consumers to the subpaths

Rewrite the in-repo import sites capability by capability
(`@barwise/core` -> `@barwise/core/mapping`, etc.). Each capability is
its own PR and keeps the suite green; the one-way build surfaces every
site. Order by smallest first (e.g. `counterexample`, `sql`) to validate
the mechanics before the larger `mapping` set.

### 3. Slim the root barrel

Once `knip` confirms no consumer imports a moved capability from root,
delete those re-exports from `src/index.ts`. The barrel shrinks to the
foundational API; a new mapping or lineage symbol no longer edits it.
This is the step that realizes the finding; WS1-2 are the safe runway to
it.

## API and migration impact

- The `@barwise/core` public surface gains nine subpaths; after WS3 the
  root no longer re-exports the moved capabilities (a deliberate,
  in-repo-only break -- cheap because private).
- All nine downstream packages may update import paths (79 files), but
  only mechanically; no type or behavior changes.
- `knip.json` gains the subpaths as core entry points. `depcruise` is
  unaffected -- subpath imports still resolve to `packages/core/src`, so
  the direction rules (S-ORTH-1..3) hold unchanged.
- The vscode package's Bundler resolution honors the `exports` map the
  same as NodeNext, so no per-package config split is needed.

## Open decisions (for review)

- **How far to take it.** Recommend all three workstreams (curated root
  is the actual fix), but WS1 alone is a legitimate stopping point if the
  migration churn is judged not worth a P3 win. The staging makes either
  outcome safe.
- **Root membership.** Recommend root = model + serialization +
  validation + format registry + import/export types. The reviewer may
  prefer a thinner root (e.g. validation as `./validation`) or a fatter
  one. This is the one judgment call that affects how many sites move.
- **Subpath granularity.** Recommend the nine folder-aligned subpaths
  above; collapsing `counterexample` into `./validation` or `sql` into
  `./mapping` is reasonable if finer paths feel like overkill.

## Risks and testing

- The `exports` map could seal a path a consumer needs. Verified today:
  no deep `@barwise/core/<subpath>` imports exist, and `ModelBuilder` is
  a relative import, so nothing breaks on WS1. Re-check before WS3.
- Each workstream runs the full monorepo build + test (the one-way graph
  makes the build fail on any unmigrated or mistyped import), plus
  `depcruise`, `purity`, and `knip`.
- WS3 is the only step that can break a missed consumer; gate it on a
  clean `knip` (no remaining root imports of the moved symbols) and a
  green full build before merge.

## Non-goals

- No new package, no dependency-graph node, no behavior change.
- No public test-helper surface; `ModelBuilder` stays relative.
- No change to the format registry's composition model -- only where its
  symbols are imported from.
