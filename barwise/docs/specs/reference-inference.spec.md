# Inferring references a schema does not declare, when asked to

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-c5f

In one sentence: `barwise import model --format ddl` and `import sql`
gain `--infer-references`, which reads a column named after another
table's key, with that key's type, as a reference to it, and reports
every reference it inferred; without the flag nothing changes.

## Principle

**Explicit over implicit: the user declares the convention, the
importer applies it.** Warehouse schemas routinely write no foreign keys
-- BigQuery's are `NOT ENFORCED` and usually omitted, and C07's skin
uses that idiom -- while naming every reference column after the key it
holds (`NETWORK_DEVICE.SITE_ID`). Reading those names as references is
right far more often than not, but not always (a `site_id` from another
system), and an importer that guessed by default would put
relationships into a model that no one stated.

## Options

| Option                                                 | C07 row                               | Risk                                              |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| A. infer by default, warn per inference                | passes                                | a wrong guess enters every import of every schema |
| B. infer behind `--infer-references` (recommended)     | passes when the trial passes the flag | none by default; the flag is the declaration      |
| C. never infer; declare the C07 checks not_expressible | stays out of reach                    | none; also no help for the common warehouse case  |

The rule under B: a column `X` in table `T` references table `U` when
`X` equals `U`'s single key column name, or `<U>_<key>`, or `<U>_id`
(case- and separator-insensitive; `U` matches in its own form or in
the other number by exactly these endings and no others: `ies` and
`y`, `es` and nothing, `s` and nothing -- so `categories` matches
`category`, `statuses` matches `status`, and an irregular plural such
as `people` matches only itself, PR #620 review), `U` is not
`T`, and the declared types match; a column that would match two tables
infers nothing and is reported. Each inference is a warning naming the
column and the table, so it can be checked by eye.

A column in `T`'s primary key is never inferred (PR #620 review): an
inferred reference there would be the key-is-reference shape of
key-reference-tables.spec.md, and one opt-in guess would feed a second,
the subtype heuristic. Such a column is reported as a candidate and left
alone.

The flag is refused unless the format is `ddl` (`import model`) or the
command is `import sql`: `import model` serves every text importer,
and `--format openapi --infer-references` would otherwise appear to do
something it did not (PR #620 review). The refusal has its own test.

## Requirements

1. When `--infer-references` is absent, the DDL and SQL importers shall
   infer no reference, whatever the column names.
2. When it is given, for a column `X` of table `T` that is not in `T`'s
   primary key and has no declared foreign key, the importer shall read
   a reference to table `U` when `X` matches `U`'s single key column by
   one of the three forms above, `U` is not `T`, and the declared types
   match; and shall warn once per inferred reference, naming the column
   and the table.
3. When a column matches two or more tables, the importer shall infer
   nothing for it and shall warn naming the candidates.
4. When a matching column is in `T`'s primary key, the importer shall
   infer nothing for it and shall warn that it is a candidate.
5. When the flag is given to `import model` with a format other than
   `ddl`, the command shall exit non-zero with a message naming the
   formats that accept it.
6. The flag shall reach the DDL importer through `import model --format
   ddl`, through `import sql` on a file, and through `import sql` on a
   directory.

## Scope

In scope: requirements 1-6 in the DDL importer, with `SqlImportFormat`
threading the option through its file and directory flows (today it
passes `DdlImportFormat.parse` only `{ modelName }` in both); unit tests
for each matching form, a type mismatch, a self-table match, the
ambiguous case, the key-column case and the flag absent; CLI tests that
observe an inferred relationship through all three paths of requirement
6 and the refusal of requirement 5 (PR #620 review); the CLI docs; and
the capability-matrix row for the flag, marked as a deliberate CLI-only
divergence, in the same commit as the flag (CLAUDE.md, capability
matrix).

Out of scope: MCP and VS Code, until there is a use for the flag there;
dbt, whose relationships tests already state references.

## Workstreams

1. **The flag and the inference** (formats, cli): requirements 1-6, the
   tests above, the docs and the matrix row.
2. **The trial passes it** (trial): a per-artifact `import_flags` list in
   `customer.yaml`, validated against the flags the importer accepts and
   appended by `importCommand` in `trial/lib/steps.mjs` (today it builds
   the arguments from importer, path and dialect alone); a trial test
   that an artifact's flags reach the command line; C07's BigQuery
   artifact given `--infer-references`; then a trial run and the C07 row
   reclassified. It depends on workstream 1.
