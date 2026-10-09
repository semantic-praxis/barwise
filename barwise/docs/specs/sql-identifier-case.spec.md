# Column names in a DDL import compare the way SQL compares them

Status: Draft -- no workstream implemented
Created: 2026-10-09
Last-updated: 2026-10-09
Tracking: barwise-yvx (and barwise-sl4, which workstream 1 closes)

In one sentence: every place the DDL importer asks "is this the same
column?" goes through one comparator, which ignores case for unquoted
names and respects it when both names are quoted.

## Principle

**Define errors out of existence, by solving the comparison once.** SQL
folds the case of an unquoted identifier and keeps the case of a quoted
one. The importer currently answers "same column?" in about fifteen
places, each choosing for itself, and they disagree:

- **Exact comparison** (`fk.columns.includes(column.name)`, the
  composite-key reading, `foreignKeysOfKey`): an unquoted `site_id`
  column and `FOREIGN KEY (SITE_ID)` are treated as different columns,
  so a declared foreign key is dropped with no warning. This is
  barwise-sl4, and it happens on main with no flag.
- **Case-folded comparison** (the subtype rule from #623 and #625,
  reference inference from #628, CHECK matching, `columnKey` for
  annotations): a quoted `"subject_id"` and a quoted `"SUBJECT_ID"`,
  which are two different columns in every dialect, are treated as one.
  That is the Copilot thread on #625, which was deferred to this spec.

Both are the same defect. `unquote` and `identifierList` in
`sqlIdentifiers.ts` drop the quotes at parse time, so no later step can
know which rule applies. Each fix since #623 has patched one comparison
site, and the next review found another. Change amplification is the
cost: one decision, edited in fifteen places.

## Should a quoted name ever match an unquoted one? (resolved: yes, ignoring case)

Whether `"subject_id"` matches a bare `SUBJECT_ID` depends on the
dialect. PostgreSQL folds unquoted names to lower case, so it matches.
Oracle and DB2 fold to upper case, so it does not, but `"SUBJECT_ID"`
does. The importer has no dialect: one parser reads the fourteen trial
dialects. So when one name is quoted and the other is not, the
comparator ignores case. That gives the right answer under both folding
directions for every name a real schema writes in a single case. It
gives a wrong match only when a table holds two quoted columns that
differ only in case and an unquoted reference to one of them. In that
case the reference is ambiguous, and the importer warns instead of
choosing.

## Scope

In scope:

- When two column names are both unquoted, the system shall treat them
  as the same column if they are equal ignoring case.
- When two column names are both quoted, the system shall treat them as
  the same column only if they are exactly equal.
- When one column name is quoted and the other is not, the system shall
  treat them as the same column if they are equal ignoring case.
- When an unquoted reference in a constraint (a PRIMARY KEY, UNIQUE or
  FOREIGN KEY column list, or a REFERENCES target) matches more than one
  column of its table, the system shall warn naming the table and the
  reference, and import the constraint against none of them.
- When a table has two columns whose names produce the same value type
  name (`"subject_id"` and `"SUBJECT_ID"` both become `SubjectId`), the
  system shall warn naming both columns.

Out of scope:

- **Table names.** `tableKey` and `bareName` fold table names the same
  way, with the same theoretical defect. No schema in the tests or the
  trial has two tables whose names differ only in case, and reference
  inference's dot rule (kept as is by the owner on 2026-10-09) already
  depends on that folding. A separate issue if a real schema needs it.
- **The dbt importer.** It reads column names from `schema.yml` and
  compiled SQL with its own rules, in `@barwise/dbt`. It is a separate
  package with its own I/O (CLAUDE.md, connector convention), so it is
  not changed here.
- **Exports.** The DDL exporter writes the names it is given; nothing
  here changes what it emits.

## Inventory

| Site (in `packages/formats/src/ddl/`)                                | Compares today       | Verdict                         |
| -------------------------------------------------------------------- | -------------------- | ------------------------------- |
| `sqlIdentifiers.ts` `unquote`, `identifierList`                      | drops quotedness     | WS2: keeps it                   |
| `DdlImportFormat.ts` column step, `fk.columns.includes(column.name)` | exact                | WS1: comparator (fixes sl4)     |
| `DdlImportFormat.ts` `compositeReading`, `foreignKeysOfKey`          | exact                | WS1: comparator                 |
| `DdlImportFormat.ts` value-binary and entity checks (~998, ~1312)    | exact                | WS1: comparator                 |
| `DdlImportFormat.ts` `subtypeReading`                                | folded               | WS1: comparator                 |
| `DdlImportFormat.ts` `inferReferences` local `same`                  | folded               | WS1: comparator, local removed  |
| `DdlImportFormat.ts` CHECK and value-constraint matching (~720-827)  | folded               | WS1: comparator                 |
| `DdlImportFormat.ts` subtype-link skip (~495)                        | folded               | WS1: comparator                 |
| `barwiseAnnotation.ts` `columnKey`                                   | folded               | unchanged: barwise writes these |
| `DdlImportFormat.ts` `toPascalCase` for value type names             | folds, can collide   | WS3: warns on a collision       |
| `nameMatching.ts` `bareName`, `headNoun`                             | folded (table names) | unchanged: table names          |

`columnKey` stays folded on purpose. Annotations are written by
barwise's own exporter, which never emits two columns that differ only
in case, so there is nothing for it to tell apart.

## Target architecture

```ts
// sqlIdentifiers.ts: the parser keeps whether a name was quoted.
export interface SqlName {
  /** The name without its quotes, as written. */
  readonly text: string;
  readonly quoted: boolean;
}

// nameMatching.ts: the one place "same column?" is answered.
export function sameColumn(a: SqlName, b: SqlName): boolean {
  if (a.quoted && b.quoted) return a.text === b.text;
  return a.text.toLowerCase() === b.text.toLowerCase();
}
```

`ParsedColumn.name`, `ParsedTable.primaryKey`, `uniqueConstraints`,
`ParsedForeignKey.columns` and `referencedColumns`, and
`ParsedColumn.references.column` carry `SqlName` instead of `string`.
Display (warnings, `toPascalCase`) reads `.text`. Every comparison
calls `sameColumn`.

## Alternatives considered

- **Fold everything, and close the #625 thread as accepted.** One line
  of change and consistent with today's majority. It leaves a valid
  schema conflated, and it is the behavior the reviewer flagged. The
  owner chose to track the fix instead (2026-10-09).
- **A canonical key per name** (unquoted lowercased, quoted kept
  exactly), compared with `===` and usable in maps. Simpler at call
  sites, but it cannot express the mixed case: a key-based rule must
  pick one folding direction, which is right for PostgreSQL and wrong
  for Oracle, or the reverse. The comparator answers both.
- **Keep the quote characters in the stored string** and unquote on
  display. Avoids a type change, but every display site must remember
  to strip, and forgetting puts quotes into model names. A type makes
  the compiler find every site.

## Workstreams (each independently shippable)

### 1. One comparator, case-insensitive (closes barwise-sl4)

Add `sameColumn(a: string, b: string)` to `nameMatching.ts`, comparing
without case, and route every site in the Inventory through it,
removing `inferReferences`' local `same`. No parser change. This fixes
the dropped foreign key in barwise-sl4 and makes every site agree. It
does not yet separate quoted names; it moves the whole importer to the
behavior most sites already have.

Acceptance: the barwise-sl4 statement
(`site_id INT, FOREIGN KEY (SITE_ID) REFERENCES region (region_id)`)
imports a NetworkDevice-Region fact type. A test of the composite-key
reading with mixed-case key and foreign-key lists passes. A test pins
that `DdlImportFormat.ts` has no column comparison outside `sameColumn`
(a source scan for `.includes(column.name)` and
`.toLowerCase() ===` on column names), so a sixteenth site cannot be
added the old way; this is the drift guard CLAUDE.md requires for a
must-agree rule.

### 2. The parser keeps quotedness

Introduce `SqlName`, make `unquote` and `identifierList` return it, and
change `sameColumn` to the target signature. Two quoted names that
differ only in case become distinct. The ambiguous-reference warning
lands here, because this is the first workstream where a reference can
match two columns.

Acceptance: the #625 thread's table (`PRIMARY KEY ("subject_id")` and
`FOREIGN KEY ("SUBJECT_ID")`) does not infer a subtype. A bare
`subject_id` in a table with both quoted columns produces the
ambiguity warning. Every existing DDL test, the trial's fourteen
dialect files, and `examples/` import unchanged.

### 3. Warn when two columns collide on a value type name (provisional: not yet grounded)

After WS2, a table can hold two distinct columns that `toPascalCase`
maps to one value type name. What the model builder does with that
today has not been checked. At minimum the import warns; whether it
also renames one value type is decided when this is grounded.

## API and migration impact

- No public export changes. `SqlName` and `sameColumn` are internal to
  `@barwise/formats`.
- `sqlIdentifiers.ts` has a byte-identical copy in the trial's DDL
  generator for `CREATE_TABLE_PREFIX`, registered in
  `parity.manifest.json`. WS2 does not touch that pattern; if it did,
  the manifest check would fail.
- No downstream package changes. The CLI, MCP and VS Code surfaces call
  the importer and see only different, more correct output.

## Open decisions (for review)

- **Mixed quoted and unquoted comparison.** Recommended: ignore case,
  as above, because the importer has no dialect. The alternative is a
  `--sql-dialect` option that sets the folding direction: exact for
  every dialect, but a new flag for a case no schema has shown.
- **Ambiguous reference: warn and skip, or warn and pick the first.**
  Recommended: skip. Picking one invents a relationship the DDL did not
  determine, and the warning tells the user why it is missing.

## Risks and testing

- WS1 changes behavior only where exact comparison failed before, so
  every existing test should pass unchanged; a test that changes is a
  finding, not a fixture to update.
- WS2 changes the parsed types throughout `DdlImportFormat.ts`. The
  compiler finds every site; the risk is a display site reading
  `.text` where it should compare. The source-scan test from WS1 keeps
  catching comparisons.
- After each workstream: `npm run build` and the formats and cli tests,
  then the trial's DDL rows, which exercise all fourteen dialects.

## Non-goals

- No change to how table names or dbt column names are compared.
- No dialect detection.
- No change to what the DDL exporter writes.
