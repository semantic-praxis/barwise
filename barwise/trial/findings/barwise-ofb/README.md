# barwise-ofb: exports record no lineage sources, so impact is dead

## Reproduction

```sh
mkdir /tmp/lin && cp trial/customers/C01-hospital/kernel.orm.yaml /tmp/lin/model.orm.yaml
cd /tmp/lin
barwise export model.orm.yaml --format ddl --output schema.sql
cat .barwise/lineage.yaml
barwise lineage impact model.orm.yaml --element ot-encounter --format json
```

The manifest:

```yaml
version: 1
sourceModel: ""
exports:
  - artifact: /tmp/lin/schema.sql
    format: ddl
    sources: []
```

`schema.sql` renders the `encounter` table and says so in its own
annotation (`-- Source: Encounter (ot-encounter)`), yet impact on
`ot-encounter` returns `{ "changedElement": "ot-encounter",
"affectedArtifacts": [] }` with exit 0. Every element gives the same
answer.

## Cause

`packages/cli/src/commands/export.ts` records
`result.lineage?.flatMap((l) => l.sources) ?? []`, and no registered
exporter sets `result.lineage`. `generateDdlLineage` and
`generateModelLineage` in `packages/core/src/lineage/generate.ts` are
exported and unit-tested and have no production call site.

## How the trial missed it

The late-requirement sprint ran `lineage impact` and graded the exit
code. Copilot pointed that out on PR #509; graded on the report, the
step fails for every customer.
