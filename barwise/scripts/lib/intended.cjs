// The package graph: which @barwise/* packages each package may import.
//
// This map is the authority (docs/specs/architecture-index.spec.md,
// resolved by the owner 2026-10-23). The root CLAUDE.md "Dependency
// Graph" block is a rendering of it for readers, and
// scripts/check-architecture.mjs fails when that block, or a package's
// runtime `dependencies`, disagrees with it. It lives here rather than in
// .dependency-cruiser.cjs because that file may export only `forbidden`
// and `options`, so nothing else could read the map from it -- which is
// how arch-triage.mjs came to keep a copy that drifted (it lacked
// promptlab entirely, and diagram-ui under cli and mcp).
//
// Keys are package directory names under barwise/packages/.
module.exports = {
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
