# A routed constraint is a source of its table, and a subtype rule has an example

Status: Draft

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-20o, barwise-j7j
Plan-reviewed: 72344ba4 (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/core/src/lineage/generate.ts,
barwise/packages/core/src/lineage/impact.ts,
barwise/packages/mcp/tests/tools/impactAnalysis.test.ts,
barwise/packages/core/src/annotation/constraintSpec.ts,
barwise/packages/formats/src/ddl/DdlExportFormat.ts,
+barwise/packages/core/tests/lineage/routedConstraints.test.ts,
barwise/packages/core/tests/mapping/ConstraintRouting.test.ts

This spec fixes two gaps in what the DDL export reports.

- **barwise-20o.** When the DDL export writes a constraint onto a table,
  as a UNIQUE or CHECK clause or as a spilled comment, that table's
  lineage shall list the constraint as a source. Today it does not.
  Changing a ring or an unenforced mandatory changes the DDL text, but
  `barwise lineage impact <constraint id>` reports no affected DDL.
- **barwise-j7j.** When a constraint over subtypes spills, its
  ConstraintSpec shall carry an example of the instance it forbids.
  Today the example reads "No concrete example available; see the
  verbalization."

## Principle

Explicit over implicit, and one decision in one place. The router
already decides which table each constraint lands on. Lineage reads
that decision rather than deciding again, so the two cannot disagree.
For the example, the counterexample generator's contract is that its
populations trip population validation. A subtype instance has no
population to mint, so the example is written by the spec builder
beside the counterexample, and the generator's contract (and its law
test) is left as it is.

## Observed today (at 2bc4f3db)

- `routeAll` (`constraintRouting.ts`) knows the constraint behind each
  clause and spill. `routeConstraints` drops it: `RoutedClause` and
  `SpilledConstraint` carry a table name and SQL or a spec, but no
  constraint id.
- `generateDdlLineage(model, schema)` lists, per table:
  - the source element;
  - the fact types of its columns' roles;
  - the referenced entities and the constraints behind its foreign keys.

  It has no routing input. The DDL, dbt, OpenAPI and Avro exports call
  it. Only the DDL export routes constraints into its text.
- `lineage impact` words a `Constraint` source as "enforces constraint
  X" (`impact.ts`). That is true of a foreign key's constraint, and not
  of a spilled one, which the DDL only comments.
- `generateModelLineage` indexes constraints over subtypes and names
  each `<label>: subtypes of <Supertype>`.
- `buildConstraintSpec` takes its example from
  `generateCounterexampleInView`, which returns undefined for a
  constraint over subtype facts ("subtype membership is not populated
  in a model"). Every format that reports an unexpressed constraint uses
  it: the DDL spills, the Ossie writer and verifier, and the OpenAPI, Avro
  and dbt reports (`unreportedConstraintSpecs`). The example reaches a
  person through the export result's `constraintSpecs`, as the MCP
  export tool's detail report shows it. The DDL comment carries only the
  verbalization.
- `tests/laws/counterexample.law.test.ts` requires every generated
  counterexample to trip its own population rule.
- Measured with the prototype over the 84 tracked models that load
  (scratchpad `j7j-measure.mjs`):
  - DDL lineage gains 372 constraint sources across 205 tables;
  - the 14 subtype constraints that spill now get an example. The other
    14 "No concrete example" specs are kinds the generator leaves out
    on purpose (value comparison, cardinality, joins);
  - no CLI golden changes, and the core, formats, dbt, cli and mcp
    suites pass.

## Scope

### Workstream 1: lineage reads the routing (barwise-20o)

- `ConstraintRouting` shall gain `placements: readonly
  ConstraintPlacement[]`, holding `{ tableName, inView }` for each
  constraint the routing wrote on a table, once per pair.
  - It is recorded where a clause or a spill is pushed.
  - It carries the constraint the router placed, not an id to look up
    again: a duplicate id would resolve to another constraint.
  - A spill with no table is not placed. The DDL writes it after the
    last table, and no lineage entry stands for the file's tail. That is
    the one routed constraint lineage still cannot name.
- `generateDdlLineage` shall take an optional third argument,
  `placements` (default none).
  - For each placement on a table, it adds the constraint as a
    `Constraint` source of that table's entry, with the fact types it
    names, as it does for a foreign key's constraint. A constraint with
    no id is skipped, since a source needs one.
  - Placements are grouped by table once, not scanned per table.
  - The DDL export passes `routing.placements`. The dbt, OpenAPI and
    Avro exports pass none: they write no routed constraint into their
    text.
- Every constraint source is named by one helper, `constraintSource`:
  the foreign key's, the placed one, and the model lineage's subtype
  constraints. A constraint over subtypes is named `<label>: subtypes of
  <Supertype>` everywhere.
- `lineage impact` words a constraint source "states constraint X", true
  of a key the DDL enforces and of a comment it only records.
- Tests:
  - a ring that spills onto a table, and a CHECK clause, are each listed
    as a source of that table;
  - a subtype exclusion is listed as a source of its supertype's table;
  - each test fails without the placements.

### Workstream 2: a subtype rule's example (barwise-j7j)

- When `buildConstraintSpec` gets no counterexample for a constraint
  over subtypes, the example shall name the forbidden instance:
  - an exclusion: `Forbidden: one Party in both LegalEntity and
    NaturalPerson`;
  - a disjunctive mandatory: `Forbidden: one Party in none of:
    LegalEntity, NaturalPerson`;
  - an exclusive-or: both forms, joined by `, or`.

  The first two subtypes stand for the pair. A disjunctive mandatory
  over one subtype reads `one Staff in none of: Assistant`. When any
  subtype does not resolve to a name, the example stays as it is today,
  since a list with one left out would forbid an allowed instance.
- `generateCounterexampleInView` is unchanged, so its law still holds
  over every counterexample it returns.
- The example reaches every format that reports the constraint
  through `buildConstraintSpec`: the DDL, Ossie, OpenAPI, Avro and dbt
  reports alike.
- Tests: one per kind, the single-subtype disjunctive mandatory, and the
  unresolved case, at `buildConstraintSpec`. Each new-example test fails
  on today's code.

## Open decisions

1. **Where the subtype example comes from.**
   - (a) The spec builder (recommended). The example is text, the
     counterexample contract stays a population that validation rejects,
     and its law test is untouched.
   - (b) A `Counterexample` with no populations. Every consumer gets one,
     but the law test would need an exemption, which weakens the one
     check that a counterexample is real.

   Recommend (a).
2. **Which constraints count as placed.**
   - (a) Clauses and spills alike (recommended). Both change the table's
     text.
   - (b) Spills only, as the issue names. A UNIQUE or CHECK clause from a
     constraint would stay out of lineage, though changing it changes
     the table just the same.

   Recommend (a). Most of the 372 new sources are clauses.

## Risks and testing

`barwise lineage impact` now reports DDL tables for many more
constraints. That is the fix. No tracked file holds a lineage manifest,
so nothing in the repository goes stale. The exported DDL text is
byte-identical. The subtype examples change only the `constraintSpecs`
an export returns. Placements are recorded when the router decides, not
when the text pass writes them. A table name the clause injector cannot
match (one holding a doubled quote) is a pre-existing injection defect,
and it would list a source the text lacks.
