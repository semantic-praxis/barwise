// The external (non-@barwise) runtime dependencies a package may declare,
// for the packages whose list is a decision. Only core is listed: its dependencies
// decide what every surface ships, and an import that pulls in I/O or a
// heavy solver belongs one layer out (docs/adr/determinism-in-core.md).
// A package not listed here is unconstrained.
// Decision: docs/adr/package-graph-authority.md#core-external-deps
//
// A separate file from intended.cjs because that file's export IS the
// package map: every consumer reads each of its keys as a package, so a
// second map inside it would read as packages (spec:
// docs/specs/format-renderers-to-connectors.spec.md, WS4). check:architecture compares this with each
// listed package's runtime dependency fields, in both directions.
module.exports = {
  "core": ["ajv", "effect", "yaml"],
};
