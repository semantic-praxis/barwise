// Architecture conformance gate -- WS4 of
// docs/specs/archive/architecture-analysis.spec.md.
//
// This config IS the reflexion model: the intended one-way dependency
// graph from the root CLAUDE.md, encoded as machine-checkable rules and
// diffed against the actual import graph on every CI run. It owns the
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

// The intended graph: which @barwise/* packages each package may import.
// Source of truth is the root CLAUDE.md dependency graph.
const INTENDED = {
  "core": [],
  "diagram": ["core"],
  "diagram-ui": ["diagram"],
  "llm": ["core"],
  "code-analysis": ["core"],
  "dbt": ["core"],
  "formats": ["core"],
  "learn": ["core"],
  "promptlab": ["core", "llm", "learn"],
  "cli": [
    "core",
    "diagram",
    "diagram-ui",
    "llm",
    "code-analysis",
    "dbt",
    "formats",
    "learn",
    "promptlab",
  ],
  "mcp": ["core", "diagram", "diagram-ui", "llm", "code-analysis", "dbt", "formats", "learn"],
  "vscode": [
    "core",
    "diagram",
    "diagram-ui",
    "llm",
    "code-analysis",
    "dbt",
    "formats",
    "mcp",
  ],
};

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
  ],
  options: {
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    includeOnly: "^packages/[^/]+/src/",
    exclude: { path: "\\.(test|spec)\\.tsx?$" },
  },
};
