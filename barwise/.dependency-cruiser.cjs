// Architecture conformance gate -- WS4 of
// docs/specs/archive/architecture-analysis.spec.md.
//
// This config IS the reflexion model: the intended one-way dependency
// graph (INTENDED, scripts/lib/intended.cjs, the authority), encoded as
// machine-checkable rules and diffed against the actual import graph on every CI run. It owns the
// orthogonality pillar -- direction (S-ORTH-1..3) and acyclicity
// (S-ORTH-4, which replaces the former madge check).
//
// It does NOT own determinism: dependency-cruiser sees imports, not code
// patterns, so the core-purity gate (no process.env / clock / randomness
// in core, scenarios S-DET-1..3) lives in scripts/check-core-purity.mjs.
//
// Resolution is pinned to source via tsconfig.depcruise.json so the rules
// hold whether or not the packages have been built to dist. Subpath
// exports (@barwise/core/annotation, @barwise/diagram-ui/server, ...)
// need exact entries in that tsconfig's "paths" -- the "@barwise/*"
// wildcard swallows a subpath and silently DROPS the edge from the
// graph (barwise-862). scripts/check-depcruise-gate.mjs derives the
// expected entries from each package.json's exports and fails when the
// mapping is missing or stale, and probes that a forbidden subpath
// import is actually reported.

// The intended graph lives in scripts/lib/intended.cjs, which is the
// authority for it; the root CLAUDE.md graph is checked against it
// (scripts/check-architecture.mjs).
const INTENDED = require("./scripts/lib/intended.cjs");

// One rule per package: forbid importing any sibling package's src that
// is not in its permitted set (itself plus its allowed dependencies).
const directionRules = Object.entries(INTENDED).map(([pkg, allowed]) => {
  const group = [pkg, ...allowed].join("|");
  return {
    name: `layer-${pkg}`,
    severity: "error",
    comment: "S-ORTH-1..3: a package may import only its permitted set (see INTENDED).",
    from: { path: `^packages/${pkg}/src/` },
    to: {
      path: "^packages/[^/]+/src/",
      pathNot: `^packages/(${group})/src/`,
    },
  };
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "S-ORTH-4: internal modules must not form an import cycle.",
      from: {},
      to: { circular: true },
    },
    ...directionRules,
    // ossie-interchange#peer-standard and #own-vocabulary: Ossie documents
    // enter and leave only through the `ossie` descriptor, and translation
    // lives only there. The ADR first described one rule, "only ossie/
    // imports Ossie modules"; it fails on main, because the barrel exports
    // the descriptor's types, and with the barrel allowed it misses a
    // re-export. So two rules (adr-batch9-enforcers.spec.md, WS3). The
    // vendored schema under formats/schemas/ is outside includeOnly, so
    // this cannot see it; check:source-sites' ossie-schema-refs does.
    {
      name: "ossie-only-in-descriptor",
      severity: "error",
      comment:
        "ossie-interchange#peer-standard: only formats/src/ossie/ and the package's two entry "
        + "files (index.ts, registration.ts) reach an Ossie module.",
      from: {
        pathNot: "^packages/formats/src/(ossie/|index\\.ts$|registration\\.ts$)",
      },
      to: { path: "^packages/formats/src/ossie/" },
    },
    {
      // Keyed on the target file, not the exported name, so an aliased
      // re-export (`export { parseOssie as parse }`) is still an edge to
      // parseOssie.ts and fails here.
      name: "ossie-entry-points",
      severity: "error",
      comment: "ossie-interchange#own-vocabulary: the entry files reach only the adapters and the "
        + "document types, never the parser, mapper or writer behind them.",
      from: { path: "^packages/formats/src/(index|registration)\\.ts$" },
      to: {
        path: "^packages/formats/src/ossie/",
        pathNot:
          "^packages/formats/src/ossie/(OssieExportFormat|OssieImportFormat|OssieTypes)\\.ts$",
      },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    includeOnly: "^packages/[^/]+/src/",
    exclude: { path: "\\.(test|spec)\\.tsx?$" },
  },
};
