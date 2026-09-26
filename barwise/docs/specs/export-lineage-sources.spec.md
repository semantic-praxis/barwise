# Exports record what they were built from

Status: Implemented 2026-09-26 -- the single workstream; see Implementation notes

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-ofb

`barwise export model.orm.yaml --format ddl --output schema.sql` writes
a lineage manifest, `.barwise/lineage.yaml`, beside the model, and
`barwise lineage impact` reads it to say which artifacts a change to an
element affects. Every entry's `sources` is empty. The CLI records
`result.lineage`, and no export format sets it.
`generateDdlLineage` and `generateModelLineage` in
`packages/core/src/lineage/generate.ts` are exported and unit-tested,
but nothing calls them. They lost their callers when the interop
formats moved out of core. So `lineage impact` answers
`affectedArtifacts: []` with exit 0 for every element, on the CLI, in
MCP and in VS Code. The manifest's `sourceModel` is also the empty
string. After this change, every registered format records the model
elements each of its artifacts came from, and `lineage impact` finds
the artifacts.

## Principle

**A gate that cannot see its input must not print PASS**, applied to a
report: an empty `sources` list is indistinguishable from an artifact
that depends on nothing. A format that records nothing must say so.
The generators already exist; this change gives them their callers
(compare barwise-811, a builder with no call site).

## Requirements

- **R1.** Each registered export format shall set `ExportResult.lineage`.
  DDL, dbt, OpenAPI and Avro map through `RelationalMapper`, so they use
  `generateDdlLineage(model, schema)` on the schema they rendered.
  NORMA renders the model itself, so it uses `generateModelLineage`.
- **R2.** The CLI's manifest entry shall carry those sources, and
  `sourceModel` shall name the model file relative to the manifest's
  directory, so `resolveArtifact` can find it.
- **R3.** If a format sets no lineage, the CLI shall still write the
  entry but warn on stderr that `lineage impact` cannot see that
  artifact. An empty list is then a stated gap, not a silent one.
- **R4.** A test at the surface: export, then `lineage impact` on an
  element the artifact renders, with that artifact expected in the
  result. This is the test whose absence let the capability stay dead
  behind green unit tests.

## Scope

In: the five export formats, `updateManifest` (for `sourceModel`), the
CLI export command, and the trial rows under barwise-ofb. Out: MCP and
VS Code writing manifests of their own; today only the CLI's single-model
export writes one, and they read it. Also out: a project export writing a
manifest, which is a separate capability.

## Workstream (single)

Formats first, then the CLI, then the surface test and the trial.

## Risks and testing

- **Manifest size.** A DDL entry lists every element each table traces
  to. That is what `impact` needs, and the manifest is YAML beside the
  model, not a hot path.
- **Existing manifests.** An old manifest with empty `sources` keeps
  reading as it did; the next export of that artifact fills it in.
- Tests: each format sets lineage naming an element it renders; the
  CLI export-then-impact test; `sourceModel` is set. Each must fail
  against the code before its change.

## Open decisions

None.

## Implementation notes

- The 12 `late:impact-id` rows under barwise-ofb, one per customer, are
  retired: `lineage impact` by id now lists the exported artifacts.
  barwise-5m9 (`--element` given a name silently matches nothing) was
  blocked on this and is now its own question.
- R1 is tested twice: `packages/formats/tests/ExportLineage.test.ts`
  names the exporter that regressed, and
  `packages/cli/tests/commands/exportLineage.test.ts` is the R4 surface
  test over all five registered formats, dbt included. Both fail against
  the code before the change. The R3 warning is tested through a format
  registered by the test, because no shipped format is left without
  lineage.
